/**
 * @file accounts.ts
 * @project ocs-answer-hub
 * @module 查询计费
 * @description 凭证受理限额、用户积分冻结与幂等结算。
 * @logic 用户行锁后更新凭证并冻结积分；结果和账本同事务提交，失败释放，过期受理可恢复。
 * @dependencies pg, core, search
 * @index_tags billing, credits, quota
 * @author holic512
 */
import type pg from 'pg';
import {prepare,type QuestionInput} from './search.js';
import {questionSnapshot} from './query-history.js';
import {fail,transaction} from './core.js';
export type QueryIdentity={userId:number;tokenId:string}|{tokenHash:string};
export async function reserveQuery(pool:pg.Pool,input:QuestionInput,identity:QueryIdentity,requestId?:string){
 return transaction(pool,async c=>{
  const token=(await c.query<{id:string;user_id:number}>(`SELECT id,user_id FROM api_tokens WHERE ${'tokenHash' in identity?'hash=$1':'id=$1 AND user_id=$2'}`, 'tokenHash' in identity?[identity.tokenHash]:[identity.tokenId,identity.userId])).rows[0];
  if(!token)throw fail('查题凭证无效或不属于当前用户',401);
  const user=(await c.query<{id:number;disabled:boolean;must_change:boolean;deleted_at:Date|null;balance:number;frozen:number}>('SELECT id,disabled,must_change,deleted_at,balance,frozen FROM users WHERE id=$1 FOR UPDATE',[token.user_id])).rows[0];
  if(!user||user.disabled||user.deleted_at||user.must_change)throw fail('账号不可用或需要修改密码',403);
  if(user.balance-user.frozen<1)throw fail('积分不足，请联系管理员',402);
  const updated=(await c.query<{name:string;prefix:string}>(`UPDATE api_tokens SET usage_day=(now() AT TIME ZONE 'Asia/Shanghai')::date,day_count=CASE WHEN usage_day=(now() AT TIME ZONE 'Asia/Shanghai')::date THEN day_count+1 ELSE 1 END,minute_bucket=date_trunc('minute',now()),minute_count=CASE WHEN minute_bucket=date_trunc('minute',now()) THEN minute_count+1 ELSE 1 END,last_used=now() WHERE id=$1 AND NOT revoked AND (expires_at IS NULL OR expires_at>now()) AND daily_limit>0 AND (usage_day<>(now() AT TIME ZONE 'Asia/Shanghai')::date OR day_count<daily_limit) AND (minute_bucket<>date_trunc('minute',now()) OR minute_count<rpm) RETURNING name,prefix`,[token.id])).rows[0];
  if(!updated){const state=(await c.query('SELECT revoked,expires_at FROM api_tokens WHERE id=$1',[token.id])).rows[0];if(!state||state.revoked||state.expires_at&&new Date(state.expires_at)<=new Date())throw fail('凭证已撤销、删除或过期',401);throw fail('凭证调用频率或每日额度已用尽',429);}
  await c.query('UPDATE users SET frozen=frozen+1 WHERE id=$1',[user.id]);
  const event=(await c.query<{id:string}>(`INSERT INTO query_events(user_id,token_id,token_name,token_prefix,title,status,duration_ms,fingerprint,question_snapshot,request_id,billing_status,billing_expires_at) VALUES($1,$2,$3,$4,$5,'pending',0,$6,$7,$8,'held',now()+interval '5 minutes') RETURNING id::text`,[user.id,token.id,updated.name,updated.prefix,input.title,prepare(input).key,JSON.stringify(questionSnapshot(input)),requestId??null])).rows[0];
  return {userId:user.id,tokenId:token.id,eventId:event.id};
 });
}
export type QueryCompletion={status:'hit'|'miss'|'error'|'rejected';source?:string|null;questionId?:string|null;durationMs:number;attempts:unknown[];failureCode?:string|null;queryId?:string};
export async function completeQuery(pool:pg.Pool,eventId:string,result:QueryCompletion){
 return transaction(pool,async c=>{
  const identity=(await c.query<{user_id:number|null}>('SELECT user_id FROM query_events WHERE id=$1',[eventId])).rows[0];
  if(!identity)return false;
  // 与受理统一先锁用户，避免结算、管理员调分和新受理之间形成反向锁序。
  if(identity.user_id)await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[identity.user_id]);
  const event=(await c.query<{user_id:number|null;billing_status:string;status:string}>('SELECT user_id,billing_status,status FROM query_events WHERE id=$1 FOR UPDATE',[eventId])).rows[0];
  if(event.status!=='pending')return false;
  if(event.billing_status==='held'&&event.user_id){
   const charge=result.status==='hit';
   const user=(await c.query<{balance:number}>('UPDATE users SET frozen=frozen-1,balance=balance-$2 WHERE id=$1 RETURNING balance',[event.user_id,charge?1:0])).rows[0];
   if(charge)await c.query("INSERT INTO credit_ledger(user_id,amount,balance,reason,event_id) VALUES($1,-1,$2,'查题成功',$3)",[event.user_id,user.balance,eventId]);
  }
  await c.query(`UPDATE query_events SET status=$2,source=$3,question_id=$4,duration_ms=$5,attempts=$6,failure_code=$7,query_id=coalesce($8,query_id),billing_status=CASE WHEN billing_status='held' THEN CASE WHEN $2='hit' THEN 'charged' ELSE 'released' END ELSE billing_status END,billing_expires_at=NULL WHERE id=$1`,[eventId,result.status,result.source??null,result.questionId??null,result.durationMs,JSON.stringify(result.attempts),result.failureCode??null,result.queryId??null]);
  return true;
 });
}
export async function recoverExpiredCredits(pool:pg.Pool){
 const rows=(await pool.query<{id:string}>("SELECT id::text FROM query_events WHERE billing_status='held' AND billing_expires_at<now() ORDER BY billing_expires_at LIMIT 100")).rows;
 for(const row of rows)await completeQuery(pool,row.id,{status:'error',durationMs:0,attempts:[],failureCode:'interrupted'});
 return rows.length;
}
export async function usage(pool:pg.Pool,userId:number){
 return (await pool.query(`SELECT id,username,role,balance,frozen,balance-frozen AS available,(SELECT count(*)::int FROM query_events WHERE user_id=$1 AND created_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai') AS requests,(SELECT count(*)::int FROM query_events WHERE user_id=$1 AND status='hit' AND created_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai') AS hits FROM users WHERE id=$1`,[userId])).rows[0];
}
