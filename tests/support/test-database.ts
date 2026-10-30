/**
 * @file test-database.ts
 * @project ocs-answer-hub
 * @module 临时测试数据库
 * @description 为数据库和浏览器测试创建独立 PostgreSQL 容器，不读取应用连接配置。
 * @logic 随机容器名与密码、回环随机端口、等待就绪，测试结束仅删除本次容器。
 * @dependencies Docker, node:child_process, node:crypto
 * @index_tags test, database, isolation
 * @author holic512
 */
import {execFile} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {promisify} from 'node:util';
import {setTimeout} from 'node:timers/promises';

const execute=promisify(execFile);
export async function createTestDatabase(){
 const name=`ocs-test-${randomBytes(8).toString('hex')}`;
 const password=randomBytes(24).toString('hex');
 const close=async()=>{await execute('docker',['rm','-f',name]);};
 await execute('docker',['run','-d','--name',name,'-e','POSTGRES_PASSWORD','-e','POSTGRES_DB=answer_hub_test','-p','127.0.0.1::5432','postgres:17-alpine'],{env:{...process.env,POSTGRES_PASSWORD:password}});
 try{
  for(let attempt=0;;attempt++){
   try{await execute('docker',['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres']);break;}
   catch{if(attempt===59)throw new Error('临时 PostgreSQL 启动超时');await setTimeout(250);}
  }
  const {stdout}=await execute('docker',['port',name,'5432/tcp']);
  const port=stdout.trim().split(':').at(-1)!;
  return {url:`postgresql://postgres:${password}@127.0.0.1:${port}/answer_hub_test`,close};
 }catch(error){await close();throw error;}
}
