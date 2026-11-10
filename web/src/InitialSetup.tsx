import type {api as request} from './lib/api';
import type {ApiError} from '../../shared/api-types';
/**
 * @file InitialSetup.tsx
 * @project ocs-answer-hub
 * @module 首次初始化
 * @description 设置首次管理员账号与密码，完成后进入登录页。
 * @logic 表单确认密码后提交一次性初始化，兼容其他会话已完成初始化的结果。
 * @dependencies react-hook-form, zod, components/ui
 * @index_tags setup, admin, form
 * @author holic512
 */
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {FormField} from './components/ui/form';
import {Feedback} from './components/ui/alert';
import {useAction} from './hooks/use-resource';
type Props={api:typeof request;onComplete:(username?:string)=>Promise<void>};
const schema=z.object({username:z.string().trim().min(1,'请输入管理员账号').max(100),password:z.string().min(8,'密码至少8位').max(128),confirmPassword:z.string()}).refine(d=>d.password===d.confirmPassword,{message:'两次密码不一致',path:['confirmPassword']});
export default function InitialSetup({api,onComplete}:Props){
 const action=useAction(),form=useForm({resolver:zodResolver(schema),defaultValues:{username:'',password:'',confirmPassword:''}});
 return <section aria-labelledby="setup-title"><h1 id="setup-title">初始化管理员</h1><p className="muted">首次使用，请设置管理员账号和密码。</p><form onSubmit={form.handleSubmit(data=>action.execute(async()=>{try{const result=await api<{username:string}>('/setup','POST',data);await onComplete(result.username);}catch(e){if((e as ApiError).status===409)await onComplete();else throw e;}}))} noValidate><FormField label="管理员账号" error={form.formState.errors.username?.message}><Input autoComplete="username" autoFocus {...form.register('username')}/></FormField><FormField label="管理员密码" hint="8至128位，支持长密码。" error={form.formState.errors.password?.message}><Input type="password" autoComplete="new-password" {...form.register('password')}/></FormField><FormField label="确认密码" error={form.formState.errors.confirmPassword?.message}><Input type="password" autoComplete="new-password" {...form.register('confirmPassword')}/></FormField><Feedback error={action.error}/><Button variant="default" className="full" disabled={action.pending}>{action.pending?'正在创建管理员…':'创建管理员并进入登录'}</Button></form><p className="secure-note">已有管理员后，此入口自动关闭。</p></section>;
}
