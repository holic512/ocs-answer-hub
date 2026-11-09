/**
 * @file accounts.ts
 * @project ocs-answer-hub
 * @module 用户额度
 * @description 数据库统一用户/凭证扣额并创建持久查题记录。
 * @logic 按用户再凭证加锁，校验额度后同一事务保存完整题目、指纹与请求编号；失败全部回滚。
 * @dependencies pg, search, query-history
 * @index_tags users, quota, atomic
 * @author holic512
 */
import type pg from 'pg';
import {prepare,type QuestionInput} from './search.js';
import {questionSnapshot} from './query-history.js';
const fail=(message:string,statusCode:number)=>Object.assign(new Error(message),{statusCode});
export async function reserveQuery(pool:pg.Pool,input:QuestionInput,identity:{userId:number}|{tokenHash:string},requestId?:string){
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const token='tokenHash' in identity?(await c.query('SELECT id,user_id FROM api_tokens WHERE hash=$1',[identity.tokenHash])).rows[0]:null;
  if('tokenHash' in identity&&!token)throw fail('查题凭证无效或过期',401);
  const userId='userId' in identity?identity.userId:token.user_id;
  const user=(await c.query(`UPDATE administrators SET usage_day=CURRENT_DATE,day_count=CASE WHEN usage_day=CURRENT_DATE THEN day_count+1 ELSE 1 END,minute_bucket=date_trunc('minute',now()),minute_count=CASE WHEN minute_bucket=date_trunc('minute',now()) THEN minute_count+1 ELSE 1 END WHERE id=$1 AND NOT disabled AND NOT must_change AND daily_limit>0 AND (usage_day<>CURRENT_DATE OR day_count<daily_limit) AND (minute_bucket<>date_trunc('minute',now()) OR minute_count<rpm) RETURNING id`,[userId])).rows[0];
  if(!user){const row=(await c.query('SELECT disabled,must_change FROM administrators WHERE id=$1',[userId])).rows[0];if(!row||row.disabled||row.must_change)throw fail('用户已禁用或需要修改密码',403);throw fail('用户调用频率或每日额度已用尽',429);}
  if(token){const updated=await c.query(`UPDATE api_tokens SET usage_day=CURRENT_DATE,day_count=CASE WHEN usage_day=CURRENT_DATE THEN day_count+1 ELSE 1 END,minute_bucket=date_trunc('minute',now()),minute_count=CASE WHEN minute_bucket=date_trunc('minute',now()) THEN minute_count+1 ELSE 1 END,last_used=now() WHERE id=$1 AND NOT revoked AND (expires_at IS NULL OR expires_at>now()) AND daily_limit>0 AND (usage_day<>CURRENT_DATE OR day_count<daily_limit) AND (minute_bucket<>date_trunc('minute',now()) OR minute_count<rpm) RETURNING id`,[token.id]);
   if(!updated.rowCount){const row=(await c.query('SELECT revoked,expires_at FROM api_tokens WHERE id=$1',[token.id])).rows[0];if(row.revoked||row.expires_at&&new Date(row.expires_at)<=new Date())throw fail('查题凭证无效或过期',401);throw fail('凭证调用频率或每日额度已用尽',429);}
  }
  const event=(await c.query("INSERT INTO query_events(user_id,token_id,title,status,duration_ms,fingerprint,question_snapshot,request_id) VALUES($1,$2,$3,'pending',0,$4,$5,$6) RETURNING id",[userId,token?.id??null,input.title,prepare(input).key,JSON.stringify(questionSnapshot(input)),requestId??null])).rows[0];
  await c.query('COMMIT');return {userId,tokenId:token?.id??null,eventId:String(event.id)};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function usage(pool:pg.Pool,userId:number){return (await pool.query('SELECT id,username,role,disabled,daily_limit,rpm,CASE WHEN usage_day=CURRENT_DATE THEN day_count ELSE 0 END day_count,greatest(0,daily_limit-CASE WHEN usage_day=CURRENT_DATE THEN day_count ELSE 0 END) remaining FROM administrators WHERE id=$1',[userId])).rows[0];}
