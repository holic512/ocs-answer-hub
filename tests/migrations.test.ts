import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
import {databaseUrl} from '../server/config.js';
import {createPool,createOrm,migrate} from '../server/db.js';
import {assertTestDatabaseUrl} from './support/test-database.js';
// 单独执行，避免与会重建同一 schema 的集成测试并发。
const enabled=process.env.MIGRATION_TEST==='1';
test('Prisma initializes, repeats safely, adopts legacy schema and preserves data',{skip:!enabled,timeout:120000},async()=>{
 const url=assertTestDatabaseUrl(databaseUrl(process.env,true),databaseUrl(),process.env.TEST_DATABASE_RESET);
 const pool=createPool(url);
 try{
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await migrate(pool);await migrate(pool);
  const orm=createOrm(pool);
  const row=await orm.providers.create({data:{name:'迁移保留夹具',kind:'http',priority:1,config_cipher:'fixture'}});
  assert.equal((await orm.providers.findUniqueOrThrow({where:{id:row.id}})).name,'迁移保留夹具');await orm.$disconnect();
  assert.equal(Number((await pool.query('SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')).rows[0].count),1);
  // 模拟原系统数据库：原迁移标记和表保留，尚未接入 Prisma。
  await pool.query('DROP TABLE _prisma_migrations');
  await pool.query('CREATE INDEX IF NOT EXISTS question_trgm_idx ON questions USING gin(normal_title gin_trgm_ops)');
  await migrate(pool);await migrate(pool);
  assert.equal((await pool.query('SELECT name FROM providers WHERE id=$1',[row.id])).rows[0].name,'迁移保留夹具');
  assert.equal(Number((await pool.query('SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')).rows[0].count),1);
  await pool.query('DROP TABLE _prisma_migrations; DROP INDEX question_trgm_idx; DROP EXTENSION pg_trgm');
  await migrate(pool);
  // 在独立临时迁移目录中模拟下一版本，避免改动仓库迁移历史。
  const fixture=await fs.mkdtemp(path.join(os.tmpdir(),'hub-migration-'));
  try{
   await fs.cp('prisma',path.join(fixture,'prisma'),{recursive:true});
   await fs.symlink(path.resolve('node_modules'),path.join(fixture,'node_modules'),'dir');
   await fs.mkdir(path.join(fixture,'prisma/migrations/20261030000001_fixture'));
   await fs.writeFile(path.join(fixture,'prisma/migrations/20261030000001_fixture/migration.sql'),'ALTER TABLE settings ADD COLUMN migration_fixture text;');
   await fs.writeFile(path.join(fixture,'prisma.config.ts'),`import {defineConfig} from 'prisma/config';export default defineConfig({schema:'prisma/schema.prisma',migrations:{path:'prisma/migrations'},datasource:{url:process.env.PRISMA_DATABASE_URL}});`);
   const deploy=()=>execute(process.execPath,[path.resolve('node_modules/prisma/build/index.js'),'migrate','deploy'],{cwd:fixture,env:{...process.env,PRISMA_DATABASE_URL:url}});
   await deploy();await deploy();
   assert.equal(Number((await pool.query('SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')).rows[0].count),2);
   await pool.query('SELECT migration_fixture FROM settings');
   assert.equal((await pool.query('SELECT name FROM providers WHERE id=$1',[row.id])).rows[0].name,'迁移保留夹具');
  }finally{await fs.rm(fixture,{recursive:true,force:true});}
 }finally{await pool.end();}
});
