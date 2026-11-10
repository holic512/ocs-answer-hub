import type {Page} from '../../../shared/contracts';
import type {Token,Setup,TokenCreated,TokenDefaults,TokenWrite} from '../../../shared/api-types';
/**
 * @file TokensPage.tsx
 * @project ocs-answer-hub
 * @module 调用凭证
 * @description 个人凭证及管理员代管凭证的分页 CRUD、撤销和一次性密钥展示。
 * @logic 用户受系统限额上限约束；管理员可设置用户凭证，删除保留调用历史。
 * @dependencies react-hook-form, zod, hooks/use-resource, components/ui
 * @index_tags tokens, ocs, form
 * @author holic512
 */
import {useState} from 'react';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {Plus,Copy,Download} from 'lucide-react';
import {Button} from '../components/ui/button';
import {Input,Textarea} from '../components/ui/input';
import {Badge} from '../components/ui/badge';
import {DataTable} from '../components/ui/data-table';
import {Sheet} from '../components/ui/sheet';
import {FormField,FormActions} from '../components/ui/form';
import {Feedback} from '../components/ui/alert';
import {Heading} from '../components/workspace';
import {useApp} from '../context/app';
import {useResource,useAction} from '../hooks/use-resource';
import {api} from '../lib/api';
import {date,download} from '../lib/format';
const tokenSchema=z.object({name:z.string().trim().min(1,'请输入凭证名称').max(100),daily_limit:z.number().int().min(1).max(100000),rpm:z.number().int().min(1).max(600),expires_at:z.string()});
type Values=z.infer<typeof tokenSchema>;
export default function TokensPage(){return <><Heading title="调用凭证" desc="网页与 OCS 使用同一凭证限额。成功获得答案扣除账号 1 积分。"/><TokenManager/></>;}
export function TokenManager({userId}:{userId?:number}){
 const {confirm,setup}=useApp(),action=useAction();
 const liveSettings=useResource<Setup>('/setup');const [page,setPage]=useState(1),[edit,setEdit]=useState<Partial<Token>|null>(null),[created,setCreated]=useState<TokenCreated|null>(null);
 const base=userId?'/admin/tokens':'/workspace/tokens';
 const resource=useResource<Page<Token>>(`${base}?page=${page}${userId?`&user_id=${userId}`:''}`);
 const items=resource.data?.items??[];
 async function mutate(row:Token,operation:'revoke'|'delete'){if(!await confirm(operation==='delete'?`删除凭证「${row.name}」？删除后立即失效，历史记录仍保留。`:`撤销凭证「${row.name}」？撤销后不可继续调用。`))return;await action.execute(async()=>{await api(`${base}/${row.id}${operation==='revoke'?'/revoke':''}`,operation==='delete'?'DELETE':'POST',operation==='revoke'?{}:undefined);await resource.reload();},operation==='delete'?'凭证已删除':'凭证已撤销');}
 return <><div className="section-toolbar"><p className="muted">{userId?'为该用户管理调用凭证。':'密钥只在创建时显示，请及时保存 OCS 配置。'}</p><Button variant="default" onClick={()=>{action.clear();setEdit({});}}><Plus size={16}/>创建凭证</Button></div><Feedback error={resource.error||action.error} message={action.message}/><DataTable data={items} loading={resource.loading} total={resource.data?.total??0} page={page} pageSize={resource.data?.pageSize??30} onPageChange={setPage} columns={[
 {accessorKey:'name',header:'名称',cell:({row})=><div><strong>{row.original.name}</strong><small className="block muted mono">{row.original.prefix}…</small></div>},
 {id:'status',header:'状态',cell:({row})=>{const r=row.original,expired=r.expires_at&&new Date(r.expires_at)<new Date();return <Badge tone={r.revoked||expired?'gray':'green'}>{r.revoked?'已撤销':expired?'已过期':'有效'}</Badge>;}},
 {id:'quota',header:'凭证限额',cell:({row})=><span>每日 {row.original.daily_limit.toLocaleString()}<small className="block muted">每分钟 {row.original.rpm} 次</small></span>},
 {accessorKey:'day_count',header:'今日用量',cell:({row})=>row.original.day_count},
 {accessorKey:'expires_at',header:'到期 / 最近调用',cell:({row})=><span>{row.original.expires_at?date(row.original.expires_at):'长期有效'}<small className="block muted">{date(row.original.last_used)}</small></span>},
 {id:'actions',header:'操作',cell:({row})=><div className="row-actions"><Button size="sm" onClick={()=>{action.clear();setEdit(row.original);}}>编辑</Button>{!row.original.revoked&&<Button size="sm" disabled={action.pending} onClick={()=>mutate(row.original,'revoke')}>撤销</Button>}<Button size="sm" className="danger-text" disabled={action.pending} onClick={()=>mutate(row.original,'delete')}>删除</Button></div>}
 ]}/>{edit&&<Sheet title={edit.id?'编辑凭证':'创建调用凭证'} onClose={()=>setEdit(null)}><TokenForm item={edit} administrator={Boolean(userId)} defaults={liveSettings.data?.tokenDefaults??setup.tokenDefaults} onCancel={()=>setEdit(null)} onSave={async(values)=>{const result=await api<TokenCreated>(edit.id?`${base}/${edit.id}`:base,edit.id?'PUT':'POST',{...values,...(userId?{user_id:userId}:{})});await resource.reload();setEdit(null);if(result.token)setCreated(result);}}/></Sheet>}{created&&<Sheet title="凭证已创建" description="密钥仅展示这一次，关闭前请复制或下载配置。" onClose={()=>setCreated(null)}><FormField label="调用密钥"><Input readOnly value={created.token}/></FormField><FormField label="OCS 配置"><Textarea readOnly className="code-editor" rows={16} value={JSON.stringify(created.config,null,2)}/></FormField><Feedback error={action.error} message={action.message}/><FormActions><Button variant="outline" onClick={()=>download('知序-OCS配置.json',created.config)}><Download size={16}/>下载配置</Button><Button variant="default" onClick={()=>action.execute(()=>navigator.clipboard.writeText(JSON.stringify(created.config)),'OCS 配置已复制')}><Copy size={16}/>复制配置</Button></FormActions></Sheet>}</>;
}
function TokenForm({item,defaults,administrator,onSave,onCancel}:{item:Partial<Token>;defaults:TokenDefaults;administrator:boolean;onSave:(data:TokenWrite)=>Promise<void>;onCancel:()=>void}){
 const action=useAction(),form=useForm<Values>({resolver:zodResolver(tokenSchema),defaultValues:{name:item.name??'',daily_limit:item.daily_limit??defaults?.daily_limit??2000,rpm:item.rpm??defaults?.rpm??60,expires_at:item.expires_at?new Date(new Date(item.expires_at).getTime()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16):''}});
 const dailyMax=administrator?100000:defaults?.max_daily_limit??2000,rpmMax=administrator?600:defaults?.max_rpm??60;
 return <form onSubmit={form.handleSubmit(data=>action.execute(async()=>{if(data.daily_limit>dailyMax){form.setError('daily_limit',{message:`不可超过 ${dailyMax} 次`});return;}if(data.rpm>rpmMax){form.setError('rpm',{message:`不可超过 ${rpmMax} 次`});return;}await onSave({...data,expires_at:data.expires_at?new Date(data.expires_at).toISOString():null});}))}><FormField label="凭证名称" error={form.formState.errors.name?.message}><Input {...form.register('name')}/></FormField><div className="form-grid"><FormField label="每日调用上限" hint={`最多 ${dailyMax.toLocaleString()} 次`} error={form.formState.errors.daily_limit?.message}><Input type="number" min={1} max={dailyMax} {...form.register('daily_limit',{valueAsNumber:true})}/></FormField><FormField label="每分钟调用上限" hint={`最多 ${rpmMax} 次`} error={form.formState.errors.rpm?.message}><Input type="number" min={1} max={rpmMax} {...form.register('rpm',{valueAsNumber:true})}/></FormField></div><FormField label="到期时间" hint="留空表示长期有效。" error={form.formState.errors.expires_at?.message}><Input type="datetime-local" {...form.register('expires_at')}/></FormField><Feedback error={action.error}/><FormActions><Button type="button" variant="outline" onClick={onCancel}>取消</Button><Button variant="default" disabled={action.pending}>{action.pending?'保存中…':'保存凭证'}</Button></FormActions></form>;
}
