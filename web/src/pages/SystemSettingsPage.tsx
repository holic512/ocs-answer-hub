/**
 * @file SystemSettingsPage.tsx
 * @project ocs-answer-hub
 * @module 系统配置
 * @description 注册、赠送积分及个人凭证限额默认值和上限设置。
 * @logic 服务端数据初始化表单，保存时统一校验默认值不超过上限。
 * @dependencies react-hook-form, zod, hooks/use-resource, components/ui
 * @index_tags settings, registration, quota
 * @author holic512
 */
import {Controller,useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {Heading} from '../components/workspace';
import {Button} from '../components/ui/button';
import {Input} from '../components/ui/input';
import {Switch} from '../components/ui/switch';
import {FormField,FormActions} from '../components/ui/form';
import {Feedback} from '../components/ui/alert';
import {useResource,useAction} from '../hooks/use-resource';
import {api} from '../lib/api';
const schema=z.object({registrationEnabled:z.boolean(),registrationCredits:z.number().int().min(0).max(1000000),tokenDailyDefault:z.number().int().min(1).max(100000),tokenRpmDefault:z.number().int().min(1).max(600),tokenDailyMax:z.number().int().min(1).max(100000),tokenRpmMax:z.number().int().min(1).max(600)}).refine(d=>d.tokenDailyDefault<=d.tokenDailyMax,{message:'默认每日限额不能超过上限',path:['tokenDailyDefault']}).refine(d=>d.tokenRpmDefault<=d.tokenRpmMax,{message:'默认频率不能超过上限',path:['tokenRpmDefault']});
type Values=z.infer<typeof schema>;
export default function SystemSettingsPage(){const resource=useResource<Values>('/admin/settings');return <><Heading title="系统设置" desc="管理注册入口、积分赠送和用户可设置的凭证限额。"/><Feedback error={resource.error} loading={resource.loading}/>{resource.data&&<SettingsForm initial={resource.data}/>}</>;}
function SettingsForm({initial}:{initial:Values}){const action=useAction(),form=useForm<Values>({resolver:zodResolver(schema),defaultValues:initial});return <form className="settings-form" onSubmit={form.handleSubmit(data=>action.execute(()=>api('/admin/settings','PUT',data),'系统设置已保存'))} noValidate><section className="settings-section"><div><h2>用户注册</h2><p>注册成功后赠送积分，已有用户的余额不受设置变更影响。</p></div><div><div className="setting-row"><strong>开放账号注册</strong><Controller name="registrationEnabled" control={form.control} render={({field})=><Switch aria-label="开放注册" checked={field.value} onCheckedChange={field.onChange}/>}/></div><FormField label="注册赠送积分" error={form.formState.errors.registrationCredits?.message}><Input type="number" min={0} max={1000000} {...form.register('registrationCredits',{valueAsNumber:true})}/></FormField></div></section><section className="settings-section"><div><h2>调用凭证</h2><p>限额归属于凭证。用户可在系统上限内调低额度，管理员可单独调整。</p></div><div className="form-grid">{([['tokenDailyDefault','默认每日上限',100000],['tokenDailyMax','用户每日上限',100000],['tokenRpmDefault','默认每分钟上限',600],['tokenRpmMax','用户每分钟上限',600]] as const).map(([name,label,max])=><FormField key={name} label={label} error={form.formState.errors[name]?.message}><Input type="number" min={1} max={max} {...form.register(name,{valueAsNumber:true})}/></FormField>)}</div></section><Feedback error={action.error} message={action.message}/><FormActions><Button variant="default" disabled={action.pending}>{action.pending?'保存中…':'保存系统设置'}</Button></FormActions></form>;}
