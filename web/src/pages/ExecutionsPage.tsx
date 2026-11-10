import type {Page} from '../../../shared/contracts';
import type {Job,ExecutionPage} from '../../../shared/api-types';
/**
 * @file ExecutionsPage.tsx
 * @project ocs-answer-hub
 * @module 后台执行记录
 * @description 生成与向量任务的分页状态、取消、重试及候选结果。
 * @logic 活动任务定期更新，详情读取候选记录；操作后刷新当前列表。
 * @dependencies hooks/use-resource, components/ui, react-router
 * @index_tags operations, jobs, execution
 * @author holic512
 */
import {useEffect,useState} from 'react';
import {useSearchParams} from 'react-router';
import {RefreshCw} from 'lucide-react';
import {Heading} from '../components/workspace';
import {Button} from '../components/ui/button';
import {Badge} from '../components/ui/badge';
import {Select} from '../components/ui/select';
import {DataTable} from '../components/ui/data-table';
import {Sheet} from '../components/ui/sheet';
import {Feedback} from '../components/ui/alert';
import {useResource,useAction} from '../hooks/use-resource';
import {useApp} from '../context/app';
import {api} from '../lib/api';
import {date} from '../lib/format';
export const jobStatuses:Record<string,string>={queued:'排队中',running:'执行中',completed:'已完成',failed:'执行失败',cancelled:'已取消'};
export default function ExecutionsPage(){
 const [params,setParams]=useSearchParams(),[detail,setDetail]=useState<string|null>(null),action=useAction(),{confirm}=useApp();
 const page=Number(params.get('page')??1),kind=params.get('kind')??'all',status=params.get('status')??'all';
 const resource=useResource<Page<Job>>(`/admin/operations/jobs?page=${page}${kind==='all'?'':`&kind=${kind}`}${status==='all'?'':`&status=${status}`}`);
 useEffect(()=>{if(!resource.data?.items?.some((j)=>['queued','running'].includes(j.status)))return;const timer=setInterval(()=>{if(!document.hidden)void resource.reload();},5000);return()=>clearInterval(timer);},[resource.data,resource.reload]);
 function filter(key:string,value:string){const next=new URLSearchParams(params);next.set(key,value);next.delete('page');setParams(next);}
 async function command(row:Job,name:'cancel'|'retry'){if(name==='cancel'&&!await confirm('取消这个后台任务？已完成入库的题目会保留。'))return;await action.execute(async()=>{await api(`/admin/operations/jobs/${row.id}/${name}`,'POST',{});await resource.reload();},name==='cancel'?'任务已取消':'任务已重新排队');}
 return <><Heading title="执行记录" desc="集中查看自动化计划和手动唤醒产生的任务。"><Button variant="outline" onClick={()=>resource.reload()}><RefreshCw size={15}/>刷新</Button></Heading><section className="card table-card"><div className="toolbar"><Select aria-label="任务类型" value={kind} onChange={e=>filter('kind',e.target.value)}><option value="all">全部类型</option><option value="generation">题库迭代</option><option value="backfill">向量索引</option></Select><Select aria-label="任务状态" value={status} onChange={e=>filter('status',e.target.value)}><option value="all">全部状态</option>{Object.entries(jobStatuses).map(([k,v])=><option value={k} key={k}>{v}</option>)}</Select></div><Feedback error={resource.error||action.error} message={action.message}/><DataTable data={resource.data?.items??[]} total={resource.data?.total??0} page={page} pageSize={resource.data?.pageSize??30} onPageChange={n=>{const next=new URLSearchParams(params);next.set('page',String(n));setParams(next);}} loading={resource.loading} columns={[
 {accessorKey:'kind',header:'任务',cell:({row})=><span>{row.original.kind==='generation'?'题库迭代':'向量索引'}<small className="block muted">{row.original.course||'全库'}</small></span>},
 {accessorKey:'status',header:'状态',cell:({row})=><Badge tone={row.original.status==='completed'?'green':row.original.status==='failed'?'amber':'gray'}>{jobStatuses[row.original.status]}</Badge>},
 {id:'progress',header:'进度',cell:({row})=><span>处理 {row.original.processed} 项<small className="block muted">{row.original.kind==='generation'?`入库 ${row.original.accepted} 题 · 第 ${row.original.round} 轮`:`跳过 ${row.original.skipped_count??0} 项`}</small></span>},
 {accessorKey:'error',header:'执行信息',cell:({row})=><span className="wrap-cell">{row.original.error??'—'}</span>},
 {accessorKey:'created_at',header:'创建时间',cell:({row})=>date(row.original.created_at)},
 {id:'actions',header:'操作',cell:({row})=><div className="row-actions"><Button size="sm" onClick={()=>setDetail(row.original.id)}>详情</Button>{['queued','running'].includes(row.original.status)&&<Button size="sm" disabled={action.pending} onClick={()=>command(row.original,'cancel')}>取消</Button>}{row.original.status==='failed'&&row.original.attempts<row.original.max_attempts&&!row.original.cancel_requested&&<Button size="sm" disabled={action.pending} onClick={()=>command(row.original,'retry')}>重试</Button>}</div>}
 ]}/></section>{detail&&<Sheet title="任务执行详情" wide onClose={()=>setDetail(null)}><ExecutionDetail id={detail}/></Sheet>}</>;
}
function ExecutionDetail({id}:{id:string}){const [page,setPage]=useState(1);const resource=useResource<ExecutionPage>(`/admin/operations/jobs/${id}?page=${page}`),job=resource.data?.job;const reasons:Record<string,string>={duplicate:'重复题目',structure_invalid:'结构不符合要求',invalid_answer:'答案无法匹配',unsafe_content:'包含无效指令',embedding_input_too_long:'超过模型长度',seed_missing:'种子题不存在'};return <><Feedback error={resource.error} loading={resource.loading}/>{job&&<><dl className="detail-list"><dt>执行状态</dt><dd>{jobStatuses[job.status]}</dd><dt>类型</dt><dd>{job.kind==='generation'?'题库迭代':'向量索引'}</dd><dt>课程</dt><dd>{job.course||'全库'}</dd><dt>处理量</dt><dd>{job.processed}</dd><dt>执行信息</dt><dd>{job.error??'—'}</dd></dl><DataTable data={resource.data?.items??[]} total={resource.data?.total??0} page={page} pageSize={resource.data?.pageSize??30} onPageChange={setPage} columns={[{accessorKey:'round',header:'轮次',size:70},{id:'question',header:'题目',cell:({row})=><div className="question-cell"><strong>{row.original.data?.title??'无效题目数据'}</strong><p>{row.original.data?.answer}</p></div>},{accessorKey:'status',header:'结果',cell:({row})=><Badge tone={row.original.status==='accepted'?'green':'gray'}>{row.original.status==='accepted'?'已入库':'未入库'}</Badge>},{accessorKey:'reason',header:'说明',cell:({row})=>reasons[row.original.reason??'']??row.original.reason??'—'}]}/></>}</>;}
