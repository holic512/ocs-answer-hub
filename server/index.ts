/**
 * @file index.ts
 * @project ocs-answer-hub
 * @module 服务启动
 * @description 加载服务器私有运行配置，完成数据库迁移后启动 HTTP 服务。
 * @logic 每次进程启动重新读配置、初始化应用、监听端口、处理退出信号。
 * @dependencies config, app, node:path
 * @index_tags startup, runtime-config
 * @author holic512
 */
import {loadRuntimeConfig} from './config.js';
import {buildApp} from './app.js';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const parent=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=existsSync(path.join(parent,'prisma'))?parent:path.dirname(parent);
const config=loadRuntimeConfig();
const {app}=await buildApp({databaseUrl:config.databaseUrl,origin:config.origin,stateDir:config.stateDir,staticDir:path.join(root,'dist/web')});
await app.listen({host:config.host,port:config.port});
console.log(`知序已启动，监听端口 ${config.port}；加密主密钥保存在状态目录中`);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{app.close().then(()=>process.exit(0));});
