/**
 * @file operations.ts
 * @project ocs-answer-hub
 * @module repositories
 * @description 运维任务、计划和派发持久化。
 * @logic 提供领取、合并、种子快照和执行记录的领域 SQL，事务由服务管理。
 * @dependencies pg, operation-contracts
 * @index_tags operations, scheduler, repository
 * @author holic512
 */
import type pg from 'pg';
import type {Pagination} from './users.js';
import type {GenerationConfig,Job,JobFilters,JobInput,Schedule,ScheduleInput,Seed} from '../services/operation-contracts.js';
export type GenerationPreview={id:string;round:number;question_id:string|null;data:Record<string,unknown>;status:string;reason:string|null;created_at:Date};
export class OperationsRepository {
 constructor(private db:pg.Pool|pg.PoolClient){}
 async lockDispatch(){await this.db.query('SELECT pg_advisory_xact_lock(764006)');}
 async active(input:JobInput,scheduleId?:string){return (await this.db.query<Job>("SELECT * FROM background_jobs WHERE kind=$1 AND status IN ('queued','running') AND NOT cancel_requested AND ($1='backfill' OR schedule_id=$2::uuid) ORDER BY created_at LIMIT 1",[input.kind,scheduleId??null])).rows[0];}
 async resetIndex(){await this.db.query('UPDATE question_vectors SET content_version=0');await this.db.query('DELETE FROM vector_index_skips');}
 async seeds(input:GenerationConfig){return (await this.db.query<Seed>('SELECT id,title,type,options,answer,course FROM questions WHERE id=ANY($1::uuid[]) AND course=$2 AND NOT deleted ORDER BY id',[input.seed_ids,input.course])).rows;}
 async aiEnabled(id:string){return Boolean((await this.db.query("SELECT id FROM providers WHERE id=$1 AND enabled AND kind='ai'",[id])).rowCount);}
 async create(input:JobInput,userId:number,scheduleId?:string,seeds:Seed[]=[]){
  if(input.kind==='backfill')return (await this.db.query<Job>("INSERT INTO background_jobs(kind,user_id,schedule_id) VALUES('backfill',$1,$2) RETURNING *",[userId,scheduleId??null])).rows[0];
  return (await this.db.query<Job>("INSERT INTO background_jobs(kind,user_id,provider_id,course,max_rounds,max_questions,batch_size,seed_snapshot,schedule_id) VALUES('generation',$1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[userId,input.provider_id,input.course,input.max_rounds,input.max_questions,input.batch_size,JSON.stringify(seeds),scheduleId??null])).rows[0];
 }
 async recordDispatchFailure(schedule:Schedule,userId:number,message:string){await this.db.query("INSERT INTO background_jobs(kind,user_id,schedule_id,course,status,attempts,error) VALUES($1,$2,$3,$4,'failed',1,$5)",[schedule.kind,userId,schedule.id,typeof schedule.config.course==='string'?schedule.config.course:'',message]);}
 async due(){return (await this.db.query<Schedule>('SELECT * FROM task_schedules WHERE enabled AND next_run_at<=now() ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT 10')).rows;}
 async advance(schedule:Schedule,at:Date){await this.db.query('UPDATE task_schedules SET next_run_at=$2,last_run_at=now(),updated_at=now() WHERE id=$1',[schedule.id,at]);}
 async disable(id:string){await this.db.query('UPDATE task_schedules SET enabled=false WHERE id=$1',[id]);}
 async jobs(p:JobFilters){const where='($1::text IS NULL OR kind=$1) AND ($2::text IS NULL OR status=$2)',values=[p.kind??null,p.status??null];const [items,total]=await Promise.all([this.db.query<Job>(`SELECT * FROM background_jobs WHERE ${where} ORDER BY created_at DESC,id LIMIT $3 OFFSET $4`,[...values,p.pageSize,(p.page-1)*p.pageSize]),this.db.query<{total:number}>(`SELECT count(*)::int total FROM background_jobs WHERE ${where}`,values)]);return {items:items.rows,total:total.rows[0].total,page:p.page,pageSize:p.pageSize};}
 async job(id:string){return (await this.db.query<Job>('SELECT * FROM background_jobs WHERE id=$1',[id])).rows[0];}
 async previews(id:string,p:Pagination){const [items,total]=await Promise.all([this.db.query<GenerationPreview>('SELECT id::text,round,question_id,data,status,reason,created_at FROM generation_previews WHERE job_id=$1 ORDER BY id LIMIT $2 OFFSET $3',[id,p.pageSize,(p.page-1)*p.pageSize]),this.db.query<{total:number}>('SELECT count(*)::int total FROM generation_previews WHERE job_id=$1',[id])]);return {items:items.rows,total:total.rows[0].total,...p};}
 async cancel(id:string){return Boolean((await this.db.query("UPDATE background_jobs SET cancel_requested=true,status='cancelled',updated_at=now() WHERE id=$1 AND status IN ('queued','running','failed') RETURNING id",[id])).rowCount);}
 async retry(id:string){return Boolean((await this.db.query("UPDATE background_jobs SET status='queued',error=NULL,lease_until=NULL,lease_token=NULL,updated_at=now() WHERE id=$1 AND status='failed' AND attempts<max_attempts AND NOT cancel_requested RETURNING id",[id])).rowCount);}
 async schedules(p:Pagination){const [items,total]=await Promise.all([this.db.query<Schedule>('SELECT * FROM task_schedules ORDER BY created_at,id LIMIT $1 OFFSET $2',[p.pageSize,(p.page-1)*p.pageSize]),this.db.query<{total:number}>('SELECT count(*)::int total FROM task_schedules')]);return {items:items.rows,total:total.rows[0].total,...p};}
 async schedule(id:string){return (await this.db.query<Schedule>('SELECT * FROM task_schedules WHERE id=$1',[id])).rows[0];}
 async saveSchedule(data:ScheduleInput,userId:number,at:Date,id?:string){
  const values=[data.name,data.kind,data.enabled,data.mode,data.interval_minutes,data.time_of_day,JSON.stringify(data.config),at,userId];
  if(id)return (await this.db.query<Schedule>('UPDATE task_schedules SET name=$2,kind=$3,enabled=$4,mode=$5,interval_minutes=$6,time_of_day=$7,config=$8,next_run_at=$9,updated_at=now(),user_id=$10 WHERE id=$1 RETURNING *',[id,...values])).rows[0];
  return (await this.db.query<Schedule>('INSERT INTO task_schedules(name,kind,enabled,mode,interval_minutes,time_of_day,config,next_run_at,user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',values)).rows[0];
 }
 async removeSchedule(id:string){return Boolean((await this.db.query('DELETE FROM task_schedules WHERE id=$1 RETURNING id',[id])).rowCount);}
 async skips(){return (await this.db.query<{id:string;title:string;course:string;reason:string;updated_at:Date}>('SELECT q.id,q.title,q.course,s.reason,s.updated_at FROM vector_index_skips s JOIN questions q ON q.id=s.question_id WHERE NOT q.deleted AND s.content_version=q.content_version ORDER BY s.updated_at DESC LIMIT 100')).rows;}
}
