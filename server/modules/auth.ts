/**
 * @file auth.ts
 * @project ocs-answer-hub
 * @module modules
 * @description 认证与角色授权 HTTP 边界。
 * @logic 校验来源、会话和角色，调用认证服务并处理 Cookie。
 * @dependencies fastify, zod, AuthService, core
 * @index_tags auth, routes, permissions
 * @author holic512
 */
import type {FastifyInstance} from 'fastify';
import type pg from 'pg';
import {z} from 'zod';
import {actor,fail} from '../core.js';
import {setLogActor} from '../logging.js';
import {accountSchema} from './users.js';
import {AuthService} from '../services/auth.js';
const registrationSchema=accountSchema.extend({confirmPassword:z.string().max(128)}).refine(d=>d.password===d.confirmPassword,{message:'两次密码不一致',path:['confirmPassword']});
export function registerAuth(app:FastifyInstance,pool:pg.Pool,origin:string){
 const service=new AuthService(pool),cookieOptions={path:'/',httpOnly:true,secure:new URL(origin).protocol==='https:',sameSite:'strict' as const};
 const originCheck=(value:string|undefined)=>{if(value!==origin)throw fail('请求来源不被允许',403);};
 app.addHook('preHandler',async req=>{
  const route=req.routeOptions.url??'';if(!route.startsWith('/api/admin/')&&!route.startsWith('/api/workspace/'))return;
  const user=await service.session(req.cookies.session??'');
  if(!user)throw fail('请先登录',401);req.actor=user;setLogActor(user.username);
  if(!['GET','HEAD','OPTIONS'].includes(req.method)){originCheck(req.headers.origin);if(req.headers['x-csrf-token']!==user.csrf)throw fail('请求安全校验失败，请刷新页面',403);}
  const shared=['/api/admin/me','/api/admin/password','/api/admin/logout','/api/admin/query'];
  if(route.startsWith('/api/admin/')&&!shared.includes(route)&&user.role!=='admin')throw fail('需要管理员权限',403);
  if(user.must_change&&!shared.slice(0,3).includes(route))throw Object.assign(fail('首次登录请先修改密码',403),{mustChange:true});
 });
 app.get('/api/setup',(_req,reply)=>{reply.header('Cache-Control','no-store');return service.setupInfo();});
 app.post('/api/setup',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},(req,reply)=>{originCheck(req.headers.origin);const data=registrationSchema.parse(req.body);reply.code(201);return service.setup(data);});
 app.post('/api/register',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},(req,reply)=>{originCheck(req.headers.origin);const data=registrationSchema.parse(req.body);reply.code(201);return service.register(data);});
 app.post('/api/login',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(req,reply)=>{originCheck(req.headers.origin);const session=await service.login(accountSchema.parse(req.body));reply.setCookie('session',session.token,{...cookieOptions,maxAge:43200});return session.result;});
 app.get('/api/admin/me',async req=>{const u=actor(req);return {id:u.id,role:u.role,username:u.username,csrf:u.csrf,mustChange:u.must_change};});
 app.post('/api/admin/logout',async(req,reply)=>{await service.logout(req.cookies.session??'');reply.clearCookie('session',cookieOptions);return {ok:true};});
 app.post('/api/admin/password',async(req,reply)=>{const data=z.object({oldPassword:z.string().max(200),newPassword:z.string().min(8).max(128)}).parse(req.body);await service.changePassword(actor(req).id,data);reply.clearCookie('session',cookieOptions);return {ok:true,relogin:true};});
}
