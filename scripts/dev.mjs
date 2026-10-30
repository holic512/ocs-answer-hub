/**
 * @file dev.mjs
 * @project ocs-answer-hub
 * @module 开发入口
 * @description 单命令启动 API 热重载与 Vite 前端开发服务。
 * @logic 先监听前端端口，再启动后端；退出或启动失败时统一停止服务。
 * @dependencies node:child_process, vite
 * @index_tags dev, startup
 * @author holic512
 */
import {spawn} from 'node:child_process';
import {createServer} from 'vite';

let frontend,backend,stopping=false;
try{
 const origin=new URL(process.env.APP_ORIGIN??'http://127.0.0.1:5173');
 frontend=await createServer({server:{host:'127.0.0.1',port:Number(origin.port||(origin.protocol==='https:'?443:80)),strictPort:true}});
 await frontend.listen();
 frontend.printUrls();
 backend=spawn(process.execPath,['--env-file-if-exists=.env','--import','tsx','--watch','server/index.ts'],{stdio:'inherit'});
 backend.once('error',error=>{console.error(error.message);stop(1);});
 backend.once('exit',(code,signal)=>{stop(signal?1:code??1);});
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>stop(0));
}catch(error){console.error(error.message);await stop(1);}

async function stop(code){
 if(stopping)return;
 stopping=true;
 backend?.kill('SIGTERM');
 await frontend?.close();
 process.exitCode=code;
}
