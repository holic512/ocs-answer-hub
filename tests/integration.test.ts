import test from 'node:test';import assert from 'node:assert/strict';
import {workspace} from './support/workspace.js';
import {verifyPassword,decrypt} from '../server/security.js';
import {prepare} from '../server/search.js';
import {storeQuestion} from '../server/modules/questions.js';
import {buildApp,ocsConfig} from '../server/app.js';

test('workspace lifecycle: setup, registration, AI encryption, local accumulation, edits, OCS and restart',{timeout:120000},async t=>{
 for(const name of ['info','warn','error'] as const)t.mock.method(console,name,()=>{});
 let calls=0;const fixture=await workspace({transport:async()=>{calls++;return {choices:[{message:{content:'{"answer":"o2"}'}}]};}});
 const {request,pool,engine}=fixture;
 try{
  assert.equal((await request('GET','/api/setup')).json().required,false);
  assert.equal((await request('POST','/api/setup',{username:'new-admin',password:'password888',confirmPassword:'password888'})).statusCode,409);
  const admin=(await pool.query('SELECT * FROM users')).rows[0];assert.equal(admin.balance,20);assert(await verifyPassword('password888',admin.password_hash));
  const member=await fixture.signup('member');assert.equal((await request('GET','/api/admin/users',undefined,member.headers)).statusCode,403);
  const thirdParty=await request('POST','/api/admin/providers',{name:'retired',kind:'http',config:{url:'https://example.com'}});assert.equal(thirdParty.statusCode,400);
  const ai=await request('POST','/api/admin/providers',{name:'AI',kind:'ai',enabled:true,priority:1,timeout_ms:1000,config:{baseUrl:'https://fixture.example/v1',apiKey:'private-test-key',model:'fixture'}});assert.equal(ai.statusCode,201,ai.body);
  const read=(await request('GET','/api/admin/providers')).json().items[0];assert.equal(read.config.apiKey,'');assert.equal(read.config.hasKey,true);
  const cipher=(await pool.query('SELECT config_cipher FROM providers')).rows[0].config_cipher;assert(!cipher.includes('private-test-key'));assert.equal(decrypt(cipher,fixture.key).apiKey,'private-test-key');
  assert.equal((await request('PUT',`/api/admin/providers/${read.id}`,read)).statusCode,200);
  const credential=await fixture.token(),q={title:'集成题 1+2等于几',type:'single',options:['2','3']};
  const result=await request('POST','/api/workspace/query',{...q,tokenId:credential.id});assert.equal(result.json().answer,'3',result.body);assert.equal(calls,1);assert.equal((await request('GET','/api/workspace/credits')).json().balance,19);
  const local=await request('POST','/api/workspace/query',{...q,options:['3','2'],tokenId:credential.id});assert.equal(local.json().source,'本地题库');assert.equal(calls,1);
  const row=await storeQuestion(pool,prepare(q),'2');assert.equal(row.answer,'3');assert.equal('verified' in row,false);assert.equal('source' in row,false);
  assert.equal((await request('PUT',`/api/admin/questions/${row.id}`,{...q,answer:'2'})).statusCode,200);assert.equal((await engine.local(prepare(q)))?.answer,'2');
  const versions=(await request('GET',`/api/admin/questions/${row.id}/versions`)).json().items;assert.equal(versions.length,2);assert.equal(versions[0].operation,'编辑题目');
  const ocs=await fixture.app.inject({method:'POST',url:'/api/ocs/query',headers:{authorization:`Bearer ${credential.token}`},payload:q});assert.equal(ocs.json().answer,'2');assert.deepEqual(new Function(ocsConfig(fixture.origin,credential.token)[0].handler)()(ocs.json()),[q.title,'2']);
  const preview=await request('POST','/api/admin/import',{items:[{...q,answer:'3'}]});assert.equal(preview.json().valid,1);
  await request('POST','/api/admin/import',{preview:false,items:[{...q,answer:'3'}]});assert.equal((await engine.local(prepare(q)))?.answer,'2');
  await request('POST','/api/admin/import',{preview:false,overwrite:true,items:[{...q,answer:'3'}]});assert.equal((await engine.local(prepare(q)))?.answer,'3');
  assert(!JSON.stringify((await request('GET','/api/admin/export')).json()).includes('verified'));
  await request('DELETE',`/api/workspace/tokens/${credential.id}`);assert.equal((await fixture.app.inject({method:'POST',url:'/api/ocs/query',headers:{authorization:`Bearer ${credential.token}`},payload:q})).statusCode,401);
  const history=(await request('GET','/api/workspace/query-events')).json();assert.equal(history.total,3);assert.equal(history.items[0].token_name,'Test credential');
  const before=(await pool.query('SELECT balance FROM users WHERE id=$1',[admin.id])).rows[0].balance;
  const peer=await buildApp({databaseUrl:fixture.database.url,origin:fixture.origin,stateDir:fixture.stateDir,test:true});assert.equal(peer.key,fixture.key);assert.equal((await peer.pool.query('SELECT balance FROM users WHERE id=$1',[admin.id])).rows[0].balance,before);await peer.app.close();
 }finally{await fixture.close();}
});
