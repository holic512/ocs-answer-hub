import type {Page} from '../../../shared/contracts';
import type {AiProvider,QuestionRecord} from '../../../shared/api-types';
/**
 * @file GenerationForm.tsx
 * @project ocs-answer-hub
 * @module 题库迭代表单
 * @description 从已有课程题库选择种子，设置 AI 和批次参数。
 * @logic 课程筛选服务端分页题目，保存选择并提交种子 ID，不覆盖已有题目。
 * @dependencies react-hook-form, zod, hooks/use-resource, components/ui
 * @index_tags generation, seeds, form
 * @author holic512
 */
import {useEffect,useState} from 'react';
import {Controller,useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {useResource,useAction,useDebouncedValue} from '../hooks/use-resource';
import {Button} from './ui/button';
import {Input} from './ui/input';
import {Select} from './ui/select';
import {Checkbox} from './ui/checkbox';
import {DataTable} from './ui/data-table';
import {FormField,FormActions} from './ui/form';
import {Feedback} from './ui/alert';
import {labels} from './workspace';
export const generationSchema=z.object({course:z.string().trim().min(1,'请填写课程').max(200),provider_id:z.string().min(1,'请选择 AI'),seed_ids:z.array(z.string()).min(1,'至少选择一道种子题').max(20,'最多选择20道种子题'),max_rounds:z.number().int().min(1).max(50),max_questions:z.number().int().min(1).max(500),batch_size:z.number().int().min(1).max(20)});
export type GenerationValues=z.infer<typeof generationSchema>;
export function GenerationForm({initial,onSave,submitLabel='创建迭代任务',pending=false}:{initial?:Partial<GenerationValues>;onSave:(data:GenerationValues)=>Promise<void>;submitLabel?:string;pending?:boolean}){
 const form=useForm<GenerationValues>({resolver:zodResolver(generationSchema),defaultValues:{course:initial?.course??'',provider_id:initial?.provider_id??'',seed_ids:initial?.seed_ids??[],max_rounds:initial?.max_rounds??5,max_questions:initial?.max_questions??50,batch_size:initial?.batch_size??10}});
 const [course,setCourse]=useState(initial?.course??''),[page,setPage]=useState(1),[search,setSearch]=useState(''),action=useAction();
 const debouncedSearch=useDebouncedValue(search);
 const providers=useResource<Page<AiProvider>>('/admin/providers?pageSize=100'),questions=useResource<Page<QuestionRecord>>(course?`/admin/questions?page=${page}&course=${encodeURIComponent(course)}&q=${encodeURIComponent(debouncedSearch)}`:null),selected=form.watch('seed_ids');
 useEffect(()=>{if(initial?.course)setCourse(initial.course);},[]);
 function select(id:string,checked:boolean){form.setValue('seed_ids',checked?[...selected,id]:selected.filter(x=>x!==id),{shouldValidate:true});}
 return <form onSubmit={form.handleSubmit(data=>action.execute(()=>onSave(data)))} noValidate><div className="form-grid"><FormField label="课程" hint="先填写课程，再筛选种子题。" error={form.formState.errors.course?.message}><Input {...form.register('course')} onBlur={e=>{form.register('course').onBlur(e);const next=e.target.value.trim();if(next!==course){setCourse(next);setPage(1);form.setValue('seed_ids',[]);}}}/></FormField><FormField label="生成使用的 AI" error={form.formState.errors.provider_id?.message}><Controller name="provider_id" control={form.control} render={({field})=><Select value={field.value} onChange={e=>field.onChange(e.target.value)}><option value="">请选择已启用 AI</option>{(providers.data?.items??[]).filter((p)=>p.enabled).map((p)=><option value={p.id} key={p.id}>{p.name} · {p.config.model}</option>)}</Select>}/></FormField></div><div className="section-toolbar"><div><h3>选择种子题</h3><p className="muted">已选 {selected.length} 题，最多 20 题。已有答案不会被迭代任务覆盖。</p></div><Input aria-label="搜索种子题" placeholder="搜索种子题" className="filter-input" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></div><Feedback error={questions.error||providers.error||form.formState.errors.seed_ids?.message}/><DataTable data={questions.data?.items??[]} loading={questions.loading} empty={course?'该课程没有匹配的种子题':'填写课程后选择种子题'} total={questions.data?.total??0} page={page} pageSize={questions.data?.pageSize??30} onPageChange={setPage} columns={[
 {id:'select',header:'选择',size:56,cell:({row})=><Checkbox aria-label={`选择种子题 ${row.original.title}`} checked={selected.includes(row.original.id)} disabled={!selected.includes(row.original.id)&&selected.length>=20} onCheckedChange={v=>select(row.original.id,v===true)}/>},
 {accessorKey:'title',header:'题干',cell:({row})=><span className="wrap-cell line-clamp">{row.original.title}</span>},
 {accessorKey:'type',header:'题型',size:90,cell:({row})=>labels[row.original.type]??'其他'}
 ]}/><div className="form-grid generation-limits"><FormField label="最多生成题数" error={form.formState.errors.max_questions?.message}><Input type="number" min={1} max={500} {...form.register('max_questions',{valueAsNumber:true})}/></FormField><FormField label="最多轮次" error={form.formState.errors.max_rounds?.message}><Input type="number" min={1} max={50} {...form.register('max_rounds',{valueAsNumber:true})}/></FormField><FormField label="每批题数" error={form.formState.errors.batch_size?.message}><Input type="number" min={1} max={20} {...form.register('batch_size',{valueAsNumber:true})}/></FormField></div><Feedback error={action.error}/><FormActions><Button variant="default" disabled={pending||action.pending}>{pending||action.pending?'正在提交…':submitLabel}</Button></FormActions></form>;
}
