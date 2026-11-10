import type {Page} from '../../../shared/contracts';
import type {QuestionRecord,QuestionWrite,Revision,ImportPreview} from '../../../shared/api-types';
/**
 * @file QuestionsPage.tsx
 * @project ocs-answer-hub
 * @module 本地题库
 * @description 分页题库、完整编辑、导入预览、答案版本与种子迭代入口。
 * @logic 题目按课程和题型筛选，答案结构由服务端校验，导入默认跳过重复题。
 * @dependencies react-hook-form, zod, hooks/use-resource, components/ui
 * @index_tags questions, import, crud
 * @author holic512
 */
import {useState} from 'react';
import {Link} from 'react-router';
import {Controller,useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {Plus,Upload,Download,Search} from 'lucide-react';
import {api} from '../lib/api';
import {useApp} from '../context/app';
import {useResource,useAction} from '../hooks/use-resource';
import {Heading,labels} from '../components/workspace';
import {Button} from '../components/ui/button';
import {Input,Textarea} from '../components/ui/input';
import {Select} from '../components/ui/select';
import {DataTable} from '../components/ui/data-table';
import {Sheet} from '../components/ui/sheet';
import {FormField,FormActions} from '../components/ui/form';
import {Feedback} from '../components/ui/alert';
import {Checkbox} from '../components/ui/checkbox';
import {date,download} from '../lib/format';
const questionSchema=z.object({title:z.string().trim().min(1,'请输入题干').max(8000),type:z.enum(['single','multiple','judgement','completion','unknown']),options:z.string(),course:z.string().max(200),answer:z.string().trim().min(1,'请输入答案').max(12000),images:z.string()});
type Values=z.infer<typeof questionSchema>;
export default function QuestionsPage(){
 const [page,setPage]=useState(1),[filters,setFilters]=useState({q:'',course:'',type:''}),[edit,setEdit]=useState<Partial<QuestionRecord>|null>(null),[importing,setImporting]=useState(false),[version,setVersion]=useState<QuestionRecord|null>(null);
 const {confirm}=useApp(),action=useAction(),resource=useResource<Page<QuestionRecord>>(`/admin/questions?page=${page}&${new URLSearchParams(filters)}`);
 async function remove(row:QuestionRecord){if(await confirm(`删除题目「${row.title.slice(0,60)}」？`))await action.execute(async()=>{await api(`/admin/questions/${row.id}`,'DELETE');await resource.reload();},'题目已删除');}
 return <><Heading title="本地题库" desc="维护题干、选项与答案，按课程组织题库。"><Button variant="outline" onClick={()=>setImporting(true)}><Upload size={15}/>导入</Button><Button variant="outline" onClick={()=>action.execute(async()=>download('知序-本地题库.json',await api('/admin/export')))}><Download size={15}/>导出</Button><Button variant="default" onClick={()=>setEdit({})}><Plus size={16}/>添加题目</Button></Heading><section className="card table-card"><form className="toolbar" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);setFilters({q:String(f.get('q')),course:String(f.get('course')),type:f.get('type')==='__all__'?'':String(f.get('type'))});setPage(1);}}><Input name="q" placeholder="搜索题干或答案" aria-label="搜索题目" className="search-input"/><Input name="course" placeholder="课程名称" aria-label="课程名称" className="filter-input"/><Select name="type" aria-label="题型筛选" defaultValue="__all__"><option value="__all__">全部题型</option>{Object.entries(labels).map(([k,v])=><option value={k} key={k}>{v}</option>)}</Select><Button variant="outline"><Search size={15}/>筛选</Button></form><Feedback error={resource.error||action.error} message={action.message}/><DataTable data={resource.data?.items??[]} total={resource.data?.total??0} page={page} pageSize={resource.data?.pageSize??30} loading={resource.loading} onPageChange={setPage} columns={[
 {accessorKey:'title',header:'题目 / 答案',size:560,cell:({row})=><div className="question-cell"><strong>{row.original.title}</strong><p>{row.original.answer}</p></div>},
 {accessorKey:'course',header:'课程',cell:({row})=>row.original.course||'未分类'},
 {accessorKey:'type',header:'题型',cell:({row})=>labels[row.original.type]??'其他'},
 {accessorKey:'updated_at',header:'更新时间',cell:({row})=>date(row.original.updated_at)},
 {id:'actions',header:'操作',cell:({row})=><div className="row-actions"><Button size="sm" onClick={()=>setEdit(row.original)}>编辑</Button><Button size="sm" onClick={()=>setVersion(row.original)}>版本</Button><Button size="sm" className="danger-text" onClick={()=>remove(row.original)}>删除</Button></div>}
 ]}/></section><p className="page-note">需要基于已有题目扩展题库？前往<Link to="/iteration">题库迭代</Link>选择种子题。</p>{edit&&<Sheet title={edit.id?'编辑题目':'添加题目'} onClose={()=>setEdit(null)}><QuestionForm item={edit} onSave={async(data)=>{await api(edit.id?`/admin/questions/${edit.id}`:'/admin/questions',edit.id?'PUT':'POST',data);setEdit(null);await resource.reload();}}/></Sheet>}{importing&&<Sheet title="导入本地题库" description="支持题库 JSON 或带 title、type、options、course、answer 列的 CSV。" onClose={()=>setImporting(false)}><ImportQuestions onDone={async()=>{setImporting(false);await resource.reload();}}/></Sheet>}{version&&<Sheet title="答案修改记录" description={version.title} onClose={()=>setVersion(null)}><AnswerVersions id={version.id}/></Sheet>}</>;
}
function QuestionForm({item,onSave}:{item:Partial<QuestionRecord>;onSave:(data:QuestionWrite)=>Promise<void>}){
 const action=useAction(),form=useForm<Values>({resolver:zodResolver(questionSchema),defaultValues:{title:item.title??'',type:item.type??'single',options:Array.isArray(item.options)?item.options.join('\n'):item.options??'',course:item.course??'',answer:item.answer??'',images:(item.images??[]).map((x:any)=>typeof x==='string'?x:x.url).join('\n')}});
 return <form onSubmit={form.handleSubmit(data=>action.execute(()=>onSave({...data,options:data.options.split('\n').map(x=>x.trim()).filter(Boolean),images:data.images.split('\n').map(x=>x.trim()).filter(Boolean)})))} noValidate><div className="form-grid"><FormField label="课程" error={form.formState.errors.course?.message}><Input {...form.register('course')}/></FormField><FormField label="题型"><Controller name="type" control={form.control} render={({field})=><Select value={field.value} onChange={e=>field.onChange(e.target.value)}>{Object.entries(labels).map(([k,v])=><option value={k} key={k}>{v}</option>)}</Select>}/></FormField></div><FormField label="题干" error={form.formState.errors.title?.message}><Textarea rows={4} {...form.register('title')}/></FormField><FormField label="选项" hint="每行一个选项。判断与填空可以留空。"><Textarea rows={4} {...form.register('options')}/></FormField><FormField label="答案" hint="单多选填写选项文本，多选与多空用 # 分隔；判断填写正确或错误。" error={form.formState.errors.answer?.message}><Textarea rows={3} {...form.register('answer')}/></FormField><details className="advanced-fields"><summary>图片地址</summary><FormField label="图片地址" hint="每行一个地址。"><Textarea rows={2} {...form.register('images')}/></FormField></details><Feedback error={action.error}/><FormActions><Button variant="default" disabled={action.pending}>{action.pending?'保存中…':'保存题目'}</Button></FormActions></form>;
}
function parseCsv(text:string){const rows:string[][]=[];let row:string[]=[],cell='',quote=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quote&&text[i+1]==='"'){cell+='"';i++;}else quote=!quote;}else if(!quote&&(c===','||c==='\n')){row.push(cell.replace(/\r$/,''));cell='';if(c==='\n'){if(row.some(Boolean))rows.push(row);row=[];}}else cell+=c;}row.push(cell);if(row.some(Boolean))rows.push(row);const headers=rows.shift()?.map(x=>x.trim())??[];return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));}
function ImportQuestions({onDone}:{onDone:()=>Promise<void>}){
 const action=useAction(),[items,setItems]=useState<QuestionWrite[]>([]),[preview,setPreview]=useState<ImportPreview|null>(null),[overwrite,setOverwrite]=useState(false),[filename,setFilename]=useState('');
 return <><FormField label="选择文件" hint="单次最多500题。JSON可使用数组或 {items:[]} 格式。"><Input type="file" accept=".json,.csv" onChange={e=>{const file=e.target.files?.[0];if(!file)return;setPreview(null);setItems([]);void action.execute(async()=>{const text=await file.text();const raw=file.name.toLowerCase().endsWith('.csv')?parseCsv(text):JSON.parse(text);const data=Array.isArray(raw)?raw:raw.items;if(!Array.isArray(data)||!data.length)throw new Error('文件没有可导入的题目');if(data.length>500)throw new Error('单次最多导入500题，请拆分文件');setItems(data);setFilename(file.name);});}}/></FormField><label className="check-field"><Checkbox checked={overwrite} onCheckedChange={v=>{setOverwrite(v===true);setPreview(null);}}/>覆盖同指纹题目的答案</label><p className="inline-note">默认跳过已有题目。覆盖模式会更新已有答案并记录修改版本。</p><Feedback error={action.error}/>{items.length>0&&<p>{filename} · {items.length} 题</p>}{preview&&<div className="inline-note"><p>共 {preview.total} 题，可导入 {preview.valid} 题{preview.duplicates!==undefined?`，重复 ${preview.duplicates} 题`:''}。</p>{preview.invalid?.length>0&&<p>无效行：{preview.invalid.join('、')}</p>}</div>}<FormActions><Button variant="outline" disabled={!items.length||action.pending} onClick={()=>action.execute(async()=>setPreview(await api<ImportPreview>('/admin/import','POST',{items,preview:true,overwrite})))}>预览导入</Button><Button variant="default" disabled={!preview||Boolean(preview.invalid?.length)||action.pending} onClick={()=>action.execute(async()=>{await api('/admin/import','POST',{items,preview:false,overwrite});await onDone();})}>确认导入</Button></FormActions></>;
}
function AnswerVersions({id}:{id:string}){const resource=useResource<{items:Revision[]}>(`/admin/questions/${id}/versions`);return <><Feedback error={resource.error}/><DataTable data={resource.data?.items??[]} loading={resource.loading} columns={[{accessorKey:'answer',header:'答案',cell:({row})=><span className="wrap-cell">{row.original.answer}</span>},{accessorKey:'operation',header:'操作',cell:({row})=>({create:'创建',update:'修改',import:'导入',generation:'生成',ai:'AI 入库'} as Record<string,string>)[row.original.operation]??row.original.operation??'修改'},{accessorKey:'created_at',header:'时间',cell:({row})=>date(row.original.created_at)}]}/></>;}
