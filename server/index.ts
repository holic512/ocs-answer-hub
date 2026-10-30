/**
 * @file index.ts
 * @project ocs-answer-hub
 * @module 服务启动
 * @description 加载服务器私有运行配置，完成数据库迁移后启动 HTTP 服务。
 * @logic 每次启动启用终端与文件日志、重新读配置、初始化应用、监听端口并处理退出信号。
 * @dependencies config, app, logging, node:path
 * @index_tags startup, runtime-config
 * @author holic512
 */
import {loadRuntimeConfig} from './config.js';
import {installFileLogging,logEvent,logError} from './logging.js';
import {buildApp} from './app.js';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const parent=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=existsSync(path.join(parent,'prisma'))?parent:path.dirname(parent);
installFileLogging();
try{
 const config=loadRuntimeConfig();
 const database=new URL(config.databaseUrl);
 logEvent('application.starting',{node:process.version,origin:config.origin,configSource:process.env.CONFIG_FILE??'.env',database:{host:database.hostname,port:database.port,name:decodeURIComponent(database.pathname.slice(1))},stateDir:config.stateDir});
 const {app}=await buildApp({databaseUrl:config.databaseUrl,origin:config.origin,stateDir:config.stateDir,staticDir:path.join(root,'dist/web')});
 try{await app.listen({host:config.host,port:config.port});}catch(error){await app.close();throw error;}
 logEvent('application.ready',{host:config.host,port:config.port});
 console.log(`知序已启动，监听端口 ${config.port}；加密主密钥保存在状态目录中`);
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{
  logEvent('application.stopping',{signal});
  app.close().then(()=>{logEvent('application.stopped',{signal});process.exit(0);}).catch(error=>{logEvent('application.shutdown.failed',{error:logError(error)},'error');process.exit(1);});
 });
}catch(error){const reason=error instanceof Error&&/^(运行配置|无法读取运行配置|状态目录中的 master\.key)/.test(error.message)?error.message:'请检查数据库连通性、迁移状态及目录权限';logEvent('application.startup.failed',{reason,error:logError(error)},'error');process.exitCode=1;}
