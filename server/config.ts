/**
 * @file config.ts
 * @project ocs-answer-hub
 * @module 配置
 * @description 加载外置运行配置并校验，保留本地环境变量和五项数据库配置。
 * @logic 每次启动读取配置文件，文件优先于环境变量，缺失可选字段使用默认值。
 * @dependencies node:fs, node:util, node:net, zod
 * @index_tags config, database
 * @author holic512
 */
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {isIP} from 'node:net';
import {z} from 'zod';

const runtimeSchema=z.object({
 DB_HOST:z.string().min(1,'请填写数据库地址').refine(value=>isIP(value.replace(/^\[|\]$/g,''))!==0||/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value),'数据库地址只能填写主机名或 IP，不含协议和端口'),
 DB_PORT:z.coerce.number().int().min(1).max(65535).default(5432),
 DB_NAME:z.string().min(1,'请填写数据库名'),
 DB_USER:z.string().min(1,'请填写数据库用户名'),
 DB_PASSWORD:z.string().min(1,'请填写数据库密码'),
 APP_ORIGIN:z.string().refine(value=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&url.origin===value;}catch{return false;}},'请填写完整的 HTTP/HTTPS 访问地址，不带路径或末尾斜杠').default('http://127.0.0.1:18771'),
 HOST:z.string().min(1).refine(value=>isIP(value)!==0||/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value),'监听地址只能填写主机名或 IP').default('127.0.0.1'),
 PORT:z.coerce.number().int().min(1).max(65535).default(18771),
 STATE_DIR:z.string().min(1).default('./state')
});

export function loadRuntimeConfig({env=process.env,file=env.CONFIG_FILE}:{env?:NodeJS.ProcessEnv;file?:string}={}){
 const keys=Object.keys(runtimeSchema.shape);
 const inherited=Object.fromEntries(keys.filter(key=>env[key]!==undefined).map(key=>[key,env[key]]));
 const external=file?readConfigFile(file):{};
 const unknown=Object.keys(external).filter(key=>!keys.includes(key));
 if(unknown.length)throw new Error(`运行配置包含未知字段：${unknown.join('、')}`);
 const parsed=runtimeSchema.safeParse({...inherited,...external});
 if(!parsed.success)throw new Error('运行配置无效：'+parsed.error.issues.map(issue=>`${issue.path.join('.')}：${issue.message}`).join('；'));
 const values=parsed.data;
 return {databaseUrl:databaseUrl({...values,DB_PORT:String(values.DB_PORT),PORT:String(values.PORT)})!,origin:values.APP_ORIGIN,host:values.HOST,port:values.PORT,stateDir:values.STATE_DIR};
}

function readConfigFile(file:string){
 let text:string;
 try{text=readFileSync(file,'utf8');}catch{throw new Error(`无法读取运行配置文件 ${file}，请先初始化配置并检查文件权限`);}
 const seen=new Set<string>();
 for(const [index,line] of text.replace(/^\uFEFF/,'').split(/\r?\n/).entries()){
  if(!line.trim()||line.trimStart().startsWith('#'))continue;
  const match=/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if(!match)throw new Error(`运行配置第 ${index+1} 行格式无效，应为 字段名=值`);
  if(seen.has(match[1]))throw new Error(`运行配置字段重复：${match[1]}`);
  seen.add(match[1]);
  const value=match[2];
  if(['"',"'",'`'].includes(value[0])){
   const end=value.indexOf(value[0],1);
   if(end<0||!/^\s*(?:#.*)?$/.test(value.slice(end+1)))throw new Error(`运行配置第 ${index+1} 行引号不匹配；配置值不支持跨行`);
  }
 }
 return parseEnv(text);
}

export function databaseUrl(env:NodeJS.ProcessEnv=process.env):string {
 const name=env.DB_NAME;
 for(const key of ['DB_HOST','DB_USER','DB_PASSWORD'] as const){if(!env[key])throw new Error(`请在 .env 中填写 ${key}（${{DB_HOST:'数据库地址',DB_USER:'数据库用户名',DB_PASSWORD:'数据库密码'}[key]}）`);}
 if(!name)throw new Error('请在 .env 中填写 DB_NAME（数据库名）');
 const port=env.DB_PORT??'5432';
 if(!/^\d+$/.test(port)||Number(port)<1||Number(port)>65535)throw new Error('DB_PORT（数据库端口）必须是 1～65535 的整数');
 const url=new URL('postgresql://localhost');
 url.hostname=isIP(env.DB_HOST!)===6?`[${env.DB_HOST}]`:env.DB_HOST!;url.port=port;url.username=encodeURIComponent(env.DB_USER!);url.password=encodeURIComponent(env.DB_PASSWORD!);url.pathname='/'+encodeURIComponent(name);
 return url.toString();
}
