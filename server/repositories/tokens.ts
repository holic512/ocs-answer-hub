/**
 * @file tokens.ts
 * @project ocs-answer-hub
 * @module repositories
 * @description 调用凭证及历史标识持久化。
 * @logic 按归属分页和写入，删除前保存历史名称快照。
 * @dependencies pg
 * @index_tags tokens, repository
 * @author holic512
 */
import type pg from 'pg';
import type {Pagination} from './users.js';
export type TokenInput={name:string;daily_limit?:number;rpm?:number;expires_at?:string|null};
export type TokenValues=TokenInput&{daily_limit:number;rpm:number};
export type TokenRow={id:string;name:string;prefix:string;expires_at:Date|null;revoked:boolean;daily_limit:number;rpm:number;day_count:number;usage_day:Date;last_used:Date|null;created_at:Date;user_id:number;username:string};
export class TokensRepository {
 constructor(private db:pg.Pool|pg.PoolClient){}
 async list(p:Pagination&{q:string},owner?:number){
  const values=[owner??null,`%${p.q.replace(/[\\%_]/g,'\\$&')}%`],where='($1::int IS NULL OR t.user_id=$1) AND t.name ILIKE $2';
  const [items,total]=await Promise.all([this.db.query<TokenRow>(`SELECT t.id,t.name,t.prefix,t.expires_at,t.revoked,t.daily_limit,t.rpm,CASE WHEN t.usage_day=(now() AT TIME ZONE 'Asia/Shanghai')::date THEN t.day_count ELSE 0 END day_count,t.usage_day,t.last_used,t.created_at,t.user_id,u.username FROM api_tokens t JOIN users u ON u.id=t.user_id WHERE ${where} ORDER BY t.created_at DESC,t.id LIMIT $3 OFFSET $4`,[...values,p.pageSize,(p.page-1)*p.pageSize]),this.db.query<{total:number}>(`SELECT count(*)::int total FROM api_tokens t WHERE ${where}`,values)]);
  return {items:items.rows,total:total.rows[0].total,page:p.page,pageSize:p.pageSize};
 }
 async ownerAvailable(id:number){return Boolean((await this.db.query('SELECT id FROM users WHERE id=$1 AND NOT disabled AND deleted_at IS NULL',[id])).rowCount);}
 async create(data:TokenValues,userId:number,hash:string,prefix:string){return (await this.db.query<{id:string}>('INSERT INTO api_tokens(name,hash,prefix,daily_limit,rpm,expires_at,user_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[data.name,hash,prefix,data.daily_limit,data.rpm,data.expires_at??null,userId])).rows[0];}
 async update(id:string,data:TokenValues,owner?:number){return Boolean((await this.db.query('UPDATE api_tokens SET name=$2,daily_limit=$3,rpm=$4,expires_at=$5 WHERE id=$1 AND ($6::int IS NULL OR user_id=$6) RETURNING id',[id,data.name,data.daily_limit,data.rpm,data.expires_at??null,owner??null])).rowCount);}
 async revoke(id:string,owner?:number){return Boolean((await this.db.query('UPDATE api_tokens SET revoked=true WHERE id=$1 AND ($2::int IS NULL OR user_id=$2) RETURNING id',[id,owner??null])).rowCount);}
 async remove(id:string,owner?:number){
  const row=(await this.db.query<{name:string;prefix:string}>('SELECT name,prefix FROM api_tokens WHERE id=$1 AND ($2::int IS NULL OR user_id=$2) FOR UPDATE',[id,owner??null])).rows[0];
  if(!row)return false;
  await this.db.query('UPDATE query_events SET token_name=coalesce(token_name,$2),token_prefix=coalesce(token_prefix,$3) WHERE token_id=$1',[id,row.name,row.prefix]);
  await this.db.query('DELETE FROM api_tokens WHERE id=$1',[id]);return true;
 }
 async valid(hash:string){return Boolean((await this.db.query('SELECT id FROM api_tokens WHERE hash=$1 AND NOT revoked AND (expires_at IS NULL OR expires_at>now())',[hash])).rowCount);}
}
