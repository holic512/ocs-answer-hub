import crypto from 'node:crypto';
import {promisify} from 'node:util';
import {lookup} from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import {Agent,request} from 'undici';
const scrypt=promisify(crypto.scrypt);
export const randomToken=(bytes=32)=>crypto.randomBytes(bytes).toString('base64url');
export function generateAdminPassword(){const alphabet='abcdefghjkmnpqrstuvwxyz23456789';let password='';do{password=Array.from({length:8},()=>alphabet[crypto.randomInt(alphabet.length)]).join('');}while(!/[a-z]/.test(password)||!/[0-9]/.test(password));return password;}
export const digest=(text:string)=>crypto.createHash('sha256').update(text).digest('hex');
export async function hashPassword(password:string){const salt=randomToken(16);const hash=await scrypt(password,salt,64) as Buffer;return `${salt}:${hash.toString('hex')}`;}
export async function verifyPassword(password:string,stored:string){try{const [salt,h]=stored.split(':');const actual=await scrypt(password,salt,64) as Buffer;const expected=Buffer.from(h,'hex');return expected.length===actual.length&&crypto.timingSafeEqual(expected,actual);}catch{return false;}}
export function encrypt(value:unknown,key:string){const iv=crypto.randomBytes(12);const c=crypto.createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);const data=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);return [iv.toString('base64'),c.getAuthTag().toString('base64'),data.toString('base64')].join('.');}
export function decrypt(value:string,key:string):any{const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64'));const c=crypto.createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);c.setAuthTag(tag);return JSON.parse(Buffer.concat([c.update(data),c.final()]).toString());}
const secretName=/token|secret|api.?key|password|authorization|cookie/i;
export function redact(value:any,name=''):any{if(secretName.test(name))return value?'********':'';if(Array.isArray(value))return value.map(x=>redact(x));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redact(v,k)]));return value;}
export function restoreSecrets(value:any,old:any):any{if(value==='********')return old??'';if(Array.isArray(value))return value.map((x,i)=>restoreSecrets(x,old?.[i]));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,restoreSecrets(v,old?.[k])]));return value;}
export function isPublicIp(ip:string){try{let addr=ipaddr.parse(ip);if(addr.kind()==='ipv6'&&(addr as ipaddr.IPv6).isIPv4MappedAddress())addr=(addr as ipaddr.IPv6).toIPv4Address();return addr.range()==='unicast'&&!(addr.kind()==='ipv6'&&['2002:','64:ff9b:','64:ff9b:1:'].some(prefix=>addr.toString().toLowerCase().startsWith(prefix)));}catch{return false;}}
export function validateUrl(raw:string,allowHosts:string[]=[]){const u=new URL(raw);const allowed=allowHosts.includes(u.hostname);if(u.username||u.password||u.hash)throw new Error('上游地址不能包含用户密码或片段');if(!['http:','https:'].includes(u.protocol))throw new Error('上游地址仅支持 HTTP 或 HTTPS');if(ipaddr.isValid(u.hostname.replace(/^\[|\]$/g,''))&&!isPublicIp(u.hostname.replace(/^\[|\]$/g,''))&&!allowed)throw new Error('禁止访问私有网络地址');return u;}
export type NetworkEvent={stage:'dns'|'connect'|'http'|'json';status:'passed'|'failed';message:string;httpStatus?:number;durationMs:number};
export class UpstreamError extends Error{constructor(public code:string,message:string,public httpStatus?:number){super(message);this.name='UpstreamError';}}
export async function safeRequest(raw:string,method:string,headers:Record<string,string>,body:any,timeout:number,allowHosts:string[]=[],observe?:(event:NetworkEvent)=>void):Promise<any>{
 const started=Date.now(),deadline=started+timeout;const emit=(stage:NetworkEvent['stage'],status:NetworkEvent['status'],message:string,httpStatus?:number)=>observe?.({stage,status,message,durationMs:Date.now()-started,...(httpStatus?{httpStatus}:{})});
 let u:URL;try{u=validateUrl(raw,allowHosts);}catch{throw new UpstreamError('UPSTREAM_ADDRESS','上游地址或网络范围不符合安全限制');}
 const host=u.hostname.replace(/^\[|\]$/g,'');let addresses:Array<{address:string;family:number}>;let timer:ReturnType<typeof setTimeout>|undefined;
 try{addresses=await Promise.race([lookup(host,{all:true}),new Promise<never>((_r,reject)=>{timer=setTimeout(()=>reject(new UpstreamError('UPSTREAM_TIMEOUT','DNS解析超时')),Math.max(1,timeout))})]);}
 catch(e:any){emit('dns','failed',e.code==='UPSTREAM_TIMEOUT'?'DNS解析超时':'DNS解析失败');throw new UpstreamError(e.code==='UPSTREAM_TIMEOUT'?'UPSTREAM_TIMEOUT':'UPSTREAM_DNS','DNS解析失败或超时');}finally{if(timer)clearTimeout(timer);}
 if(!addresses.length||(!allowHosts.includes(u.hostname)&&addresses.some(a=>!isPublicIp(a.address)))){emit('dns','failed','解析地址不在允许的公网范围');throw new UpstreamError('UPSTREAM_ADDRESS','上游 DNS 指向非公网地址');}
 emit('dns','passed','DNS解析通过，连接地址已固定');const remaining=Math.max(1,deadline-Date.now());
 const target=addresses[0];const agent=new Agent({connect:{lookup:((_h:any,opts:any,cb:any)=>opts?.all?cb(null,[target]):cb(null,target.address,target.family)) as any,timeout:Math.min(remaining,10000)}});
 let connected=false;
 try{const response=await request(u,{method:method as any,headers:{...headers,'accept':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)}),dispatcher:agent,signal:AbortSignal.timeout(remaining),headersTimeout:remaining,bodyTimeout:remaining});
 connected=true;emit('connect','passed',u.protocol==='https:'?'TCP连接与TLS证书验证通过':'HTTP连接成功（明文传输）');
 if(response.statusCode<200||response.statusCode>=300){response.body.on('error',()=>{});response.body.destroy();emit('http','failed',`上游返回HTTP ${response.statusCode}`,response.statusCode);throw new UpstreamError('UPSTREAM_HTTP',`上游返回 HTTP ${response.statusCode}`,response.statusCode);}
 emit('http','passed',`上游返回HTTP ${response.statusCode}`,response.statusCode);
 let size=0;const chunks:Buffer[]=[];for await(const chunk of response.body){size+=chunk.length;if(size>1024*1024){response.body.destroy();emit('json','failed','响应超过1MB限制');throw new UpstreamError('UPSTREAM_SIZE','上游返回超过1MB');}chunks.push(Buffer.from(chunk));}
 let result:any;try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{emit('json','failed','响应不是有效的JSON');throw new UpstreamError('UPSTREAM_JSON','响应不是有效的JSON');}emit('json','passed','JSON响应解析通过');return result;
 }catch(e:any){if(e instanceof UpstreamError)throw e;const code=String(e.code??e.cause?.code??'');if(!connected)emit('connect','failed','连接失败、证书错误或超时');throw new UpstreamError(/TIMEOUT|ABORT/i.test(code)||e.name==='TimeoutError'?'UPSTREAM_TIMEOUT':/CERT|TLS|SSL/i.test(code)?'UPSTREAM_TLS':'UPSTREAM_NETWORK','上游连接失败、超时或响应中断');}
 finally{await agent.destroy();}
}
