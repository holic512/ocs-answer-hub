import type {Page} from '../../../shared/contracts';
import type {Schedule,ScheduleWrite} from '../../../shared/api-types';
/**
 * @file SchedulesPage.tsx
 * @project ocs-answer-hub
 * @module 自动化计划
 * @description 维护向量索引和题库迭代的持久化执行计划。
 * @logic 间隔或每日计划共用手动唤醒入口，生成配置复用种子题表单。
 * @dependencies react-hook-form, zod, GenerationForm, components/ui
 * @index_tags operations, schedules, automation
 * @author holic512
 */
import {useState} from 'react';
import {Controller,useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {Plus,Play} from 'lucide-react';
import {api} from '../lib/api';
import {useApp} from '../context/app';
import {useResource,useAction} from '../hooks/use-resource';
import {Heading} from '../components/workspace';
import {GenerationForm,type GenerationValues} from '../components/GenerationForm';
import {Button} from '../components/ui/button';
import {Input} from '../components/ui/input';
import {Select} from '../components/ui/select';
import {Switch} from '../components/ui/switch';
import {Badge} from '../components/ui/badge';
import {DataTable} from '../components/ui/data-table';
import {Sheet} from '../components/ui/sheet';
import {FormField,FormActions} from '../components/ui/form';
import {Feedback} from '../components/ui/alert';
import {date} from '../lib/format';
const scheduleSchema=z.object({name:z.string().trim().min(1,'请输入计划名称').max(100),kind:z.enum(['backfill','generation']),enabled:z.boolean(),mode:z.enum(['interval','daily']),interval_minutes:z.number().int().min(1).max(10080),time_of_day:z.string().regex(/^\d{2}:\d{2}$/,'请输入有效时间')});
type Values=z.infer<typeof scheduleSchema>;
export default function SchedulesPage(){
 const [page,setPage]=useState(1),[edit,setEdit]=useState<Partial<Schedule>|null>(null),resource=useResource<Page<Schedule>>(`/admin/operations/schedules?page=${page}`),action=useAction(),{confirm}=useApp();
 return <><Heading title="自动化任务" desc="配置定期向量维护与题库扩充，也可立即唤醒执行。"><Button variant="default" onClick={()=>setEdit({})}><Plus size={16}/>新建计划</Button></Heading><Feedback error={resource.error||action.error} message={action.message}/><section className="card table-card"><DataTable data={resource.data?.items??[]} total={resource.data?.total??0} page={page} pageSize={resource.data?.pageSize??30} onPageChange={setPage} loading={resource.loading} columns={[
 {accessorKey:'name',header:'计划名称',cell:({row})=><strong>{row.original.name}</strong>},
 {accessorKey:'kind',header:'任务类型',cell:({row})=>row.original.kind==='backfill'?'向量增量索引':'题库迭代'},
 {id:'schedule',header:'执行频率',cell:({row})=>row.original.mode==='daily'?`每日 ${row.original.time_of_day}`:`每 ${row.original.interval_minutes} 分钟`},
 {accessorKey:'enabled',header:'状态',cell:({row})=><Badge tone={row.original.enabled?'green':'gray'}>{row.original.enabled?'已启用':'已停用'}</Badge>},
 {accessorKey:'next_run_at',header:'下次执行',cell:({row})=>row.original.enabled?date(row.original.next_run_at):'—'},
 {id:'actions',header:'操作',cell:({row})=><div className="row-actions"><Button size="sm" disabled={action.pending} onClick={()=>action.execute(async()=>{await api(`/admin/operations/schedules/${row.original.id}/run`,'POST',{});await resource.reload();},'计划已唤醒，执行情况见执行记录')}><Play size={14}/>立即执行</Button><Button size="sm" onClick={()=>setEdit(row.original)}>编辑</Button><Button size="sm" onClick={()=>action.execute(async()=>{await api(`/admin/operations/schedules/${row.original.id}`,'PUT',{...row.original,enabled:!row.original.enabled});await resource.reload();})}>{row.original.enabled?'停用':'启用'}</Button><Button size="sm" className="danger-text" onClick={async()=>{if(await confirm(`删除计划「${row.original.name}」？已有执行记录会保留。`))await action.execute(async()=>{await api(`/admin/operations/schedules/${row.original.id}`,'DELETE');await resource.reload();},'计划已删除');}}>删除</Button></div>}
 ]}/></section>{edit&&<Sheet title={edit.id?'编辑自动化计划':'新建自动化计划'} wide onClose={()=>setEdit(null)}><ScheduleForm item={edit} onSave={async(data)=>{await api(edit.id?`/admin/operations/schedules/${edit.id}`:'/admin/operations/schedules',edit.id?'PUT':'POST',data);await resource.reload();setEdit(null);}}/></Sheet>}</>;
}
function ScheduleForm({item,onSave}:{item:Partial<Schedule>;onSave:(data:ScheduleWrite)=>Promise<void>}){
 const action=useAction();const [schedule,setSchedule]=useState<Values|null>(null),[generation,setGeneration]=useState<GenerationValues|undefined>(item.kind==='generation'?{course:'',provider_id:'',seed_ids:[],max_rounds:5,max_questions:50,batch_size:10,...item.config}:undefined);
 const form=useForm<Values>({resolver:zodResolver(scheduleSchema),defaultValues:{name:item.name??'',kind:item.kind??'backfill',enabled:item.enabled??true,mode:item.mode??'interval',interval_minutes:item.interval_minutes??5,time_of_day:item.time_of_day?.slice(0,5)??'03:00'}}),kind=form.watch('kind'),mode=form.watch('mode');
 return schedule?<><div className="section-toolbar"><h3>{schedule.name} · 生成配置</h3><Button variant="outline" onClick={()=>setSchedule(null)}>返回计划设置</Button></div><GenerationForm initial={generation} submitLabel="保存自动化计划" onSave={async(config)=>{setGeneration(config);await onSave({...schedule,config});}}/></>:<form onSubmit={form.handleSubmit(data=>{if(data.kind==='generation')setSchedule(data);else void action.execute(()=>onSave({...data,config:{}}));})} noValidate><FormField label="计划名称" error={form.formState.errors.name?.message}><Input {...form.register('name')}/></FormField><div className="form-grid"><FormField label="任务类型"><Controller name="kind" control={form.control} render={({field})=><Select value={field.value} onChange={e=>field.onChange(e.target.value)}><option value="backfill">向量增量索引</option><option value="generation">题库迭代</option></Select>}/></FormField><FormField label="执行方式"><Controller name="mode" control={form.control} render={({field})=><Select value={field.value} onChange={e=>field.onChange(e.target.value)}><option value="interval">固定间隔</option><option value="daily">每日定时</option></Select>}/></FormField></div>{mode==='interval'?<FormField label="执行间隔（分钟）" error={form.formState.errors.interval_minutes?.message}><Input type="number" min={1} max={10080} {...form.register('interval_minutes',{valueAsNumber:true})}/></FormField>:<FormField label="每日执行时间" hint="按北京时间（Asia/Shanghai）执行。" error={form.formState.errors.time_of_day?.message}><Input type="time" {...form.register('time_of_day')}/></FormField>}<div className="setting-row"><div><strong>启用计划</strong><p>停用计划仍可通过“立即执行”手动唤醒。</p></div><Controller name="enabled" control={form.control} render={({field})=><Switch aria-label="启用计划" checked={field.value} onCheckedChange={field.onChange}/>}/></div><Feedback error={action.error}/><FormActions><Button variant="default" disabled={action.pending}>{kind==='generation'?'下一步：选择种子与模型':'保存自动化计划'}</Button></FormActions></form>;
}
