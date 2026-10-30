/**
 * @file deployment.ts
 * @project ocs-answer-hub
 * @module 容器入口
 * @description 首次配置初始化、启动前校验与健康检查。
 * @logic 默认模板与配置目录分离，只创建缺失配置；应用以非 root 身份读取配置。
 * @dependencies node:fs, node:path, config
 * @index_tags docker, config, deployment
 * @author holic512
 */
import {constants} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {loadRuntimeConfig} from './config.js';

try{
 const action=process.argv[2]??'start';
 if(action==='init')await initialize();
 else if(action==='check'){
  const config=loadRuntimeConfig();
  await fs.mkdir(config.stateDir,{recursive:true,mode:0o700});
  await fs.access(config.stateDir,constants.W_OK);
  console.log('运行配置校验通过，状态目录可写；未连接数据库，未输出配置内容');
 }else if(action==='health'){
  const config=loadRuntimeConfig();
  const host=config.host==='0.0.0.0'?'127.0.0.1':config.host==='::'?'[::1]':config.host;
  const response=await fetch(`http://${host}:${config.port}/api/health`,{signal:AbortSignal.timeout(4000)});
  if(!response.ok)process.exitCode=1;
 }else if(action==='start')await import('./index.js');
 else throw new Error('未知容器命令，可用命令为 init、check、start、health');
}catch(error){
 // 启动错误可能携带带凭据的数据库连接信息，入口仅展示明确的配置错误。
 console.error(error instanceof Error&&(/^(运行配置|无法读取运行配置|未知容器命令)/.test(error.message))?error.message:'容器操作失败，请检查数据库连通性、迁移状态及目录权限；未输出敏感配置');
 process.exitCode=1;
}

async function initialize(){
 const file=process.env.CONFIG_FILE??'/app/config/config.env';
 const storage=process.env.STATE_DIR??'/app/storage';
 for(const directory of [path.dirname(file),storage]){
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  if(process.getuid?.()===0)await fs.chown(directory,1000,1000);
 }
 try{
  await fs.copyFile('/app/defaults/config.env',file,constants.COPYFILE_EXCL);
  await fs.chmod(file,0o600);
  if(process.getuid?.()===0)await fs.chown(file,1000,1000);
  console.log('已生成默认 config.env，请填写数据库密码和访问地址后再启动应用');
 }catch(error:any){
  if(error.code!=='EEXIST')throw error;
  console.log('配置文件已存在，完整保留原内容及文件权限');
 }
}
