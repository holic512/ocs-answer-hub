import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import type {HTTPMethods} from 'fastify';
import {buildApp,type AppConfig} from '../../server/app.js';
import {createTestDatabase} from './test-database.js';
export async function workspace(options:Partial<AppConfig>={}){
 const database=await createTestDatabase(),stateDir=await fs.mkdtemp(path.join(os.tmpdir(),'ocs-workspace-')),origin='http://localhost';
 let built:Awaited<ReturnType<typeof buildApp>>;
 try{built=await buildApp({databaseUrl:database.url,stateDir,origin,test:true,...options});}catch(e){await fs.rm(stateDir,{recursive:true,force:true});await database.close();throw e;}
 const {app,pool}=built;
 const setup=await app.inject({method:'POST',url:'/api/setup',headers:{origin},payload:{username:'owner',password:'password888',confirmPassword:'password888'}});assert.equal(setup.statusCode,201,setup.body);
 const login=async(username='owner',password='password888')=>{const r=await app.inject({method:'POST',url:'/api/login',headers:{origin},payload:{username,password}});assert.equal(r.statusCode,200,r.body);return {origin,cookie:r.headers['set-cookie']!.toString().split(';')[0],'x-csrf-token':r.json().csrf};};
 const headers=await login();
 const request=(method:HTTPMethods,url:string,payload?:unknown,identity=headers)=>app.inject({method,url,headers:identity,...(payload===undefined?{}:{payload})});
 const token=async(user_id?:number,daily_limit=2000,rpm=60)=>{const r=await request('POST','/api/admin/tokens',{name:'Test credential',daily_limit,rpm,...(user_id?{user_id}:{})});assert.equal(r.statusCode,201,r.body);return r.json() as {id:string;token:string;config:unknown};};
 const signup=async(username:string)=>{const r=await request('POST','/api/register',{username,password:'password888',confirmPassword:'password888'});assert.equal(r.statusCode,201,r.body);return {id:r.json().id as number,headers:await login(username)};};
 const close=async()=>{await app.close();await fs.rm(stateDir,{recursive:true,force:true});await database.close();};
 return {...built,database,stateDir,origin,headers,login,request,token,signup,close};
}
