/**
 * @file InitialSetup.tsx
 * @project ocs-answer-hub
 * @module 首次初始化
 * @description 在认证布局中展示首次账号设置，完成后进入登录页。
 * @logic 用户设置账号和密码、确认密码、提交一次性初始化、处理已有账号状态。
 * @dependencies React, components/ui, /api/setup
 * @index_tags setup, admin, onboarding
 * @author holic512
 */
import {useState, type FormEvent} from 'react';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';

type Props={api:(url:string,method?:string,body?:unknown)=>Promise<any>;onComplete:(username?:string)=>Promise<void>};
export default function InitialSetup({api,onComplete}:Props){
 const[pending,setPending]=useState(false),[error,setError]=useState('');
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setError('');
  const data=Object.fromEntries(new FormData(event.currentTarget));
  if(!String(data.username).trim()){setError('请输入管理员账号');return;}
  if(data.password!==data.confirmPassword){setError('两次密码不一致，请重新确认');return;}
  setPending(true);
  try{const result=await api('/setup','POST',data);await onComplete(result.username);}
  catch(error:any){if(error.status===409)await onComplete();else setError(error.message);}
  finally{setPending(false);}
 }
 return <section aria-labelledby="setup-title">
   <h1 id="setup-title">初始化管理员</h1>
   <p className="muted">当前数据库尚无管理员，请设置账号和密码。</p>
   <form onSubmit={submit}>
    <label className="field"><span>管理员账号</span><Input name="username" autoComplete="username" maxLength={100} placeholder="设置管理员账号" required autoFocus disabled={pending}/></label>
    <label className="field"><span>管理员密码</span><Input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} aria-describedby="setup-password-hint" required disabled={pending}/><small id="setup-password-hint">至少 8 个字符，无需特殊符号。</small></label>
    <label className="field"><span>确认密码</span><Input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={pending}/></label>
    {error&&<div className="error" role="alert">{error}</div>}
    <Button className="primary full" disabled={pending}>{pending?'正在创建管理员…':'创建管理员并进入登录'}</Button>
   </form>
   <p className="secure-note">仅首次使用需要设置，已有管理员后将关闭此入口。</p>
 </section>;
}
