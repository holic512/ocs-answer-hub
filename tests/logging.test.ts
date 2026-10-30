import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {logEvent,logError,runWithLogContext,rememberLogSecrets,sanitizeLog} from '../server/logging.js';

test('runtime logging preserves console output, appends across restarts and rotates three backups',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ocs-logging-'));
 const module=new URL('../server/logging.ts',import.meta.url).href;
 const run=(code:string)=>spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',`import {installFileLogging} from ${JSON.stringify(module)};installFileLogging(${JSON.stringify(directory)});installFileLogging(${JSON.stringify(directory)});${code}`],{encoding:'utf8'});
 try{
  const file=path.join(directory,'app.log');
  let result=run("console.log('started %s','fixture');console.warn('[provider-test]',JSON.stringify({failureCode:'answer_mismatch'}));console.error('fixture error');");
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/started fixture/);assert.match(result.stderr,/provider-test/);assert.match(result.stderr,/fixture error/);
  const records=(await fs.readFile(file,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(records.map(row=>row.level),['info','warn','error']);assert.equal(records[0].message,'started fixture');assert.match(records[0].time,/^\d{4}-\d{2}-\d{2}T/);
  result=run("console.log('restarted');");assert.equal(result.status,0,result.stderr);
  assert.equal((await fs.readFile(file,'utf8')).trim().split('\n').length,4);
  for(let index=0;index<4;index++){
   await fs.truncate(file,10*1024*1024);
   result=run(`console.log('rotation ${index}');`);assert.equal(result.status,0,result.stderr);
  }
  assert.deepEqual((await fs.readdir(directory)).sort(),['app.log','app.log.1','app.log.2','app.log.3']);
  assert.equal(JSON.parse((await fs.readFile(file,'utf8')).trim()).message,'rotation 3');
  if(process.platform!=='win32')assert.equal((await fs.stat(file)).mode&0o777,0o600);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('structured logs isolate concurrent request context and redact values, URLs and error details',async(t)=>{
 const records:any[]=[];t.mock.method(console,'info',(_event:string,value:string)=>records.push(JSON.parse(value)));
 await Promise.all(['first','second'].map((id,index)=>new Promise<void>(resolve=>{
  runWithLogContext({requestId:id,method:'POST',route:'/api/fixture',secrets:[]},()=>{
   rememberLogSecrets({apiKey:`credential-${id}`});
   setTimeout(()=>{logEvent('fixture',{answer:`credential-${id}`,tokenId:'safe-resource-id'});resolve();},index===0?10:1);
  });
 })));
 assert.deepEqual(records.map(row=>row.requestId),['second','first']);
 assert(records.every(row=>row.answer==='[REDACTED]'&&row.tokenId==='safe-resource-id'));
 runWithLogContext({requestId:'request-a-fixture',method:'POST',route:'/api/login',secrets:[]},()=>{rememberLogSecrets({password:'a'});logEvent('fixture',{answer:'a'});});
 assert.equal(records.at(-1).requestId,'request-a-fixture');assert.equal(records.at(-1).route,'/api/login');assert.equal(records.at(-1).answer,'[REDACTED]');
 const value=sanitizeLog({endpoint:'http://user:pass@example.com/v1?token=hidden#fragment',password:'hidden',nested:{apiKey:'unknown',reasoning:'private',key:'hidden',accessKey:'unknown'},text:'Bearer bearer-secret',long:'x'.repeat(3000)});
 const text=JSON.stringify(value);assert(!text.includes('hidden'));assert(!text.includes('bearer-secret'));assert(!text.includes('unknown'));assert(!text.includes('private'));assert(text.includes('http://example.com/v1'));assert(text.includes('已截断'));
 const error=Object.assign(new Error('database password must never be logged'),{code:'23505',detail:'raw SQL must never be logged',constraint:'fixture_unique'});
 const logged=logError(error);assert.equal(logged.code,'23505');assert.equal(logged.constraint,'fixture_unique');assert(!JSON.stringify(logged).includes('database password'));assert(!JSON.stringify(logged).includes('raw SQL'));
});

test('structured event fields are searchable at the top level of persisted log records',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ocs-structured-log-'));
 try{
  const module=new URL('../server/logging.ts',import.meta.url).href;
  const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',`import {installFileLogging,logEvent} from ${JSON.stringify(module)};installFileLogging(${JSON.stringify(directory)});logEvent('query.completed',{requestId:'request-fixture',queryId:'query-fixture',status:'hit'});`],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const record=JSON.parse((await fs.readFile(path.join(directory,'app.log'),'utf8')).trim());
  assert.equal(record.event,'query.completed');assert.equal(record.requestId,'request-fixture');assert.equal(record.queryId,'query-fixture');assert.equal(record.level,'info');
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('startup configuration failures are persisted with field names and no credentials',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ocs-startup-log-'));
 try{
  const result=spawnSync(process.execPath,['--import',import.meta.resolve('tsx'),fileURLToPath(new URL('../server/index.ts',import.meta.url))],{cwd:directory,encoding:'utf8',env:{...process.env,CONFIG_FILE:'',DB_HOST:'',DB_NAME:'fixture',DB_USER:'fixture',DB_PASSWORD:'never-log-startup-password'}});
  assert.equal(result.status,1,result.stderr);
  const records=(await fs.readFile(path.join(directory,'logs/app.log'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  const failed=records.find(row=>row.event==='application.startup.failed');assert(failed);assert.match(failed.reason,/DB_HOST/);assert.equal(failed.level,'error');
  assert(!JSON.stringify(records).includes('never-log-startup-password'));assert(!result.stderr.includes('never-log-startup-password'));
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
