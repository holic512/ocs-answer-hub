/**
 * @file http.ts
 * @project ocs-answer-hub
 * @module HTTP 基础设施
 * @description 请求追踪、脱敏审计和一致错误响应。
 * @logic 请求编号贯穿生命周期，结构化错误只暴露安全说明。
 * @dependencies fastify, zod, logging
 * @index_tags http, audit, errors
 * @author holic512
 */
import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {logEvent,logError,runWithLogContext,rememberLogSecrets} from '../logging.js';
export function registerHttp(app:FastifyInstance){
 app.addHook('onRequest',(req,reply,done)=>{reply.header('X-Request-ID',req.id);runWithLogContext({requestId:req.id,method:req.method,route:req.routeOptions.url??req.url.split('?')[0],secrets:[]},()=>{rememberLogSecrets({authorization:req.headers.authorization,cookie:req.headers.cookie});done();});});
 app.addHook('preValidation',async req=>{rememberLogSecrets(req.body);});
 app.addHook('onResponse',async(req,reply)=>{
  if(!req.url.startsWith('/api/')||req.routeOptions.url==='/api/health')return;
  const fields={requestId:req.id,method:req.method,route:req.routeOptions.url??req.url.split('?')[0],actor:req.actor?.username,statusCode:reply.statusCode,durationMs:Math.round(reply.elapsedTime)};
  logEvent('http.request.completed',fields,reply.statusCode>=500?'error':reply.statusCode>=400?'warn':'info');
  if(reply.statusCode<300&&!['GET','HEAD','OPTIONS'].includes(req.method)&&!req.url.endsWith('/query')&&!req.url.endsWith('/test')){
   const route=req.routeOptions.url??'',body=req.body;
   const input=route.includes('/password')||route.includes('/ocs-config')||route.includes('/login')||route.includes('/register')||route.includes('/setup')?undefined:route==='/api/admin/import'?{count:(body as {items?:unknown[]})?.items?.length}:body;
   logEvent('admin.action',{...fields,resource:req.params,input});
  }
 });
 app.setErrorHandler((error,req,reply)=>{
  const e=error as Error&{statusCode?:number;code?:string;mustChange?:boolean},status=e instanceof z.ZodError?400:e.statusCode&&e.statusCode>=400&&e.statusCode<600?e.statusCode:500;
  if(status===429)reply.header('Retry-After','60');
  const message=e instanceof z.ZodError?'输入格式不正确':e.code==='23505'?'名称或题目已存在':status<500?e.message:'服务暂不可用，请按请求编号检查日志';
  const actual=e.code==='23505'?409:status;
  logEvent('http.request.failed',{requestId:req.id,statusCode:actual,error:logError(e)},actual>=500?'error':'warn');
  return reply.code(actual).send({error:message,requestId:req.id,...(e.mustChange?{mustChange:true}:{}),...(e instanceof z.ZodError?{details:e.issues.slice(0,8).map(issue=>`${issue.path.join('.')}: ${issue.message}`),fields:Object.fromEntries(e.issues.map(issue=>[issue.path.join('.'),issue.message]))}:{})});
 });
}
