import test from 'node:test';import assert from 'node:assert/strict';
import {workspace} from './support/workspace.js';import {encrypt} from '../server/security.js';import {prepare} from '../server/search.js';import {storeQuestion} from '../server/modules/questions.js';import type {SemanticService} from '../server/semantic.js';import type {Transport} from '../server/providers.js';
test('AI-only engine computes RAG once across fallback and persists safe failures',{timeout:120000},async t=>{
 for(const method of ['info','warn','error']as const)t.mock.method(console,method,()=>{});
 let ragCalls=0,calls=0;let response:Transport=async()=>({choices:[{message:{content:'{"answer":"正确"}'}}]});const semantic={rag:async()=>{ragCalls++;return {enabled:false,reason:'index_incomplete',context:'FILTERED_CONTEXT',items:[]};}}as unknown as SemanticService;
 const f=await workspace({semantic,transport:(...args)=>{calls++;return response(...args);}});
 try{
  await storeQuestion(f.pool,prepare({title:'本地命中',type:'judgement'}),'正确');assert.equal((await f.engine.query({title:'本地命中',type:'judgement'},null)).source,'本地题库');assert.equal(ragCalls,0);
  for(const [index,name]of ['first','second'].entries())await f.pool.query("INSERT INTO providers(name,kind,enabled,priority,timeout_ms,config_cipher) VALUES($1,'ai',true,$2,1000,$3)",[name,index+1,encrypt({baseUrl:`https://${name}.example/v1`,apiKey:'private-api-key',model:'fixture'},f.key)]);
  response=async(url,_m,_h,body)=>{assert(!JSON.stringify(body).includes('FILTERED_CONTEXT'));return url.includes('first')?{choices:[{message:{content:'{"answer":null}'}}]}:{choices:[{message:{content:'{"answer":"正确"}'}}]};};
  const success=await f.engine.query({title:'AI回退题',type:'judgement'},null);assert.equal(success.code,1);assert.equal(success.source,'second');assert.equal(ragCalls,1);assert.equal(calls,2);
  await f.pool.query("UPDATE providers SET enabled=false WHERE name='second'");
  const scenarios=[['output_limit',{choices:[{finish_reason:'length',message:{content:'{"answer":"正确"}',reasoning_content:'private-reasoning'}}]}],['reasoning_only',{choices:[{message:{content:'',reasoning_content:'private-reasoning'}}]}],['model_refusal',{choices:[{message:{content:null,refusal:'private-api-key'}}]}],['response_mapping',{choices:[{message:{content:'bad JSON private-api-key'}}]}],['answer_mismatch',{choices:[{message:{content:'{"answer":"unknown"}'}}]}]]as const;
  for(const [code,payload]of scenarios){response=async()=>payload;const result=await f.engine.query({title:'失败 '+code,type:'judgement'},null);assert.equal(result.code,0);assert.equal(result.failureCode,code);const event=(await f.pool.query('SELECT status,failure_code,attempts FROM query_events WHERE id=$1',[result.eventId])).rows[0];assert.equal(event.failure_code,code);assert.equal(event.status,'miss');assert(!JSON.stringify(event).includes('private-api-key'));assert(!JSON.stringify(event).includes('private-reasoning'));}
 }finally{await f.close();}
});
