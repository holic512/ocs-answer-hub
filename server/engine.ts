/**
 * @file engine.ts
 * @project ocs-answer-hub
 * @module 检索引擎
 * @description 本地答案缓存、按来源顺序查题并持久化答案及查询记录。
 * @logic 本地缓存优先、同题合并、来源有界并发，题库写入后统一使缓存失效。
 * @dependencies pg, search, providers, security, logging, concurrency
 * @index_tags query, fallback, persistence
 * @author holic512
 */
import type pg from 'pg';
import {randomUUID} from 'node:crypto';
import {logEvent,logError,rememberLogSecrets} from './logging.js';
import {prepare,fuzzySafe,canonicalAnswer,type QuestionInput,type Prepared} from './search.js';
import {decrypt,encrypt,safeRequest} from './security.js';
import {queryProvider,type Transport} from './providers.js';
import {ConcurrencyPool} from './concurrency.js';
type LocalResult={code:number;question:string;answer:string;source:string;origin:string;questionId:string;verified:boolean;match:string};
export class Engine{
 private inflight=new Map<string,{id:string;promise:Promise<any>}>();private providerQueues=new Map<string,ConcurrencyPool>();
 private localCache=new Map<string,{expires:number;value:LocalResult}>();private cacheEpoch=0;
 invalidateLocal(){this.cacheEpoch++;this.localCache.clear();}
 constructor(public pool:pg.Pool,public key:string,public transport?:Transport){ }
 async store(q:Prepared,answer:string,source:string,verified=false,queryId?:string){
  const client=await this.pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[q.key]);
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
  const epoch=this.cacheEpoch,cached=this.localCache.get(q.key);
  if(cached&&cached.expires>Date.now()){
   this.localCache.delete(q.key);this.localCache.set(q.key,cached);
   await this.pool.query('UPDATE questions SET hit_count=hit_count+1 WHERE id=$1',[cached.value.questionId]);
   logEvent('query.cache',{fingerprint:q.key,status:'hit'});
   return {...cached.value,question:q.title};
  }
  this.localCache.delete(q.key);
  let row=(await this.pool.query('SELECT * FROM questions WHERE fingerprint=$1 AND NOT deleted AND NOT conflict',[q.key])).rows[0];let match='exact';
  if(!row){const candidate=(await this.pool.query('SELECT * FROM questions WHERE type=$1 AND NOT deleted AND NOT conflict AND abs(length(normal_title)-length($2))<=3 AND normal_title LIKE $3 ORDER BY verified DESC,hit_count DESC LIMIT 100',[q.type,q.normalTitle,`%${q.normalTitle.slice(0,3).replace(/[\\%_]/g,'')}%`])).rows;
   const valid=candidate.filter(r=>fuzzySafe(q,prepare({title:r.title,type:r.type,options:r.options,images:r.images,course:r.course})));if(valid.length===1){row=valid[0];match='fuzzy';}
  }
  if(!row||!canonicalAnswer(row.answer,q))return null;
  await this.pool.query('UPDATE questions SET hit_count=hit_count+1 WHERE id=$1',[row.id]);
  const value:LocalResult={code:1,question:q.title,answer:row.answer,source:'本地题库',origin:row.source,questionId:row.id,verified:row.verified,match};
  // 写入期间完成的旧读取不能重新填回缓存；模糊匹配也随整库变更失效。
  if(epoch===this.cacheEpoch){if(this.localCache.size>=256)this.localCache.delete(this.localCache.keys().next().value!);this.localCache.set(q.key,{expires:Date.now()+30000,value});}
  return value;
 }

 async execute(q:Prepared,queryId:string){const attempts:any[]=[];const local=await this.local(q);logEvent('query.local',{queryId,fingerprint:q.key,status:local?'hit':'miss',questionId:local?.questionId,match:local?.match});if(local)return {...local,attempts:[{source:'本地题库',status:'hit'}]};attempts.push({source:'本地题库',status:'miss'});
 const providers=(await this.pool.query('SELECT * FROM providers WHERE enabled ORDER BY priority,created_at')).rows;const deadline=Date.now()+55000;
 for(const p of providers){const remaining=deadline-Date.now();if(remaining<500){attempts.push({source:p.name,status:'skipped',message:'已达到总超时'});logEvent('provider.skipped',{queryId,providerId:p.id,reason:'total_timeout'},'warn');break;}
  const queue=this.providerQueues.get(p.id)??new ConcurrencyPool(4);this.providerQueues.set(p.id,queue);
  const start=Date.now();const release=await queue.acquire(deadline);
  if(!release){attempts.push({source:p.name,status:'skipped',message:'等待来源时已达到总超时'});logEvent('provider.skipped',{queryId,providerId:p.id,reason:'queue_timeout'},'warn');break;}
  let providerConfig:any;
  try{providerConfig=decrypt(p.config_cipher,this.key);rememberLogSecrets(providerConfig);const timeoutMs=Math.max(1,Math.min(deadline-Date.now(),p.timeout_ms));
   logEvent('provider.started',{queryId,providerId:p.id,providerName:p.name,kind:p.kind,model:providerConfig.model,apiFormat:providerConfig.apiFormat,maxTokens:providerConfig.maxTokens,vision:providerConfig.vision,timeoutMs,endpoint:providerConfig.baseUrl??providerConfig.url??'https://tk.enncy.cn/query'},'info',providerConfig);
   let observed:any=undefined;const capture:Transport=async(...args)=>{logEvent('provider.request',{queryId,providerId:p.id,url:args[0],method:args[1],timeoutMs:args[4],bodyFields:args[3]&&typeof args[3]==='object'?Object.keys(args[3]):[]},'info',providerConfig);const result=await (this.transport??safeRequest)(args[0],args[1],args[2],args[3],args[4],event=>logEvent('provider.network',{queryId,providerId:p.id,...event},event.status==='failed'?'warn':'info',providerConfig));observed=result;logEvent('provider.response',{queryId,providerId:p.id,responseFields:result&&typeof result==='object'?Object.keys(result):[],responseType:Array.isArray(result)?'array':typeof result},'info',providerConfig);return result;};
   const result=await queryProvider({...p,config:providerConfig},q,timeoutMs,capture,event=>logEvent('provider.mapping',{queryId,providerId:p.id,...event},event.status==='failed'?'warn':'info',providerConfig));
   logEvent('provider.completed',{queryId,providerId:p.id,status:result?'hit':'miss',durationMs:Date.now()-start,answer:result?.answer,usage:result?.usage},'info',providerConfig);
   if(observed!==undefined)await this.pool.query('INSERT INTO provider_observations(fingerprint,title,source,status,response_cipher) VALUES($1,$2,$3,$4,$5)',[q.key,q.title,p.name,result?'valid':'no_valid_answer',encrypt(observed,this.key)]);
   if(!result){attempts.push({source:p.name,status:'miss',durationMs:Date.now()-start});continue;}
   const row=await this.store(q,result.answer,result.ai?`${p.name} · AI`:p.name,false,queryId);if(row.conflict){logEvent('query.conflict',{queryId,providerId:p.id,questionId:row.id},'warn');attempts.push({source:p.name,status:'conflict',message:'与本地历史答案冲突，未自动采用'});continue;}attempts.push({source:p.name,status:'hit',durationMs:Date.now()-start,...(result.usage?{usage:result.usage}:{})});
   return {code:1,question:q.title,answer:result.answer,source:p.name,questionId:row.id,verified:false,match:'external',ai:result.ai,attempts};
  }catch(e:any){logEvent('provider.failed',{queryId,providerId:p.id,providerName:p.name,durationMs:Date.now()-start,error:logError(e)},'warn',providerConfig);const msg=/HTTP \d+/.exec(e.message)?.[0]??'请求失败、超时或数据格式不正确';attempts.push({source:p.name,status:'error',durationMs:Date.now()-start,message:msg});}
  finally{release();if(queue.idle)this.providerQueues.delete(p.id);}
 }
 return {code:0,question:q.title,answer:null,source:null,message:'未找到可用答案，请在后台配置题库源或人工补充',attempts};
 }
 async query(input:QuestionInput,tokenId:string|null){
  const start=Date.now(),q=prepare(input);let entry=this.inflight.get(q.key);const joined=Boolean(entry);
  if(!entry){if(this.inflight.size>=20)throw Object.assign(new Error('查题繁忙，请稍后重试'),{statusCode:429});const id=randomUUID();const promise=this.execute(q,id);entry={id,promise};this.inflight.set(q.key,entry);const active=entry;void promise.finally(()=>{if(this.inflight.get(q.key)===active)this.inflight.delete(q.key);}).catch(()=>{});}
  const current=entry;
  logEvent(joined?'query.joined':'query.started',{queryId:current.id,fingerprint:q.key,tokenId,question:{title:q.title,type:q.type,choices:q.choices,imageCount:q.images.length}});
  try{
   const result=await current.promise;
   await this.pool.query('INSERT INTO query_events(token_id,title,status,source,question_id,duration_ms,attempts) VALUES($1,$2,$3,$4,$5,$6,$7)',[tokenId,q.title,result.code===1?'hit':'miss',result.source,result.questionId??null,Date.now()-start,JSON.stringify(result.attempts)]);
   logEvent('query.completed',{queryId:current.id,tokenId,status:result.code===1?'hit':'miss',source:result.source,questionId:result.questionId,answer:result.answer,attempts:result.attempts,durationMs:Date.now()-start});
   return {...result,durationMs:Date.now()-start};
  }catch(error){logEvent('query.failed',{queryId:current.id,error:logError(error),durationMs:Date.now()-start},'error');throw error;}
  finally{if(this.inflight.get(q.key)===current)this.inflight.delete(q.key);}
 }
}
