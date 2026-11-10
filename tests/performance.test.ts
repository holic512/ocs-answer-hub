import test from 'node:test';import assert from 'node:assert/strict';import {setTimeout as delay} from 'node:timers/promises';
import {ConcurrencyPool} from '../server/concurrency.js';import {workspace} from './support/workspace.js';import {encrypt} from '../server/security.js';import {storeQuestion} from '../server/modules/questions.js';import {prepare} from '../server/search.js';import {Engine} from '../server/engine.js';
test('queue releases slots and removes expired waiters',async()=>{const queue=new ConcurrencyPool(1),release=await queue.acquire(Date.now()+1000);assert(release);assert.equal(await queue.acquire(Date.now()+10),null);const next=queue.acquire(Date.now()+1000);release();const done=await next;assert(done);done();assert(queue.idle);});
test('real database: cross-instance content, twenty concurrent callers and single-flight',{timeout:120000},async t=>{
 for(const method of ['info','warn','error']as const)t.mock.method(console,method,()=>{});
 let active=0,peak=0,calls=0,hold=false,unblock!:()=>void,started!:()=>void;let gate=Promise.resolve(),reached=Promise.resolve();
 const f=await workspace({transport:async()=>{calls++;active++;peak=Math.max(peak,active);started?.();try{if(hold)await gate;else await delay(25);return {choices:[{message:{content:'{"answer":"正确"}'}}]};}finally{active--;}}});
 try{
  const q=prepare({title:'跨实例题目',type:'judgement'}),stored=await storeQuestion(f.pool,q,'正确'),peer=new Engine(f.pool,f.key);assert.equal((await peer.local(q))?.answer,'正确');await storeQuestion(f.pool,q,'错误',true);assert.equal((await peer.local(q))?.answer,'错误');await f.pool.query('UPDATE questions SET deleted=true WHERE id=$1',[stored.id]);assert.equal(await peer.local(q),null);
  await f.pool.query("INSERT INTO providers(name,kind,enabled,priority,timeout_ms,config_cipher) VALUES('AI','ai',true,1,2000,$1)",[encrypt({baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'fixture'},f.key)]);
  const results=await Promise.all(Array.from({length:20},(_,i)=>f.engine.query({title:'不同题 '+i,type:'judgement'},null)));assert(results.every(r=>r.code===1));assert.equal(calls,20);assert.equal(peak,4);
  calls=0;const same=await Promise.all(Array.from({length:10},()=>f.engine.query({title:'共享问题',type:'judgement'},null)));assert(same.every(r=>r.code===1));assert.equal(calls,1);assert.equal(new Set(same.map(r=>r.eventId)).size,10);
  hold=true;gate=new Promise(r=>{unblock=r;});reached=new Promise(r=>{started=r;});const work=Array.from({length:20},(_,i)=>f.engine.query({title:'占用工作 '+i,type:'judgement'},null));await reached;await assert.rejects(f.engine.query({title:'第21个工作',type:'judgement'},null),{statusCode:429});unblock();await Promise.all(work);hold=false;
  assert.equal((await f.engine.query({title:'恢复工作',type:'judgement'},null)).code,1);
 }finally{unblock?.();await f.close();}
});
