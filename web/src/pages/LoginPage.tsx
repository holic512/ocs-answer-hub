/**
 * @file LoginPage.tsx
 * @project ocs-answer-hub
 * @module 用户认证
 * @description 登录、开放注册和密码重置说明。
 * @logic 按系统设置开放注册；成功后进入登录页，保留认证目标页面。
 * @dependencies react-hook-form, zod, react-router, context/app
 * @index_tags auth, registration, form
 * @author holic512
 */
import {useState} from 'react';
import {Link,useLocation,useNavigate} from 'react-router';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {Button} from '../components/ui/button';
import {Input} from '../components/ui/input';
import {FormField} from '../components/ui/form';
import {Feedback} from '../components/ui/alert';
import {useApp} from '../context/app';
import {useAction} from '../hooks/use-resource';
import {api} from '../lib/api';
const schema=z.object({username:z.string().trim().min(1,'请输入用户名').max(100),password:z.string().min(8,'密码至少8位').max(128),confirmPassword:z.string().optional()});
type Values=z.infer<typeof schema>;
export default function LoginPage({registerMode=false}:{registerMode?:boolean}){
 const {login,loginName,setup}=useApp(),action=useAction(),location=useLocation(),navigate=useNavigate();const [help,setHelp]=useState(false);
 const form=useForm<Values>({resolver:zodResolver(schema),defaultValues:{username:registerMode?'':loginName,password:'',confirmPassword:''}});
 async function submit(data:Values){if(registerMode&&data.password!==data.confirmPassword){form.setError('confirmPassword',{message:'两次密码不一致'});return;}await action.execute(async()=>{if(registerMode){await api('/register','POST',data);navigate('/login',{replace:true,state:{registered:true}});}else{const current=await login(data);navigate(current.mustChange?'/settings':location.state?.from??'/query',{replace:true});}});}
 if(registerMode&&!setup.registrationEnabled)return <><h1>注册暂未开放</h1><p className="muted">请联系管理员创建账号。</p><Button asChild variant="outline"><Link to="/login">返回登录</Link></Button></>;
 return <><h1>{registerMode?'创建知序账号':'登录知序'}</h1><p className="muted">{registerMode?`注册即可获得 ${setup.registrationCredits??20} 积分，成功查题每次使用 1 积分。`:'使用你的账号进入题库工作台。'}</p>{location.state?.registered&&<Feedback message="注册成功，请使用新账号登录。"/>}<form onSubmit={form.handleSubmit(submit)} noValidate><FormField label="用户名" error={form.formState.errors.username?.message}><Input {...form.register('username')} autoComplete="username"/></FormField><FormField label="密码" error={form.formState.errors.password?.message}><Input type="password" {...form.register('password')} autoComplete={registerMode?'new-password':'current-password'}/></FormField>{registerMode&&<FormField label="确认密码" error={form.formState.errors.confirmPassword?.message}><Input type="password" {...form.register('confirmPassword')} autoComplete="new-password"/></FormField>}<Feedback error={action.error}/><Button variant="default" className="full" disabled={action.pending}>{action.pending?'正在处理…':registerMode?'注册账号':'登录'}</Button></form><div className="auth-links">{registerMode?<Link to="/login">已有账号，返回登录</Link>:<>{setup.registrationEnabled&&<Link to="/register">注册账号</Link>}<Button size="sm" onClick={()=>setHelp(!help)}>忘记密码</Button></>}</div>{help&&<p className="inline-note">请联系管理员重置密码。重置后首次登录需设置新密码。</p>}</>;
}
