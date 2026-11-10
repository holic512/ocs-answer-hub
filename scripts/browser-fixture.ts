/**
 * @file browser-fixture.ts
 * @project ocs-answer-hub
 * @module 桌面验收环境
 * @description 为浏览器验收提供隔离数据库和模拟 AI，不连接用户或生产数据。
 * @logic 启动真实应用、准备题库与模拟协议，退出后清理临时数据库和密钥。
 * @dependencies app, questions, test-database
 * @index_tags browser, fixture, isolation
 * @author holic512
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildApp} from '../server/app.js';
import {storeQuestion} from '../server/modules/questions.js';
import {prepare} from '../server/search.js';
import {encrypt} from '../server/security.js';
import {createTestDatabase} from '../tests/support/test-database.js';
export async function browserFixture(){
 const database=await createTestDatabase(),stateDir=await fs.mkdtemp(path.join(os.tmpdir(),'ocs-browser-')),origin='http://127.0.0.1:18772';
 try{
  const built=await buildApp({databaseUrl:database.url,origin,stateDir,staticDir:fileURLToPath(new URL('../dist/web',import.meta.url)),test:true,transport:async()=>({choices:[{message:{content:'{"answer":"o1"}'},finish_reason:'stop'}]})});
  await storeQuestion(built.pool,prepare({title:'水由氢和氧两种元素组成。',type:'judgement',course:'验收课程'}),'正确');
  await built.pool.query("INSERT INTO providers(name,kind,enabled,priority,timeout_ms,config_cipher) VALUES('验收 AI','ai',true,1,3000,$1)",[encrypt({baseUrl:'https://example.com/v1',apiKey:'fixture-key',model:'fixture-model',apiFormat:'chat',maxTokens:512,outputMode:'json'},built.key)]);
  await built.app.listen({host:'127.0.0.1',port:18772});
  return {...built,origin,close:async()=>{await built.app.close();await fs.rm(stateDir,{recursive:true,force:true});await database.close();}};
 }catch(e){await fs.rm(stateDir,{recursive:true,force:true});await database.close();throw e;}
}
if(process.argv.includes('--serve')){
 const fixture=await browserFixture();console.log('BROWSER_FIXTURE_READY '+fixture.origin);
 for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void fixture.close().finally(()=>process.exit(0));});
}
