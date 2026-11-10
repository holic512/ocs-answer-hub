import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {createPool,migrate} from '../server/db.js';import {createTestDatabase} from './support/test-database.js';
test('legacy upgrade preserves users, credentials, questions, AI and history, removes retired data and grants once',{timeout:120000},async()=>{
 const database=await createTestDatabase(),p=createPool(database.url);
 try{
  await p.query(await fs.readFile('prisma/migrations/20261030000000_initial/migration.sql','utf8'));
  await p.query("INSERT INTO administrators VALUES(1,'legacy','original-hash',false,now()); INSERT INTO sessions(hash,csrf,expires_at) VALUES('old-session','old-csrf',now()+interval '1 day'); INSERT INTO providers(name,kind,priority,config_cipher) VALUES('AI','ai',1,'original-cipher'),('retired','http',2,'retired-cipher'); INSERT INTO api_tokens(name,hash,prefix,day_count) VALUES('old-token','original-token-hash','prefix',7); INSERT INTO questions(fingerprint,title,normal_title,type,answer,source,verified,conflict) VALUES('f','保留题目','保留题目','judgement','正确','old',false,true); INSERT INTO answer_versions(question_id,answer,source) SELECT id,answer,source FROM questions; INSERT INTO query_events(token_id,title,status,duration_ms) SELECT id,'保留查询','hit',10 FROM api_tokens;");
  await migrate(p);await migrate(p);
  const user=(await p.query('SELECT * FROM users')).rows[0];assert.equal(user.id,1);assert.equal(user.username,'legacy');assert.equal(user.password_hash,'original-hash');assert.equal(user.role,'admin');assert.equal(user.balance,20);assert.equal(user.frozen,0);for(const field of ['daily_limit','rpm','day_count'])assert(!(field in user));
  assert.equal((await p.query('SELECT count(*)::int n FROM credit_ledger')).rows[0].n,1);
  const token=(await p.query('SELECT * FROM api_tokens')).rows[0];assert.equal(token.hash,'original-token-hash');assert.equal(token.day_count,7);assert.equal(token.user_id,1);
  const question=(await p.query('SELECT * FROM questions')).rows[0];assert.equal(question.answer,'正确');for(const field of ['source','verified','conflict'])assert(!(field in question));
  assert.equal((await p.query('SELECT * FROM answer_versions')).rows[0].answer,'正确');
  const event=(await p.query('SELECT * FROM query_events')).rows[0];assert.equal(event.title,'保留查询');assert.equal(event.token_name,'old-token');assert.equal(event.token_prefix,'prefix');assert.equal(event.billing_status,'none');
  const ai=(await p.query('SELECT * FROM providers')).rows;assert.equal(ai.length,1);assert.equal(ai[0].config_cipher,'original-cipher');
  await assert.rejects(p.query("INSERT INTO providers(name,kind,priority,config_cipher) VALUES('blocked','http',1,'x')"),{code:'23514'});
  assert.equal((await p.query("SELECT format_type(atttypid,atttypmod) t FROM pg_attribute WHERE attrelid='question_vectors'::regclass AND attname='embedding'")).rows[0].t,'vector(512)');
  assert.equal((await p.query('SELECT count(*)::int n FROM task_schedules WHERE enabled')).rows[0].n,1);
  const next=(await p.query("INSERT INTO users(username,password_hash) VALUES('next','hash') RETURNING id")).rows[0];assert.equal(next.id,2);
 }finally{await p.end();await database.close();}
});
