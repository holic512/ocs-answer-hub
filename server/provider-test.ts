import {safeRequest,type NetworkEvent} from './security.js';
import {prepare,type QuestionInput} from './search.js';
import {queryProvider,validateProvider,type Provider,type Transport,type ProviderDiagnostic} from './providers.js';

export type ProbeStep={stage:string;status:'passed'|'failed'|'no_answer';message:string;httpStatus?:number;durationMs?:number;code?:string};
export type ProbeResult={providerId:string;providerName:string;status:'passed'|'no_answer'|'failed';reachable:boolean;answer:string|null;durationMs:number;persisted:false;warnings:string[];steps:ProbeStep[];failureCode?:string;httpStatus?:number;usage?:unknown};
export async function probeProvider(provider:Provider,input:QuestionInput,transport:Transport=safeRequest,allowHosts:string[]=[]):Promise<ProbeResult>{
 const started=Date.now(),steps:ProbeStep[]=[],warnings:string[]=[];
 const report:ProbeResult={providerId:provider.id,providerName:provider.name,status:'failed',reachable:false,answer:null,durationMs:0,persisted:false,warnings,steps};
 const endpoint=provider.kind==='ai'?provider.config.baseUrl:provider.kind==='yanxi'?'https://tk.enncy.cn/query':provider.config.url;
 if(typeof endpoint==='string'&&endpoint.startsWith('http:'))warnings.push('HTTP上游为明文传输，题目和该上游密钥不会被HTTPS保护。');
 if(provider.kind==='ai')warnings.push('这次测试会实际请求该模型，可能消耗AI额度；答案不写入题库。');
 let networkObserved=false,received=false;
 const observe=(event:NetworkEvent)=>{networkObserved=true;if(event.stage==='http'||event.stage==='json')report.reachable=true;if(event.httpStatus)report.httpStatus=event.httpStatus;steps.push(event);};
 const diagnose=(event:ProviderDiagnostic)=>steps.push(event);
 const capture:Transport=async(...args)=>{const result=await transport(args[0],args[1],args[2],args[3],args[4],args[5],observe);received=true;report.reachable=true;if(!networkObserved)steps.push({stage:'response',status:'passed',message:'上游已返回数据，正在校验响应和答案'});return result;};
 try{
  try{validateProvider(provider.kind,provider.config,allowHosts);steps.push({stage:'config',status:'passed',message:'接口配置校验通过；仅请求当前指定来源'});}catch{steps.push({stage:'config',status:'failed',message:'配置无效：请检查HTTP/HTTPS地址、网络范围、模型及响应字段'});report.failureCode='configuration';return report;}
  const result=await queryProvider(provider,prepare(input),provider.timeout_ms,capture,allowHosts,diagnose);
  if(result){report.status='passed';report.answer=result.answer;if(result.usage)report.usage=result.usage;}
  else{const failure=steps.find(s=>s.status==='failed');if(failure){report.status='failed';report.failureCode=failure.code??'response_mapping';}else{report.status='no_answer';if(!steps.some(s=>s.status==='no_answer'))steps.push({stage:'answer',status:'no_answer',message:'上游已响应，本题未返回可用答案'});}}
 }catch(e:any){
  const code=String(e.code??'');const status=Number(e.httpStatus)||undefined;
  const failure=code==='UPSTREAM_HTTP'?(status===401||status===403?'authentication':status===429?'rate_limit':'http'):code==='UPSTREAM_JSON'?'response_format':code==='UPSTREAM_DNS'?'dns':code==='UPSTREAM_TLS'?'tls':code==='UPSTREAM_ADDRESS'?'network_policy':code==='UPSTREAM_SIZE'?'response_size':code==='UPSTREAM_TIMEOUT'?'timeout':'connection';
  const messages:Record<string,string>={authentication:'上游鉴权失败，请检查该题库源的Token或API Key',rate_limit:'上游限流或额度限制（HTTP 429）',http:`上游返回HTTP ${status??'错误'}，重定向不会自动跟随`,response_format:'上游返回的不是有效JSON，请核对接口地址',dns:'DNS解析失败，请检查域名',tls:'HTTPS证书或TLS连接失败',network_policy:'目标为未授权私网/回环/元数据地址；未发出请求',response_size:'上游响应超过1MB限制',timeout:'上游请求超时，请检查网络与超时配置',connection:'无法完成上游请求，请检查地址、端口及网络'};
  report.status='failed';report.failureCode=failure;if(status){report.httpStatus=status;report.reachable=true;}
  steps.push({stage:'request',status:'failed',code:failure,message:messages[failure],...(status?{httpStatus:status}:{})});
 }finally{report.durationMs=Date.now()-started;report.reachable=report.reachable||received;}
 return report;
}
