/**
 * @file ai.ts
 * @project ocs-answer-hub
 * @module repositories
 * @description AI 配置密文持久化。
 * @logic 按优先级分页，提供配置生命周期及排序原子写入。
 * @dependencies pg
 * @index_tags ai, repository
 * @author holic512
 */
import type pg from 'pg';
import type {Pagination} from './users.js';
export type ProviderInput={name:string;kind:'ai';enabled:boolean;priority:number;timeout_ms:number;config:Record<string,unknown>};
export type ProviderRow=Omit<ProviderInput,'config'>&{id:string;config_cipher:string;created_at:Date};
export class AiRepository {
 constructor(private db:pg.Pool|pg.PoolClient){}
 async list(p:Pagination){const [items,total]=await Promise.all([this.db.query<ProviderRow>('SELECT * FROM providers ORDER BY priority,created_at LIMIT $1 OFFSET $2',[p.pageSize,(p.page-1)*p.pageSize]),this.db.query<{total:number}>('SELECT count(*)::int total FROM providers')]);return {items:items.rows,total:total.rows[0].total,...p};}
 async find(id:string){return (await this.db.query<ProviderRow>('SELECT * FROM providers WHERE id=$1',[id])).rows[0];}
 async create(data:ProviderInput,cipher:string){return (await this.db.query<{id:string}>("INSERT INTO providers(name,kind,enabled,priority,timeout_ms,config_cipher) VALUES($1,'ai',$2,$3,$4,$5) RETURNING id",[data.name,data.enabled,data.priority,data.timeout_ms,cipher])).rows[0];}
 async update(id:string,data:ProviderInput,cipher:string){await this.db.query('UPDATE providers SET name=$2,enabled=$3,priority=$4,timeout_ms=$5,config_cipher=$6 WHERE id=$1',[id,data.name,data.enabled,data.priority,data.timeout_ms,cipher]);}
 async remove(id:string){return Boolean((await this.db.query('DELETE FROM providers WHERE id=$1 RETURNING id',[id])).rowCount);}
 async reorder(ids:string[]){for(const [index,id] of ids.entries())await this.db.query('UPDATE providers SET priority=$2 WHERE id=$1',[id,index+1]);}
}
