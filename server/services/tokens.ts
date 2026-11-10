/**
 * @file tokens.ts
 * @project ocs-answer-hub
 * @module services
 * @description 凭证归属、限额与 OCS 配置业务。
 * @logic 普通用户受系统额度上限约束，删除和历史标识同事务提交。
 * @dependencies TokensRepository, settings, security, core
 * @index_tags tokens, service, ocs
 * @author holic512
 */
import type pg from 'pg';
import {fail,transaction} from '../core.js';
import {randomToken,digest} from '../security.js';
import {TokensRepository,type TokenInput} from '../repositories/tokens.js';
import type {Pagination} from '../repositories/users.js';
import {getSettings} from './settings.js';
export function ocsConfig(origin:string,token:string){return [{name:'知序 · 本地与 AI 题库',homepage:origin,url:`${origin}/api/ocs/query`,method:'post',type:'GM_xmlhttpRequest',contentType:'json',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},data:{title:'${title}',options:'${options}',type:'${type}',images:{handler:'return (env) => env.images || []'},suggestion_title:'${suggestion_title}',suggestion_options:'${suggestion_options}'},handler:'return (res) => res.code === 1 ? [res.question, res.answer] : [res.message || "未找到答案", undefined]'}];}

export class TokensService {
 constructor(private pool:pg.Pool,private origin:string){}
 list(p:Pagination&{q:string},owner?:number){return new TokensRepository(this.pool).list(p,owner);}
 async create(data:TokenInput,userId:number,admin:boolean){
  const limits=await this.limits(data,admin),repo=new TokensRepository(this.pool);
  if(!await repo.ownerAvailable(userId))throw fail('用户不存在或已禁用');
  const token=`zhixu_${randomToken()}`,row=await repo.create({...data,...limits},userId,digest(token),token.slice(0,13));
  return {...row,token,config:ocsConfig(this.origin,token)};
 }
 async update(id:string,data:TokenInput,admin:boolean,owner?:number){const limits=await this.limits(data,admin);if(!await new TokensRepository(this.pool).update(id,{...data,...limits},owner))throw fail('凭证不存在',404);}
 async revoke(id:string,owner?:number){if(!await new TokensRepository(this.pool).revoke(id,owner))throw fail('凭证不存在',404);}
 async remove(id:string,owner?:number){await transaction(this.pool,async c=>{if(!await new TokensRepository(c).remove(id,owner))throw fail('凭证不存在',404);});}
 async wrapper(token:string){if(!await new TokensRepository(this.pool).valid(digest(token)))throw fail('凭证不存在、过期或已撤销');return {config:ocsConfig(this.origin,token)};}
 private async limits(data:TokenInput,admin:boolean){const settings=await getSettings(this.pool),daily_limit=data.daily_limit??settings.tokenDailyDefault,rpm=data.rpm??settings.tokenRpmDefault;if(!admin&&(daily_limit>settings.tokenDailyMax||rpm>settings.tokenRpmMax))throw fail('超过系统允许的凭证额度');return {daily_limit,rpm};}
}
