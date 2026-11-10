/**
 * @file ai.ts
 * @project ocs-answer-hub
 * @module modules
 * @description AI 配置和测试 HTTP 边界。
 * @logic 输入仅在入口校验，编辑保留旧密钥，调用配置业务服务。
 * @dependencies fastify, zod, providers, AiService
 * @index_tags ai, routes, forms
 * @author holic512
 */
import type {FastifyInstance} from 'fastify';
import type pg from 'pg';
import {z} from 'zod';
import {fail,idSchema,paginationSchema,questionSchema} from '../core.js';
import {aiConfigSchema,validateProvider,type AiConfig,type Transport} from '../providers.js';
import {AiService} from '../services/ai.js';
const providerSchema=z.object({name:z.string().trim().min(1).max(100),kind:z.literal('ai').default('ai'),enabled:z.boolean().default(false),priority:z.number().int().min(1).max(9999).default(100),timeout_ms:z.number().int().min(1000).max(45000).default(12000),config:z.record(z.string(),z.unknown())});
const bodySchema=z.object({provider:providerSchema.optional(),question:questionSchema.optional()}),defaultQuestion={title:'1+2等于几？',type:'single' as const,options:'A. 2\nB. 3\nC. 4'};
export function registerAi(app:FastifyInstance,pool:pg.Pool,key:string,transport:Transport){
 const service=new AiService(pool,key,transport);
 app.get('/api/admin/providers',req=>service.list(paginationSchema.parse(req.query)));
 app.post('/api/admin/providers',(req,reply)=>{const data=providerSchema.parse(req.body),config=configFor(data.config);reply.code(201);return service.create(data,config);});
 app.put<{Params:{id:string}}>('/api/admin/providers/:id',async req=>{const id=idSchema.parse(req.params.id),data=providerSchema.parse(req.body),old=await service.saved(id);await service.update(id,data,configFor(data.config,old.config));return {ok:true};});
 app.delete<{Params:{id:string}}>('/api/admin/providers/:id',async req=>{await service.remove(idSchema.parse(req.params.id));return {ok:true};});
 app.post('/api/admin/providers/reorder',async req=>{await service.reorder(z.object({ids:z.array(idSchema).max(100)}).parse(req.body).ids);return {ok:true};});
 app.post('/api/admin/providers/test',{config:{rateLimit:{max:12,timeWindow:'1 minute'}}},async req=>{const data=bodySchema.parse(req.body);if(!data.provider)throw fail('请提供测试配置');const provider={...data.provider,id:'draft',config:configFor(data.provider.config)};return {...await service.test(provider,data.question??defaultQuestion),requestId:req.id};});
 app.post<{Params:{id:string}}>('/api/admin/providers/:id/test',{config:{rateLimit:{max:12,timeWindow:'1 minute'}}},async req=>{const id=idSchema.parse(req.params.id),data=bodySchema.parse(req.body??{}),old=await service.saved(id),provider=data.provider?{...data.provider,id,config:configFor(data.provider.config,old.config)}:old;return {...await service.test(provider,data.question??defaultQuestion),requestId:req.id};});
}
function configFor(input:Record<string,unknown>,old?:AiConfig){const config=aiConfigSchema.parse({...input,apiKey:input.apiKey||old?.apiKey});try{validateProvider('ai',config);}catch{throw fail('请检查 AI 地址、模型和密钥配置');}return config;}
