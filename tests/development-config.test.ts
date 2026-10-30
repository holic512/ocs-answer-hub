import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assertTestDatabaseUrl} from './support/test-database.js';
import {validateProvider} from '../server/providers.js';

const root=fileURLToPath(new URL('../',import.meta.url));

test('documented provider examples match the actual adapters',async()=>{
 for(const [name,kind] of [['yanxi','yanxi'],['http','http'],['ai-chat','ai'],['ai-responses','ai']] as const){
  const config=JSON.parse(await fs.readFile(path.join(root,'examples/providers',name+'.json'),'utf8'));
  assert.doesNotThrow(()=>validateProvider(kind,config),name);
 }
});

test('destructive database tests require explicit isolated test configuration',()=>{
 const isolated='postgresql://fixture:fixture@localhost:5432/answer_hub_test';
 assert.equal(assertTestDatabaseUrl(isolated,'postgresql://fixture:fixture@localhost:5432/answer_hub_dev','1'),isolated);
 assert.throws(()=>assertTestDatabaseUrl(isolated,undefined,undefined),/TEST_DATABASE_RESET/);
 assert.throws(()=>assertTestDatabaseUrl('postgresql://fixture:fixture@localhost:5432/answer_hub',undefined,'1'),/_test/);
 assert.throws(()=>assertTestDatabaseUrl(isolated,isolated,'1'),/DATABASE_URL/);
 assert.throws(()=>assertTestDatabaseUrl('https://example.com/answer_hub_test',undefined,'1'),/PostgreSQL/);
});

test('local setup generates matching private env and never overwrites it',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'answer-hub-setup-'));
 try{
  const run=()=>spawnSync(process.execPath,[path.join(root,'scripts/setup-local.mjs')],{cwd:directory,encoding:'utf8'});
  let result=run();assert.equal(result.status,0,result.stderr);
  const env=await fs.readFile(path.join(directory,'.env'),'utf8');
  const values=Object.fromEntries(env.split(/\r?\n/).filter(line=>/^[A-Z_]+=/.test(line)).map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];}));
  const database=new URL(values.DATABASE_URL),testDatabase=new URL(values.TEST_DATABASE_URL);
  assert.equal(database.hostname,'127.0.0.1');assert.equal(database.port,values.PG_LOCAL_PORT);
  assert.equal(decodeURIComponent(database.password),values.PG_LOCAL_PASSWORD);
  assert.equal(database.pathname,'/ocs_answer_hub_dev');assert.equal(testDatabase.pathname,'/ocs_answer_hub_test');
  assert.equal(values.APP_ORIGIN,'http://127.0.0.1:5173');assert.equal(values.TEST_DATABASE_RESET,'1');
  assert(!env.includes('REPLACE_WITH_LOCAL_PASSWORD'));assert(!result.stdout.includes(values.PG_LOCAL_PASSWORD));
  if(process.platform!=='win32')assert.equal((await fs.stat(path.join(directory,'.env'))).mode&0o777,0o600);
  result=run();assert.equal(result.status,0,result.stderr);assert.equal(await fs.readFile(path.join(directory,'.env'),'utf8'),env);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
