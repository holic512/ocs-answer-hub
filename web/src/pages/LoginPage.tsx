/**
 * @file LoginPage.tsx
 * @project ocs-answer-hub
 * @module 管理员登录
 * @description 登录表单与目标页面恢复。
 * @logic 登录后跳转原目标路由，需要改密的旧账号先进入安全设置。
 * @dependencies react-router, context/app, components/ui
 * @index_tags login, auth
 * @author holic512
 */
import { useLocation,useNavigate } from 'react-router';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Field,Icon } from '../components/workspace';
import { useApp } from '../context/app';
export default function LoginPage(){
 const {login,run,busy,error,loginName}=useApp();const location=useLocation(),navigate=useNavigate();
 return <><h1>登录知序</h1><p className="muted">仅限管理员访问，无开放注册。</p><form onSubmit={event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));void run(async()=>{const user=await login(data);navigate(user.mustChange?'/settings':location.state?.from??'/overview',{replace:true});});}}>
  <Field label="管理员账号"><Input name="username" autoComplete="username" required defaultValue={loginName}/></Field>
  <Field label="密码"><Input name="password" type="password" autoComplete="current-password" required/></Field>
  {error&&<div className="error" role="alert">{error}</div>}<Button className="primary full" disabled={busy}>{busy?'登录中…':'进入管理后台'}<Icon name="arrow" size={16}/></Button>
 </form></>;
}
