import {buildApp} from './app.js';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
const {app}=await buildApp({databaseUrl:process.env.DATABASE_URL,origin:process.env.APP_ORIGIN??'http://127.0.0.1:18771',stateDir:process.env.STATE_DIR??path.join(root,'state'),key:process.env.MASTER_KEY,staticDir:path.join(root,'dist/web'),allowHosts:(process.env.UPSTREAM_ALLOW_HOSTS??'').split(',').map(x=>x.trim()).filter(Boolean)});
await app.listen({host:process.env.HOST??'127.0.0.1',port:Number(process.env.PORT??18771)});
console.log(`OCS Answer Hub ready on port ${process.env.PORT??18771}; credentials stored privately in STATE_DIR`);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{app.close().then(()=>process.exit(0));});
