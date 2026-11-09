import {sanitizeLog} from './logging.js';
import type {ProviderDiagnostic} from './providers.js';

export function providerFailure(error:any){
 const status=Number(error.httpStatus)||undefined,code=String(error.code??'');
 const failure=code==='UPSTREAM_HTTP'?(status===401||status===403?'authentication':status===429?'rate_limit':'http'):code==='UPSTREAM_JSON'?'response_format':code==='UPSTREAM_DNS'?'dns':code==='UPSTREAM_TLS'?'tls':code==='UPSTREAM_ADDRESS'?'address':code==='UPSTREAM_SIZE'?'response_size':code==='UPSTREAM_TIMEOUT'?'timeout':'connection';
 const messages:Record<string,string>={authentication:'上游鉴权失败，请检查该题库源的Token或API Key',rate_limit:'上游限流或额度限制（HTTP 429）',http:`上游返回HTTP ${status??'错误'}，重定向不会自动跟随`,response_format:'上游返回的不是有效JSON，请核对接口地址',dns:'DNS解析失败，请检查域名',tls:'HTTPS证书或TLS连接失败',address:'上游地址格式无效或协议不受支持',response_size:'上游响应超过1MB限制',timeout:'上游请求超时，请检查网络与超时配置',connection:'无法完成上游请求，请检查地址、端口及网络'};
 return {stage:'request',code:failure,message:messages[failure],...(status?{httpStatus:status}:{})};
}

export function answerFailure(events:ProviderDiagnostic[],config:unknown){
 const issue=events.find(event=>event.status==='failed')??events.find(event=>event.status==='no_answer');
 const answer=issue?.code==='answer_mismatch'?issue.details?.answer:undefined;
 const candidate=typeof answer==='string'?answer:Array.isArray(answer)&&answer.every(value=>typeof value==='string')?answer:undefined;
 return {stage:issue?.stage??'answer',code:issue?.code??'no_answer',message:issue?.message??'上游未返回可用答案',...(candidate!==undefined?sanitizeLog({candidateAnswer:candidate},[],config) as object:{})};
}
