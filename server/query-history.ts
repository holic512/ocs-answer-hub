/**
 * @file query-history.ts
 * @project ocs-answer-hub
 * @module 查题记录
 * @description 提供按账号隔离的查询记录、重复失败聚合及完整失败导出。
 * @logic 入口验证筛选条件，以题目指纹分组失败记录，白名单输出题目及诊断信息。
 * @dependencies Fastify, pg, zod, search
 * @index_tags query, history, failures, export
 * @author holic512
 */
import type {FastifyInstance} from 'fastify';
import type pg from 'pg';
import {z} from 'zod';
import type {QuestionInput} from './search.js';

const pageSize=30;
const failedStatus="e.status IN ('miss','error','rejected')";
const groupKey="coalesce(e.fingerprint,'legacy:'||e.title)";
const eventColumns=`e.id::text AS id,e.user_id,u.username,e.token_id,t.name AS token_name,e.title,e.status,e.source,e.question_id,e.duration_ms,e.attempts,e.created_at,e.fingerprint,e.question_snapshot,e.request_id,e.query_id,e.failure_code`;
const eventTables='query_events e LEFT JOIN administrators u ON u.id=e.user_id LEFT JOIN api_tokens t ON t.id=e.token_id';
const dateInput=z.union([z.iso.date(),z.iso.datetime({offset:true})]);
const filtersSchema=z.object({q:z.string().trim().max(8000).default(''),status:z.enum(['all','failed','hit','pending','miss','error','rejected']).default('all'),from:dateInput.optional(),to:dateInput.optional(),source:z.string().max(100).optional(),user_id:z.coerce.number().int().positive().max(2147483647).optional(),page:z.coerce.number().int().min(1).max(1000000).default(1),view:z.enum(['records','failures']).default('records'),group_key:z.string().max(8100).optional()}).refine(p=>!p.from||!p.to||dateBound(p.from)<=dateBound(p.to,true),{message:'开始时间不能晚于结束时间',path:['to']});
type Filters=z.infer<typeof filtersSchema>;

export function questionSnapshot(input:QuestionInput){
 return {title:input.title,type:input.type,options:Array.isArray(input.options)?[...input.options]:input.options,images:input.images?.map(image=>typeof image==='string'?image:{url:image.url}),course:input.course,suggestion_title:input.suggestion_title,suggestion_options:input.suggestion_options};
}

export function registerQueryHistory(app:FastifyInstance,pool:pg.Pool){
 for(const audience of ['workspace','admin'] as const){
  const prefix=`/api/${audience}/query-events`;
  app.get(prefix,async(req,reply)=>{
   reply.header('Cache-Control','no-store');
   const p=filtersSchema.parse(req.query),base=filterWhere(p,audience==='workspace'?(req as any).admin.id:undefined);
   const conditions=[...base.conditions];
   if(p.view==='failures'||p.status==='failed')conditions.push(failedStatus);
   else if(p.status!=='all'){base.values.push(p.status);conditions.push(`e.status=$${base.values.length}`);}
   const clause=conditions.join(' AND '),baseClause=base.conditions.join(' AND '),baseValues=base.values.slice(0,base.baseLength);
   const grouped=p.view==='failures';
   const listSql=grouped?`SELECT (array_agg(e.id::text ORDER BY e.created_at DESC,e.id DESC))[1] AS id,(array_agg(e.title ORDER BY e.created_at DESC,e.id DESC))[1] AS title,${groupKey} AS group_key,bool_or(e.fingerprint IS NULL) AS approximate,count(*)::int AS failure_count,min(e.created_at) AS first_failure,max(e.created_at) AS last_failure,(array_agg(e.failure_code ORDER BY e.created_at DESC,e.id DESC))[1] AS failure_code FROM query_events e WHERE ${clause} GROUP BY ${groupKey} ORDER BY last_failure DESC,max(e.id) DESC LIMIT ${pageSize} OFFSET $${base.values.length+1}`:`SELECT ${eventColumns} FROM ${eventTables} WHERE ${clause} ORDER BY e.created_at DESC,e.id DESC LIMIT ${pageSize} OFFSET $${base.values.length+1}`;
   const [list,total,summary,sources]=await Promise.all([
    pool.query(listSql,[...base.values,(p.page-1)*pageSize]),
    pool.query(`SELECT count(${grouped?`DISTINCT ${groupKey}`:'*'})::int AS total FROM query_events e WHERE ${clause}`,base.values),
    pool.query(`SELECT count(*)::int AS requests,count(*) FILTER(WHERE e.status='hit')::int AS hits,count(*) FILTER(WHERE ${failedStatus})::int AS failed,count(*) FILTER(WHERE e.status='pending')::int AS pending FROM query_events e WHERE ${baseClause}`,baseValues),
    pool.query(`SELECT DISTINCT name FROM (SELECT e.source AS name FROM query_events e WHERE ${baseClause} UNION ALL SELECT a->>'source' AS name FROM query_events e CROSS JOIN LATERAL jsonb_array_elements(e.attempts) a WHERE ${baseClause}) s WHERE name IS NOT NULL AND name<>'' AND name<>'RAG' ORDER BY name`,baseValues)
   ]);
   return {items:grouped?list.rows:list.rows.map(eventView),total:total.rows[0].total,page:p.page,pageSize,summary:summary.rows[0],sources:sources.rows.map(row=>row.name)};
  });
  app.get(`${prefix}/export`,async(req,reply)=>{
   reply.header('Cache-Control','no-store');
   const p=filtersSchema.parse(req.query),where=filterWhere(p,audience==='workspace'?(req as any).admin.id:undefined);
   const rows=(await pool.query(`SELECT ${eventColumns} FROM ${eventTables} WHERE ${where.conditions.join(' AND ')} AND ${failedStatus} ORDER BY e.created_at DESC,e.id DESC`,where.values)).rows;
   const groups=new Map<string,{group_key:string;title:string;approximate:boolean;failure_count:number;first_failure:Date;last_failure:Date;events:ReturnType<typeof eventView>[]}>();
   for(const row of rows){const event=eventView(row);let group=groups.get(event.group_key);if(!group){group={group_key:event.group_key,title:row.title,approximate:event.approximate,failure_count:0,first_failure:row.created_at,last_failure:row.created_at,events:[]};groups.set(event.group_key,group);}group.failure_count++;group.first_failure=row.created_at;group.events.push(event);}
   return {format:'ocs-answer-hub-failures-v1',exported_at:new Date().toISOString(),groups:[...groups.values()]};
  });
  app.get<{Params:{id:string}}>(`${prefix}/:id`,async(req,reply)=>{
   reply.header('Cache-Control','no-store');
   const id=z.string().regex(/^[1-9]\d{0,18}$/).transform(BigInt).pipe(z.bigint().max(9223372036854775807n)).transform(String).parse(req.params.id),userId=audience==='workspace'?(req as any).admin.id:undefined;
   const row=(await pool.query(`SELECT ${eventColumns} FROM ${eventTables} WHERE e.id=$1${userId===undefined?'':' AND e.user_id=$2'}`,[id,...(userId===undefined?[]:[userId])])).rows[0];
   if(!row)throw Object.assign(new Error('查题记录不存在'),{statusCode:404});
   return {item:eventView(row)};
  });
 }
}

function dateBound(value:string,end=false){
 if(value.length!==10)return new Date(value).getTime();
 return new Date(`${value}T00:00:00+08:00`).getTime()+(end?86400000:0);
}
function filterWhere(p:Filters,userId?:number){
 const values:unknown[]=[],conditions=['TRUE'];
 const add=(sql:string,value:unknown)=>{values.push(value);conditions.push(sql.replace('?',`$${values.length}`));};
 if(userId!==undefined)add('e.user_id=?',userId);else if(p.user_id!==undefined)add('e.user_id=?',p.user_id);
 if(p.q)add('e.title ILIKE ?',`%${p.q.replace(/[\\%_]/g,'\\$&')}%`);
 if(p.from)add('e.created_at>=?',new Date(dateBound(p.from)));
 if(p.to)add(`e.created_at${p.to.length===10?'<':'<='}?`,new Date(dateBound(p.to,true)));
 if(p.source){values.push(p.source);conditions.push(`(e.source=$${values.length} OR EXISTS(SELECT 1 FROM jsonb_array_elements(e.attempts) a WHERE a->>'source'=$${values.length}))`);}
 if(p.group_key)add(`${groupKey}=?`,p.group_key);
 return {values,conditions,baseLength:values.length};
}
function safeAttempts(attempts:Record<string,unknown>[]){
 return attempts.map(attempt=>{
  const result:Record<string,unknown>={};
  for(const key of ['source','providerId','kind','status','stage','code','message','reason'])if(typeof attempt[key]==='string')result[key]=attempt[key];
  if(typeof attempt.candidateAnswer==='string'||Array.isArray(attempt.candidateAnswer)&&attempt.candidateAnswer.every(value=>typeof value==='string'))result.candidateAnswer=attempt.candidateAnswer;
  for(const key of ['httpStatus','durationMs'])if(typeof attempt[key]==='number')result[key]=attempt[key];
  if(attempt.ai&&typeof attempt.ai==='object'){const ai=attempt.ai as Record<string,unknown>;result.ai=Object.fromEntries(['model','apiFormat','maxTokens','enableThinking','vision'].filter(key=>['string','number','boolean'].includes(typeof ai[key])).map(key=>[key,ai[key]]));}
  return result;
 });
}
function eventView(row:any){
 return {id:String(row.id),user_id:row.user_id,username:row.username,token_id:row.token_id,token_name:row.token_name,title:row.title,status:row.status,source:row.source,question_id:row.question_id,duration_ms:row.duration_ms,created_at:row.created_at,fingerprint:row.fingerprint,question_snapshot:row.question_snapshot?questionSnapshot(row.question_snapshot):null,request_id:row.request_id,query_id:row.query_id,failure_code:row.failure_code,attempts:safeAttempts(row.attempts),group_key:row.fingerprint??`legacy:${row.title}`,approximate:row.fingerprint===null};
}
