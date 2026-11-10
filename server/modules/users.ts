/**
 * @file users.ts
 * @project ocs-answer-hub
 * @module modules
 * @description 用户和积分管理 HTTP 边界。
 * @logic 一次校验用户输入后调用生命周期与账本服务，保留兼容导出。
 * @dependencies fastify, zod, UsersService
 * @index_tags users, credits, routes
 * @author holic512
 */
import type {FastifyInstance} from 'fastify';
import type pg from 'pg';
import {z} from 'zod';
import {actor,paginationSchema,userIdSchema} from '../core.js';
import {UsersService,createUser} from '../services/users.js';
export {createUser} from '../services/users.js';
export const accountSchema=z.object({username:z.string().trim().min(1).max(100),password:z.string().min(8).max(128)});
const filters=paginationSchema.extend({q:z.string().trim().max(100).default(''),role:z.enum(['admin','user','all']).default('all'),status:z.enum(['all','active','disabled','deleted']).default('all')});
export function creditPage(pool:pg.Pool,userId:number,query:unknown){return new UsersService(pool).creditPage(userId,paginationSchema.parse(query));}
export function registerUsers(app:FastifyInstance,pool:pg.Pool){
 const service=new UsersService(pool);
 app.get('/api/workspace/credits',req=>service.creditPage(actor(req).id,paginationSchema.parse(req.query)));
 app.get('/api/admin/users',req=>service.list(filters.parse(req.query)));
 app.post('/api/admin/users',async(req,reply)=>{const data=accountSchema.extend({role:z.enum(['user','admin']).default('user')}).parse(req.body);reply.code(201);return createUser(pool,{...data,mustChange:true},'管理员创建赠送');});
 app.get<{Params:{id:string}}>('/api/admin/users/:id',req=>service.detail(userIdSchema.parse(req.params.id)));
 app.put<{Params:{id:string}}>('/api/admin/users/:id',async req=>{const data=z.object({username:z.string().trim().min(1).max(100),role:z.enum(['admin','user']),disabled:z.boolean()}).parse(req.body);await service.update(userIdSchema.parse(req.params.id),data);return {ok:true};});
 app.delete<{Params:{id:string}}>('/api/admin/users/:id',async req=>{await service.remove(userIdSchema.parse(req.params.id));return {ok:true};});
 app.post<{Params:{id:string}}>('/api/admin/users/:id/password',async req=>{const {password}=z.object({password:z.string().min(8).max(128)}).parse(req.body);await service.resetPassword(userIdSchema.parse(req.params.id),password);return {ok:true};});
 app.get<{Params:{id:string}}>('/api/admin/users/:id/credits',req=>service.creditPage(userIdSchema.parse(req.params.id),paginationSchema.parse(req.query)));
 app.post<{Params:{id:string}}>('/api/admin/users/:id/credits',req=>{const {amount,reason}=z.object({amount:z.number().int().min(-1000000).max(1000000).refine(v=>v!==0),reason:z.string().trim().min(1).max(500)}).parse(req.body);return service.adjustCredits(userIdSchema.parse(req.params.id),amount,reason,actor(req).id);});
}
