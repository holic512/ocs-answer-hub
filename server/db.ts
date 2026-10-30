/**
 * @file db.ts
 * @project ocs-answer-hub
 * @module 数据库
 * @description 共用 PostgreSQL 连接池与 Prisma ORM，启动前执行版本迁移。
 * @logic 识别并校验旧版基线，执行待应用迁移，保留 PostgreSQL 专用查询能力。
 * @dependencies pg, @prisma/client, @prisma/adapter-pg, prisma
 * @index_tags database, orm, migration
 * @author holic512
 */
import pg from 'pg';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const execute=promisify(execFile);
const parent=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=existsSync(path.join(parent,'prisma'))?parent:path.dirname(parent);
const cli=createRequire(import.meta.url).resolve('prisma/build/index.js');
const baseline='20261030000000_initial';
export function createPool(url:string){return new pg.Pool({connectionString:url,max:12,connectionTimeoutMillis:5000,idleTimeoutMillis:15000,statement_timeout:8000});}
export function createOrm(pool:pg.Pool){return new PrismaClient({adapter:new PrismaPg(pool,{disposeExternalPool:false})});}
export async function migrate(pool:pg.Pool){
 const connection=await pool.connect();
 try{
  await connection.query('SELECT pg_advisory_lock(764002)');
  const state=(await connection.query("SELECT to_regclass('public._prisma_migrations') AS prisma, to_regclass('public.schema_migrations') AS legacy")).rows[0];
  if(!state.prisma&&state.legacy){
   const legacy=await connection.query("SELECT version FROM schema_migrations WHERE version='001-initial'");
   if(!legacy.rowCount)throw new Error('无法识别旧数据库版本，请先核对结构并手动建立迁移基线');
   // 只接管旧系统完整结构，结构不一致时停止，不把未知表结构标记为已迁移。
   const diff=await runPrisma(pool,['migrate','diff','--from-config-datasource','--to-schema','prisma/baseline.prisma','--script']);
   // 旧库未安装 pg_trgm 时可能没有此可选索引，只忽略该索引的创建差异。
   const changes=diff.replace(/--[^\n]*/g,'').replace(/CREATE INDEX "question_trgm_idx" ON (?:"public"\.)?"questions" USING GIN \("normal_title" gin_trgm_ops\);/g,'').trim();
   if(changes)throw new Error('旧数据库结构与 1.0.0 基线不一致，请核对后再迁移；未修改现有表');
   await runPrisma(pool,['migrate','resolve','--applied',baseline]);
  }
  await runPrisma(pool,['migrate','deploy']);
 }finally{await connection.query('SELECT pg_advisory_unlock(764002)');connection.release();}
}
async function runPrisma(pool:pg.Pool,args:string[]){
 try{const result=await execute(process.execPath,[cli,...args],{cwd:root,env:{...process.env,PRISMA_DATABASE_URL:pool.options.connectionString},maxBuffer:1024*1024});return result.stdout;}
 catch(error:any){throw new Error(`数据库版本迁移失败（${args.slice(0,2).join(' ')}），请运行 npm run db:status 检查；未启动服务。`,{cause:error});}
}
