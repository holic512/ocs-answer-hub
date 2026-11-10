/**
 * @file questions.ts
 * @project ocs-answer-hub
 * @module modules
 * @description 本地题库管理 HTTP 边界。
 * @logic 校验题目与分页，兼容部分编辑及引擎持久化导出。
 * @dependencies fastify, zod, QuestionsService
 * @index_tags questions, routes
 * @author holic512
 */
import type {FastifyInstance} from 'fastify';
import type pg from 'pg';
import {z} from 'zod';
import {idSchema,paginationSchema,questionSchema} from '../core.js';
import {QuestionsService} from '../services/questions.js';
export {storeQuestion} from '../services/questions.js';
export type {QuestionRow} from '../services/questions.js';
const withAnswer=questionSchema.extend({answer:z.union([z.string().min(1).max(12000),z.array(z.string().max(12000)).min(1)])});
const filters=paginationSchema.extend({q:z.string().trim().max(300).default(''),course:z.string().max(200).default(''),type:z.string().max(30).default('')});
export function registerQuestions(app:FastifyInstance,pool:pg.Pool){
 const service=new QuestionsService(pool);
 app.get('/api/admin/questions',req=>service.list(filters.parse(req.query)));
 app.get('/api/admin/courses',()=>service.courses());
 app.get<{Params:{id:string}}>('/api/admin/questions/:id/versions',req=>service.versions(idSchema.parse(req.params.id)));
 app.post('/api/admin/questions',(req,reply)=>{const data=withAnswer.parse(req.body);reply.code(201);return service.create(data);});
 app.put<{Params:{id:string}}>('/api/admin/questions/:id',async req=>{const id=idSchema.parse(req.params.id),old=await service.detail(id),data=withAnswer.parse({...old,...req.body as object});await service.update(id,data);return {ok:true};});
 app.delete<{Params:{id:string}}>('/api/admin/questions/:id',async req=>{await service.remove(idSchema.parse(req.params.id));return {ok:true};});
 app.get('/api/admin/export',()=>service.export());
 app.post('/api/admin/import',req=>service.import(z.object({preview:z.boolean().default(true),overwrite:z.boolean().default(false),items:z.array(withAnswer).min(1).max(500)}).parse(req.body)));
}
