/**
 * @file auth.ts
 * @project ocs-answer-hub
 * @module services
 * @description 初始化、注册、会话和密码业务。
 * @logic 认证使用用户仓储，凭据计算在事务外，账号和会话变更原子保存。
 * @dependencies UsersRepository, users, settings, security, core
 * @index_tags auth, sessions, service
 * @author holic512
 */
import type pg from 'pg';
import {fail,transaction} from '../core.js';
import {digest,hashPassword,randomToken,verifyPassword} from '../security.js';
import {UsersRepository} from '../repositories/users.js';
import {createUser} from './users.js';
import {getSettings} from './settings.js';
export class AuthService {
 constructor(private pool:pg.Pool){}
 async setupInfo(){const repo=new UsersRepository(this.pool),s=await getSettings(this.pool);return {required:!await repo.activeAdmin(),registrationEnabled:s.registrationEnabled,registrationCredits:s.registrationCredits,tokenDefaults:{daily_limit:s.tokenDailyDefault,rpm:s.tokenRpmDefault,max_daily_limit:s.tokenDailyMax,max_rpm:s.tokenRpmMax}};}
 session(token:string){return new UsersRepository(this.pool).session(digest(token));}
 async setup(data:{username:string;password:string}){
  const passwordHash=await hashPassword(data.password);
  return transaction(this.pool,async c=>{
   const repo=new UsersRepository(c);await repo.lockLifecycle(0);
   if(await repo.hasAdmin())throw fail('系统已完成初始化',409);
   const user=await repo.create({...data,passwordHash,role:'admin',mustChange:false,balance:20});
   if(!user)throw fail('账号已存在',409);
   await repo.recordCredit({userId:user.id,amount:20,balance:20,reason:'初始化赠送',reference:`setup:${user.id}`});
   return {ok:true,id:user.id,username:user.username};
  });
 }
 async register(data:{username:string;password:string}){
  if(!await new UsersRepository(this.pool).activeAdmin())throw fail('请先完成管理员初始化',409);
  if(!(await getSettings(this.pool)).registrationEnabled)throw fail('系统暂未开放注册',403);
  const user=await createUser(this.pool,{...data,role:'user',mustChange:false},'注册赠送');
  return {ok:true,id:user.id,username:user.username};
 }
 async login(data:{username:string;password:string}){
  const repo=new UsersRepository(this.pool);
  if(!await repo.activeAdmin())throw fail('请先完成管理员初始化',409);
  const user=await repo.credentials(data.username);
  if(!user||user.disabled||!await verifyPassword(data.password,user.password_hash))throw fail('账号或密码不正确',401);
  const token=randomToken(),csrf=randomToken();await repo.createSession(user.id,digest(token),csrf);
  return {token,result:{id:user.id,role:user.role,username:user.username,csrf,mustChange:user.must_change}};
 }
 logout(token:string){return new UsersRepository(this.pool).deleteSession(digest(token));}
 async changePassword(id:number,data:{oldPassword:string;newPassword:string}){
  const repo=new UsersRepository(this.pool),old=await repo.password(id);
  if(!old||!await verifyPassword(data.oldPassword,old))throw fail('原密码不正确');
  if(data.oldPassword===data.newPassword)throw fail('新密码不能与原密码相同');
  const hash=await hashPassword(data.newPassword);
  await transaction(this.pool,async c=>{const users=new UsersRepository(c);await users.setPassword(id,hash,false);await users.clearSessions(id);});
 }
}
