/**
 * @file logging.ts
 * @project ocs-answer-hub
 * @module 运行日志
 * @description 将应用控制台消息同步写入独立日志目录，保留终端输出。
 * @logic 请求上下文关联、凭据脱敏和错误定位，JSON 行记录，10 MiB 轮转并保留三份历史文件。
 * @dependencies node:fs, node:path, node:util, node:async_hooks
 * @index_tags logging, persistence, rotation
 * @author holic512
 */
import {appendFileSync,existsSync,mkdirSync,renameSync,rmSync,statSync} from 'node:fs';
import path from 'node:path';
import {format} from 'node:util';
import {AsyncLocalStorage} from 'node:async_hooks';

const maxBytes=10*1024*1024;
let installed=false;
export function installFileLogging(directory=path.resolve('logs')){
 if(installed)return;
 mkdirSync(directory,{recursive:true,mode:0o700});
 const file=path.join(directory,'app.log');
 appendFileSync(file,'',{mode:0o600});
 const originalError=console.error.bind(console);
 for(const [method,level] of [['log','info'],['info','info'],['warn','warn'],['error','error']] as const){
  const original=console[method].bind(console);
  console[method]=(...args:unknown[])=>{
   original(...args);
   try{
    let details:Record<string,unknown>={};
    if(args.length===2&&typeof args[0]==='string'&&/^\[[\w.-]+\]$/.test(args[0])&&typeof args[1]==='string'){try{details={event:args[0].slice(1,-1),...JSON.parse(args[1])};}catch{}}
    const line=JSON.stringify({...details,time:new Date().toISOString(),level,message:details.event?String(args[0]):format(...args)})+'\n';
    if(statSync(file).size+Buffer.byteLength(line)>maxBytes){
     rmSync(file+'.3',{force:true});
     for(let index=2;index>=1;index--)if(existsSync(file+'.'+index))renameSync(file+'.'+index,file+'.'+(index+1));
     renameSync(file,file+'.1');
    }
    appendFileSync(file,line,{mode:0o600});
   }catch{originalError('运行日志写入失败，请检查 logs 目录权限及剩余磁盘空间。');}
  };
 }
 process.on('uncaughtExceptionMonitor',(error,origin)=>logEvent('process.uncaught',{origin,error:logError(error)},'error'));
 installed=true;
}

export type LogContext={requestId:string;method:string;route:string;actor?:string;secrets:string[]};
const context=new AsyncLocalStorage<LogContext>();
const secretField=/password|passwd|secret|api.?key|access.?key|private.?key|credential|authorization|cookie|csrf|session|cipher|master.?key|reasoning|analysis|(?:^|_)(?:token|key|pwd)$|hash$/i;
export function runWithLogContext(value:LogContext,done:()=>void){context.run(value,done);}
export function rememberLogSecrets(value:unknown){const current=context.getStore();if(current)collectSecrets(value,current.secrets);}
export function setLogActor(actor:string){const current=context.getStore();if(current)current.actor=actor;}
export function logEvent(event:string,data:Record<string,unknown>={},level:'info'|'warn'|'error'='info',secretSource?:unknown){
 const current=context.getStore();const {secrets:known=[],...trace}=current??{};
 const record=sanitizeLog({...trace,...data},[...known],secretSource);
 console[level](`[${event}]`,JSON.stringify(record));
}
export function logError(error:unknown){
 if(!(error instanceof Error))return {name:'UnknownError'};
 const source=error as Error&Record<string,unknown>;
 const fields=Object.fromEntries(['code','constraint','table','column','schema','routine','syscall','errno'].filter(key=>typeof source[key]==='string'||typeof source[key]==='number').map(key=>[key,source[key]]));
 return {name:error.name,...fields,frames:error.stack?.split('\n').filter(line=>/^\s+at /.test(line)).slice(0,8),cause:error.cause instanceof Error?{name:error.cause.name,code:(error.cause as NodeJS.ErrnoException).code}:undefined};
}
export function sanitizeLog(value:unknown,secrets:string[]=[],secretSource?:unknown):unknown{
 collectSecrets(secretSource,secrets);secrets.sort((a,b)=>b.length-a.length);
 const clean=(item:unknown,key='',depth=0):unknown=>{
  if(secretField.test(key))return '[REDACTED]';
  if(typeof item==='string'){
   let text=item;for(const secret of secrets)text=secret.length<4?(text===secret?'[REDACTED]':text):text.split(secret).join('[REDACTED]');
   text=text.replace(/\bBearer\s+[^\s"'<>]+/gi,'Bearer [REDACTED]').replace(/(?:https?|postgres(?:ql)?):\/\/[^\s"'<>]+/gi,raw=>{try{const url=new URL(raw);url.username='';url.password='';url.search='';url.hash='';return url.toString();}catch{return '[URL]';}});
   return text.length>2000?text.slice(0,2000)+'…[已截断]':text;
  }
  if(item===null||typeof item==='number'||typeof item==='boolean'||item===undefined)return item;
  if(depth>=5)return '[内容层级已截断]';
  if(Array.isArray(item))return item.slice(0,20).map(entry=>clean(entry,'',depth+1));
  if(typeof item==='object')return Object.fromEntries(Object.entries(item).slice(0,40).map(([name,entry])=>[name,clean(entry,name,depth+1)]));
  return String(item);
 };
 return clean(value);
}
function collectSecrets(value:unknown,output:string[],parent=''){
 if(typeof value==='string'&&value&&(secretField.test(parent)||parent==='headers')){
  if(!output.includes(value))output.push(value);
  if(/^Bearer\s+/i.test(value)){const token=value.replace(/^Bearer\s+/i,'');if(token&&!output.includes(token))output.push(token);}
 }
 if(value&&typeof value==='object')for(const [key,item] of Object.entries(value))collectSecrets(item,output,parent==='headers'?'headers':key);
}
