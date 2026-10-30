/**
 * @file clean.mjs
 * @project ocs-answer-hub
 * @module 开发清理
 * @description 清理可重新生成的构建产物、验收报告和工具缓存。
 * @logic 使用固定目录清单，支持预览；保留依赖、配置、业务数据和密钥。
 * @dependencies node:fs/promises, node:path, node:url
 * @index_tags development, cleanup
 * @author holic512
 */
import {lstat,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const args=process.argv.slice(2);
if(args.some(arg=>arg!=='--dry-run')){
 console.error('用法：node scripts/clean.mjs [--dry-run]');
 process.exit(1);
}
const root=fileURLToPath(new URL('../',import.meta.url));
const preview=args.includes('--dry-run');
const targets=['dist','artifacts','coverage','.vite','playwright-report','test-results','node_modules/.vite','node_modules/.cache','delpoy/__pycache__','tests/__pycache__'];
let count=0;
for(const target of targets){
 const file=path.join(root,target);
 try{await lstat(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}
 if(!preview)await rm(file,{recursive:true,force:true});
 console.log(`${preview?'将清理':'已清理'}：${target}`);
 count++;
}
console.log(count?`${preview?'预览':'清理'}完成，共 ${count} 项。`:'没有需要清理的开发产物。');
