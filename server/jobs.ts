/**
 * @file jobs.ts
 * @project ocs-answer-hub
 * @module 持久后台任务
 * @description PostgreSQL 租约队列执行本地向量回填和有界 AI 题库生成。
 * @logic SKIP LOCKED 领取、租约令牌隔离旧执行者，轮次结果与进度同事务提交，失败保留游标可重试。
 * @dependencies pg, semantic, providers, search, zod
 * @index_tags worker, generation, backfill
 * @author holic512
 */
import type pg from 'pg';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {SemanticService,SemanticInputTooLongError,SEMANTIC_POLICY,embeddingText,isSafeQuestionText,semanticContentHash,EMBEDDING_MODEL} from './semantic.js';
import {prepare,canonicalAnswer} from './search.js';
import {decrypt} from './security.js';
import {requestAi,type Transport} from './providers.js';
import {dispatchDueSchedules} from './modules/operations.js';
import {recoverExpiredCredits} from './accounts.js';
import {generationPrompt,AI_SYSTEM,GENERATION_SCHEMA} from './ai/prompts.js';
import {logEvent,logError} from './logging.js';
const generatedSchema=z.object({title:z.string().min(4).max(2000),type:z.enum(['single','multiple','judgement','completion']),options:z.array(z.string().min(1).max(500)).max(10).default([]),answer:z.union([z.string().min(1).max(4000),z.array(z.string().max(1000)).min(1).max(10)])}).strict().superRefine((q,ctx)=>{if((q.type==='single'||q.type==='multiple')&&(q.options.length<2||new Set(q.options).size!==q.options.length))ctx.addIssue({code:'custom',message:'选择题需要至少两个不同选项'});});
export class JobWorker{
 private timer?:ReturnType<typeof setInterval>;private active?:Promise<boolean>;
 constructor(public pool:pg.Pool,public semantic:SemanticService,private key:string,private transport:Transport){}
 start(){this.timer=setInterval(()=>{if(!this.active){this.active=this.tick().catch(e=>{logEvent('worker.failed',{error:logError(e)},'error');return false;}).finally(()=>{this.active=undefined;});}},1000);this.timer.unref();}
 async close(){clearInterval(this.timer);await this.active;}
 async tick(){
  await recoverExpiredCredits(this.pool);
  await dispatchDueSchedules(this.pool);
  await this.pool.query("UPDATE background_jobs SET status='failed',attempts=attempts+1,error='任务多次中断，已达到恢复上限',lease_until=NULL,updated_at=now() WHERE status='running' AND lease_until<now() AND attempts+1>=max_attempts AND NOT cancel_requested");
  const job=(await this.pool.query(`UPDATE background_jobs SET attempts=CASE WHEN status='running' THEN attempts+1 ELSE attempts END,status='running',lease_token=$1,lease_until=now()+interval '10 minutes',updated_at=now() WHERE id=(SELECT id FROM background_jobs WHERE (status='queued' OR (status='running' AND lease_until<now())) AND NOT cancel_requested ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,[randomUUID()])).rows[0];
  if(!job)return false;
  try{if(job.kind==='backfill')await this.backfill(job);else await this.generate(job);}catch(e){await this.pool.query("UPDATE background_jobs SET status=CASE WHEN cancel_requested THEN 'cancelled' ELSE 'failed' END,attempts=attempts+1,error=$3,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running'",[job.id,job.lease_token,e instanceof Error&&e.message==='vector_index_incomplete'?'所选课程向量缺失、过期或含超长题，请维护后重试':e instanceof Error&&e.name==='SemanticUnavailableError'?'本地模型不可用，请检查模型健康状态':'任务执行失败，请检查来源或本地模型后重试']);logEvent('job.failed',{jobId:job.id,error:logError(e)},'warn');}
  return true;
 }
 private async backfill(job:any){
  const rows=(await this.pool.query(`SELECT q.* FROM questions q LEFT JOIN question_vectors v ON v.question_id=q.id LEFT JOIN vector_index_skips s ON s.question_id=q.id WHERE NOT q.deleted AND ($1::uuid IS NULL OR q.id>$1) AND (v.model IS DISTINCT FROM $2 OR v.content_version IS DISTINCT FROM q.content_version) AND (s.model IS DISTINCT FROM $2 OR s.content_version IS DISTINCT FROM q.content_version) ORDER BY q.id LIMIT 10`,[job.cursor_id,EMBEDDING_MODEL])).rows;
  for(const row of rows){if(!await this.owns(job))return;const indexed=await this.semantic.indexQuestion(row);await this.pool.query("UPDATE background_jobs SET cursor_id=$3,processed=processed+1,skipped_count=skipped_count+$4,lease_until=now()+interval '10 minutes',updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running'",[job.id,job.lease_token,row.id,indexed?.indexed===false?1:0]);}
  await this.finish(job,rows.length<10?'completed':'queued');
 }
 private async generate(job:any){
  if(!await this.owns(job))return;
  const provider=(await this.pool.query("SELECT * FROM providers WHERE id=$1 AND enabled AND kind='ai'",[job.provider_id])).rows[0];if(!provider)throw new Error('AI source unavailable');
  provider.config=decrypt(provider.config_cipher,this.key);
  // 模型不可用时不能跳过向量去重继续生成。
  await this.semantic.embed('生成去重健康检查');
  await this.requireCompleteIndex(this.pool,job.course);
  const count=Math.min(job.batch_size,job.max_questions-job.accepted);
  if(!Array.isArray(job.seed_snapshot)||!job.seed_snapshot.length)throw new Error('generation_seeds_required');
  const seeds=job.seed_snapshot.slice(((job.round*3)%job.seed_snapshot.length),((job.round*3)%job.seed_snapshot.length)+3);
  const prompt=generationPrompt(job.course,seeds,count,job.round+1);
  const output=await requestAi(provider,prompt,provider.timeout_ms,this.transport,[],AI_SYSTEM,undefined,GENERATION_SCHEMA);if(!output)throw new Error('Empty generation');
  const parsed=z.object({questions:z.array(z.unknown()).max(20)}).strict().parse(JSON.parse(output.text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')));
  const candidates:any[]=[];
  for(const raw of parsed.questions.slice(0,count)){
   const d=generatedSchema.safeParse(raw);if(!d.success){candidates.push({data:{},reason:'structure_invalid'});continue;}
   const q=prepare({...d.data,course:job.course});const answer=canonicalAnswer(d.data.answer,q);
   if(!answer||!isSafeQuestionText(JSON.stringify(d.data))){candidates.push({data:d.data,reason:answer?'unsafe_content':'invalid_answer'});continue;}
   try{const embedding=await this.semantic.embed(embeddingText(q));candidates.push({q,answer,embedding,data:d.data});}catch(e){if(!(e instanceof SemanticInputTooLongError))throw e;candidates.push({data:d.data,reason:'embedding_input_too_long'});}
  }
  const c=await this.pool.connect();
  try{
   await c.query('BEGIN');
   const owned=(await c.query("SELECT * FROM background_jobs WHERE id=$1 AND lease_token=$2 AND status='running' AND NOT cancel_requested FOR UPDATE",[job.id,job.lease_token])).rows[0];if(!owned){await c.query('ROLLBACK');return;}
   // 生成写入串行化，防止两个 worker 同时判定相同候选为新题；不持锁调用 AI。
   await c.query('SELECT pg_advisory_xact_lock(764003)');
   await this.requireCompleteIndex(c,job.course);
   let accepted=0;
   for(const item of candidates){let reason=item.reason;let questionId=null;
    if(!reason){const {q,answer,embedding}=item;
     const duplicate=(await c.query(`SELECT id FROM questions WHERE fingerprint=$1 OR normal_title=$2 OR (NOT deleted AND similarity(normal_title,$2)>0.9) LIMIT 1`,[q.key,q.normalTitle])).rowCount;
     const vectorDuplicate=(await c.query('SELECT v.question_id FROM question_vectors v JOIN questions q ON q.id=v.question_id WHERE NOT q.deleted AND q.course=$3 AND v.content_version=q.content_version AND v.model=$4 AND 1-(v.embedding <=> $1::vector)>=$2 LIMIT 1',[JSON.stringify(embedding),SEMANTIC_POLICY.dedupMin,job.course,EMBEDDING_MODEL])).rowCount;
     if(duplicate||vectorDuplicate)reason='duplicate';
     else{
      const row=(await c.query(`INSERT INTO questions(fingerprint,title,normal_title,type,options,course,answer,generation_task_id,generation_round,generation_model) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(fingerprint) DO NOTHING RETURNING *`,[q.key,q.title,q.normalTitle,q.type,JSON.stringify(q.choices),job.course,answer,job.id,job.round+1,provider.config.model])).rows[0];
      if(row){questionId=row.id;accepted++;await c.query("INSERT INTO answer_versions(question_id,answer,operation,snapshot) VALUES($1,$2,'生成题目',$3)",[row.id,answer,JSON.stringify({title:row.title,type:row.type,options:row.options,course:row.course,answer})]);
       // 同事务写入向量，当前批次后续候选也参与向量去重。
       await c.query('INSERT INTO question_vectors(question_id,embedding,content_hash,model,content_version) VALUES($1,$2::vector,$3,$4,$5)',[row.id,JSON.stringify(embedding),semanticContentHash(row),EMBEDDING_MODEL,row.content_version]);
      }else reason='duplicate';
     }
    }
    await c.query('INSERT INTO generation_previews(job_id,round,question_id,data,status,reason) VALUES($1,$2,$3,$4,$5,$6)',[job.id,job.round+1,questionId,JSON.stringify(item.data),questionId?'accepted':'rejected',reason??null]);
   }
   await c.query(`UPDATE background_jobs SET round=round+1,accepted=accepted+$3,processed=processed+$4,status=CASE WHEN round+1>=max_rounds OR accepted+$3>=max_questions THEN 'completed' ELSE 'queued' END,lease_until=NULL,error=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2`,[job.id,job.lease_token,accepted,candidates.length]);
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 private async requireCompleteIndex(connection:pg.Pool|pg.PoolClient,course:string){const missing=await connection.query('SELECT 1 FROM questions q LEFT JOIN question_vectors v ON v.question_id=q.id WHERE NOT q.deleted AND q.course=$1 AND (v.model IS DISTINCT FROM $2 OR v.content_version IS DISTINCT FROM q.content_version) LIMIT 1',[course,EMBEDDING_MODEL]);if(missing.rowCount)throw new Error('vector_index_incomplete');}
 private async owns(job:any){return Boolean((await this.pool.query("SELECT id FROM background_jobs WHERE id=$1 AND lease_token=$2 AND status='running' AND NOT cancel_requested",[job.id,job.lease_token])).rowCount);}
 private async finish(job:any,status:string){await this.pool.query("UPDATE background_jobs SET status=CASE WHEN cancel_requested THEN 'cancelled' ELSE $3 END,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running'",[job.id,job.lease_token,status]);}
}
