/**
 * @file users.ts
 * @project ocs-answer-hub
 * @module services
 * @description 用户生命周期与积分事务。
 * @logic 创建赠分、管理员保留、软删除和人工调分使用原子事务。
 * @dependencies UsersRepository, settings, security, core
 * @index_tags users, credits, service
 * @author holic512
 */
import type pg from 'pg';
import type {Role} from '../../shared/contracts.js';
import {fail,transaction} from '../core.js';
import {hashPassword} from '../security.js';
import {UsersRepository,type UserChange,type UserFilters,type Pagination} from '../repositories/users.js';
import {getSettings} from './settings.js';
export type CreateUser={username:string;password:string;role:Role;mustChange:boolean};
export async function createUser(pool:pg.Pool,data:CreateUser,reason:string){
 const passwordHash=await hashPassword(data.password),settings=await getSettings(pool);
 return transaction(pool,async c=>{
  const repo=new UsersRepository(c),user=await repo.create({...data,passwordHash,balance:settings.registrationCredits});
  if(!user)throw fail('账号已存在',409);
  await repo.recordCredit({userId:user.id,amount:user.balance,balance:user.balance,reason,reference:`signup:${user.id}`});
  return user;
 });
}
export class UsersService {
 constructor(private pool:pg.Pool){}
 list(p:UserFilters){return new UsersRepository(this.pool).list(p);}
 async detail(id:number){const user=await new UsersRepository(this.pool).find(id);if(!user)throw fail('用户不存在',404);return user;}
 async creditPage(id:number,p:Pagination){const repo=new UsersRepository(this.pool),credits=await repo.credits(id);if(!credits)throw fail('用户不存在',404);return {...credits,...await repo.ledger(id,p)};}
 async update(id:number,data:UserChange){
  await transaction(this.pool,async c=>{
   const repo=new UsersRepository(c),old=await lockUser(repo,id);
   if(old.role==='admin'&&(data.disabled||data.role!=='admin'))await requireOtherAdmin(repo,id);
   await repo.update(id,data);
   if(data.disabled||old.role!==data.role)await repo.clearSessions(id);
  });
 }
 async remove(id:number){await transaction(this.pool,async c=>{const repo=new UsersRepository(c),old=await lockUser(repo,id);if(old.role==='admin')await requireOtherAdmin(repo,id);await repo.retire(id);});}
 async resetPassword(id:number,password:string){const hash=await hashPassword(password);await transaction(this.pool,async c=>{const repo=new UsersRepository(c);if(!await repo.setPassword(id,hash,true))throw fail('用户不存在',404);await repo.clearSessions(id);});}
 async adjustCredits(id:number,amount:number,reason:string,actorId:number){return transaction(this.pool,async c=>{const repo=new UsersRepository(c),credits=await repo.adjustCredits(id,amount);if(!credits)throw fail('用户不存在或调整后可用积分小于 0');await repo.recordCredit({userId:id,amount,balance:credits.balance,reason,actorId});return credits;});}
}
async function lockUser(repo:UsersRepository,id:number){const user=await repo.lockLifecycle(id);if(!user)throw fail('用户不存在',404);return user;}
async function requireOtherAdmin(repo:UsersRepository,id:number){if(!await repo.otherAdmin(id))throw fail('必须保留至少一个有效管理员',409);}
