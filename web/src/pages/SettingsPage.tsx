/**
 * @file SettingsPage.tsx
 * @project ocs-answer-hub
 * @module 账号安全
 * @description 自助密码变更与首次登录改密。
 * @logic 校验当前和新密码，保存成功后清理会话并重新登录。
 * @dependencies react-hook-form, zod, context/app, components/ui
 * @index_tags settings, password
 * @author holic512
 */
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {Button} from '../components/ui/button';
import {Input} from '../components/ui/input';
import {FormField,FormActions} from '../components/ui/form';
import {Feedback} from '../components/ui/alert';
import {Heading} from '../components/workspace';
import {api} from '../lib/api';
import {useAction} from '../hooks/use-resource';
import {useApp} from '../context/app';
const schema=z.object({oldPassword:z.string().min(1,'请输入当前密码'),newPassword:z.string().min(8,'新密码至少8位').max(128),confirm:z.string()}).refine(v=>v.newPassword===v.confirm,{message:'两次新密码不一致',path:['confirm']});
export default function SettingsPage(){const {user,endSession,notify}=useApp(),action=useAction(),form=useForm({resolver:zodResolver(schema),defaultValues:{oldPassword:'',newPassword:'',confirm:''}});return <><Heading title="账号安全" desc={user?.mustChange?'首次登录需要设置新密码。':'修改密码会使所有现有登录会话失效。'}/><section className="card password-card"><h2>修改密码</h2><form onSubmit={form.handleSubmit(data=>action.execute(async()=>{await api('/admin/password','POST',{oldPassword:data.oldPassword,newPassword:data.newPassword});endSession();notify('密码已更新，请重新登录');}))} noValidate><FormField label="当前密码" error={form.formState.errors.oldPassword?.message}><Input type="password" autoComplete="current-password" {...form.register('oldPassword')}/></FormField><FormField label="新密码" hint="8至128位，支持长密码。" error={form.formState.errors.newPassword?.message}><Input type="password" autoComplete="new-password" {...form.register('newPassword')}/></FormField><FormField label="确认新密码" error={form.formState.errors.confirm?.message}><Input type="password" autoComplete="new-password" {...form.register('confirm')}/></FormField><Feedback error={action.error}/><FormActions><Button variant="default" disabled={action.pending}>{action.pending?'更新中…':'更新密码并重新登录'}</Button></FormActions></form></section></>;}
