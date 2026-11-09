/**
 * @file engine.ts
 * @project ocs-answer-hub
 * @module 检索引擎
 * @description 本地精确和保守模糊检索、AI 专用 RAG 与可追溯查询记录。
 * @logic 同题合并及来源有界并发，AI 才读取向量参考；每次受理独立保存结果和失败诊断。
 * @dependencies pg, search, providers, security, logging, concurrency
 * @index_tags query, fallback, persistence
 * @author holic512
 */
import {SemanticService} from './semantic.js';
import type pg from 'pg';
import {randomUUID} from 'node:crypto';
import {logEvent,logError,rememberLogSecrets,sanitizeLog} from './logging.js';
import {prepare,fuzzySafe,canonicalAnswer,type QuestionInput,type Prepared} from './search.js';
import {decrypt,encrypt,safeRequest} from './security.js';
import {queryProvider,type Transport} from './providers.js';
import {ConcurrencyPool} from './concurrency.js';
import {answerFailure,providerFailure} from './provider-diagnostics.js';
import {questionSnapshot} from './query-history.js';
import type {ProviderDiagnostic} from './providers.js';
type LocalResult={code:number;question:string;answer:string;source:string;origin:string;questionId:string;verified:boolean;match:string};
export class Engine{
 private inflight=new Map<string,{id:string;promise:Promise<any>}>();private providerQueues=new Map<string,ConcurrencyPool>();
 invalidateLocal(){}
 constructor(public pool:pg.Pool,public key:string,public transport?:Transport,public semantic?:SemanticService){ }
 async store(q:Prepared,answer:string,source:string,verified=false,queryId?:string){
  const client=await this.pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock_shared(764003)');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[q.key]);
   const old=(await client.query('SELECT * FROM questions WHERE fingerprint=$1 FOR UPDATE',[q.key])).rows[0];
   let row:any;
   if(old){
    if(verified){row=(await client.query('UPDATE questions SET answer=$2,source=$3,verified=true,conflict=false,deleted=false,updated_at=now() WHERE id=$1 RETURNING *',[old.id,answer,source])).rows[0];}
    else if(old.answer!==answer&&!old.verified){row=(await client.query('UPDATE questions SET conflict=true,updated_at=now() WHERE id=$1 RETURNING *',[old.id])).rows[0];}
    else row=old;
   }else row=(await client.query('INSERT INTO questions(fingerprint,title,normal_title,type,options,images,course,answer,source,verified) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[q.key,q.title,q.normalTitle,q.type,JSON.stringify(q.choices),JSON.stringify(q.images),q.course??'',answer,source,verified])).rows[0];
   await client.query('INSERT INTO answer_versions(question_id,answer,source,verified) VALUES($1,$2,$3,$4)',[row.id,answer,source,verified]);await client.query('COMMIT');this.invalidateLocal();logEvent('question.stored',{queryId,fingerprint:q.key,questionId:row.id,source,verified,conflict:row.conflict,answer});return row;
  }catch(e){await client.query('ROLLBACK');logEvent('question.store.failed',{queryId,fingerprint:q.key,source,error:logError(e)},'error');throw e;}finally{client.release();}
 }
 async local(q:Prepared){
  let row=(await this.pool.query('SELECT * FROM questions WHERE fingerprint=$1 AND NOT deleted AND NOT conflict',[q.key])).rows[0];let match='exact';
  if(!row){const candidate=(await this.pool.query('SELECT * FROM questions WHERE type=$1 AND NOT deleted AND NOT conflict AND abs(length(normal_title)-length($2))<=3 AND normal_title LIKE $3 ORDER BY verified DESC,hit_count DESC LIMIT 100',[q.type,q.normalTitle,`%${q.normalTitle.slice(0,3).replace(/[\\%_]/g,'')}%`])).rows;
   const valid=candidate.filter(r=>fuzzySafe(q,prepare({title:r.title,type:r.type,options:r.options,images:r.images,course:r.course})));if(valid.length===1){row=valid[0];match='fuzzy';}
  }
  if(!row)return null;const original=prepare({title:row.title,type:row.type,options:row.options,images:row.images,course:row.course});const answer=canonicalAnswer(canonicalAnswer(row.answer,original),q);if(!answer)return null;
  await this.pool.query('UPDATE questions SET hit_count=hit_count+1 WHERE id=$1',[row.id]);
  const value:LocalResult={code:1,question:q.title,answer,source:'本地题库',origin:row.source,questionId:row.id,verified:row.verified,match};
  return value;
 }

 async execute(q:Prepared,queryId:string){
  const attempts:any[]=[];
  const localStart=Date.now(),local=await this.local(q),localDurationMs=Date.now()-localStart;
  logEvent('query.local',{queryId,fingerprint:q.key,status:local?'hit':'miss',questionId:local?.questionId,match:local?.match});
  if(local)return {...local,attempts:[{source:'本地题库',kind:'local',status:'hit',durationMs:localDurationMs}]};
  attempts.push({source:'本地题库',kind:'local',status:'miss',stage:'lookup',code:'no_answer',message:'本地题库未命中',durationMs:localDurationMs});
  const providers=(await this.pool.query('SELECT * FROM providers WHERE enabled ORDER BY priority,created_at')).rows;
  const deadline=Date.now()+55000;
  for(const p of providers){
   const identity={source:p.name,providerId:p.id,kind:p.kind};
   if(deadline-Date.now()<500){attempts.push({...identity,status:'skipped',stage:'queue',code:'total_timeout',message:'已达到总超时',durationMs:0});break;}
   const queue=this.providerQueues.get(p.id)??new ConcurrencyPool(4);this.providerQueues.set(p.id,queue);
   const start=Date.now(),release=await queue.acquire(deadline);
   if(!release){attempts.push({...identity,status:'skipped',stage:'queue',code:'queue_timeout',message:'等待来源时已达到总超时',durationMs:Date.now()-start});break;}
   let providerConfig:any,ai:object={},stage='configuration';
   try{
    providerConfig=decrypt(p.config_cipher,this.key);rememberLogSecrets(providerConfig);
    if(p.kind==='ai')ai=sanitizeLog({ai:{model:providerConfig.model,apiFormat:providerConfig.apiFormat??'auto',maxTokens:providerConfig.maxTokens??1500,vision:Boolean(providerConfig.vision),enableThinking:providerConfig.enableThinking}},[],providerConfig) as object;
    const timeoutMs=Math.max(1,Math.min(deadline-Date.now(),p.timeout_ms));
    logEvent('provider.started',{queryId,providerId:p.id,providerName:p.name,kind:p.kind,model:providerConfig.model,apiFormat:providerConfig.apiFormat,maxTokens:providerConfig.maxTokens,vision:providerConfig.vision,timeoutMs,endpoint:providerConfig.baseUrl??providerConfig.url??'https://tk.enncy.cn/query'},'info',providerConfig);
    let observed:any=undefined,httpStatus:number|undefined;
    const capture:Transport=async(...args)=>{
     logEvent('provider.request',{queryId,providerId:p.id,url:args[0],method:args[1],timeoutMs:args[4],bodyFields:args[3]&&typeof args[3]==='object'?Object.keys(args[3]):[]},'info',providerConfig);
     const result=await (this.transport??safeRequest)(args[0],args[1],args[2],args[3],args[4],event=>{if(event.httpStatus)httpStatus=event.httpStatus;logEvent('provider.network',{queryId,providerId:p.id,...event},event.status==='failed'?'warn':'info',providerConfig);});
     observed=result;
     logEvent('provider.response',{queryId,providerId:p.id,responseFields:result&&typeof result==='object'?Object.keys(result):[],responseType:Array.isArray(result)?'array':typeof result},'info',providerConfig);
     return result;
    };
    stage='rag';
    const ragStart=Date.now();
    const rag=p.kind==='ai'&&this.semantic?await this.semantic.rag(q):undefined;
    if(rag)attempts.push({source:'RAG',providerId:p.id,kind:'rag',status:rag.enabled?'enabled':'filtered',stage:'rag',reason:rag.reason,durationMs:Date.now()-ragStart});
    stage='request';
    const diagnostics:ProviderDiagnostic[]=[];
    const result=await queryProvider({...p,config:providerConfig},q,Math.max(1,Math.min(p.timeout_ms,deadline-Date.now())),capture,event=>{diagnostics.push(event);logEvent('provider.mapping',{queryId,providerId:p.id,...event},event.status==='failed'?'warn':'info',providerConfig);},rag);
    logEvent('provider.completed',{queryId,providerId:p.id,status:result?'hit':'miss',durationMs:Date.now()-start,answer:result?.answer,usage:result?.usage},'info',providerConfig);
    stage='storage';
    if(observed!==undefined)await this.pool.query('INSERT INTO provider_observations(fingerprint,title,source,status,response_cipher) VALUES($1,$2,$3,$4,$5)',[q.key,q.title,p.name,result?'valid':'no_valid_answer',encrypt(observed,this.key)]);
    if(!result){const failure=answerFailure(diagnostics,providerConfig);attempts.push({...identity,...ai,status:failure.code==='no_answer'?'miss':'error',...failure,durationMs:Date.now()-start,...(httpStatus?{httpStatus}:{})});continue;}
    const row=await this.store(q,result.answer,result.ai?`${p.name} · AI`:p.name,false,queryId);
    if(row.conflict){logEvent('query.conflict',{queryId,providerId:p.id,questionId:row.id},'warn');attempts.push({...identity,...ai,status:'conflict',stage:'storage',code:'conflict',durationMs:Date.now()-start,message:'与本地历史答案冲突，未自动采用'});continue;}
    attempts.push({...identity,...ai,status:'hit',durationMs:Date.now()-start,...(result.usage?{usage:result.usage}:{})});
    return {code:1,question:q.title,answer:result.answer,source:p.name,questionId:row.id,verified:false,match:'external',ai:result.ai,attempts};
   }catch(error:any){
    logEvent('provider.failed',{queryId,providerId:p.id,providerName:p.name,durationMs:Date.now()-start,error:logError(error)},'warn',providerConfig);
    const failure=String(error.code??'').startsWith('UPSTREAM_')?providerFailure(error):{stage,code:'internal_error',message:'来源处理失败，请按请求编号查看服务日志'};
    attempts.push({...identity,...ai,status:'error',durationMs:Date.now()-start,...failure});
   }finally{release();if(queue.idle)this.providerQueues.delete(p.id);}
  }
  const failureCode=providers.length?[...attempts].reverse().find(a=>a.kind!=='rag'&&a.code)?.code??'no_answer':'no_provider';
  return {code:0,question:q.title,answer:null,source:null,message:providers.length?'未获得可用答案，请查看查询记录中的失败原因':'没有启用的外部来源，请配置题库源或人工补充',failureCode,attempts};
 }
 async query(input:QuestionInput,tokenId:string|null,eventId?:string,requestId?:string){
  const start=Date.now(),q=prepare(input);
  const recordId=eventId??String((await this.pool.query("INSERT INTO query_events(token_id,title,status,duration_ms,fingerprint,question_snapshot,request_id) VALUES($1,$2,'pending',0,$3,$4,$5) RETURNING id",[tokenId,input.title,q.key,JSON.stringify(questionSnapshot(input)),requestId??null])).rows[0].id);
  let entry=this.inflight.get(q.key);const joined=Boolean(entry);
  if(!entry){
   if(this.inflight.size>=20){await this.pool.query("UPDATE query_events SET status='rejected',failure_code='busy',duration_ms=$2 WHERE id=$1",[recordId,Date.now()-start]);throw Object.assign(new Error('查题繁忙，请稍后重试'),{statusCode:429});}
   const id=randomUUID(),promise=this.execute(q,id);entry={id,promise};this.inflight.set(q.key,entry);
   const active=entry;void promise.finally(()=>{if(this.inflight.get(q.key)===active)this.inflight.delete(q.key);}).catch(()=>{});
  }
  const current=entry;
  logEvent(joined?'query.joined':'query.started',{queryId:current.id,fingerprint:q.key,tokenId,question:{title:q.title,type:q.type,choices:q.choices,imageCount:q.images.length}});
  try{
   await this.pool.query('UPDATE query_events SET query_id=$2 WHERE id=$1',[recordId,current.id]);
   const result=await current.promise;
   await this.pool.query('UPDATE query_events SET status=$2,source=$3,question_id=$4,duration_ms=$5,attempts=$6,failure_code=$7 WHERE id=$1',[recordId,result.code===1?'hit':'miss',result.source,result.questionId??null,Date.now()-start,JSON.stringify(result.attempts),'failureCode' in result?result.failureCode:null]);
   logEvent('query.completed',{queryId:current.id,tokenId,status:result.code===1?'hit':'miss',source:result.source,questionId:result.questionId,answer:result.answer,attempts:result.attempts,durationMs:Date.now()-start});
   return {...result,durationMs:Date.now()-start,requestId,queryId:current.id,eventId:recordId};
  }catch(error){
   await this.pool.query("UPDATE query_events SET status='error',failure_code='internal_error',duration_ms=$2,attempts=$3 WHERE id=$1",[recordId,Date.now()-start,JSON.stringify([{source:'检索引擎',status:'error',stage:'internal',code:'internal_error',message:'查询处理失败，请按请求编号查看服务日志'}])]);
   logEvent('query.failed',{queryId:current.id,error:logError(error),durationMs:Date.now()-start},'error');throw error;
  }finally{if(this.inflight.get(q.key)===current)this.inflight.delete(q.key);}
 }
}
