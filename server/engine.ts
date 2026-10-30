/**
 * @file engine.ts
 * @project ocs-answer-hub
 * @module 检索引擎
 * @description 按来源顺序查题并持久化有效答案、冲突及查询记录。
 * @logic 本地优先、来源回退、请求合并和配额内查询，不区分上游地址网段。
 * @dependencies pg, search, providers, security
 * @index_tags query, fallback, persistence
 * @author holic512
 */
import type pg from 'pg';
import {prepare,fuzzySafe,canonicalAnswer,type QuestionInput,type Prepared} from './search.js';
import {decrypt,encrypt,safeRequest} from './security.js';
import {queryProvider,type Transport} from './providers.js';
export class Engine{
 private inflight=new Map<string,Promise<any>>();private providerQueues=new Map<string,Promise<void>>();
 constructor(public pool:pg.Pool,public key:string,public transport?:Transport){ }
 async store(q:Prepared,answer:string,source:string,verified=false){
  const client=await this.pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[q.key]);
   const old=(await client.query('SELECT * FROM questions WHERE fingerprint=$1 FOR UPDATE',[q.key])).rows[0];
   let row:any;
   if(old){
    if(verified){row=(await client.query('UPDATE questions SET answer=$2,source=$3,verified=true,conflict=false,deleted=false,updated_at=now() WHERE id=$1 RETURNING *',[old.id,answer,source])).rows[0];}
    else if(old.answer!==answer&&!old.verified){row=(await client.query('UPDATE questions SET conflict=true,updated_at=now() WHERE id=$1 RETURNING *',[old.id])).rows[0];}
    else row=old;
   }else row=(await client.query('INSERT INTO questions(fingerprint,title,normal_title,type,options,images,course,answer,source,verified) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[q.key,q.title,q.normalTitle,q.type,JSON.stringify(q.choices),JSON.stringify(q.images),q.course??'',answer,source,verified])).rows[0];
   await client.query('INSERT INTO answer_versions(question_id,answer,source,verified) VALUES($1,$2,$3,$4)',[row.id,answer,source,verified]);await client.query('COMMIT');return row;
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 async local(q:Prepared){let row=(await this.pool.query('SELECT * FROM questions WHERE fingerprint=$1 AND NOT deleted AND NOT conflict',[q.key])).rows[0];let match='exact';
 if(!row){const candidate=(await this.pool.query('SELECT * FROM questions WHERE type=$1 AND NOT deleted AND NOT conflict AND abs(length(normal_title)-length($2))<=3 AND normal_title LIKE $3 ORDER BY verified DESC,hit_count DESC LIMIT 100',[q.type,q.normalTitle,`%${q.normalTitle.slice(0,3).replace(/[\\%_]/g,'')}%`])).rows;
 const valid=candidate.filter(r=>fuzzySafe(q,prepare({title:r.title,type:r.type,options:r.options,images:r.images,course:r.course})));if(valid.length===1){row=valid[0];match='fuzzy';}}
 if(!row||!canonicalAnswer(row.answer,q))return null;await this.pool.query('UPDATE questions SET hit_count=hit_count+1 WHERE id=$1',[row.id]);return {code:1,question:q.title,answer:row.answer,source:'本地题库',origin:row.source,questionId:row.id,verified:row.verified,match};
 }
 async execute(q:Prepared){const attempts:any[]=[];const local=await this.local(q);if(local)return {...local,attempts:[{source:'本地题库',status:'hit'}]};attempts.push({source:'本地题库',status:'miss'});
 const providers=(await this.pool.query('SELECT * FROM providers WHERE enabled ORDER BY priority,created_at')).rows;const deadline=Date.now()+55000;
 for(const p of providers){const remaining=deadline-Date.now();if(remaining<500){attempts.push({source:p.name,status:'skipped',message:'已达到总超时'});break;}
  const previous=this.providerQueues.get(p.id)??Promise.resolve();let release!:()=>void;const current=new Promise<void>(resolve=>{release=resolve});this.providerQueues.set(p.id,current);
  const start=Date.now();let timer:ReturnType<typeof setTimeout>|undefined;
  const acquired=await Promise.race([previous.then(()=>true),new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),remaining)})]);if(timer)clearTimeout(timer);
  if(!acquired){previous.finally(release);attempts.push({source:p.name,status:'skipped',message:'等待来源时已达到总超时'});break;}
  try{let observed:any=undefined;const capture:Transport=async(...args)=>{const result=await (this.transport??safeRequest)(...args);observed=result;return result;};
   const result=await queryProvider({...p,config:decrypt(p.config_cipher,this.key)},q,Math.max(1,Math.min(deadline-Date.now(),p.timeout_ms)),capture);
   if(observed!==undefined)await this.pool.query('INSERT INTO provider_observations(fingerprint,title,source,status,response_cipher) VALUES($1,$2,$3,$4,$5)',[q.key,q.title,p.name,result?'valid':'no_valid_answer',encrypt(observed,this.key)]);
   if(!result){attempts.push({source:p.name,status:'miss',durationMs:Date.now()-start});continue;}
   const row=await this.store(q,result.answer,result.ai?`${p.name} · AI`:p.name,false);if(row.conflict){attempts.push({source:p.name,status:'conflict',message:'与本地历史答案冲突，未自动采用'});continue;}attempts.push({source:p.name,status:'hit',durationMs:Date.now()-start,...(result.usage?{usage:result.usage}:{})});
   return {code:1,question:q.title,answer:result.answer,source:p.name,questionId:row.id,verified:false,match:'external',ai:result.ai,attempts};
  }catch(e:any){const msg=/HTTP \d+/.exec(e.message)?.[0]??'请求失败、超时或数据格式不正确';attempts.push({source:p.name,status:'error',durationMs:Date.now()-start,message:msg});}
  finally{release();if(this.providerQueues.get(p.id)===current)this.providerQueues.delete(p.id);}
 }
 return {code:0,question:q.title,answer:null,source:null,message:'未找到可用答案，请在后台配置题库源或人工补充',attempts};
 }
 async query(input:QuestionInput,tokenId:string|null){const start=Date.now(),q=prepare(input);let promise=this.inflight.get(q.key);if(!promise){if(this.inflight.size>=20)throw Object.assign(new Error('查题繁忙，请稍后重试'),{statusCode:429});promise=this.execute(q);this.inflight.set(q.key,promise);}
 try{const result=await promise;await this.pool.query('INSERT INTO query_events(token_id,title,status,source,question_id,duration_ms,attempts) VALUES($1,$2,$3,$4,$5,$6,$7)',[tokenId,q.title,result.code===1?'hit':'miss',result.source,result.questionId??null,Date.now()-start,JSON.stringify(result.attempts)]);return {...result,durationMs:Date.now()-start};}finally{if(this.inflight.get(q.key)===promise)this.inflight.delete(q.key);}
 }
}
