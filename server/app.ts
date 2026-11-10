/**
 * @file app.ts
 * @project ocs-answer-hub
 * @module 应用装配
 * @description 迁移、共享基础设施、业务模块和关闭生命周期。
 * @logic 启动迁移后装配认证、管理、查询与运维，HTTP 入口不承载业务 SQL。
 * @dependencies fastify, pg, modules, engine, jobs, semantic
 * @index_tags bootstrap, modules, lifecycle
 * @author holic512
 */
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import serveStatic from '@fastify/static';
import type pg from 'pg';
import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {randomToken,createUpstreamTransport} from './security.js';
import {createPool,migrate} from './db.js';
import {Engine} from './engine.js';
import {SemanticService} from './semantic.js';
import {JobWorker} from './jobs.js';
import type {Transport} from './providers.js';
import {registerQueryHistory} from './query-history.js';
import {registerAuth} from './modules/auth.js';
import {registerHttp} from './modules/http.js';
import {registerUsers} from './modules/users.js';
import {registerTokens} from './modules/tokens.js';
import {registerQuestions} from './modules/questions.js';
import {registerAi} from './modules/ai.js';
import {registerSettings} from './modules/settings.js';
import {registerQueries} from './modules/queries.js';
import {registerOperations} from './modules/operations.js';
export {ocsConfig} from './modules/tokens.js';
const systemVersion:string=JSON.parse(readFileSync(new URL(import.meta.url.includes('/dist/server/')?'../../package.json':'../package.json',import.meta.url),'utf8')).version;
export type AppConfig={databaseUrl:string;origin:string;stateDir:string;pool?:pg.Pool;transport?:Transport;staticDir?:string;test?:boolean;semantic?:SemanticService;worker?:boolean};
export async function buildApp(config:AppConfig){
 const pool=config.pool??createPool(config.databaseUrl);
 try{await migrate(pool);}catch(error){if(!config.pool)await pool.end();throw error;}
 const key=await encryptionKey(config.stateDir),upstream=config.transport?undefined:createUpstreamTransport(),transport=config.transport??upstream!.request;
 const semantic=config.semantic??new SemanticService(pool),engine=new Engine(pool,key,transport,semantic),worker=new JobWorker(pool,semantic,key,transport);
 const app=Fastify({logger:false,genReqId:()=>randomUUID(),bodyLimit:256*1024,trustProxy:['127.0.0.1','::1'],requestTimeout:65000});
 registerHttp(app);
 await app.register(cookie);
 await app.register(helmet,{contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:'],connectSrc:["'self'"],frameAncestors:["'none'"],objectSrc:["'none'"]}},hsts:{maxAge:31536000}});
 await app.register(rateLimit,{global:true,max:300,timeWindow:'1 minute',allowList:config.test?['127.0.0.1']:[]});
 registerAuth(app,pool,config.origin);
 registerSettings(app,pool);registerUsers(app,pool);registerTokens(app,pool,config.origin);registerQuestions(app,pool);registerAi(app,pool,key,transport);
 registerQueries(app,pool,engine);registerQueryHistory(app,pool);registerOperations(app,pool,semantic);
 app.get('/api/health',async()=>{await pool.query('SELECT 1');return {ok:true,service:'ocs-answer-hub',version:systemVersion};});
 if(config.staticDir){app.get('/',async(_req,reply)=>reply.type('text/html').sendFile('index.html'));await app.register(serveStatic,{root:config.staticDir,index:false});app.setNotFoundHandler((req,reply)=>req.url.startsWith('/api/')?reply.code(404).send({error:'接口不存在'}):reply.type('text/html').sendFile('index.html'));}
 if(config.worker!==false&&!config.test)worker.start();
 app.addHook('onClose',async()=>{await worker.close();await upstream?.close();if(!config.pool)await pool.end();});
 return {app,pool,engine,key,semantic,worker};
}
async function encryptionKey(stateDir:string){await fs.mkdir(stateDir,{recursive:true,mode:0o700});const keyPath=path.join(stateDir,'master.key');let key:string;try{key=(await fs.readFile(keyPath,'utf8')).trim();}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;key=Buffer.from(randomToken(32),'base64url').toString('hex');try{await fs.writeFile(keyPath,key,{mode:0o600,flag:'wx'});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;key=(await fs.readFile(keyPath,'utf8')).trim();}}if(!/^[0-9a-f]{64}$/i.test(key))throw new Error('master.key 必须为64位十六进制');return key;}
