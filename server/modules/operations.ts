/**
 * @file operations.ts
 * @project ocs-answer-hub
 * @module modules
 * @description 向量、任务及计划 HTTP 边界。
 * @logic 校验查询及表单后调用运维服务，保留调度公共导出。
 * @dependencies fastify, zod, OperationsService
 * @index_tags operations, routes
 * @author holic512
 */
import type {FastifyInstance} from 'fastify';
import type pg from 'pg';
import {z} from 'zod';
import {actor,idSchema,paginationSchema} from '../core.js';
import type {SemanticService} from '../semantic.js';
import {OperationsService,dispatchJob} from '../services/operations.js';
import {jobSchema,scheduleSchema} from '../services/operation-contracts.js';
export {dispatchJob,dispatchDueSchedules,nextRun} from '../services/operations.js';
export {generationConfig,jobSchema,scheduleSchema} from '../services/operation-contracts.js';
export type {GenerationConfig,JobInput,Schedule} from '../services/operation-contracts.js';
const jobFilters=paginationSchema.extend({kind:z.enum(['generation','backfill']).optional(),status:z.enum(['queued','running','completed','failed','cancelled']).optional()});
export function registerOperations(app:FastifyInstance,pool:pg.Pool,semantic:SemanticService){
 const service=new OperationsService(pool,semantic);
 app.get('/api/admin/operations/vector',()=>service.vector());
 app.post('/api/admin/operations/vector/run',(req,reply)=>{const data=z.object({rebuild:z.boolean().default(false)}).parse(req.body??{});reply.code(202);return dispatchJob(pool,{kind:'backfill',...data},actor(req).id);});
 app.get('/api/admin/operations/jobs',req=>service.jobs(jobFilters.parse(req.query)));
 app.post('/api/admin/operations/jobs',(req,reply)=>{const data=jobSchema.parse(req.body);reply.code(202);return service.createJob(data,actor(req).id);});
 app.get<{Params:{id:string}}>('/api/admin/operations/jobs/:id',req=>service.job(idSchema.parse(req.params.id),paginationSchema.parse(req.query)));
 app.post<{Params:{id:string}}>('/api/admin/operations/jobs/:id/cancel',async req=>{await service.cancel(idSchema.parse(req.params.id));return {ok:true};});
 app.post<{Params:{id:string}}>('/api/admin/operations/jobs/:id/retry',async req=>{await service.retry(idSchema.parse(req.params.id));return {ok:true};});
 app.get('/api/admin/operations/schedules',req=>service.schedules(paginationSchema.parse(req.query)));
 app.post('/api/admin/operations/schedules',(req,reply)=>{const data=scheduleSchema.parse(req.body);reply.code(201);return service.saveSchedule(data,actor(req).id);});
 app.put<{Params:{id:string}}>('/api/admin/operations/schedules/:id',req=>service.saveSchedule(scheduleSchema.parse(req.body),actor(req).id,idSchema.parse(req.params.id)));
 app.delete<{Params:{id:string}}>('/api/admin/operations/schedules/:id',async req=>{await service.removeSchedule(idSchema.parse(req.params.id));return {ok:true};});
 app.post<{Params:{id:string}}>('/api/admin/operations/schedules/:id/run',req=>service.runSchedule(idSchema.parse(req.params.id),actor(req).id));
}
