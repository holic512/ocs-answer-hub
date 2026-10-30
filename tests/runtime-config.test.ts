import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadRuntimeConfig} from '../server/config.js';
const base={DB_HOST:'db',DB_PORT:'5432',DB_NAME:'hub',DB_USER:'hub',DB_PASSWORD:'literal:@/#%'};

test('runtime file is loaded on every call, overrides inherited values and defaults missing optional fields',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hub-config-'));const file=path.join(dir,'config.env');
 try{
  await fs.writeFile(file,'DB_HOST=postgres\nDB_NAME=hub\nDB_USER=user\nDB_PASSWORD="literal:@/#%"\nAPP_ORIGIN=https://first.example.com\n');
  const first=loadRuntimeConfig({env:{...base,APP_ORIGIN:'https://inherited.example.com'},file});
  assert.equal(first.origin,'https://first.example.com');assert.equal(first.port,18771);
  const db=new URL(first.databaseUrl);assert.equal(db.hostname,'postgres');assert.equal(decodeURIComponent(db.password),'literal:@/#%');
  await fs.writeFile(file,(await fs.readFile(file,'utf8')).replace('first.example.com','second.example.com'));
  const second=loadRuntimeConfig({env:{...base},file});assert.equal(second.origin,'https://second.example.com');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('runtime config rejects malformed files, unknown fields and invalid values without exposing secrets',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hub-config-'));const file=path.join(dir,'config.env');
 try{
  for(const [text,error] of [['bad line',/格式无效/],['DB_HOST=db\nDB_HOST=db',/重复/],['DB_PASSWORD="unterminated',/引号/],['TYPO=value',/未知字段/],['DB_PORT=65536',/DB_PORT/],['HOST=invalid/host',/HOST/],['APP_ORIGIN=https://example.com/path',/APP_ORIGIN/],['DB_PASSWORD=',/DB_PASSWORD/],['DB_PORT=do-not-echo-secret',/DB_PORT/]] as const){
   await fs.writeFile(file,text);assert.throws(()=>loadRuntimeConfig({env:base,file}),e=>{assert(e instanceof Error);assert.match(e.message,error);assert(!e.message.includes('do-not-echo-secret'));return true;});
  }
  assert.throws(()=>loadRuntimeConfig({env:base,file:path.join(dir,'missing.env')}),/无法读取/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('legacy environment loading remains available and IPv6 database hosts are encoded',()=>{
 const config=loadRuntimeConfig({env:{...base,DB_HOST:'::1',PORT:'18888'},file:undefined});
 assert.equal(new URL(config.databaseUrl).hostname,'[::1]');assert.equal(config.port,18888);
});
