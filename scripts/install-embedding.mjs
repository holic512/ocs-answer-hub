/**
 * @file install-embedding.mjs
 * @project ocs-answer-hub
 * @module 本地模型安装
 * @description 下载固定版本 BGE-small-zh-v1.5 INT8，验证官方权重摘要后原子安装。
 * @logic 仅部署阶段联网，绝对目录输出，不覆盖已有不同内容，支持显式指定镜像站。
 * @dependencies node:fs/promises, node:crypto, fetch
 * @index_tags embedding, installation, integrity
 * @author holic512
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const revision='75c43b069aac4d136ba6bc1122f995fedcfd2781';
const weightSha256='b9837c19ce154ff0726d398ee77abbc03a7faf0476c6f93016c84e531be7ebb5';
const files={
 'config.json':'d4193ead3a810fd694fa8a31d7fc72fbaebc0668b603e398734bf2f6538ff42f',
 'tokenizer.json':'48cea5d44424912a6fd1ea647bf4fe50b55ab8b1e5879c3275f80e339e8fae26',
 'tokenizer_config.json':'e6f3b96db926a37d4039995fbf5ad17de158dfb8f6343d607e4dbaad18d75f5a',
 'special_tokens_map.json':'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3',
 'onnx/model_int8.onnx':weightSha256
};
const destination=process.argv[2],mirror=process.argv[3]==='--mirror';
if(!destination||!path.isAbsolute(destination)||process.argv.length>5||(process.argv[3]&&!mirror))throw new Error('用法：node scripts/install-embedding.mjs /绝对路径/bge-small-zh-v1.5 [--mirror]');
const origin=mirror?'https://hf-mirror.com':'https://huggingface.co';
const sha256=buffer=>createHash('sha256').update(buffer).digest('hex');
await fs.mkdir(destination,{recursive:true});
for(const [file,expectedHash] of Object.entries(files)){
 const target=path.join(destination,file);
 let existing;try{existing=await fs.readFile(target);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(existing){
  if(sha256(existing)!==expectedHash)throw new Error(`${file} 已存在但 SHA256 不匹配；未覆盖，请移至其它位置后重试`);
  console.log(`${file}: SHA256 已核验，保留现有文件`);continue;
 }
 const response=await fetch(`${origin}/Xenova/bge-small-zh-v1.5/resolve/${revision}/${file}`,{signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw new Error(`${file} 下载失败：HTTP ${response.status}`);
 const buffer=Buffer.from(await response.arrayBuffer());
 if(sha256(buffer)!==expectedHash)throw new Error(`${file} SHA256 与固定版本不一致，未安装`);
 if(file.endsWith('.onnx')){
  if(buffer.length!==23903394||sha256(buffer)!==weightSha256)throw new Error('INT8 权重大小或 SHA256 与官方固定版本不一致，未安装');
 }else{
  if(buffer.length>2*1024*1024)throw new Error(`${file} 大小不符合预期`);
  JSON.parse(buffer.toString('utf8'));
 }
 await fs.mkdir(path.dirname(target),{recursive:true});
 const temporary=`${target}.partial-${randomUUID()}`;
 try{await fs.writeFile(temporary,buffer,{flag:'wx',mode:0o644});await fs.rename(temporary,target);}finally{await fs.rm(temporary,{force:true});}
 console.log(`${file}: ${sha256(buffer)}`);
}
console.log(`安装完成：Xenova/bge-small-zh-v1.5 @ ${revision}\n运行时设置 LOCAL_EMBEDDING_PATH=${destination}，推理只读取本地文件。`);
