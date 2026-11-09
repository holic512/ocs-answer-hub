import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {buildApp} from '../server/app.js';
import {prepare} from '../server/search.js';
import {encrypt} from '../server/security.js';
import type {Transport} from '../server/providers.js';
import type {RagDecision,SemanticService} from '../server/semantic.js';
import {createTestDatabase} from './support/test-database.js';

test('real engine keeps vectors inside AI and persists per-request failure diagnostics',{timeout:120000},async t=>{
 for(const method of ['info','warn','error'] as const)t.mock.method(console,method,()=>{});
 const database=await createTestDatabase(),stateDir=await fs.mkdtemp(path.join(os.tmpdir(),'ocs-engine-diagnostics-'));
 const calls={match:0,embed:0,rag:0},sequence:string[]=[];
 let ragDecision:RagDecision={enabled:false,reason:'index_incomplete',context:'DISABLED_CONTEXT_SENTINEL',items:[]};
 const semantic={match:async()=>{calls.match++;throw new Error('Ordinary query must not call semantic.match');},embed:async()=>{calls.embed++;throw new Error('Ordinary query must not call semantic.embed');},rag:async()=>{calls.rag++;sequence.push('rag');return ragDecision;}} as unknown as SemanticService;
 let respond:Transport=async()=>{throw new Error('Unexpected fixture transport call');};
 const transport:Transport=(...args)=>respond(...args);
 const {app,pool,engine}=await buildApp({databaseUrl:database.url,origin:'http://localhost',stateDir,test:true,semantic,transport});
 const apiKey='diagnostics-private-api-key',reasoning='sensitive-private-reasoning';
 const addProvider=async(kind:'http'|'ai',name:string,priority:number)=>{const config=kind==='ai'?{baseUrl:'https://ai.fixture.test/v1',apiKey,model:'fixture-model',maxTokens:64,enableThinking:false}:{url:'https://http.fixture.test/query',answerPath:'answer'};return (await pool.query('INSERT INTO providers(name,kind,enabled,priority,timeout_ms,config_cipher) VALUES($1,$2,true,$3,1000,$4) RETURNING id',[name,kind,priority,encrypt(config,engine.key)])).rows[0].id as string;};
 const disableProviders=()=>pool.query('UPDATE providers SET enabled=false');
 const event=async(id:string)=>(await pool.query('SELECT * FROM query_events WHERE id=$1',[id])).rows[0];
 try{
  await t.test('exact and safe fuzzy hits, local misses and HTTP hits never call vector methods',async()=>{
   const exact={title:'本地精确命中夹具题',type:'judgement'};await engine.store(prepare(exact),'正确','人工维护',true);
   const local=await engine.query(exact,null,undefined,'request-exact');assert.equal(local.match,'exact');assert.equal(local.source,'本地题库');
   const base=Array.from({length:240},(_,index)=>String.fromCharCode(0x4e00+index)).join('');
   await engine.store(prepare({title:base+'甲',type:'judgement'}),'正确','人工维护',true);
   const fuzzy=await engine.query({title:base+'乙',type:'judgement'},null,undefined,'request-fuzzy');assert.equal(fuzzy.match,'fuzzy');
   const miss=await engine.query({title:'完全不存在的本地题',type:'judgement'},null,undefined,'request-local-miss');assert.equal(miss.code,0);assert.equal((await event(miss.eventId)).failure_code,'no_provider');
   await addProvider('http','HTTP fixture',1);await addProvider('ai','AI fixture',2);
   respond=async url=>{assert(url.includes('http.fixture.test'));sequence.push('http');return {answer:'正确'};};
   const http=await engine.query({title:'外部普通题库命中夹具题',type:'judgement'},null);assert.equal(http.code,1);assert.equal(http.source,'HTTP fixture');assert.deepEqual(calls,{match:0,embed:0,rag:0});assert.deepEqual(sequence,['http']);
  });
  await t.test('only the AI stage obtains RAG and filtered context never prevents the AI answer',async()=>{
   for(const enabled of [true,false]){
    sequence.length=0;ragDecision={enabled,reason:enabled?'verified_high_similarity_unique':'index_incomplete',context:enabled?'APPROVED_CONTEXT_SENTINEL':'DISABLED_CONTEXT_SENTINEL',items:[]};
    respond=async(url,_method,_headers,body)=>{if(url.includes('http.fixture.test')){sequence.push('http');return {answer:null};}sequence.push('ai');const text=JSON.stringify(body);assert.equal(text.includes('APPROVED_CONTEXT_SENTINEL'),enabled);assert(!text.includes('DISABLED_CONTEXT_SENTINEL'));return {choices:[{message:{content:'{"answer":"正确"}'}}]};};
    const result=await engine.query({title:`AI阶段RAG夹具题 ${enabled}`,type:'judgement'},null);assert.equal(result.code,1);assert.equal(result.source,'AI fixture');assert.deepEqual(sequence,['http','rag','ai']);assert.equal(result.attempts.find((attempt:any)=>attempt.kind==='rag').status,enabled?'enabled':'filtered');assert.equal((await event(result.eventId)).failure_code,null);
   }
   assert.deepEqual(calls,{match:0,embed:0,rag:2});
  });
  await t.test('AI and upstream failures preserve stable codes, provider identity and safe settings in PostgreSQL',async()=>{
   await disableProviders();const providerId=await addProvider('ai','Diagnostic AI',1);
   const scenarios:Array<{name:string;code:string;response?:unknown;error?:{code:string;httpStatus?:number}}>=[
    {name:'output limit',code:'output_limit',response:{choices:[{finish_reason:'length',message:{content:null,reasoning_content:reasoning}}]}},
    {name:'reasoning only',code:'reasoning_only',response:{choices:[{message:{content:'',reasoning_content:reasoning}}]}},
    {name:'empty answer',code:'empty_answer',response:{choices:[{message:{content:null}}]}},
    {name:'invalid answer JSON',code:'response_mapping',response:{choices:[{message:{content:'not JSON '+apiKey,reasoning_content:reasoning}}]}},
    {name:'answer mismatch',code:'answer_mismatch',response:{choices:[{message:{content:JSON.stringify({answer:'丙 '+apiKey}),reasoning_content:reasoning}}]}},
    {name:'explicit no answer',code:'no_answer',response:{choices:[{message:{content:'{"answer":null}'}}]}},
    {name:'model refusal',code:'model_refusal',response:{choices:[{message:{content:null,refusal:'provider text '+apiKey}}]}},
    {name:'stream response',code:'stream_response',response:{choices:[{delta:{content:'unexpected'}}]}},
    {name:'incomplete responses',code:'incomplete_response',response:{object:'response',status:'in_progress',output:[]}},
    {name:'business upstream error',code:'upstream_error',response:{error:{code:'model_not_found',message:'private upstream error '+apiKey}}},
    {name:'HTTP 401',code:'authentication',error:{code:'UPSTREAM_HTTP',httpStatus:401}},
    {name:'HTTP 429',code:'rate_limit',error:{code:'UPSTREAM_HTTP',httpStatus:429}},
    {name:'HTTP 503',code:'http',error:{code:'UPSTREAM_HTTP',httpStatus:503}},
    {name:'timeout',code:'timeout',error:{code:'UPSTREAM_TIMEOUT'}},
    {name:'response JSON',code:'response_format',error:{code:'UPSTREAM_JSON'}},
    {name:'DNS',code:'dns',error:{code:'UPSTREAM_DNS'}},
    {name:'TLS',code:'tls',error:{code:'UPSTREAM_TLS'}},
    {name:'address',code:'address',error:{code:'UPSTREAM_ADDRESS'}},
    {name:'response size',code:'response_size',error:{code:'UPSTREAM_SIZE'}},
    {name:'connection',code:'connection',error:{code:'UPSTREAM_NETWORK'}}
   ];
   for(const [index,scenario]of scenarios.entries()){
    respond=async()=>{if(scenario.error)throw Object.assign(new Error('unsafe exception '+apiKey),scenario.error);return scenario.response;};
    const input={title:`失败诊断夹具题 ${index}`,type:'single',options:['甲','乙'],course:'诊断课程'};
    const result=await engine.query(input,null,undefined,`request-diagnostic-${index}`),row=await event(result.eventId),attempt=row.attempts.find((item:any)=>item.providerId===providerId&&item.kind==='ai');
    assert.equal(result.code,0,scenario.name);assert.equal(row.status,'miss',scenario.name);assert.equal(row.failure_code,scenario.code,scenario.name);assert.equal(attempt.code,scenario.code,scenario.name);assert.equal(attempt.status,scenario.code==='no_answer'?'miss':'error',scenario.name);assert.equal(attempt.ai.model,'fixture-model');assert.equal(attempt.ai.maxTokens,64);assert.equal(attempt.ai.enableThinking,false);assert.equal(row.request_id,`request-diagnostic-${index}`);assert.equal(row.fingerprint,prepare(input).key);assert.deepEqual(row.question_snapshot,input);
    if(scenario.error?.httpStatus)assert.equal(attempt.httpStatus,scenario.error.httpStatus,scenario.name);
    const persisted=JSON.stringify(row.attempts);for(const secret of [apiKey,reasoning,'unsafe exception','private upstream error'])assert(!persisted.includes(secret),`${scenario.name}: ${secret}`);
    if(scenario.code==='answer_mismatch')assert.equal(attempt.candidateAnswer,'丙 [REDACTED]');
    else assert.equal(attempt.candidateAnswer,undefined,scenario.name);
   }
   assert.equal(calls.match,0);assert.equal(calls.embed,0);
  });
  await t.test('a prior source failure followed by an AI answer remains a final success',async()=>{
   await disableProviders();await addProvider('http','Failing HTTP',1);await addProvider('ai','Successful AI',2);
   respond=async url=>{if(url.includes('http.fixture.test'))throw Object.assign(new Error('unsafe '+apiKey),{code:'UPSTREAM_HTTP',httpStatus:401});return {choices:[{message:{content:'{"answer":"甲"}'}}]};};
   const input={title:'先失败再成功夹具题',type:'single',options:['甲','乙']},result=await engine.query(input,null),row=await event(result.eventId);
   assert.equal(result.code,1);assert.equal(row.status,'hit');assert.equal(row.failure_code,null);assert(row.attempts.some((attempt:any)=>attempt.code==='authentication'));assert(row.attempts.some((attempt:any)=>attempt.kind==='ai'&&attempt.status==='hit'));
   assert.equal((await pool.query("SELECT count(*)::int AS failed FROM query_events WHERE fingerprint=$1 AND status IN ('miss','error','rejected')",[prepare(input).key])).rows[0].failed,0);
  });
  await t.test('conflicting stored answers are recorded as conflict rather than a valid hit',async()=>{
   await disableProviders();await addProvider('ai','Conflict AI',1);
   const input={title:'冲突诊断夹具题',type:'single',options:['甲','乙']};await engine.store(prepare(input),'甲','历史来源');await engine.store(prepare(input),'乙','另一来源');
   respond=async()=>({choices:[{message:{content:'{"answer":"甲"}'}}]});
   const result=await engine.query(input,null),row=await event(result.eventId);assert.equal(result.code,0);assert.equal(row.failure_code,'conflict');assert(row.attempts.some((attempt:any)=>attempt.status==='conflict'&&attempt.stage==='storage'));
  });
  await t.test('repeated failures keep separate original snapshots, request IDs and execution IDs',async()=>{
   await disableProviders();await addProvider('ai','Repeated AI',1);respond=async()=>({choices:[{message:{content:'{"answer":null}',reasoning_content:reasoning}}]});
   const firstInput={title:'连续重复失败夹具题',type:'single',options:['甲','乙'],images:[{url:'https://images.fixture.test/question.png',token:'image-secret'}],course:'重复课程'},secondInput={...firstInput,options:['乙','甲']};
   const first=await engine.query(firstInput,null,undefined,'request-repeat-first'),second=await engine.query(secondInput,null,undefined,'request-repeat-second');
   assert.notEqual(first.eventId,second.eventId);assert.notEqual(first.queryId,second.queryId);const rows=(await pool.query('SELECT * FROM query_events WHERE fingerprint=$1 ORDER BY id',[prepare(firstInput).key])).rows;assert.equal(rows.length,2);assert.deepEqual(rows.map(row=>row.request_id),['request-repeat-first','request-repeat-second']);assert.deepEqual(rows.map(row=>row.question_snapshot.options),[['甲','乙'],['乙','甲']]);assert(rows.every(row=>row.status==='miss'&&row.failure_code==='no_answer'));assert(rows.every(row=>row.question_snapshot.images[0].token===undefined));
  });
  await t.test('concurrent identical failures share one execution and retain each accepted event',async()=>{
   let release!:()=>void,arrive!:()=>void,requests=0;const gate=new Promise<void>(resolve=>{release=resolve;}),arrived=new Promise<void>(resolve=>{arrive=resolve;});
   respond=async()=>{requests++;arrive();await gate;return {choices:[{message:{content:null,reasoning_content:reasoning}}]};};
   const input={title:'并发重复失败夹具题',type:'single',options:['甲','乙']};
   const first=engine.query(input,null,undefined,'request-concurrent-first');await arrived;
   const second=engine.query({...input,options:['乙','甲']},null,undefined,'request-concurrent-second');
   try{
    const deadline=Date.now()+5000;let joined=false;
    while(Date.now()<deadline){joined=Boolean((await pool.query("SELECT query_id FROM query_events WHERE request_id='request-concurrent-second'")).rows[0]?.query_id);if(joined)break;await delay(10);}
    assert(joined,'Second request must join before fixture response is released');release();
    const results=await Promise.all([first,second]);assert.equal(requests,1);assert.equal(results[0].queryId,results[1].queryId);assert.notEqual(results[0].eventId,results[1].eventId);
    const rows=(await pool.query('SELECT * FROM query_events WHERE fingerprint=$1 ORDER BY id',[prepare(input).key])).rows;assert.equal(rows.length,2);assert(rows.every(row=>row.query_id===results[0].queryId&&row.status==='miss'&&row.failure_code==='reasoning_only'));assert.deepEqual(rows.map(row=>row.request_id),['request-concurrent-first','request-concurrent-second']);assert.deepEqual(rows.map(row=>row.question_snapshot.options),[['甲','乙'],['乙','甲']]);assert(rows.every(row=>!JSON.stringify(row.attempts).includes(reasoning)));
   }finally{release();await Promise.allSettled([first,second]);}
  });
 }finally{await app.close();await fs.rm(stateDir,{recursive:true,force:true});await database.close();}
});
