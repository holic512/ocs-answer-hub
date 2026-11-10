/**
 * @file tokens.ts
 * @project ocs-answer-hub
 * @module modules
 * @description 凭证 CRUD 与 OCS 配置 HTTP 边界。
 * @logic 校验表单后绑定本人或管理归属，调用凭证服务。
 * @dependencies fastify, zod, TokensService
 * @index_tags tokens, routes, ownership
 * @author holic512
 */
import type {FastifyInstance} from 'fastify';
import type pg from 'pg';
import {z} from 'zod';
import {actor,idSchema,paginationSchema,userIdSchema} from '../core.js';
import {TokensService} from '../services/tokens.js';
export {ocsConfig} from '../services/tokens.js';
const tokenSchema=z.object({name:z.string().trim().min(1).max(100),daily_limit:z.number().int().min(1).max(100000).optional(),rpm:z.number().int().min(1).max(600).optional(),expires_at:z.iso.datetime().nullable().optional()});
export function registerTokens(app:FastifyInstance,pool:pg.Pool,origin:string){
 const service=new TokensService(pool,origin);
 for(const audience of ['workspace','admin'] as const){
  const prefix=`/api/${audience}/tokens`,admin=audience==='admin';
  app.get(prefix,req=>{const p=paginationSchema.extend({user_id:userIdSchema.optional(),q:z.string().max(100).default('')}).parse(req.query);return service.list(p,admin?p.user_id:actor(req).id);});
  app.post(prefix,(req,reply)=>{const data=tokenSchema.extend({user_id:userIdSchema.optional()}).parse(req.body),owner=admin?data.user_id??actor(req).id:actor(req).id;reply.code(201);return service.create(data,owner,admin);});
  app.put<{Params:{id:string}}>(`${prefix}/:id`,async req=>{await service.update(idSchema.parse(req.params.id),tokenSchema.parse(req.body),admin,admin?undefined:actor(req).id);return {ok:true};});
  app.post<{Params:{id:string}}>(`${prefix}/:id/revoke`,async req=>{await service.revoke(idSchema.parse(req.params.id),admin?undefined:actor(req).id);return {ok:true};});
  app.delete<{Params:{id:string}}>(`${prefix}/:id`,async req=>{await service.remove(idSchema.parse(req.params.id),admin?undefined:actor(req).id);return {ok:true};});
 }
 app.post('/api/admin/ocs-config',req=>{const {token}=z.object({token:z.string().min(20).max(200)}).parse(req.body);return service.wrapper(token);});
}
