import test from 'node:test';import assert from 'node:assert/strict';
import {workspace} from './support/workspace.js';
import {prepare} from '../server/search.js';
import {storeQuestion} from '../server/modules/questions.js';
import {reserveQuery,completeQuery,recoverExpiredCredits} from '../server/accounts.js';

test('users, ownership, credits, token quotas, atomic settlement and recovery',{timeout:120000},async t=>{
 for(const name of ['info','warn','error']as const)t.mock.method(console,name,()=>{});
 const f=await workspace(),{request,pool}=f;
 try{
  const ownerId=(await pool.query("SELECT id FROM users WHERE role='admin'")).rows[0].id;
  const a=await f.signup('student-a'),b=await f.signup('student-b'),credential=await f.token(a.id),other=await f.token(b.id),q={title:'余额并发判断题',type:'judgement'};
  await storeQuestion(pool,prepare(q),'正确');
  const invoke=(tokenId=credential.id,identity=a.headers)=>request('POST','/api/workspace/query',{...q,tokenId},identity);
  assert.equal((await invoke(other.id)).statusCode,401);assert.equal((await request('GET','/api/admin/operations/jobs',undefined,a.headers)).statusCode,403);
  assert.equal((await request('PUT',`/api/workspace/tokens/${other.id}`,{name:'intruder',daily_limit:1,rpm:1},a.headers)).statusCode,404);
  assert.equal((await request('DELETE',`/api/workspace/tokens/${other.id}`,undefined,a.headers)).statusCode,404);
  assert.equal((await request('POST','/api/workspace/query',q,a.headers)).statusCode,400);
  const initial=(await request('GET','/api/workspace/credits',undefined,a.headers)).json();assert.equal(initial.balance,20);assert.equal(initial.items[0].amount,20);
  await request('POST',`/api/admin/users/${a.id}/credits`,{amount:-18,reason:'并发测试余额'});
  const responses=await Promise.all(Array.from({length:20},()=>invoke()));assert.equal(responses.filter(r=>r.statusCode===200).length,2);assert.equal(responses.filter(r=>r.statusCode===402).length,18);
  let credits=(await request('GET','/api/workspace/credits',undefined,a.headers)).json();assert.equal(credits.balance,0);assert.equal(credits.frozen,0);assert.equal(credits.items.filter((e:{amount:number})=>e.amount===-1).length,2);
  assert.equal((await request('POST',`/api/admin/users/${a.id}/credits`,{amount:5,reason:''})).statusCode,400);
  await request('POST',`/api/admin/users/${a.id}/credits`,{amount:5,reason:'人工分配'});
  const reserved=await reserveQuery(pool,q,{userId:a.id,tokenId:credential.id});assert.equal((await request('POST',`/api/admin/users/${a.id}/credits`,{amount:-5,reason:'不得扣除冻结'})).statusCode,400);
  await Promise.all([completeQuery(pool,reserved.eventId,{status:'hit',durationMs:1,attempts:[]}),completeQuery(pool,reserved.eventId,{status:'hit',durationMs:1,attempts:[]})]);credits=(await request('GET','/api/workspace/credits',undefined,a.headers)).json();assert.equal(credits.balance,4);assert.equal(credits.frozen,0);
  const misses=await request('POST','/api/workspace/query',{...q,title:'未入库题',tokenId:credential.id},a.headers);assert.equal(misses.json().code,0);assert.equal((await request('GET','/api/workspace/credits',undefined,a.headers)).json().balance,4);
  const stale=await reserveQuery(pool,q,{userId:a.id,tokenId:credential.id});await pool.query("UPDATE query_events SET billing_expires_at=now()-interval '1 second' WHERE id=$1",[stale.eventId]);assert.equal(await recoverExpiredCredits(pool),1);assert.equal(await recoverExpiredCredits(pool),0);assert.equal((await request('GET','/api/workspace/credits',undefined,a.headers)).json().frozen,0);
  const limited=await f.token(a.id,1,60);assert.equal((await invoke(limited.id)).statusCode,200);assert.equal((await invoke(limited.id)).statusCode,429);
  await request('POST',`/api/workspace/tokens/${limited.id}/revoke`,{},a.headers);assert.equal((await invoke(limited.id)).statusCode,401);
  const rpm=await f.token(a.id,100,1);assert.equal((await invoke(rpm.id)).statusCode,200);assert.equal((await invoke(rpm.id)).statusCode,429);
  assert.equal((await request('PUT',`/api/admin/users/${ownerId}`,{username:'owner',role:'user',disabled:false})).statusCode,409);assert.equal((await request('DELETE',`/api/admin/users/${ownerId}`)).statusCode,409);
  await request('POST',`/api/admin/users/${b.id}/password`,{password:'replacement888'});assert.equal((await request('GET','/api/workspace/credits',undefined,b.headers)).statusCode,401);const reset=await f.login('student-b','replacement888');assert.equal((await request('GET','/api/workspace/tokens',undefined,reset)).statusCode,403);
  await request('POST','/api/admin/password',{oldPassword:'replacement888',newPassword:'new-password888'},reset);const changed=await f.login('student-b','new-password888');assert.equal((await request('GET','/api/workspace/tokens',undefined,changed)).statusCode,200);
  assert.equal((await request('DELETE',`/api/admin/users/${b.id}`)).statusCode,200);assert.equal((await request('GET','/api/workspace/credits',undefined,changed)).statusCode,401);assert.equal((await pool.query('SELECT revoked FROM api_tokens WHERE id=$1',[other.id])).rows[0].revoked,true);
  const s=(await request('GET','/api/admin/settings')).json();await request('PUT','/api/admin/settings',{...s,registrationEnabled:false});assert.equal((await request('POST','/api/register',{username:'closed',password:'password888',confirmPassword:'password888'})).statusCode,403);
  await request('PUT','/api/admin/settings',{...s,tokenDailyMax:100,tokenDailyDefault:50});assert.equal((await request('POST','/api/workspace/tokens',{name:'over limit',daily_limit:101,rpm:60},a.headers)).statusCode,400);assert.equal((await request('POST','/api/workspace/tokens',{name:'default'},a.headers)).json().id.length,36);
 }finally{await f.close();}
});
