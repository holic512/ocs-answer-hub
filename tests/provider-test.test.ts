import test from 'node:test';import assert from 'node:assert/strict';import {probeProvider} from '../server/provider-test.js';
const q={title:'1+2等于几',type:'single',options:'A. 2\nB. 3'};const provider:any={id:'test',name:'独立测试源',kind:'http',enabled:false,timeout_ms:1000,config:{url:'http://source.example.com:8080/query',headers:{Authorization:'Bearer super-secret-key'},successPath:'code',successValue:1,questionPath:'data.question',answerPath:'data.answer'}};
test('probe one disabled source without any local engine or fallback',async()=>{let calls=0;const r=await probeProvider(provider,q,async(u,m,h)=>{calls++;assert.equal(u,provider.config.url);assert.equal(h.Authorization,'Bearer super-secret-key');return {code:1,data:{question:q.title,answer:'B'}}});assert.equal(calls,1);assert.equal(r.status,'passed');assert.equal(r.answer,'3');assert.equal(r.persisted,false);assert.equal(r.reachable,true);assert(r.warnings.some(x=>x.includes('HTTP')));});
test('no answer is distinct from broken mapping and invalid AI output',async()=>{const miss=await probeProvider(provider,q,async()=>({code:0,data:{answer:null}}));assert.equal(miss.status,'no_answer');assert.equal(miss.reachable,true);const bad=await probeProvider(provider,q,async()=>({code:1,data:{wrong:'B'}}));assert.equal(bad.status,'failed');assert.equal(bad.failureCode,'response_mapping');const ai=await probeProvider({...provider,kind:'ai',config:{baseUrl:'http://source.example.com:8000/v1',apiKey:'private-ai-key',model:'test'}},q,async()=>({choices:[{message:{content:'not json private-ai-key'}}]}));assert.equal(ai.status,'failed');assert(!JSON.stringify(ai).includes('private-ai-key'));});
test('authentication transport error diagnostics never echo credential or arbitrary exception text',async()=>{const r=await probeProvider(provider,q,async()=>{throw Object.assign(new Error('do not echo super-secret-key'),{code:'UPSTREAM_HTTP',httpStatus:401})});assert.equal(r.status,'failed');assert.equal(r.failureCode,'authentication');assert.equal(r.httpStatus,401);assert(!JSON.stringify(r).includes('super-secret-key'));});
test('successful response with a mismatched title does not pass answer chain',async()=>{const r=await probeProvider(provider,q,async()=>({code:1,data:{question:'1+3等于几',answer:'B'}}));assert.equal(r.status,'failed');assert.equal(r.failureCode,'answer_mismatch');});

test('failed AI matching logs extracted answer and options with credentials redacted, without exposing details to browser',async(t)=>{
 const warnings:string[]=[];t.mock.method(console,'warn',(...args:unknown[])=>warnings.push(args.join(' ')));
 const ai={...provider,name:'cpa',kind:'ai' as const,config:{baseUrl:'http://source.example.com/v1',apiKey:'private-ai-key',model:'fixture-model'}};
 const report=await probeProvider(ai,q,async()=>({choices:[{message:{content:'{"answer":"B. 3 private-ai-key"}',reasoning_content:'do-not-log-reasoning'}}]}));
 assert.equal(report.failureCode,'answer_mismatch');assert.equal(warnings.length,1);
 const log=JSON.parse(warnings[0].slice('[provider-test] '.length));
 assert.equal(log.providerName,'cpa');assert.equal(log.model,'fixture-model');assert.equal(log.failureCode,'answer_mismatch');
 assert.deepEqual(log.diagnostics[0],{answerType:'string',answer:'B. 3 [REDACTED]',questionType:'single',choices:['2','3']});
 assert(!warnings[0].includes('private-ai-key'));assert(!warnings[0].includes('do-not-log-reasoning'));assert(!JSON.stringify(report).includes('diagnostics'));assert(!JSON.stringify(report).includes('private-ai-key'));
});

test('failed answer objects and malformed JSON are bounded and redact credentials and reasoning',async(t)=>{
 const warnings:string[]=[];t.mock.method(console,'warn',(...args:unknown[])=>warnings.push(args.join(' ')));
 const report=await probeProvider(provider,q,async()=>({code:1,data:{answer:{Authorization:'Bearer super-secret-key',password:'unknown-secret',reasoning:'hidden-reasoning',value:'super-secret-key '+ 'x'.repeat(2000)}}}));
 assert.equal(report.failureCode,'answer_mismatch');assert(!warnings[0].includes('super-secret-key'));assert(!warnings[0].includes('unknown-secret'));assert(!warnings[0].includes('hidden-reasoning'));assert(warnings[0].includes('已截断'));
 const ai=await probeProvider({...provider,kind:'ai',config:{baseUrl:'https://example.com/v1',model:'fixture',apiKey:'test-private-key'}},q,async()=>({choices:[{message:{content:'invalid JSON test-private-key'}}]}));
 assert.equal(ai.failureCode,'response_mapping');assert(warnings[1].includes('invalid JSON [REDACTED]'));assert(!warnings[1].includes('test-private-key'));
});
