/**
 * @file app.ts
 * @project ocs-answer-hub
 * @module HTTP 应用
 * @description 管理后台与 OCS 接口，启动迁移后提供服务及版本健康状态。
 * @logic 增量迁移、会话与角色隔离、事务扣额、查询记录和失败导出、管理审计与兼容 OCS。
 * @dependencies Fastify, Prisma, pg, Engine, query-history, security, logging
 * @index_tags api, admin, ocs, version
 * @author holic512
 */
import {SemanticService} from './semantic.js';
import {JobWorker} from './jobs.js';
import {reserveQuery,usage} from './accounts.js';
import {registerQueryHistory} from './query-history.js';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {logEvent,logError,runWithLogContext,rememberLogSecrets,setLogActor} from './logging.js';
const systemVersion: string=JSON.parse(readFileSync(new URL(import.meta.url.includes('/dist/server/')?'../../package.json':'../package.json',import.meta.url),'utf8')).version;
import Fastify from 'fastify';import cookie from '@fastify/cookie';import helmet from '@fastify/helmet';import rateLimit from '@fastify/rate-limit';import serveStatic from '@fastify/static';
import {z} from 'zod';import type pg from 'pg';import fs from 'node:fs/promises';import path from 'node:path';
import {randomToken,digest,hashPassword,verifyPassword,encrypt,decrypt,redact,restoreSecrets,createUpstreamTransport} from './security.js';
import {createPool,createOrm,migrate} from './db.js';import {probeProvider} from './provider-test.js';import {Engine} from './engine.js';import {canonicalAnswer,prepare} from './search.js';import {validateProvider,type Transport} from './providers.js';
export type AppConfig={databaseUrl:string;origin:string;stateDir:string;pool?:pg.Pool;transport?:Transport;staticDir?:string;test?:boolean;semantic?:SemanticService;worker?:boolean};
const questionSchema=z.object({title:z.string().min(1).max(8000),options:z.union([z.string().max(20000),z.array(z.string().max(2000)).max(50)]).optional(),type:z.enum(['single','multiple','judgement','completion','unknown']).default('unknown'),images:z.array(z.union([z.string().max(20000),z.object({url:z.string().max(20000)}).passthrough()])).max(10).optional(),suggestion_title:z.string().max(8000).optional(),suggestion_options:z.string().max(20000).optional(),course:z.string().max(200).optional()});
const idSchema=z.string().uuid();
const providerSchema=z.object({name:z.string().min(1).max(100),kind:z.enum(['yanxi','http','ai']),enabled:z.boolean().default(false),priority:z.number().int().min(1).max(9999).default(100),timeout_ms:z.number().int().min(1000).max(45000).default(12000),config:z.record(z.string(),z.unknown())});
const tokenSchema=z.object({name:z.string().min(1).max(100),daily_limit:z.number().int().min(1).max(100000).default(2000),rpm:z.number().int().min(1).max(600).default(60),expires_at:z.string().datetime().nullable().optional()});
const fail=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export function ocsConfig(origin:string,token:string){return [{name:'知序 · 个人题库',homepage:origin,url:`${origin}/api/ocs/query`,method:'post',type:'GM_xmlhttpRequest',contentType:'json',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},data:{title:'${title}',options:'${options}',type:'${type}',images:{handler:'return (env) => env.images || []'},suggestion_title:'${suggestion_title}',suggestion_options:'${suggestion_options}'},handler:'return (res) => res.code === 1 ? [res.question, res.answer] : [res.message || "未找到答案", undefined]'}];}
export async function buildApp(config:AppConfig){
 logEvent('database.migration.started',{version:systemVersion});
 const pool=config.pool??createPool(config.databaseUrl);try{await migrate(pool);logEvent('database.migration.completed',{version:systemVersion});}catch(error){logEvent('database.migration.failed',{error:logError(error)},'error');if(!config.pool)await pool.end();throw error;}const orm=createOrm(pool);await fs.mkdir(config.stateDir,{recursive:true,mode:0o700});
 let key:string,keyCreated=false;const keyPath=path.join(config.stateDir,'master.key');try{key=(await fs.readFile(keyPath,'utf8')).trim();}catch(e:any){if(e.code!=='ENOENT')throw e;key=randomToken(32);key=Buffer.from(key,'base64url').toString('hex');try{await fs.writeFile(keyPath,key,{mode:0o600,flag:'wx'});keyCreated=true;}catch(e:any){if(e.code!=='EEXIST')throw e;key=(await fs.readFile(keyPath,'utf8')).trim();}}
 if(!/^[0-9a-f]{64}$/i.test(key!))throw new Error('状态目录中的 master.key 必须为64位十六进制');
 logEvent('application.encryption.ready',{created:keyCreated});
 const app=Fastify({logger:false,genReqId:()=>randomUUID(),bodyLimit:256*1024,trustProxy:['127.0.0.1','::1'],requestTimeout:65000});const upstream=config.transport?undefined:createUpstreamTransport();const transport=config.transport??upstream!.request;const semantic=config.semantic??new SemanticService(pool);const engine=new Engine(pool,key!,transport,semantic);const worker=new JobWorker(pool,semantic,key!,transport);if(config.worker!==false&&!config.test)worker.start();

 app.addHook('onRequest',(req,reply,done)=>{
  const route=req.routeOptions.url??req.url.split('?')[0];
  reply.header('X-Request-ID',req.id);
  runWithLogContext({requestId:req.id,method:req.method,route,secrets:[]},()=>{
   rememberLogSecrets({authorization:req.headers.authorization,cookie:req.headers.cookie});
   if(req.url.startsWith('/api/')&&route!=='/api/health')logEvent('http.request.started',{ip:req.ip,origin:req.headers.origin});
   done();
  });
 });
 app.addHook('preValidation',async req=>{rememberLogSecrets(req.body);});
 app.addHook('onSend',async(req,reply,payload)=>{
  if(req.url.startsWith('/api/')&&reply.statusCode<300&&!['GET','HEAD','OPTIONS'].includes(req.method)&&typeof payload==='string'){
   try{const result=JSON.parse(payload);(req as any).auditResult=Object.fromEntries(['id','ok','imported','total','valid','invalid','username'].filter(key=>result?.[key]!==undefined).map(key=>[key,result[key]]));}catch{}
  }
  return payload;
 });
 app.addHook('onResponse',async(req,reply)=>{
  if(!req.url.startsWith('/api/')||(req.routeOptions.url==='/api/health'&&reply.statusCode<400))return;
  const fields={requestId:req.id,method:req.method,route:req.routeOptions.url??req.url.split('?')[0],actor:(req as any).admin?.username,statusCode:reply.statusCode,durationMs:Math.round(reply.elapsedTime),ip:req.ip,username:(req.routeOptions.url==='/api/login'||req.routeOptions.url==='/api/setup')?(req.body as any)?.username:undefined};
  logEvent('http.request.completed',fields,reply.statusCode>=500?'error':reply.statusCode>=400?'warn':'info');
  if(reply.statusCode<300&&!['GET','HEAD','OPTIONS'].includes(req.method)){
   const route=req.routeOptions.url??'';
   if(!route.endsWith('/query')&&!route.endsWith('/test')){
    const body=req.body as any;
    const input=route==='/api/admin/import'?{preview:body?.preview??true,count:body?.items?.length}:route.includes('/password')||route.includes('/ocs-config')?undefined:body;
    logEvent('admin.action',{...fields,resource:req.params,input,result:(req as any).auditResult});
   }
  }
 });
 await app.register(cookie);await app.register(helmet,{contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:'],connectSrc:["'self'"],frameAncestors:["'none'"],objectSrc:["'none'"]}},hsts:{maxAge:31536000}});await app.register(rateLimit,{global:true,max:300,timeWindow:'1 minute',allowList:config.test?['127.0.0.1']:[]});
 const secure=new URL(config.origin).protocol==='https:';const cookieOptions={path:'/',httpOnly:true,secure,sameSite:'strict' as const};
 app.setErrorHandler((e:any,req,reply)=>{
  const status=e instanceof z.ZodError?400:(e.statusCode>=400&&e.statusCode<600?e.statusCode:500);
  if(status===429)reply.header('Retry-After','60');
  logEvent('http.request.failed',{requestId:req.id,statusCode:status,error:logError(e),reason:e instanceof z.ZodError?'输入格式不正确':status<500?(e.name==='Error'&&!e.code?e.message:'请求被拒绝'):'服务内部错误',fields:e instanceof z.ZodError?e.issues.map(issue=>issue.path.join('.')):undefined},status>=500?'error':'warn');
  if(e instanceof z.ZodError)return reply.code(400).send({error:'输入格式不正确',details:e.issues.map(x=>`${x.path.join('.')}: ${x.message}`).slice(0,5),requestId:req.id});
  reply.code(status).send({error:status<500?e.message:'服务暂不可用，请查看部署状态',requestId:req.id});
 });
 app.addHook('preHandler',async(req,reply)=>{
  const route=req.routeOptions.url??'';if(!route.startsWith('/api/admin/')&&!route.startsWith('/api/workspace/'))return;
  const hash=digest(req.cookies.session??'');const row=(await pool.query('SELECT s.csrf,a.id,a.username,a.role,a.must_change FROM sessions s JOIN administrators a ON a.id=s.user_id WHERE s.hash=$1 AND s.expires_at>now() AND NOT a.disabled',[hash])).rows[0];if(!row){logEvent('auth.rejected',{reason:'session_missing_or_expired'},'warn');return reply.code(401).send({error:'请先登录'});}(req as any).admin=row;setLogActor(row.username);
  if(!['GET','HEAD','OPTIONS'].includes(req.method)){if(req.headers.origin!==config.origin||req.headers['x-csrf-token']!==row.csrf){logEvent('auth.rejected',{reason:'origin_or_csrf_invalid',origin:req.headers.origin},'warn');return reply.code(403).send({error:'请求安全校验失败，请刷新页面'});}}
  const shared=['/api/admin/me','/api/admin/password','/api/admin/logout','/api/admin/query'];if(route.startsWith('/api/admin/')&&!shared.includes(route)&&row.role!=='admin')return reply.code(403).send({error:'需要管理员权限'});
  if(row.must_change&&!['/api/admin/me','/api/admin/password','/api/admin/logout'].includes(route)){logEvent('auth.rejected',{reason:'password_change_required'},'warn');return reply.code(403).send({error:'首次登录请先修改密码',mustChange:true});}
 });
 app.get('/api/admin/semantic/skips',async()=>({items:(await pool.query('SELECT q.id,q.title,q.course,s.reason,s.updated_at FROM vector_index_skips s JOIN questions q ON q.id=s.question_id WHERE NOT q.deleted ORDER BY s.updated_at DESC LIMIT 100')).rows}));
 app.get('/api/admin/semantic/health',async()=>semantic.health());
 app.get('/api/admin/jobs',async()=>({items:(await pool.query('SELECT * FROM background_jobs ORDER BY created_at DESC LIMIT 100')).rows}));
 app.get<{Params:{id:string}}>('/api/admin/jobs/:id',async req=>{idSchema.parse(req.params.id);const job=(await pool.query('SELECT * FROM background_jobs WHERE id=$1',[req.params.id])).rows[0];if(!job)throw fail('任务不存在',404);return {job,items:(await pool.query('SELECT id,round,question_id,data,status,reason FROM generation_previews WHERE job_id=$1 ORDER BY id LIMIT 500',[job.id])).rows};});
 app.post('/api/admin/jobs',async(req,reply)=>{const d=z.object({kind:z.enum(['generation','backfill']),provider_id:idSchema.optional(),course:z.string().trim().max(200).default(''),max_rounds:z.number().int().min(1).max(50).default(5),max_questions:z.number().int().min(1).max(500).default(50),batch_size:z.number().int().min(1).max(20).default(10)}).parse(req.body);if(d.kind==='generation'&&(!d.course||!d.provider_id))throw fail('生成任务需要课程和 AI 来源');if(d.kind==='generation'&&!(await pool.query("SELECT id FROM providers WHERE id=$1 AND enabled AND kind='ai'",[d.provider_id])).rowCount)throw fail('请选择启用的 AI 来源');const health=await semantic.health();if(!health.ready)throw fail('本地向量模型未就绪，请检查语义健康状态',503);const row=(await pool.query('INSERT INTO background_jobs(kind,user_id,provider_id,course,max_rounds,max_questions,batch_size) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[d.kind,(req as any).admin.id,d.provider_id??null,d.course,d.max_rounds,d.max_questions,d.batch_size])).rows[0];reply.code(201);return row;});
 app.post<{Params:{id:string}}>('/api/admin/jobs/:id/cancel',async req=>{idSchema.parse(req.params.id);await pool.query("UPDATE background_jobs SET cancel_requested=true,status='cancelled',updated_at=now() WHERE id=$1 AND status IN ('queued','running','failed')",[req.params.id]);return {ok:true};});
 app.post<{Params:{id:string}}>('/api/admin/jobs/:id/retry',async req=>{idSchema.parse(req.params.id);if(!(await pool.query("UPDATE background_jobs SET status='queued',error=NULL,lease_until=NULL,lease_token=NULL,updated_at=now() WHERE id=$1 AND status='failed' AND attempts<max_attempts AND NOT cancel_requested RETURNING id",[req.params.id])).rowCount)throw fail('任务不可重试或已达到重试上限',409);return {ok:true};});
 app.get('/api/health',async()=>{await pool.query('SELECT 1');return {ok:true,service:'ocs-answer-hub',version:systemVersion};});
 app.get('/api/setup',async(_req,reply)=>{
  reply.header('Cache-Control','no-store');
  return {required:!(await pool.query('SELECT id FROM administrators WHERE id=1')).rowCount};
 });
 app.post('/api/setup',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(req,reply)=>{
  reply.header('Cache-Control','no-store');
  if(req.headers.origin!==config.origin)throw fail('请求来源不被允许',403);
  const parsed=z.object({username:z.string().trim().min(1,'请填写管理员账号').max(100,'账号最多100个字符'),password:z.string().min(8,'密码至少需要8个字符').max(128,'密码最多128个字符'),confirmPassword:z.string().max(128)}).refine(data=>data.password===data.confirmPassword,{message:'两次密码不一致',path:['confirmPassword']}).safeParse(req.body);
  if(!parsed.success)throw fail(parsed.error.issues[0].message);
  const data=parsed.data;
  const created=await pool.query("INSERT INTO administrators(id,username,password_hash,must_change,role) VALUES(1,$1,$2,false,'admin') ON CONFLICT(id) DO NOTHING RETURNING username",[data.username,await hashPassword(data.password)]);
  if(!created.rowCount)throw fail('系统已完成初始化，请使用已有管理员账号登录',409);
  setLogActor(created.rows[0].username);logEvent('auth.setup.completed',{username:created.rows[0].username});reply.code(201);return {ok:true,username:created.rows[0].username};
 });
 app.post('/api/login',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(req,reply)=>{if(req.headers.origin!==config.origin)throw fail('请求来源不被允许',403);const data=z.object({username:z.string().max(100),password:z.string().max(200)}).parse(req.body);if(!(await pool.query('SELECT id FROM administrators WHERE id=1')).rowCount)throw fail('请先完成管理员初始化',409);const row=(await pool.query('SELECT * FROM administrators WHERE username=$1',[data.username])).rows[0];if(!row||row.disabled||!await verifyPassword(data.password,row.password_hash))throw fail('账号或密码不正确',401);
 await pool.query('DELETE FROM sessions WHERE expires_at<now()');const token=randomToken(),csrf=randomToken();await pool.query('INSERT INTO sessions(hash,csrf,expires_at,user_id) VALUES($1,$2,now()+interval \'12 hours\',$3)',[digest(token),csrf,row.id]);reply.setCookie('session',token,{...cookieOptions,maxAge:43200});setLogActor(row.username);logEvent('auth.login.completed',{username:row.username});return {id:row.id,role:row.role,username:row.username,csrf,mustChange:row.must_change};});
 app.get('/api/admin/me',async req=>({id:(req as any).admin.id,role:(req as any).admin.role,username:(req as any).admin.username,csrf:(req as any).admin.csrf,mustChange:(req as any).admin.must_change}));
 app.post('/api/admin/logout',async(req,reply)=>{await pool.query('DELETE FROM sessions WHERE hash=$1',[digest(req.cookies.session??'')]);reply.clearCookie('session',cookieOptions);return {ok:true};});
 app.post('/api/admin/password',async(req,reply)=>{const data=z.object({oldPassword:z.string().max(200),newPassword:z.string().min(8,'密码至少需要8个字符').max(128)}).parse(req.body);const row=(await pool.query('SELECT password_hash FROM administrators WHERE id=$1',[(req as any).admin.id])).rows[0];if(!await verifyPassword(data.oldPassword,row.password_hash))throw fail('原密码不正确',401);if(data.oldPassword===data.newPassword)throw fail('新密码不能与原密码相同');await pool.query('UPDATE administrators SET password_hash=$1,must_change=false WHERE id=$2',[await hashPassword(data.newPassword),(req as any).admin.id]);await pool.query('DELETE FROM sessions WHERE user_id=$1',[(req as any).admin.id]);await fs.unlink(path.join(config.stateDir,'bootstrap-admin.json')).catch(()=>{});reply.clearCookie('session',cookieOptions);return {ok:true,relogin:true};});
 app.get('/api/admin/providers',async()=>({items:(await orm.providers.findMany({orderBy:[{priority:'asc'},{created_at:'asc'}]})).map(p=>{const {config_cipher,...rest}=p;return {...rest,config:redact(decrypt(config_cipher,key!))};})}));
 app.post('/api/admin/providers',async(req,reply)=>{const p=providerSchema.parse(req.body);try{validateProvider(p.kind,p.config);}catch(e:any){throw fail(e.message);}const row=await orm.providers.create({data:{name:p.name,kind:p.kind,enabled:p.enabled,priority:p.priority,timeout_ms:p.timeout_ms,config_cipher:encrypt(p.config,key!)},select:{id:true}});reply.code(201);return row;});
 app.put<{Params:{id:string}}>('/api/admin/providers/:id',async req=>{idSchema.parse(req.params.id);const old=await orm.providers.findUnique({where:{id:req.params.id}});if(!old)throw fail('题库源不存在',404);const p=providerSchema.parse(req.body);p.config=restoreSecrets(p.config,decrypt(old.config_cipher,key!));try{validateProvider(p.kind,p.config);}catch(e:any){throw fail(e.message);}await orm.providers.update({where:{id:req.params.id},data:{name:p.name,kind:p.kind,enabled:p.enabled,priority:p.priority,timeout_ms:p.timeout_ms,config_cipher:encrypt(p.config,key!)}});return {ok:true};});
 const testingSources=new Set<string>();
 const testBodySchema=z.object({provider:providerSchema.optional(),question:questionSchema.optional()});
 const defaultTestQuestion={title:'1+2等于几？',type:'single' as const,options:'A. 2\nB. 3\nC. 4'};
 const executeProviderTest=async(provider:any,question:any)=>{if(testingSources.size>=3||testingSources.has(provider.id))throw fail('该来源正在测试或测试请求较多，请稍后重试',429);testingSources.add(provider.id);try{return await probeProvider(provider,question,transport);}finally{testingSources.delete(provider.id);}};
 app.post('/api/admin/providers/test',{config:{rateLimit:{max:12,timeWindow:'1 minute',groupId:'provider-test'}}},async(req,reply)=>{const data=testBodySchema.parse(req.body??{});if(!data.provider)throw fail('请提供要测试的来源配置');reply.header('Cache-Control','no-store');return {...await executeProviderTest({...data.provider,id:'draft'},data.question??defaultTestQuestion),requestId:req.id};});
 app.post<{Params:{id:string}}>('/api/admin/providers/:id/test',{config:{rateLimit:{max:12,timeWindow:'1 minute',groupId:'provider-test'}}},async(req,reply)=>{idSchema.parse(req.params.id);const row=await orm.providers.findUnique({where:{id:req.params.id}});if(!row)throw fail('题库源不存在',404);const data=testBodySchema.parse(req.body??{});const stored=decrypt(row.config_cipher,key!);const provider=data.provider?{...data.provider,id:row.id,config:restoreSecrets(data.provider.config,stored)}:{...row,config:stored};reply.header('Cache-Control','no-store');return {...await executeProviderTest(provider,data.question??defaultTestQuestion),requestId:req.id};});
 app.post('/api/admin/providers/reorder',async req=>{const ids=z.array(idSchema).max(100).parse((req.body as any)?.ids);const c=await pool.connect();try{await c.query('BEGIN');for(let i=0;i<ids.length;i++)await c.query('UPDATE providers SET priority=$2 WHERE id=$1',[ids[i],i+1]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}return {ok:true};});
 app.delete<{Params:{id:string}}>('/api/admin/providers/:id',async req=>{idSchema.parse(req.params.id);await orm.providers.deleteMany({where:{id:req.params.id}});return {ok:true};});
 const queryWorkspace=async(req:any,reply:any)=>{const q=questionSchema.parse(req.body);const reserved=await reserveQuery(pool,q,{userId:req.admin.id},req.id);reply.header('Cache-Control','no-store');return engine.query(q,null,reserved.eventId,req.id);};
 app.post('/api/admin/query',queryWorkspace);app.post('/api/workspace/query',queryWorkspace);
 app.get('/api/workspace/usage',async req=>usage(pool,(req as any).admin.id));
 app.get('/api/workspace/recent',async req=>({items:(await pool.query('SELECT id,title,status,source,duration_ms,created_at FROM query_events WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20',[(req as any).admin.id])).rows}));
 registerQueryHistory(app,pool);
 const userLimits=z.object({daily_limit:z.number().int().min(0).max(100000),rpm:z.number().int().min(1).max(600)});
 app.get('/api/admin/users',async()=>({items:(await pool.query(`SELECT id,username,role,disabled,must_change,daily_limit,rpm,CASE WHEN usage_day=CURRENT_DATE THEN day_count ELSE 0 END day_count,created_at FROM administrators ORDER BY id`)).rows}));
 app.post('/api/admin/users',async(req,reply)=>{const d=userLimits.extend({username:z.string().trim().min(1).max(100),password:z.string().min(8).max(128),role:z.enum(['admin','user']).default('user')}).parse(req.body);const row=(await pool.query('INSERT INTO administrators(username,password_hash,role,daily_limit,rpm,must_change) VALUES($1,$2,$3,$4,$5,true) ON CONFLICT(username) DO NOTHING RETURNING id',[d.username,await hashPassword(d.password),d.role,d.daily_limit,d.rpm])).rows[0];if(!row)throw fail('账号已存在',409);reply.code(201);return row;});
 app.put<{Params:{id:string}}>('/api/admin/users/:id',async req=>{const id=z.coerce.number().int().positive().parse(req.params.id);const d=userLimits.extend({disabled:z.boolean()}).parse(req.body);if(id===(req as any).admin.id&&d.disabled)throw fail('不能禁用当前登录账号');const row=(await pool.query('UPDATE administrators SET daily_limit=$2,rpm=$3,disabled=$4 WHERE id=$1 RETURNING id',[id,d.daily_limit,d.rpm,d.disabled])).rows[0];if(!row)throw fail('用户不存在',404);if(d.disabled)await pool.query('DELETE FROM sessions WHERE user_id=$1',[id]);return {ok:true};});
 app.post<{Params:{id:string}}>('/api/admin/users/:id/password',async req=>{const id=z.coerce.number().int().positive().parse(req.params.id);const d=z.object({password:z.string().min(8).max(128)}).parse(req.body);const c=await pool.connect();try{await c.query('BEGIN');if(!(await c.query('UPDATE administrators SET password_hash=$2,must_change=true WHERE id=$1 RETURNING id',[id,await hashPassword(d.password)])).rowCount)throw fail('用户不存在',404);await c.query('DELETE FROM sessions WHERE user_id=$1',[id]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}return {ok:true};});
 app.get('/api/admin/questions',async req=>{const p=z.object({q:z.string().max(300).default(''),page:z.coerce.number().int().min(1).max(10000).default(1),status:z.enum(['all','unverified','conflict']).default('all')}).parse(req.query);const clause=`NOT deleted AND (title ILIKE $1 OR answer ILIKE $1)${p.status==='unverified'?' AND NOT verified':p.status==='conflict'?' AND conflict':''}`;const values=[`%${p.q}%`];const total=Number((await pool.query(`SELECT count(*) FROM questions WHERE ${clause}`,values)).rows[0].count);return {total,page:p.page,items:(await pool.query(`SELECT * FROM questions WHERE ${clause} ORDER BY updated_at DESC LIMIT 30 OFFSET $2`,[...values,(p.page-1)*30])).rows};});
 app.get<{Params:{id:string}}>('/api/admin/questions/:id/versions',async req=>{idSchema.parse(req.params.id);return {items:(await pool.query('SELECT * FROM answer_versions WHERE question_id=$1 ORDER BY id DESC LIMIT 100',[req.params.id])).rows};});
 app.post('/api/admin/questions',async(req,reply)=>{const data=questionSchema.extend({answer:z.union([z.string().max(12000),z.array(z.string())])}).parse(req.body);const q=prepare(data),answer=canonicalAnswer(data.answer,q);if(!answer)throw fail('答案无法匹配题型或选项，请填写选项文本/字母或正确错误');const row=await engine.store(q,answer,'人工维护',true);reply.code(201);return {id:row.id};});
 app.put<{Params:{id:string}}>('/api/admin/questions/:id',async req=>{idSchema.parse(req.params.id);const row=(await pool.query('SELECT * FROM questions WHERE id=$1',[req.params.id])).rows[0];if(!row)throw fail('题目不存在',404);const data=z.object({answer:z.string().min(1).max(12000)}).parse(req.body);const q=prepare({title:row.title,options:row.options,type:row.type,images:row.images,course:row.course});const answer=canonicalAnswer(data.answer,q);if(!answer)throw fail('答案与题目选项不匹配');await engine.store(q,answer,'人工纠错',true);return {ok:true};});
 app.delete<{Params:{id:string}}>('/api/admin/questions/:id',async req=>{idSchema.parse(req.params.id);await pool.query('UPDATE questions SET deleted=true,updated_at=now() WHERE id=$1',[req.params.id]);engine.invalidateLocal();return {ok:true};});
 app.get('/api/admin/export',async()=>{const items=(await pool.query('SELECT title,type,options,images,course,answer,source,verified FROM questions WHERE NOT deleted ORDER BY created_at LIMIT 20000')).rows;logEvent('admin.export.completed',{count:items.length});return {format:'ocs-answer-hub-v1',items};});
 app.post('/api/admin/import',async req=>{const data=z.object({preview:z.boolean().default(true),items:z.array(questionSchema.extend({answer:z.union([z.string().max(12000),z.array(z.string().max(12000))])})).min(1).max(500)}).parse(req.body);const rows=data.items.map((x,i)=>{const q=prepare(x),answer=canonicalAnswer(x.answer,q);return {q,answer,index:i+1};});const invalid=rows.filter(x=>!x.answer).map(x=>x.index);if(data.preview)return {total:rows.length,valid:rows.length-invalid.length,invalid};if(invalid.length)throw fail(`第 ${invalid.slice(0,10).join('、')} 行答案无效，导入未执行`);for(const row of rows)await engine.store(row.q,row.answer!,'人工导入',true);return {imported:rows.length};});
 app.get('/api/admin/tokens',async()=>({items:(await pool.query('SELECT id,name,prefix,expires_at,revoked,daily_limit,rpm,day_count,usage_day,last_used,created_at,user_id FROM api_tokens ORDER BY created_at DESC')).rows}));
 app.post('/api/admin/tokens',async(req,reply)=>{const data=tokenSchema.extend({user_id:z.number().int().positive().default((req as any).admin.id)}).parse(req.body);if(!(await pool.query('SELECT id FROM administrators WHERE id=$1 AND NOT disabled',[data.user_id])).rowCount)throw fail('用户不存在或已禁用');const token=`zhixu_${randomToken()}`;const row=(await pool.query('INSERT INTO api_tokens(name,hash,prefix,daily_limit,rpm,expires_at,user_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[data.name,digest(token),token.slice(0,13),data.daily_limit,data.rpm,data.expires_at??null,data.user_id])).rows[0];reply.code(201);return {...row,token,config:ocsConfig(config.origin,token)};});
 app.post<{Params:{id:string}}>('/api/admin/tokens/:id/revoke',async req=>{idSchema.parse(req.params.id);await pool.query('UPDATE api_tokens SET revoked=true WHERE id=$1',[req.params.id]);return {ok:true};});
 app.post('/api/admin/ocs-config',async req=>{const {token}=z.object({token:z.string().min(20).max(200)}).parse(req.body);const valid=(await pool.query('SELECT id FROM api_tokens WHERE hash=$1 AND NOT revoked AND (expires_at IS NULL OR expires_at>now())',[digest(token)])).rowCount;if(!valid)throw fail('凭证不存在、过期或已撤销');return {config:ocsConfig(config.origin,token)};});
 app.get('/api/admin/stats',async()=>{const totals=(await pool.query(`SELECT count(*)::int requests,count(*) FILTER(WHERE status='hit')::int hits,count(*) FILTER(WHERE status IN ('miss','error','rejected'))::int failed,count(*) FILTER(WHERE status='pending')::int pending,count(*) FILTER(WHERE source='本地题库')::int local_hits,coalesce(round(avg(duration_ms)),0)::int avg_ms FROM query_events`)).rows[0];const questions=(await pool.query('SELECT count(*) FILTER(WHERE NOT deleted)::int total,count(*) FILTER(WHERE NOT deleted AND NOT verified)::int unverified,count(*) FILTER(WHERE NOT deleted AND conflict)::int conflicts FROM questions')).rows[0];return {totals,questions,sources:(await pool.query(`SELECT CASE status WHEN 'pending' THEN '处理中' WHEN 'rejected' THEN '请求被拒绝' WHEN 'error' THEN '查询异常' ELSE coalesce(source,'未命中') END source,count(*)::int count,round(avg(duration_ms))::int avg_ms FROM query_events GROUP BY 1 ORDER BY count DESC`)).rows,daily:(await pool.query(`SELECT to_char(d,'MM-DD') AS "day",count(e.id)::int count FROM generate_series(current_date-6,current_date,interval '1 day') d LEFT JOIN query_events e ON e.created_at>=d AND e.created_at<d+interval '1 day' GROUP BY d ORDER BY d`)).rows,recent:(await pool.query('SELECT e.*,t.name token_name FROM query_events e LEFT JOIN api_tokens t ON t.id=e.token_id ORDER BY e.id DESC LIMIT 30')).rows};});
 app.post('/api/ocs/query',{config:{rateLimit:{max:120,timeWindow:'1 minute'}}},async(req,reply)=>{const body=req.body as any;const token=typeof req.headers.authorization==='string'&&req.headers.authorization.startsWith('Bearer ')?req.headers.authorization.slice(7):body?.token;if(typeof token!=='string'||token.length>200)throw fail('查题凭证无效',401);const q=questionSchema.parse(body);
 const reserved=await reserveQuery(pool,q,{tokenHash:digest(token)},req.id);reply.header('Cache-Control','no-store');return engine.query(q,reserved.tokenId,reserved.eventId,req.id);});
 if(config.staticDir){app.get('/',async(_req,reply)=>reply.type('text/html').sendFile('index.html'));await app.register(serveStatic,{root:config.staticDir,index:false});app.setNotFoundHandler((req,reply)=>{if(req.url.startsWith('/api/'))return reply.code(404).send({error:'接口不存在'});return reply.type('text/html').sendFile('index.html');});}
 app.addHook('onClose',async()=>{await worker.close();await upstream?.close();await orm.$disconnect();if(!config.pool)await pool.end();logEvent('application.closed',{version:systemVersion});});
 return {app,pool,engine,key,semantic,worker};
}
