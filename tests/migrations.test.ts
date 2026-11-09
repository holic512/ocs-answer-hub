import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {createPool,migrate} from '../server/db.js';import {createTestDatabase} from './support/test-database.js';
test('fresh migrations repeat safely; legacy upgrade preserves every original table and credential',{timeout:120000},async()=>{
 const database=await createTestDatabase();const p=createPool(database.url);
 try{
  // Only this disposable database receives the original published schema fixture.
  await p.query(await fs.readFile('prisma/migrations/20261030000000_initial/migration.sql','utf8'));
  await p.query("INSERT INTO administrators VALUES(1,'legacy','original-hash',false,now()); INSERT INTO sessions(hash,csrf,expires_at) VALUES('old-session','old-csrf',now()+interval '1 day'); INSERT INTO providers(name,kind,priority,config_cipher) VALUES('source','ai',1,'old-cipher'); INSERT INTO api_tokens(name,hash,prefix,day_count) VALUES('old-token','original-token-hash','prefix',7); INSERT INTO questions(fingerprint,title,normal_title,type,answer,source) VALUES('f','保留题目','保留题目','judgement','正确','old'); INSERT INTO answer_versions(question_id,answer,source) SELECT id,answer,source FROM questions; INSERT INTO query_events(token_id,title,status,duration_ms) SELECT id,'保留查询','hit',10 FROM api_tokens; UPDATE settings SET value='{\"legacy\":true}';");
  const tables=['administrators','sessions','providers','api_tokens','questions','answer_versions','query_events','settings'];
  const before=new Map<string,any[]>();for(const table of tables)before.set(table,(await p.query(`SELECT * FROM ${table} ORDER BY 1`)).rows);
  await migrate(p);await migrate(p);
  for(const table of tables){const after=(await p.query(`SELECT * FROM ${table} ORDER BY 1`)).rows;for(const [i,row] of before.get(table)!.entries())for(const [key,value]of Object.entries(row))assert.deepEqual(after[i][key],value,`${table}.${key}`);}
  const admin=(await p.query('SELECT * FROM administrators')).rows[0];assert.equal(admin.role,'admin');assert.equal(admin.day_count,7);
  assert.equal((await p.query('SELECT user_id FROM api_tokens')).rows[0].user_id,1);assert.equal((await p.query('SELECT user_id FROM sessions')).rows[0].user_id,1);
  assert.equal((await p.query('SELECT user_id FROM query_events')).rows[0].user_id,1);
  assert.equal((await p.query('SELECT count(*)::int n FROM _prisma_migrations WHERE finished_at IS NOT NULL')).rows[0].n,4);
  const historical=(await p.query('SELECT fingerprint,question_snapshot,request_id,query_id,failure_code FROM query_events')).rows[0];assert.deepEqual(historical,{fingerprint:null,question_snapshot:null,request_id:null,query_id:null,failure_code:null});
  assert.equal((await p.query("SELECT format_type(atttypid,atttypmod) t FROM pg_attribute WHERE attrelid='question_vectors'::regclass AND attname='embedding'")).rows[0].t,'vector(512)');
  assert.equal((await p.query("INSERT INTO administrators(username,password_hash) VALUES('next','hash') RETURNING id")).rows[0].id,2);
 }finally{await p.end();await database.close();}
});
