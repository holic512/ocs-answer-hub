/**
 * @file operations.ts
 * @project ocs-answer-hub
 * @module services
 * @description 任务派发与自动化业务。
 * @logic 逐计划保存失败并推进时间，活动回填明确拒绝全量重建，事务隔离单次触发。
 * @dependencies OperationsRepository, UsersRepository, semantic, core
 * @index_tags operations, scheduler, service
 * @author holic512
 */
import type pg from 'pg';
import {z} from 'zod';
import {fail,transaction} from '../core.js';
import {OperationsRepository} from '../repositories/operations.js';
import {UsersRepository,type Pagination} from '../repositories/users.js';
import type {SemanticService} from '../semantic.js';
import {jobSchema,type JobInput,type JobFilters,type Schedule,type ScheduleInput} from './operation-contracts.js';
export function nextRun(schedule:Pick<Schedule,'mode'|'interval_minutes'|'time_of_day'>,now=new Date()){
 if(schedule.mode==='interval')return new Date(now.getTime()+schedule.interval_minutes*60000);
 const local=new Date(now.getTime()+8*3600000),[h,m]=schedule.time_of_day.split(':').map(Number);
 let result=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate(),h-8,m);if(result<=now.getTime())result+=86400000;return new Date(result);
}
export function dispatchJob(pool:pg.Pool,input:JobInput,userId:number,scheduleId?:string){return transaction(pool,c=>enqueue(new OperationsRepository(c),input,userId,scheduleId));}
export async function dispatchDueSchedules(pool:pg.Pool){
 return transaction(pool,async c=>{
  const repo=new OperationsRepository(c),due=await repo.due();
  for(const schedule of due){
   const owner=await new UsersRepository(c).activeAdmin(schedule.user_id);
   if(!owner){await repo.disable(schedule.id);continue;}
   await c.query('SAVEPOINT schedule_dispatch');
   try{await enqueue(repo,jobSchema.parse({kind:schedule.kind,...schedule.config}),owner.id,schedule.id);}
   catch(error){
    await c.query('ROLLBACK TO SAVEPOINT schedule_dispatch');
    await repo.recordDispatchFailure(schedule,owner.id,dispatchFailure(error));
   }
   await c.query('RELEASE SAVEPOINT schedule_dispatch');
   await repo.advance(schedule,nextRun(schedule));
  }
  return due.length;
 });
}
export class OperationsService {
 constructor(private pool:pg.Pool,private semantic:SemanticService){}
 async vector(){return {...await this.semantic.health(),skips:await new OperationsRepository(this.pool).skips()};}
 async createJob(input:JobInput,userId:number){if(input.kind==='generation'&&!(await this.semantic.health()).ready)throw fail('本地向量模型未就绪，请先查看向量索引',503);return dispatchJob(this.pool,input,userId);}
 jobs(p:JobFilters){return new OperationsRepository(this.pool).jobs(p);}
 async job(id:string,p:Pagination){const repo=new OperationsRepository(this.pool),job=await repo.job(id);if(!job)throw fail('任务不存在',404);return {job,...await repo.previews(id,p)};}
 async cancel(id:string){if(!await new OperationsRepository(this.pool).cancel(id))throw fail('任务不存在或已结束',409);}
 async retry(id:string){if(!await new OperationsRepository(this.pool).retry(id))throw fail('任务不可重试或已达到重试上限',409);}
 schedules(p:Pagination){return new OperationsRepository(this.pool).schedules(p);}
 async saveSchedule(data:ScheduleInput,userId:number,id?:string){const row=await new OperationsRepository(this.pool).saveSchedule(data,userId,nextRun(data),id);if(!row)throw fail('计划不存在',404);return row;}
 async removeSchedule(id:string){if(!await new OperationsRepository(this.pool).removeSchedule(id))throw fail('计划不存在',404);}
 async runSchedule(id:string,userId:number){const schedule=await new OperationsRepository(this.pool).schedule(id);if(!schedule)throw fail('计划不存在',404);return dispatchJob(this.pool,jobSchema.parse({kind:schedule.kind,...schedule.config}),userId,schedule.id);}
}
async function enqueue(repo:OperationsRepository,input:JobInput,userId:number,scheduleId?:string){
 await repo.lockDispatch();
 const active=await repo.active(input,scheduleId);
 if(active){if(input.kind==='backfill'&&input.rebuild)throw fail('已有向量任务正在执行，请等待结束后重试全量重建',409);return {...active,merged:true};}
 if(input.kind==='backfill'){if(input.rebuild)await repo.resetIndex();return repo.create(input,userId,scheduleId);}
 if(!await repo.aiEnabled(input.provider_id))throw fail('请选择已启用的 AI 配置');
 const seeds=await repo.seeds(input);
 if(seeds.length!==new Set(input.seed_ids).size)throw fail('种子题不存在、已删除或不属于所选课程');
 return repo.create(input,userId,scheduleId,seeds);
}
function dispatchFailure(error:unknown){
 if(error instanceof z.ZodError)return '计划参数无效，请编辑并重新保存计划';
 if(error instanceof Error&&'statusCode' in error)return error.message;
 return '计划触发失败，请检查配置和服务日志';
}
