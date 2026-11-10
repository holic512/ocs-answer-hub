/**
 * @file ai.ts
 * @project ocs-answer-hub
 * @module services
 * @description AI 配置密钥合并、加密和独立测试。
 * @logic 边界已校验的表单与旧密钥合并，测试并发按配置隔离。
 * @dependencies AiRepository, providers, provider-test, security
 * @index_tags ai, secrets, service
 * @author holic512
 */
import type pg from 'pg';
import {fail,transaction} from '../core.js';
import {decrypt,encrypt} from '../security.js';
import type {AiConfig,Provider,Transport} from '../providers.js';
import {probeProvider} from '../provider-test.js';
import type {QuestionInput} from '../search.js';
import {AiRepository,type ProviderInput} from '../repositories/ai.js';
import type {Pagination} from '../repositories/users.js';
export class AiService {
 private testing=new Set<string>();
 constructor(private pool:pg.Pool,private key:string,private transport:Transport){}
 async list(p:Pagination){const page=await new AiRepository(this.pool).list(p);return {...page,items:page.items.map(row=>{const {config_cipher,...rest}=row,config=decrypt(config_cipher,this.key) as AiConfig;return {...rest,config:{...config,apiKey:'',hasKey:Boolean(config.apiKey),outputMode:config.outputMode??(config.jsonMode?'json_object':'prompt')}};})};}
 async saved(id:string){const row=await new AiRepository(this.pool).find(id);if(!row)throw fail('AI 配置不存在',404);return {...row,config:decrypt(row.config_cipher,this.key) as AiConfig};}
 create(data:ProviderInput,config:AiConfig){return new AiRepository(this.pool).create(data,encrypt(config,this.key));}
 update(id:string,data:ProviderInput,config:AiConfig){return new AiRepository(this.pool).update(id,data,encrypt(config,this.key));}
 async remove(id:string){if(!await new AiRepository(this.pool).remove(id))throw fail('AI 配置不存在',404);}
 reorder(ids:string[]){return transaction(this.pool,c=>new AiRepository(c).reorder(ids));}
 async test(provider:Provider,input:QuestionInput){if(this.testing.has(provider.id)||this.testing.size>=3)throw fail('配置正在测试或测试请求较多',429);this.testing.add(provider.id);try{return await probeProvider(provider,input,this.transport);}finally{this.testing.delete(provider.id);}}
}
