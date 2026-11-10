/**
 * @file queries.ts
 * @project ocs-answer-hub
 * @module 查询接口
 * @description 工作台、OCS 受理及最近记录和系统统计。
 * @logic 两入口共用凭证积分受理，统计限制时间范围并短期缓存。
 * @dependencies fastify, pg, accounts, engine, core
 * @index_tags query, ocs, statistics
 * @author holic512
 */
import type {FastifyInstance} from 'fastify';
import type pg from 'pg';
import {z} from 'zod';
import {actor,fail,idSchema,questionSchema} from '../core.js';
import {reserveQuery,usage} from '../accounts.js';
import {Engine} from '../engine.js';
import {digest} from '../security.js';
export function registerQueries(app:FastifyInstance,pool:pg.Pool,engine:Engine){
 app.post('/api/workspace/query',async(req,reply)=>{const q=questionSchema.extend({tokenId:idSchema}).parse(req.body),reserved=await reserveQuery(pool,q,{userId:actor(req).id,tokenId:q.tokenId},req.id);reply.header('Cache-Control','no-store');return engine.query(q,reserved.tokenId,reserved.eventId,req.id);});
 app.post('/api/admin/query',async(req,reply)=>{const q=questionSchema.extend({tokenId:idSchema}).parse(req.body),reserved=await reserveQuery(pool,q,{userId:actor(req).id,tokenId:q.tokenId},req.id);reply.header('Cache-Control','no-store');return engine.query(q,reserved.tokenId,reserved.eventId,req.id);});
 app.post('/api/ocs/query',{config:{rateLimit:{max:120,timeWindow:'1 minute'}}},async(req,reply)=>{const body=z.object({token:z.string().max(200).optional()}).passthrough().parse(req.body),authorization=req.headers.authorization,token=authorization?.startsWith('Bearer ')?authorization.slice(7):body.token;if(!token||token.length>200)throw fail('查题凭证无效',401);const q=questionSchema.parse(body),reserved=await reserveQuery(pool,q,{tokenHash:digest(token)},req.id);reply.header('Cache-Control','no-store');return engine.query(q,reserved.tokenId,reserved.eventId,req.id);});
 app.get('/api/workspace/usage',req=>usage(pool,actor(req).id));
 app.get('/api/workspace/recent',async req=>({items:(await pool.query('SELECT id::text,title,status,source,duration_ms,created_at,billing_status FROM query_events WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20',[actor(req).id])).rows}));
 let statsCache:{at:number;value:unknown}|undefined;
 app.get('/api/admin/stats',async()=>{if(statsCache&&Date.now()-statsCache.at<15000)return statsCache.value;
  const [totals,questions,sources,daily,recent]=await Promise.all([
   pool.query(`SELECT count(*)::int requests,count(*) FILTER(WHERE status='hit')::int hits,count(*) FILTER(WHERE status IN ('miss','error','rejected'))::int failed,count(*) FILTER(WHERE status='pending')::int pending,count(*) FILTER(WHERE source='本地题库')::int local_hits,coalesce(round(avg(duration_ms)),0)::int avg_ms FROM query_events WHERE created_at>=now()-interval '30 days'`),
   pool.query('SELECT count(*)::int total FROM questions WHERE NOT deleted'),
   pool.query("SELECT CASE status WHEN 'pending' THEN '处理中' WHEN 'rejected' THEN '请求被拒绝' WHEN 'error' THEN '查询异常' ELSE coalesce(source,'未命中') END source,count(*)::int count,round(avg(duration_ms))::int avg_ms FROM query_events WHERE created_at>=now()-interval '30 days' GROUP BY 1 ORDER BY count DESC"),
   pool.query(`SELECT to_char(days.at,'MM-DD') AS day,count(e.id)::int AS count FROM generate_series(current_date-29,current_date,interval '1 day') AS days(at) LEFT JOIN query_events e ON e.created_at>=days.at AND e.created_at<days.at+interval '1 day' GROUP BY days.at ORDER BY days.at`),
   pool.query('SELECT e.id::text,e.title,e.status,e.source,e.duration_ms,e.created_at,coalesce(e.token_name,t.name) token_name FROM query_events e LEFT JOIN api_tokens t ON t.id=e.token_id ORDER BY e.created_at DESC,e.id DESC LIMIT 30')]);
  const value={totals:totals.rows[0],questions:questions.rows[0],sources:sources.rows,daily:daily.rows,recent:recent.rows};statsCache={at:Date.now(),value};return value;
 });
}
