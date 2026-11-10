/**
 * @file provider-test.ts
 * @project ocs-answer-hub
 * @module 来源测试
 * @description 独立测试指定来源并返回脱敏的网络、字段与答案诊断。
 * @logic 只查询指定来源，记录请求阶段与结果；失败时输出脱敏诊断，不修改题库和查询统计。
 * @dependencies security, search, providers
 * @index_tags probe, diagnostics, upstream
 * @author holic512
 */
import {safeRequest,type NetworkEvent} from './security.js';
import {providerFailure} from './provider-diagnostics.js';
import {logEvent,rememberLogSecrets} from './logging.js';
import {prepare,type QuestionInput} from './search.js';
import {queryProvider,validateProvider,type Provider,type Transport,type ProviderDiagnostic} from './providers.js';

export type ProbeStep={stage:string;status:'passed'|'failed'|'no_answer';message:string;httpStatus?:number;durationMs?:number;code?:string};
export type ProbeResult={providerId:string;providerName:string;status:'passed'|'no_answer'|'failed';reachable:boolean;answer:string|null;durationMs:number;persisted:false;warnings:string[];steps:ProbeStep[];failureCode?:string;httpStatus?:number;usage?:unknown};
export async function probeProvider(provider:Provider,input:QuestionInput,transport:Transport=safeRequest):Promise<ProbeResult>{
 rememberLogSecrets(provider.config);
 const started=Date.now(),steps:ProbeStep[]=[],warnings:string[]=[];
 const report:ProbeResult={providerId:provider.id,providerName:provider.name,status:'failed',reachable:false,answer:null,durationMs:0,persisted:false,warnings,steps};
 const endpoint=provider.config.baseUrl;
 if(typeof endpoint==='string'&&endpoint.startsWith('http:'))warnings.push('HTTP上游为明文传输，题目和该上游密钥不会被HTTPS保护。');
 if(provider.kind==='ai')warnings.push('这次测试会实际请求该模型，可能消耗AI额度；答案不写入题库。');
 let networkObserved=false,received=false;
 const observe=(event:NetworkEvent)=>{logEvent('provider.test.network',{providerId:provider.id,...event},event.status==='failed'?'warn':'info');networkObserved=true;if(event.stage==='http'||event.stage==='json')report.reachable=true;if(event.httpStatus)report.httpStatus=event.httpStatus;steps.push(event);};
 const diagnostics:unknown[]=[];
 const diagnose=({details,...event}:ProviderDiagnostic)=>{steps.push(event);if(details)diagnostics.push(details);};
 logEvent('provider.test.started',{providerId:provider.id,providerName:provider.name,kind:provider.kind,model:provider.config.model,apiFormat:provider.config.apiFormat,maxTokens:provider.config.maxTokens,timeoutMs:provider.timeout_ms,endpoint,question:input},'info',provider.config);
 const capture:Transport=async(...args)=>{logEvent('provider.test.request',{providerId:provider.id,url:args[0],method:args[1],timeoutMs:args[4],bodyFields:args[3]&&typeof args[3]==='object'?Object.keys(args[3]):[]},'info',provider.config);const result=await transport(args[0],args[1],args[2],args[3],args[4],observe);logEvent('provider.test.response',{providerId:provider.id,responseFields:result&&typeof result==='object'?Object.keys(result):[],responseType:Array.isArray(result)?'array':typeof result},'info',provider.config);received=true;report.reachable=true;if(!networkObserved)steps.push({stage:'response',status:'passed',message:'上游已返回数据，正在校验响应和答案'});return result;};
 try{
  try{validateProvider(provider.kind,provider.config);steps.push({stage:'config',status:'passed',message:'接口配置校验通过；仅请求当前指定来源'});}catch{steps.push({stage:'config',status:'failed',message:'配置无效：请检查HTTP/HTTPS地址、模型及响应字段'});report.failureCode='configuration';return report;}
  const result=await queryProvider(provider,prepare(input),provider.timeout_ms,capture,diagnose);
  if(result){report.status='passed';report.answer=result.answer;if(result.usage)report.usage=result.usage;}
  else{const failure=steps.find(s=>s.status==='failed');if(failure){report.status='failed';report.failureCode=failure.code??'response_mapping';}else{report.status='no_answer';if(!steps.some(s=>s.status==='no_answer'))steps.push({stage:'answer',status:'no_answer',message:'上游已响应，本题未返回可用答案'});}}
 }catch(e:any){
  const failure=providerFailure(e);
  report.status='failed';report.failureCode=failure.code;if(failure.httpStatus){report.httpStatus=failure.httpStatus;report.reachable=true;}
  steps.push({status:'failed',...failure});
 }finally{
  report.durationMs=Date.now()-started;report.reachable=report.reachable||received;
  logEvent(report.status==='failed'?'provider-test':'provider.test.completed',{providerId:provider.id,providerName:provider.name,kind:provider.kind,model:provider.kind==='ai'?provider.config.model:undefined,status:report.status,failureCode:report.failureCode,httpStatus:report.httpStatus,durationMs:report.durationMs,answer:report.answer,steps:report.steps,diagnostics},report.status==='failed'?'warn':'info',provider.config);
 }
 return report;
}
