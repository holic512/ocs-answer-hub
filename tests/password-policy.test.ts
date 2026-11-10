import test from 'node:test';
import assert from 'node:assert/strict';
import {workspace} from './support/workspace.js';

test('registration and administrator reset accept eight characters without symbol requirements',async t=>{
 for(const method of ['info','warn','error'] as const)t.mock.method(console,method,()=>{});
 const w=await workspace();
 try{
  const register=(password:string,confirmPassword=password)=>w.request('POST','/api/register',{username:'eight-char-user',password,confirmPassword});
  assert.equal((await register('1234567')).statusCode,400);
  assert.equal((await register('12345678','87654321')).statusCode,400);
  const created=await register('12345678');assert.equal(created.statusCode,201,created.body);
  assert.equal((await w.pool.query('SELECT must_change FROM users WHERE id=$1',[created.json().id])).rows[0].must_change,false);
  const reset=await w.request('POST',`/api/admin/users/${created.json().id}/password`,{password:'abcdefgh'});assert.equal(reset.statusCode,200,reset.body);
  const user=await w.login('eight-char-user','abcdefgh');assert.equal((await w.request('GET','/api/admin/me',undefined,user)).json().mustChange,true);
 }finally{await w.close();}
});
test('password change enforces eight characters and invalidates existing sessions',async t=>{
 for(const method of ['info','warn','error'] as const)t.mock.method(console,method,()=>{});
 const w=await workspace();
 try{
  assert.equal((await w.request('POST','/api/admin/password',{oldPassword:'password888',newPassword:'short77'})).statusCode,400);
  const changed=await w.request('POST','/api/admin/password',{oldPassword:'password888',newPassword:'abcdefgh'});assert.equal(changed.statusCode,200,changed.body);
  assert.equal((await w.request('GET','/api/admin/me')).statusCode,401);
  await w.login('owner','abcdefgh');
 }finally{await w.close();}
});
