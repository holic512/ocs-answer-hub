/**
 * @file engine.ts
 * @project ocs-answer-hub
 * @module 查询编排
 * @description 本地优先、AI 降级、单次 RAG 与独立调用结算。
 * @logic 同题共享查询工作，受理记录分别结算，持久化失败释放积分。
 * @dependencies pg, semantic, providers, questions, accounts, concurrency
 * @index_tags query, billing, fallback
 * @author holic512
 */
import type pg from 'pg';
import {randomUUID} from 'node:crypto';
import {SemanticService,type RagDecision} from './semantic.js';
import {prepare,fuzzySafe,canonicalAnswer,type QuestionInput,type Prepared} from './search.js';
import {decrypt,safeRequest} from './security.js';
import {queryProvider,type Transport,type Provider,type ProviderDiagnostic} from './providers.js';
import {ConcurrencyPool} from './concurrency.js';
import {answerFailure,providerFailure} from './provider-diagnostics.js';
import {questionSnapshot} from './query-history.js';
import {completeQuery} from './accounts.js';
import {storeQuestion,type QuestionRow} from './modules/questions.js';
import {fail} from './core.js';
import {logEvent,logError} from './logging.js';
import {PROMPT_VERSION} from './ai/prompts.js';
export type Attempt={source:string;kind:string;status:string;durationMs:number;providerId?:string;stage?:string;code?:string;reason?:string;message?:string;httpStatus?:number;promptVersion?:string};
export type QueryResult={code:number;question:string;answer:string|null;source:string|null;questionId?:string;match?:string;ai?:boolean;message?:string;failureCode?:string;attempts:Attempt[]};
export class Engine{
 private inflight=new Map<string,{id:string;promise:Promise<QueryResult>}>();
 private providerQueues=new Map<string,ConcurrencyPool>();
 constructor(public pool:pg.Pool,public key:string,public transport?:Transport,public semantic?:SemanticService){}
 async local(q:Prepared){
  let row=(await this.pool.query<QuestionRow>('SELECT * FROM questions WHERE fingerprint=$1 AND NOT deleted',[q.key])).rows[0],match='exact';
  if(!row){const rows=(await this.pool.query<QuestionRow>('SELECT * FROM questions WHERE type=$1 AND course=$2 AND NOT deleted AND abs(length(normal_title)-length($3))<=3 AND normal_title LIKE $4 ORDER BY hit_count DESC,id LIMIT 101',[q.type,q.course??'',q.normalTitle,`%${q.normalTitle.slice(0,3).replace(/[\\%_]/g,'')}%`])).rows;if(rows.length>100)return null;const valid=rows.filter(r=>fuzzySafe(q,prepare(r)));if(valid.length===1){row=valid[0];match='fuzzy';}}
  if(!row)return null;const answer=canonicalAnswer(canonicalAnswer(row.answer,prepare(row)),q);if(!answer)return null;
  await this.pool.query('UPDATE questions SET hit_count=hit_count+1 WHERE id=$1',[row.id]);
  return {code:1,question:q.title,answer,source:'本地题库',questionId:row.id,match};
 }
 async execute(q:Prepared,queryId:string):Promise<QueryResult>{
  const attempts:Attempt[]=[],start=Date.now(),local=await this.local(q);attempts.push({source:'本地题库',kind:'local',status:local?'hit':'miss',durationMs:Date.now()-start});if(local)return {...local,attempts};
  const providers=(await this.pool.query("SELECT * FROM providers WHERE enabled AND kind='ai' ORDER BY priority,created_at")).rows,deadline=Date.now()+55000;
  let rag:Promise<RagDecision>|undefined;
  for(const row of providers){
   if(deadline-Date.now()<100){attempts.push({source:row.name,kind:'ai',status:'error',stage:'queue',code:'total_timeout',durationMs:0});break;}
   const queue=this.providerQueues.get(row.id)??new ConcurrencyPool(4);this.providerQueues.set(row.id,queue);const started=Date.now(),release=await queue.acquire(deadline);
   if(!release){attempts.push({source:row.name,kind:'ai',status:'error',code:'queue_timeout',durationMs:Date.now()-started});break;}
   const identity={source:row.name,providerId:row.id,kind:'ai',promptVersion:PROMPT_VERSION};
   try{
    const p:Provider={...row,config:decrypt(row.config_cipher,this.key)};
    if(!rag&&this.semantic)rag=this.semantic.rag(q);
    const reference=await rag;if(reference)attempts.push({source:'RAG',kind:'rag',status:reference.enabled?'enabled':'filtered',reason:reference.reason,durationMs:Date.now()-started});
    const diagnostics:ProviderDiagnostic[]=[];
    const result=await queryProvider(p,q,Math.max(1,Math.min(p.timeout_ms,deadline-Date.now())),this.transport??safeRequest,e=>diagnostics.push(e),reference);
    if(!result){const failure=answerFailure(diagnostics,p.config);attempts.push({...identity,...failure,status:failure.code==='no_answer'?'miss':'error',durationMs:Date.now()-started});continue;}
    const stored=await storeQuestion(this.pool,q,result.answer);
    if(stored.deleted){attempts.push({...identity,status:'miss',code:'deleted_question',message:'题目已被管理员删除',durationMs:Date.now()-started});continue;}
    const answer=canonicalAnswer(stored.answer,q);if(!answer)continue;
    attempts.push({...identity,status:'hit',durationMs:Date.now()-started});logEvent('query.ai.completed',{queryId,providerId:p.id,promptVersion:PROMPT_VERSION,usage:result.usage});
    return {code:1,question:q.title,answer,source:row.name,questionId:stored.id,match:'ai',ai:true,attempts};
   }catch(error){attempts.push({...identity,...providerFailure(error),status:'error',durationMs:Date.now()-started});logEvent('query.ai.failed',{queryId,error:logError(error)},'warn');}
   finally{release();if(queue.idle)this.providerQueues.delete(row.id);}
  }
  return {code:0,question:q.title,answer:null,source:null,message:providers.length?'未获得可用答案':'没有启用的 AI 配置，请联系管理员',failureCode:providers.length?[...attempts].reverse().find(a=>a.code)?.code??'no_answer':'no_provider',attempts};
 }
 async query(input:QuestionInput,tokenId:string|null,eventId?:string,requestId?:string){
  const start=Date.now(),q=prepare(input),recordId=eventId??String((await this.pool.query("INSERT INTO query_events(token_id,title,status,duration_ms,fingerprint,question_snapshot,request_id) VALUES($1,$2,'pending',0,$3,$4,$5) RETURNING id",[tokenId,input.title,q.key,JSON.stringify(questionSnapshot(input)),requestId??null])).rows[0].id);
  let entry=this.inflight.get(q.key);
  if(!entry){if(this.inflight.size>=20){await completeQuery(this.pool,recordId,{status:'rejected',durationMs:0,attempts:[],failureCode:'busy'});throw fail('查题繁忙，请稍后重试',429);}const id=randomUUID(),promise=this.execute(q,id);entry={id,promise};this.inflight.set(q.key,entry);const current=entry;void promise.finally(()=>{if(this.inflight.get(q.key)===current)this.inflight.delete(q.key);}).catch(()=>{});}
  try{const result=await entry.promise;await completeQuery(this.pool,recordId,{status:result.code===1?'hit':'miss',source:result.source,questionId:result.questionId,durationMs:Date.now()-start,attempts:result.attempts,failureCode:result.failureCode,queryId:entry.id});return {...result,durationMs:Date.now()-start,requestId,queryId:entry.id,eventId:recordId};}
  catch(error){await completeQuery(this.pool,recordId,{status:'error',durationMs:Date.now()-start,attempts:[],failureCode:'internal_error',queryId:entry.id});throw error;}
 }
}
