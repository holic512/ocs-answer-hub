/**
 * @file users.ts
 * @project ocs-answer-hub
 * @module repositories
 * @description 用户身份、会话与积分账本持久化。
 * @logic 按领域提供分页、锁定、账号生命周期和账本操作，事务由服务控制。
 * @dependencies pg, shared/contracts
 * @index_tags users, credits, repository
 * @author holic512
 */
import type pg from 'pg';
import type {CreditSummary,Role} from '../../shared/contracts.js';
import type {Actor} from '../core.js';
export type Pagination={page:number;pageSize:number};
export type UserRow=CreditSummary&{id:number;username:string;role:Role;disabled:boolean;must_change:boolean;created_at:Date;deleted_at:Date|null};
export type UserFilters=Pagination&{q:string;role:Role|'all';status:'all'|'active'|'disabled'|'deleted'};
export type UserChange={username:string;role:Role;disabled:boolean};
export type CredentialRow={id:number;username:string;role:Role;password_hash:string;must_change:boolean;disabled:boolean};
export type LedgerRow={id:string;amount:number;balance:number;reason:string;actor_id:number|null;actor_name:string|null;event_id:string|null;created_at:Date};
const columns='id,username,role,disabled,must_change,balance,frozen,balance-frozen AS available,created_at,deleted_at';
export class UsersRepository {
 constructor(private db:pg.Pool|pg.PoolClient){}
 async activeAdmin(owner?:number|null){return (await this.db.query<{id:number}>("SELECT id FROM users WHERE role='admin' AND NOT disabled AND deleted_at IS NULL AND ($1::int IS NULL OR id=$1) ORDER BY id LIMIT 1",[owner??null])).rows[0];}
 async hasAdmin(){return Boolean((await this.db.query("SELECT id FROM users WHERE role='admin' AND deleted_at IS NULL LIMIT 1")).rowCount);}
 async find(id:number){return (await this.db.query<UserRow>(`SELECT ${columns} FROM users WHERE id=$1`,[id])).rows[0];}
 async list(p:UserFilters){
  const where=`username ILIKE $1 AND ($2='all' OR role=$2) AND ${p.status==='deleted'?'deleted_at IS NOT NULL':`deleted_at IS NULL${p.status==='active'?' AND NOT disabled':p.status==='disabled'?' AND disabled':''}`}`;
  const values=[`%${p.q.replace(/[\\%_]/g,'\\$&')}%`,p.role];
  const [items,total]=await Promise.all([this.db.query<UserRow>(`SELECT ${columns} FROM users WHERE ${where} ORDER BY id LIMIT $3 OFFSET $4`,[...values,p.pageSize,(p.page-1)*p.pageSize]),this.db.query<{total:number}>(`SELECT count(*)::int total FROM users WHERE ${where}`,values)]);
  return {items:items.rows,total:total.rows[0].total,page:p.page,pageSize:p.pageSize};
 }
 async create(data:{username:string;passwordHash:string;role:Role;mustChange:boolean;balance:number}){return (await this.db.query<UserRow>(`INSERT INTO users(username,password_hash,role,must_change,balance) VALUES($1,$2,$3,$4,$5) ON CONFLICT(username) DO NOTHING RETURNING ${columns}`,[data.username,data.passwordHash,data.role,data.mustChange,data.balance])).rows[0];}
 async lockLifecycle(id:number){await this.db.query('SELECT pg_advisory_xact_lock(764005)');return (await this.db.query<{role:Role}>('SELECT role FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[id])).rows[0];}
 async otherAdmin(id:number){return Boolean((await this.db.query("SELECT id FROM users WHERE role='admin' AND NOT disabled AND deleted_at IS NULL AND id<>$1",[id])).rowCount);}
 async update(id:number,data:UserChange){await this.db.query('UPDATE users SET username=$2,role=$3,disabled=$4 WHERE id=$1',[id,data.username,data.role,data.disabled]);}
 async retire(id:number){
  await this.db.query('UPDATE users SET disabled=true,deleted_at=now() WHERE id=$1',[id]);
  await this.clearSessions(id);
  await this.db.query('UPDATE api_tokens SET revoked=true WHERE user_id=$1',[id]);
  await this.db.query("UPDATE background_jobs SET cancel_requested=true,status='cancelled' WHERE user_id=$1 AND status IN ('queued','running')",[id]);
  await this.db.query('UPDATE task_schedules SET enabled=false WHERE user_id=$1',[id]);
 }
 async clearSessions(id:number){await this.db.query('DELETE FROM sessions WHERE user_id=$1',[id]);}
 async credentials(username:string){return (await this.db.query<CredentialRow>('SELECT id,username,password_hash,role,must_change,disabled FROM users WHERE username=$1 AND deleted_at IS NULL',[username])).rows[0];}
 async password(id:number){return (await this.db.query<{password_hash:string}>('SELECT password_hash FROM users WHERE id=$1',[id])).rows[0]?.password_hash;}
 async setPassword(id:number,passwordHash:string,mustChange:boolean){return Boolean((await this.db.query('UPDATE users SET password_hash=$2,must_change=$3 WHERE id=$1 AND deleted_at IS NULL RETURNING id',[id,passwordHash,mustChange])).rowCount);}
 async session(hash:string){return (await this.db.query<Actor>('SELECT s.csrf,u.id,u.username,u.role,u.must_change FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=$1 AND s.expires_at>now() AND NOT u.disabled AND u.deleted_at IS NULL',[hash])).rows[0];}
 async createSession(id:number,hash:string,csrf:string){await this.db.query('DELETE FROM sessions WHERE expires_at<now()');await this.db.query("INSERT INTO sessions(hash,csrf,expires_at,user_id) VALUES($1,$2,now()+interval '12 hours',$3)",[hash,csrf,id]);}
 async deleteSession(hash:string){await this.db.query('DELETE FROM sessions WHERE hash=$1',[hash]);}
 async credits(id:number){return (await this.db.query<CreditSummary>('SELECT balance,frozen,balance-frozen AS available FROM users WHERE id=$1',[id])).rows[0];}
 async ledger(id:number,p:Pagination){
  const [items,total]=await Promise.all([this.db.query<LedgerRow>('SELECT l.id::text,l.amount,l.balance,l.reason,l.actor_id,a.username actor_name,l.event_id::text,l.created_at FROM credit_ledger l LEFT JOIN users a ON a.id=l.actor_id WHERE l.user_id=$1 ORDER BY l.created_at DESC,l.id DESC LIMIT $2 OFFSET $3',[id,p.pageSize,(p.page-1)*p.pageSize]),this.db.query<{total:number}>('SELECT count(*)::int total FROM credit_ledger WHERE user_id=$1',[id])]);
  return {items:items.rows,total:total.rows[0].total,...p};
 }
 async adjustCredits(id:number,amount:number){return (await this.db.query<CreditSummary>('UPDATE users SET balance=balance+$2 WHERE id=$1 AND deleted_at IS NULL AND balance+$2>=frozen RETURNING balance,frozen,balance-frozen available',[id,amount])).rows[0];}
 async recordCredit(data:{userId:number;amount:number;balance:number;reason:string;actorId?:number;reference?:string}){await this.db.query('INSERT INTO credit_ledger(user_id,amount,balance,reason,actor_id,reference_key) VALUES($1,$2,$3,$4,$5,$6)',[data.userId,data.amount,data.balance,data.reason,data.actorId??null,data.reference??null]);}
}
