import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {buildApp} from '../server/app.js';import {createTestDatabase} from './support/test-database.js';import {reserveQuery} from '../server/accounts.js';import {prepare} from '../server/search.js';
test('multi-user authorization, shared atomic quota, tokens and session revocation',{timeout:120000},async t=>{
 const db=await createTestDatabase();const state=await fs.mkdtemp(path.join(os.tmpdir(),'ocs-users-'));const origin='http://127.0.0.1:18771';
 const {app,pool,engine}=await buildApp({databaseUrl:db.url,origin,stateDir:state,test:true});
 try{
  await app.inject({method:'POST',url:'/api/setup',headers:{origin},payload:{username:'owner',password:'ownerpass123',confirmPassword:'ownerpass123'}});
  async function login(username:string,password:string){const r=await app.inject({method:'POST',url:'/api/login',headers:{origin},payload:{username,password}});assert.equal(r.statusCode,200,r.body);return {origin,cookie:String(r.headers['set-cookie']).split(';')[0],'x-csrf-token':r.json().csrf};}
  const admin=await login('owner','ownerpass123');
  const call=(method:any,url:string,payload?:any,headers=admin)=>app.inject({method,url,headers,payload});
  const create=await call('POST','/api/admin/users',{username:'student',password:'temporary123',daily_limit:7,rpm:600});assert.equal(create.statusCode,201,create.body);const id=create.json().id;assert.equal(id,2);
  let user=await login('student','temporary123');assert.equal((await call('POST','/api/workspace/query',{title:'must change'},user)).statusCode,403);
  assert.equal((await call('POST','/api/admin/password',{oldPassword:'temporary123',newPassword:'studentpass123'},user)).statusCode,200);
  user=await login('student','studentpass123');
  await t.test('ordinary user cannot access any administrator data or mutations',async()=>{
   for(const route of ['/providers','/questions','/tokens','/stats','/export','/users','/jobs','/semantic/health','/semantic/skips'])assert.equal((await call('GET','/api/admin'+route,undefined,user)).statusCode,403,route);
   assert.equal((await call('POST','/api/admin/users',{username:'hacked'},user)).statusCode,403);
   assert.equal((await call('GET','/api/workspace/usage',undefined,user)).json().id,id);
   assert.equal((await call('POST','/api/workspace/query',{title:'csrf'}, {...user,'x-csrf-token':'wrong'})).statusCode,403);
  });
  const q={title:'统一额度测试题',type:'judgement'};await engine.store(prepare(q),'正确','人工维护',true);
  const token=(await call('POST','/api/admin/tokens',{name:'student OCS',user_id:id,daily_limit:100,rpm:600})).json();assert(token.token);
  await t.test('20 concurrent browser and OCS requests consume exactly seven user credits',async()=>{
   const started=performance.now();const requests=Array.from({length:20},(_,i)=>i%2?call('POST','/api/workspace/query',q,user):app.inject({method:'POST',url:'/api/ocs/query',headers:{authorization:`Bearer ${token.token}`},payload:q}));
   const results=await Promise.all(requests);assert.equal(results.filter(r=>r.statusCode===200).length,7,results.map(r=>r.body).join('\n'));assert.equal(results.filter(r=>r.statusCode===429).length,13);
   assert.equal((await pool.query('SELECT day_count FROM administrators WHERE id=$1',[id])).rows[0].day_count,7);
   assert.equal((await pool.query('SELECT count(*)::int n FROM query_events WHERE user_id=$1',[id])).rows[0].n,7);
   assert((await call('GET','/api/workspace/recent',undefined,user)).json().items.every((r:any)=>r.title===q.title));
   assert.equal((await call('GET','/api/workspace/recent')).json().items.length,0);
   console.log(JSON.stringify({benchmark:'20 mixed HTTP callers / 7 quota',durationMs:Math.round(performance.now()-started),accepted:7,rejected:13}));
  });
  await t.test('RPM is atomic across independent database clients; failed token debit rolls back user debit',async()=>{
   await pool.query('UPDATE administrators SET daily_limit=100,rpm=3,minute_count=0 WHERE id=$1',[id]);
   const results=await Promise.allSettled(Array.from({length:20},()=>reserveQuery(pool,'rpm',{userId:id})));assert.equal(results.filter(r=>r.status==='fulfilled').length,3);
   await pool.query('UPDATE administrators SET rpm=600,minute_count=0 WHERE id=$1',[id]);await pool.query('UPDATE api_tokens SET revoked=true WHERE id=$1',[token.id]);
   const before=(await pool.query('SELECT day_count FROM administrators WHERE id=$1',[id])).rows[0].day_count;
   assert.equal((await app.inject({method:'POST',url:'/api/ocs/query',headers:{authorization:`Bearer ${token.token}`},payload:q})).statusCode,401);
   assert.equal((await pool.query('SELECT day_count FROM administrators WHERE id=$1',[id])).rows[0].day_count,before);
   await call('GET','/api/admin/questions');assert.equal((await pool.query('SELECT day_count FROM administrators WHERE id=1')).rows[0].day_count,0);
   assert.equal((await call('POST','/api/admin/query',q)).statusCode,200);assert.equal((await pool.query('SELECT day_count FROM administrators WHERE id=1')).rows[0].day_count,1);
  });
  await t.test('zero daily quota remains zero after day rollover for browser and OCS',async()=>{
   await pool.query("UPDATE administrators SET daily_limit=0,usage_day=CURRENT_DATE-1,day_count=10 WHERE id=$1",[id]);await pool.query('UPDATE api_tokens SET revoked=false WHERE id=$1',[token.id]);
   assert.equal((await call('POST','/api/workspace/query',q,user)).statusCode,429);assert.equal((await app.inject({method:'POST',url:'/api/ocs/query',headers:{authorization:`Bearer ${token.token}`},payload:q})).statusCode,429);
   assert.equal((await pool.query('SELECT day_count FROM administrators WHERE id=$1',[id])).rows[0].day_count,10);
  });
  await t.test('disable, re-enable and reset password revoke existing sessions',async()=>{
   assert.equal((await call('PUT',`/api/admin/users/${id}`,{daily_limit:100,rpm:60,disabled:true})).statusCode,200);assert.equal((await call('GET','/api/workspace/usage',undefined,user)).statusCode,401);
   await call('PUT',`/api/admin/users/${id}`,{daily_limit:100,rpm:60,disabled:false});user=await login('student','studentpass123');
   assert.equal((await call('POST',`/api/admin/users/${id}/password`,{password:'resetpass123'})).statusCode,200);assert.equal((await call('GET','/api/admin/me',undefined,user)).statusCode,401);
  });
 }finally{await app.close();await fs.rm(state,{recursive:true,force:true});await db.close();}
});
