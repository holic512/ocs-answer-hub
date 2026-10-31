import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {buildApp} from '../server/app.js';
import {Engine} from '../server/engine.js';
import {prepare} from '../server/search.js';
import {encrypt} from '../server/security.js';
import {ConcurrencyPool} from '../server/concurrency.js';
import {createTestDatabase} from './support/test-database.js';

test('source queue releases slots and removes expired waiters',async()=>{
 const queue=new ConcurrencyPool(1);const release=await queue.acquire(Date.now()+1000);assert(release);
 assert.equal(await queue.acquire(Date.now()+20),null);
 const next=queue.acquire(Date.now()+1000);release();const done=await next;assert(done);done();assert(queue.idle);
 assert.equal(await queue.acquire(Date.now()-1),null);
});

test('real database cache invalidation, accounting and bounded upstream concurrency',{timeout:120000},async(t)=>{
 t.mock.method(console,'info',()=>{});t.mock.method(console,'warn',()=>{});
 const database=await createTestDatabase();const stateDir=await fs.mkdtemp(path.join(os.tmpdir(),'ocs-performance-'));
 let active=0,peak=0,calls=0,hold=false;let started!:()=>void,unblock!:()=>void;
 let reached=new Promise<void>(resolve=>{started=resolve;});let gate=new Promise<void>(resolve=>{unblock=resolve;});
 const {app,pool,engine}=await buildApp({databaseUrl:database.url,origin:'http://localhost',stateDir,test:true,transport:async()=>{
  active++;peak=Math.max(peak,active);calls++;started();
  try{if(hold)await gate;else await delay(25);return {answer:'正确'};}finally{active--;}
 }});
 try{
  await app.ready();await app.inject({method:'POST',url:'/api/setup',headers:{origin:'http://localhost'},payload:{username:'cache-owner',password:'cache888',confirmPassword:'cache888'}});
  const login=await app.inject({method:'POST',url:'/api/login',headers:{origin:'http://localhost'},payload:{username:'cache-owner',password:'cache888'}});
  const headers={origin:'http://localhost',cookie:login.headers['set-cookie']!.toString().split(';')[0],'x-csrf-token':login.json().csrf};
  await t.test('database reads retain hit counts and observe corrections, conflicts, imports and deletions',async(t)=>{
   const q=prepare({title:'缓存测试题',type:'judgement'});const stored=await engine.store(q,'正确','fixture',true);
   let reads=0;const query=pool.query.bind(pool);const spy=t.mock.method(pool,'query',((...args:any[])=>{if(typeof args[0]==='string'&&args[0].startsWith('SELECT * FROM questions'))reads++;return (query as any)(...args);}) as typeof pool.query);
   assert.equal((await engine.local(q))?.answer,'正确');const coldReads=reads;
   assert.equal((await engine.local(q))?.answer,'正确');assert.equal(reads,coldReads+1);
   assert.equal(Number((await pool.query('SELECT hit_count FROM questions WHERE id=$1',[stored.id])).rows[0].hit_count),2);
   const now=Date.now();const clock=t.mock.method(Date,'now',()=>now+31000);
   assert.equal((await engine.local(q))?.answer,'正确');assert(reads>coldReads);clock.mock.restore();
   await engine.store(q,'错误','人工纠错',true);assert.equal((await engine.local(q))?.answer,'错误');
   const conflict=prepare({title:'缓存冲突题',type:'judgement'});await engine.store(conflict,'正确','one');assert(await engine.local(conflict));await engine.store(conflict,'错误','two');assert.equal(await engine.local(conflict),null);
   const imported=await app.inject({method:'POST',url:'/api/admin/import',headers,payload:{preview:false,items:[{title:q.title,type:q.type,answer:'正确'}]}});assert.equal(imported.statusCode,200);assert.equal((await engine.local(q))?.answer,'正确');
   assert.equal((await app.inject({method:'DELETE',url:`/api/admin/questions/${stored.id}`,headers})).statusCode,200);assert.equal(await engine.local(q),null);
   spy.mock.restore();
   const base=Array.from({length:240},(_,index)=>String.fromCharCode(0x4e00+index)).join('');
   const original=prepare({title:base+'甲',type:'judgement'}),similar=prepare({title:base+'乙',type:'judgement'});
   await engine.store(original,'正确','fixture',true);assert.equal((await engine.local(similar))?.match,'fuzzy');
   await engine.store(similar,'错误','fixture',true);assert.equal((await engine.local(similar))?.answer,'错误');assert.equal((await engine.local(similar))?.match,'exact');
  });
  await t.test('independent service instances see corrections and deletions immediately',async()=>{
   const peer=new Engine(pool,engine.key);const q=prepare({title:'跨实例一致性题',type:'judgement'});
   const row=await engine.store(q,'正确','人工维护',true);assert.equal((await peer.local(q))?.answer,'正确');
   await engine.store(q,'错误','人工纠错',true);assert.equal((await peer.local(q))?.answer,'错误');
   await pool.query('UPDATE questions SET deleted=true WHERE id=$1',[row.id]);assert.equal(await peer.local(q),null);
  });
  await pool.query('INSERT INTO providers(name,kind,enabled,priority,timeout_ms,config_cipher) VALUES($1,$2,true,1,1000,$3)',['并发来源','http',encrypt({url:'http://fixture.local/query',answerPath:'answer'},engine.key)]);
  await t.test('20 different questions run with at most four requests per source, one event per caller',async()=>{
   const before=Number((await pool.query('SELECT count(*) FROM query_events')).rows[0].count);calls=0;peak=0;
   const results=await Promise.all(Array.from({length:20},(_,index)=>engine.query({title:`并发性能题${index}`,type:'judgement'},null)));
   assert(results.every(result=>result.code===1));assert.equal(calls,20);assert.equal(peak,4);
   assert.equal(Number((await pool.query('SELECT count(*) FROM query_events')).rows[0].count)-before,20);
  });
  await t.test('identical questions share work and cached OCS queries still consume quota and log each call',async()=>{
   calls=0;const q={title:'同题性能测试',type:'judgement'};
   assert((await Promise.all(Array.from({length:10},()=>engine.query(q,null)))).every(result=>result.code===1));assert.equal(calls,1);
   const token=(await app.inject({method:'POST',url:'/api/admin/tokens',headers,payload:{name:'缓存配额',daily_limit:2,rpm:60}})).json();
   const invoke=()=>app.inject({method:'POST',url:'/api/ocs/query',headers:{authorization:`Bearer ${token.token}`},payload:q});
   assert.equal((await invoke()).json().source,'本地题库');assert.equal((await invoke()).statusCode,200);assert.equal((await invoke()).statusCode,429);
   assert.equal(Number((await pool.query('SELECT count(*) FROM query_events WHERE token_id=$1',[token.id])).rows[0].count),2);
   await app.inject({method:'POST',url:`/api/admin/tokens/${token.id}/revoke`,headers,payload:{}});assert.equal((await invoke()).statusCode,401);
  });
  await t.test('the global admission bound rejects excess distinct work and recovers after completion',async()=>{
   hold=true;reached=new Promise(resolve=>{started=resolve;});gate=new Promise(resolve=>{unblock=resolve;});
   const work=Array.from({length:20},(_,index)=>engine.query({title:`繁忙测试题${index}`,type:'judgement'},null));await reached;
   await assert.rejects(engine.query({title:'第21个不同题',type:'judgement'},null),{statusCode:429});unblock();await Promise.all(work);hold=false;
   assert.equal((await engine.query({title:'恢复后的题目',type:'judgement'},null)).code,1);
  });
 }finally{unblock();await app.close();await fs.rm(stateDir,{recursive:true,force:true});await database.close();}
});
