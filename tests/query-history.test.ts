import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildApp} from '../server/app.js';
import {reserveQuery} from '../server/accounts.js';
import {questionSnapshot} from '../server/query-history.js';
import {prepare} from '../server/search.js';
import {hashPassword} from '../server/security.js';
import {createTestDatabase} from './support/test-database.js';

test('question snapshots only retain reproducible question fields',()=>{
 const input={title:'快照题',type:'single',options:['甲','乙'],images:['https://example.test/a.png',{url:'https://example.test/b.png',token:'hidden-image-token'}],course:'课程',suggestion_title:'建议题干',suggestion_options:'建议选项',token:'hidden-token',headers:{authorization:'hidden-header'}};
 const snapshot=questionSnapshot(input);
 assert.deepEqual(snapshot,{title:'快照题',type:'single',options:['甲','乙'],images:['https://example.test/a.png',{url:'https://example.test/b.png'}],course:'课程',suggestion_title:'建议题干',suggestion_options:'建议选项'});
 assert.notEqual(snapshot.options,input.options);
});

test('query history isolates users, groups repeated final failures and exports every matching event',{timeout:120000},async t=>{
 for(const method of ['info','warn','error'] as const)t.mock.method(console,method,()=>{});
 const database=await createTestDatabase(),state=await fs.mkdtemp(path.join(os.tmpdir(),'ocs-query-history-')),origin='http://127.0.0.1:18771';
 const {app,pool}=await buildApp({databaseUrl:database.url,origin,stateDir:state,test:true,transport:async()=>{throw new Error('History tests must not call upstream providers');}});
 try{
  await app.inject({method:'POST',url:'/api/setup',headers:{origin},payload:{username:'owner',password:'ownerpass123',confirmPassword:'ownerpass123'}});
  const userId=(await pool.query("INSERT INTO users(username,password_hash,must_change,role,balance) VALUES('student',$1,false,'user',20) RETURNING id",[await hashPassword('studentpass123')])).rows[0].id;
  const login=async(username:string,password:string)=>{const response=await app.inject({method:'POST',url:'/api/login',headers:{origin},payload:{username,password}});assert.equal(response.statusCode,200,response.body);return {cookie:String(response.headers['set-cookie']).split(';')[0],origin,'x-csrf-token':response.json().csrf};};
  const admin=await login('owner','ownerpass123'),user=await login('student','studentpass123');
  const get=(url:string,headers=user)=>app.inject({method:'GET',url,headers});
  const question={title:'重复失败题',type:'single',options:['甲','乙'],images:[{url:'https://example.test/question.png',authorization:'remove-me'}],course:'物理'};
  const tokenId=(await pool.query("INSERT INTO api_tokens(name,hash,prefix,user_id) VALUES('history','history-hash','history-prefix',$1) RETURNING id",[userId])).rows[0].id;
  const first=await reserveQuery(pool,question,{userId,tokenId},'request-first');
  const second=await reserveQuery(pool,question,{userId,tokenId},'request-second');
  const attempt={source:'Fixture AI',providerId:'fixture-provider',kind:'ai',status:'miss',stage:'mapping',code:'output_limit',message:'模型输出被上限截断',durationMs:33,candidateAnswer:'最终候选',ai:{model:'fixture-model',apiFormat:'chat',maxTokens:64,enableThinking:false,vision:false,apiKey:'secret-config'},details:{output:'secret-raw-output'},reasoning:'secret-reasoning',headers:{Authorization:'secret-header'},response_cipher:'secret-cipher'};
  await pool.query("UPDATE query_events SET status='miss',failure_code='output_limit',query_id='execution-shared',attempts=$2,created_at='2026-11-08T13:00:00Z' WHERE id=$1",[first.eventId,JSON.stringify([attempt])]);
  await pool.query("UPDATE query_events SET status='error',failure_code='timeout',query_id='execution-second',attempts=$2,created_at='2026-11-08T14:00:00Z' WHERE id=$1",[second.eventId,JSON.stringify([{source:'Fixture AI',status:'error',code:'timeout',httpStatus:504,message:'请求超时'}])]);
  await pool.query("INSERT INTO query_events(user_id,title,status,duration_ms,fingerprint,question_snapshot,failure_code,created_at) SELECT $1,'跨页失败题'||n,'miss',10,'fixture-fingerprint-'||n,jsonb_build_object('title','跨页失败题'||n,'type','judgement'),'empty_answer','2026-11-09T01:00:00Z'::timestamptz+n*interval '1 minute' FROM generate_series(1,35) n",[userId]);
  await pool.query("INSERT INTO query_events(user_id,title,status,duration_ms,created_at) VALUES($1,'历史同题','miss',1,'2026-11-07T01:00:00Z'),($1,'历史同题','error',2,'2026-11-07T02:00:00Z')",[userId]);
  await pool.query("INSERT INTO query_events(user_id,title,status,source,duration_ms,created_at,fingerprint,failure_code) VALUES($1,'成功题','hit','Fixture AI',1,'2026-11-09T02:00:00Z','success-fingerprint',NULL),($1,'处理中题','pending',NULL,0,'2026-11-09T02:01:00Z','pending-fingerprint',NULL),($1,'繁忙题','rejected',NULL,0,'2026-11-09T02:02:00Z','busy-fingerprint','busy')",[userId]);
  const ownerId=(await pool.query("SELECT id FROM users WHERE role='admin'")).rows[0].id;
  const foreignId=(await pool.query("INSERT INTO query_events(user_id,title,status,duration_ms,created_at,failure_code) VALUES($1,'管理员失败题','error',2,'2026-11-09T02:03:00Z','internal_error') RETURNING id::text AS id",[ownerId])).rows[0].id;

  await t.test('accepted records retain original input and request IDs without credentials',async()=>{
   const row=(await pool.query('SELECT fingerprint,question_snapshot,request_id FROM query_events WHERE id=$1',[first.eventId])).rows[0];
   assert.equal(row.fingerprint,prepare(question).key);assert.equal(row.request_id,'request-first');assert.deepEqual(row.question_snapshot.images,[{url:'https://example.test/question.png'}]);assert(!JSON.stringify(row).includes('remove-me'));
  });
  await t.test('lists and details enforce the existing session and administrator boundary',async()=>{
   assert.equal((await app.inject({method:'GET',url:'/api/workspace/query-events'})).statusCode,401);
   for(const suffix of ['',`/${first.eventId}`,'/export'])assert.equal((await get('/api/admin/query-events'+suffix)).statusCode,403);
   const list=await get('/api/workspace/query-events?user_id=1');assert.equal(list.statusCode,200,list.body);assert.equal(list.headers['cache-control'],'no-store');assert.equal(list.json().total,42);assert(list.json().items.every((item:any)=>item.user_id===userId));
   assert.equal((await get(`/api/workspace/query-events/${foreignId}`)).statusCode,404);
   assert.equal((await get('/api/workspace/query-events/99999999')).statusCode,404);
   assert.equal((await get('/api/workspace/query-events/9999999999999999999')).statusCode,400);
   assert.equal((await get(`/api/admin/query-events/${first.eventId}`,admin)).statusCode,200);
   const mine=await get(`/api/admin/query-events?user_id=${ownerId}`,admin);assert.equal(mine.json().total,1);assert.equal(mine.json().items[0].id,foreignId);
  });
  await t.test('record pages, summary and filters distinguish final failure from pending and success',async()=>{
   const all=(await get('/api/workspace/query-events')).json();assert.deepEqual(all.summary,{requests:42,hits:1,failed:40,pending:1});assert.equal(all.pageSize,30);assert.equal(all.items.length,30);assert(all.sources.includes('Fixture AI'));
   const page2=(await get('/api/workspace/query-events?page=2')).json();assert.equal(page2.items.length,12);assert(!page2.items.some((item:any)=>all.items.some((firstPage:any)=>firstPage.id===item.id)));
   assert.equal((await get('/api/workspace/query-events?status=failed')).json().total,40);
   assert.equal((await get('/api/workspace/query-events?status=hit')).json().total,1);
   assert.equal((await get('/api/workspace/query-events?status=pending')).json().total,1);
   assert.equal((await get('/api/workspace/query-events?status=rejected')).json().total,1);
   const source=(await get('/api/workspace/query-events?source=Fixture%20AI')).json();assert.equal(source.total,3);assert.equal(source.summary.failed,2);
   const date=(await get('/api/workspace/query-events?from=2026-11-08&to=2026-11-08')).json();assert.equal(date.total,2);
   assert.equal((await get('/api/workspace/query-events?q=%E9%87%8D%E5%A4%8D')).json().total,2);
   assert.equal((await get('/api/workspace/query-events?q=%25')).json().total,0);
   for(const query of ['page=0','status=invalid','from=2026-02-30','from=2026-11-09&to=2026-11-07','user_id=99999999999'])assert.equal((await get('/api/workspace/query-events?'+query)).statusCode,400,query);
  });
  await t.test('repeated failures use fingerprints and expose safe chronological detail',async()=>{
   const grouped=(await get('/api/workspace/query-events?view=failures&q=%E9%87%8D%E5%A4%8D')).json();assert.equal(grouped.total,1);assert.equal(grouped.items[0].failure_count,2);assert.equal(grouped.items[0].id,second.eventId);assert.equal(grouped.items[0].failure_code,'timeout');assert.equal(grouped.items[0].approximate,false);
   const expanded=(await get('/api/workspace/query-events?group_key='+prepare(question).key)).json();assert.equal(expanded.total,2);
   const detail=await get('/api/workspace/query-events/'+first.eventId);assert.equal(detail.headers['cache-control'],'no-store');const item=detail.json().item;assert.equal(item.request_id,'request-first');assert.equal(item.query_id,'execution-shared');assert.equal(item.attempts[0].code,'output_limit');assert.equal(item.attempts[0].candidateAnswer,'最终候选');assert.deepEqual(item.attempts[0].ai,{model:'fixture-model',apiFormat:'chat',maxTokens:64,enableThinking:false,vision:false});
   for(const secret of ['secret-config','secret-raw-output','secret-reasoning','secret-header','secret-cipher'])assert(!detail.body.includes(secret),secret);
   const legacy=(await get('/api/workspace/query-events?view=failures&q=%E5%8E%86%E5%8F%B2')).json().items[0];assert.equal(legacy.group_key,'legacy:历史同题');assert.equal(legacy.failure_count,2);assert.equal(legacy.approximate,true);assert.equal(legacy.failure_code,null);
  });
  await t.test('failure export ignores paging and status, preserves other filters and includes complete attempts',async()=>{
   const exported=await get('/api/workspace/query-events/export?status=hit&page=2&view=records');assert.equal(exported.statusCode,200,exported.body);assert.equal(exported.headers['cache-control'],'no-store');const data=exported.json();assert.equal(data.format,'ocs-answer-hub-failures-v1');assert.equal(data.groups.length,38);assert.equal(data.groups.reduce((sum:number,group:any)=>sum+group.events.length,0),40);assert(data.groups.every((group:any)=>group.events.every((event:any)=>event.user_id===userId&&['miss','error','rejected'].includes(event.status))));
   assert(data.groups.some((group:any)=>group.failure_count===2&&group.group_key===prepare(question).key));
   const old=data.groups.find((group:any)=>group.approximate);assert(old);assert(old.events.every((event:any)=>event.question_snapshot===null&&event.failure_code===null));
   for(const secret of ['secret-config','secret-raw-output','secret-reasoning','secret-header','secret-cipher'])assert(!exported.body.includes(secret),secret);
   const filtered=(await get('/api/workspace/query-events/export?source=Fixture%20AI&from=2026-11-08&to=2026-11-08')).json();assert.equal(filtered.groups.length,1);assert.equal(filtered.groups[0].events.length,2);
   assert.equal((await get(`/api/admin/query-events/export?user_id=${ownerId}`,admin)).json().groups[0].events[0].id,foreignId);
  });
  await t.test('overview totals retain compatible fields and separate failed and pending requests',async()=>{
   const response=await get('/api/admin/stats',admin);assert.equal(response.statusCode,200,response.body);const stats=response.json();assert.equal(stats.totals.requests,43);assert.equal(stats.totals.hits,1);assert.equal(stats.totals.failed,41);assert.equal(stats.totals.pending,1);assert.equal(stats.totals.local_hits,0);assert(stats.sources.some((source:any)=>source.source==='处理中'));assert(stats.sources.some((source:any)=>source.source==='请求被拒绝'));assert(stats.sources.some((source:any)=>source.source==='查询异常'));
  });
 }finally{await app.close();await fs.rm(state,{recursive:true,force:true});await database.close();}
});
