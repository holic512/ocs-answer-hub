import type {Page} from '../../../shared/contracts';
import type {User} from '../../../shared/api-types';
/**
 * @file UsersPage.tsx
 * @project ocs-answer-hub
 * @module 用户管理
 * @description 分页账号管理、详情、积分调账与凭证代管。
 * @logic 用户表与编辑表单分离，详情页按标签加载积分和凭证，危险操作需确认。
 * @dependencies react-hook-form, zod, hooks/use-resource, components/ui
 * @index_tags users, crud, credits, admin
 * @author holic512
 */
import {useState} from 'react';
import {Controller,useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {Plus,Search} from 'lucide-react';
import {api} from '../lib/api';
import {useApp} from '../context/app';
import {useResource,useAction} from '../hooks/use-resource';
import {Heading} from '../components/workspace';
import {Button} from '../components/ui/button';
import {Input,Textarea} from '../components/ui/input';
import {Select} from '../components/ui/select';
import {Badge} from '../components/ui/badge';
import {DataTable} from '../components/ui/data-table';
import {Sheet} from '../components/ui/sheet';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '../components/ui/tabs';
import {FormField,FormActions} from '../components/ui/form';
import {Feedback} from '../components/ui/alert';
import {CreditLedger} from './CreditsPage';
import {TokenManager} from './TokensPage';
import {date} from '../lib/format';
const schema=z.object({username:z.string().trim().min(1,'请输入用户名').max(100),role:z.enum(['user','admin']),disabled:z.boolean(),password:z.string()});
type Values=z.infer<typeof schema>;
export default function UsersPage(){
 const {confirm,user}=useApp(),action=useAction();const [page,setPage]=useState(1),[q,setQ]=useState(''),[role,setRole]=useState('all'),[status,setStatus]=useState('all'),[edit,setEdit]=useState<Partial<User>|null>(null),[detail,setDetail]=useState<User|null>(null),[reset,setReset]=useState<User|null>(null),[adjust,setAdjust]=useState<User|null>(null),[detailVersion,setDetailVersion]=useState(0);
 const resource=useResource<Page<User>>(`/admin/users?page=${page}&q=${encodeURIComponent(q)}&role=${role}&status=${status}`);
 async function remove(row:User){if(!await confirm(`删除用户「${row.username}」？该用户将退出登录，其凭证立即失效，历史账本仍保留。`))return;await action.execute(async()=>{await api(`/admin/users/${row.id}`,'DELETE');await resource.reload();},'用户已删除');}
 return <><Heading title="用户管理" desc="管理账号、角色、积分与调用凭证。"><Button variant="default" onClick={()=>setEdit({})}><Plus size={16}/>创建用户</Button></Heading><section className="card table-card"><form className="toolbar" onSubmit={e=>{e.preventDefault();setQ(String(new FormData(e.currentTarget).get('q')??''));setPage(1);}}><Input name="q" aria-label="搜索用户" placeholder="搜索用户名" className="search-input"/><Select aria-label="用户角色" value={role} onChange={e=>{setRole(e.target.value);setPage(1);}}><option value="all">全部角色</option><option value="user">普通用户</option><option value="admin">管理员</option></Select><Select aria-label="账号状态" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="all">全部状态</option><option value="active">正常账号</option><option value="disabled">已禁用</option></Select><Button variant="outline"><Search size={15}/>搜索</Button></form><Feedback error={resource.error||action.error} message={action.message}/><DataTable data={resource.data?.items??[]} loading={resource.loading} total={resource.data?.total??0} page={page} pageSize={resource.data?.pageSize??30} onPageChange={setPage} columns={[
 {accessorKey:'id',header:'ID',size:60},
 {accessorKey:'username',header:'用户',cell:({row})=><Button className="table-link" onClick={()=>setDetail(row.original)}>{row.original.username}</Button>},
 {accessorKey:'role',header:'角色',cell:({row})=><Badge tone="gray">{row.original.role==='admin'?'管理员':'普通用户'}</Badge>},
 {accessorKey:'disabled',header:'状态',cell:({row})=><Badge tone={row.original.disabled?'gray':'green'}>{row.original.disabled?'已禁用':row.original.must_change?'待修改密码':'正常'}</Badge>},
 {accessorKey:'balance',header:'积分余额',cell:({row})=>row.original.balance},
 {accessorKey:'created_at',header:'创建时间',cell:({row})=>date(row.original.created_at)},
 {id:'actions',header:'操作',cell:({row})=><div className="row-actions"><Button size="sm" onClick={()=>setDetail(row.original)}>详情</Button><Button size="sm" onClick={()=>setEdit(row.original)}>编辑</Button><Button size="sm" onClick={()=>setAdjust(row.original)}>调分</Button><Button size="sm" onClick={()=>setReset(row.original)}>重置密码</Button><Button size="sm" disabled={row.original.id===user?.id||action.pending} className="danger-text" onClick={()=>remove(row.original)}>删除</Button></div>}
 ]}/></section>{edit&&<Sheet title={edit.id?'编辑用户':'创建用户'} onClose={()=>setEdit(null)}><UserForm item={edit} onCancel={()=>setEdit(null)} onSave={async(data)=>{await api(edit.id?`/admin/users/${edit.id}`:'/admin/users',edit.id?'PUT':'POST',data);await resource.reload();setEdit(null);}}/></Sheet>}{detail&&<Sheet title={detail.username} description="用户详情、积分账本与调用凭证" wide onClose={()=>setDetail(null)}><UserDetail key={`${detail.id}-${detailVersion}`} userId={detail.id} onAdjust={()=>setAdjust(detail)}/></Sheet>}{reset&&<Sheet title={`重置 ${reset.username} 的密码`} onClose={()=>setReset(null)}><PasswordReset userId={reset.id} onDone={async()=>{setReset(null);await resource.reload();}}/></Sheet>}{adjust&&<Sheet title={`调整 ${adjust.username} 的积分`} onClose={()=>setAdjust(null)}><CreditAdjustment userId={adjust.id} onDone={async()=>{setAdjust(null);setDetailVersion(x=>x+1);await resource.reload();}}/></Sheet>}</>;
}
function UserForm({item,onSave,onCancel}:{item:Partial<User>;onSave:(data:Omit<Values,'password'>&{password?:string})=>Promise<void>;onCancel:()=>void}){
 const action=useAction(),form=useForm<Values>({resolver:zodResolver(schema),defaultValues:{username:item.username??'',role:item.role??'user',disabled:item.disabled??false,password:''}});
 return <form onSubmit={form.handleSubmit(data=>action.execute(async()=>{if(!item.id&&(data.password.length<8||data.password.length>128)){form.setError('password',{message:'密码应为8至128位'});return;}await onSave(item.id?{username:data.username,role:data.role,disabled:data.disabled}:data);}))}><FormField label="用户名" error={form.formState.errors.username?.message}><Input autoComplete="off" {...form.register('username')}/></FormField>{!item.id&&<FormField label="初始密码" hint="用户首次登录需要修改密码。" error={form.formState.errors.password?.message}><Input type="password" autoComplete="new-password" {...form.register('password')}/></FormField>}<FormField label="角色"><Controller control={form.control} name="role" render={({field})=><Select value={field.value} onChange={e=>field.onChange(e.target.value)}><option value="user">普通用户</option><option value="admin">管理员</option></Select>}/></FormField>{item.id&&<FormField label="账号状态"><Controller control={form.control} name="disabled" render={({field})=><Select value={String(field.value)} onChange={e=>field.onChange(e.target.value==='true')}><option value="false">正常</option><option value="true">禁用</option></Select>}/></FormField>}<Feedback error={action.error}/><FormActions><Button type="button" variant="outline" onClick={onCancel}>取消</Button><Button variant="default" disabled={action.pending}>{action.pending?'保存中…':'保存用户'}</Button></FormActions></form>;
}
function UserDetail({userId,onAdjust}:{userId:number;onAdjust:()=>void}){
 const resource=useResource<User>(`/admin/users/${userId}`),data=resource.data;const [tab,setTab]=useState('account');
 return <><Feedback error={resource.error} loading={resource.loading}/><Tabs value={tab} onValueChange={setTab}><TabsList><TabsTrigger value="account">账号资料</TabsTrigger><TabsTrigger value="credits">积分账本</TabsTrigger><TabsTrigger value="tokens">调用凭证</TabsTrigger></TabsList><TabsContent value="account"><dl className="detail-list"><dt>用户名</dt><dd>{data?.username}</dd><dt>角色</dt><dd>{data?.role==='admin'?'管理员':'普通用户'}</dd><dt>状态</dt><dd>{data?.disabled?'已禁用':'正常'}</dd><dt>创建时间</dt><dd>{date(data?.created_at)}</dd></dl><Button variant="outline" onClick={onAdjust}>调整积分</Button></TabsContent><TabsContent value="credits">{tab==='credits'&&<CreditLedger userId={userId}/>}</TabsContent><TabsContent value="tokens">{tab==='tokens'&&<TokenManager userId={userId}/>}</TabsContent></Tabs></>;
}
function PasswordReset({userId,onDone}:{userId:number;onDone:()=>Promise<void>}){
 const action=useAction();const form=useForm({resolver:zodResolver(z.object({password:z.string().min(8,'密码至少8位').max(128)})),defaultValues:{password:''}});
 return <form onSubmit={form.handleSubmit(data=>action.execute(async()=>{await api(`/admin/users/${userId}/password`,'POST',data);await onDone();}))}><p className="inline-note">重置后现有会话失效，下次登录需要修改临时密码。</p><FormField label="新临时密码" error={form.formState.errors.password?.message}><Input type="password" autoComplete="new-password" {...form.register('password')}/></FormField><Feedback error={action.error}/><FormActions><Button variant="default" disabled={action.pending}>重置密码</Button></FormActions></form>;
}
function CreditAdjustment({userId,onDone}:{userId:number;onDone:()=>Promise<void>}){
 const action=useAction();const form=useForm({resolver:zodResolver(z.object({amount:z.number().int().refine(x=>x!==0,'请输入非零积分'),reason:z.string().trim().min(1,'请填写调整原因').max(500)})),defaultValues:{amount:0,reason:''}});
 return <form onSubmit={form.handleSubmit(data=>action.execute(async()=>{await api(`/admin/users/${userId}/credits`,'POST',data);await onDone();}))}><FormField label="积分变动" hint="正数增加，负数扣减，余额不可低于已冻结积分。" error={form.formState.errors.amount?.message}><Input type="number" {...form.register('amount',{valueAsNumber:true})}/></FormField><FormField label="调整原因" error={form.formState.errors.reason?.message}><Textarea rows={3} {...form.register('reason')}/></FormField><Feedback error={action.error}/><FormActions><Button variant="default" disabled={action.pending}>确认调整积分</Button></FormActions></form>;
}
