import test from 'node:test';
import assert from 'node:assert/strict';
import {probeProvider} from '../server/provider-test.js';
const provider:any={id:'ai-response-regression',name:'AI响应兼容回归',kind:'ai',enabled:false,timeout_ms:1000,config:{baseUrl:'https://example.com/v1',apiKey:'secret-never-echo',model:'regression-model'}};
const q={title:'1+2等于几',type:'single',options:'A. 2\nB. 3\nC. 4'};
test('HTTP200 AI error envelope is diagnosed as upstream error, not missing content',async()=>{
 const r=await probeProvider(provider,q,async()=>({error:{code:'model_not_found',type:'invalid_request_error',message:'secret-never-echo full unsafe provider error'}}));
 assert.equal(r.status,'failed');assert.equal(r.failureCode,'upstream_error');assert(!JSON.stringify(r).includes('secret-never-echo'));assert(!JSON.stringify(r).includes('full unsafe provider error'));assert(r.steps.some(x=>x.message.includes('模型')));
});
test('reasoning-only truncated chat response is not a fabricated answer',async()=>{
 const r=await probeProvider(provider,q,async()=>({choices:[{finish_reason:'length',message:{role:'assistant',content:null,reasoning_content:'sensitive chain of thought secret-never-echo'}}]}));
 assert.equal(r.status,'failed');assert.equal(r.failureCode,'output_limit');assert(!JSON.stringify(r).includes('sensitive chain'));assert(!JSON.stringify(r).includes('secret-never-echo'));
});
test('Responses and data-wrapped replies extract final text, not reasoning',async()=>{
 for(const response of [{object:'response',status:'completed',output:[{type:'reasoning',summary:[]},{type:'message',role:'assistant',content:[{type:'output_text',text:'{"answer":"3"}'}]}]},{data:{choices:[{message:{content:[{type:'text',text:'{"answer":"3"}'}]}}]}}]){const r=await probeProvider(provider,q,async()=>response);assert.equal(r.status,'passed');assert.equal(r.answer,'3');}
});
test('AI null/empty content, refusal, in-progress or tool-only replies cannot pass',async()=>{
 for(const response of [{choices:[{message:{content:'',reasoning_content:'internal-only'}}]},{choices:[{message:{content:null,refusal:'unsafe-provider-text'}}]},{object:'response',status:'incomplete',output:[{type:'message',content:[{type:'output_text',text:'{"answer":"3"}'}]}]},{object:'response',status:'in_progress',output:[]},{choices:[{message:{content:null,tool_calls:[{function:{arguments:'{"answer":"3"}'}}]}}]}]){const r=await probeProvider(provider,q,async()=>response);assert.equal(r.status,'failed');assert(!JSON.stringify(r).includes('internal-only'));assert(!JSON.stringify(r).includes('unsafe-provider-text'));}
});
test('AI requests explicitly disable streaming and honor enableThinking=false',async()=>{
 const r=await probeProvider({...provider,config:{...provider.config,enableThinking:false}},q,async(_u,_m,_h,body)=>{assert.equal(body.stream,false);assert.deepEqual(body.chat_template_kwargs,{enable_thinking:false});return {choices:[{finish_reason:'stop',message:{content:'{"answer":"3"}'}}]};});assert.equal(r.status,'passed');
});
test('Agnes quiz calls default to non-thinking without changing saved configuration',async()=>{
 const config={...provider.config,model:'agnes-3.0-flash'};const r=await probeProvider({...provider,config},q,async(_u,_m,_h,body)=>{assert.equal(body.stream,false);assert.deepEqual(body.chat_template_kwargs,{enable_thinking:false});return {choices:[{message:{content:'{"answer":"3"}'}}]};});assert.equal(r.status,'passed');assert(!('enableThinking' in config));
});
test('Responses endpoint selection uses the right path and payload',async()=>{
 const r=await probeProvider({...provider,config:{...provider.config,apiFormat:'responses',baseUrl:'https://example.com/v1/responses'}},q,async(url,_m,_h,body)=>{assert.equal(url,'https://example.com/v1/responses');assert.equal(body.stream,false);assert(Array.isArray(body.input));assert(!('messages' in body));assert(!('max_tokens' in body));assert.equal(body.max_output_tokens,1500);return {object:'response',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'{"answer":"3"}'}]}]};});assert.equal(r.status,'passed');
});
test('chat content and validated answers continue to pass',async()=>{
 const r=await probeProvider(provider,q,async()=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:'{"answer":"B"}'}}]}));
 assert.equal(r.status,'passed');assert.equal(r.answer,'3');
});
