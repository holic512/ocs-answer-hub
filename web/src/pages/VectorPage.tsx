import type {VectorHealth} from '../../../shared/api-types';
/**
 * @file VectorPage.tsx
 * @project ocs-answer-hub
 * @module 向量索引运维
 * @description 本地模型状态、索引覆盖与手动增量或重建入口。
 * @logic 查询模型及索引状态，手动操作派发后台任务并链接独立执行记录。
 * @dependencies hooks/use-resource, components/ui
 * @index_tags operations, vector
 * @author holic512
 */
import {Link} from 'react-router';
import {RefreshCw,Play} from 'lucide-react';
import {Heading} from '../components/workspace';
import {Button} from '../components/ui/button';
import {Badge} from '../components/ui/badge';
import {DataTable} from '../components/ui/data-table';
import {Feedback} from '../components/ui/alert';
import {useResource,useAction} from '../hooks/use-resource';
import {useApp} from '../context/app';
import {api} from '../lib/api';
import {date,fmt} from '../lib/format';
export default function VectorPage(){
 const resource=useResource<VectorHealth>('/admin/operations/vector'),action=useAction(),{confirm}=useApp();const data=resource.data,c=data?.coverage;
 async function run(rebuild=false){if(rebuild&&!await confirm('重建全部向量索引？任务在后台执行，查题仍可使用本地匹配和 AI。'))return;await action.execute(async()=>{await api('/admin/operations/vector/run','POST',{rebuild});await resource.reload();},rebuild?'索引重建任务已提交':'增量索引任务已唤醒');}
 return <><Heading title="向量索引" desc="维护本地模型与题库索引，支撑 AI 参考检索和新题去重。"><Button variant="outline" disabled={resource.loading} onClick={()=>resource.reload()}><RefreshCw size={15}/>刷新状态</Button><Button variant="default" disabled={action.pending} onClick={()=>run()}><Play size={15}/>立即增量索引</Button></Heading><Feedback error={resource.error||action.error} message={action.message}/><section className="card"><div className="section-toolbar"><div><h2>本地模型</h2><p className="muted">{data?.reason??'正在检查状态'}</p></div><Badge tone={data?.ready?'green':'amber'}>{data?.ready?'模型已就绪':'模型未就绪'}</Badge></div><dl className="balance-strip"><div><dt>题库总数</dt><dd>{fmt(c?.total)}</dd></div><div><dt>已索引</dt><dd>{fmt(c?.indexed)}</dd></div><div><dt>待处理</dt><dd>{fmt(c?.pending)}</dd></div><div><dt>已跳过</dt><dd>{fmt(c?.skipped)}</dd></div></dl><div className="section-toolbar"><p className="muted">新增和编辑的题目由自动化计划增量处理。</p><Button variant="outline" disabled={action.pending} onClick={()=>run(true)}>重建全部索引</Button></div></section><section className="card table-card"><div className="card-title"><h2>跳过的题目</h2><Button asChild variant="ghost"><Link to="/executions?kind=backfill">查看执行记录</Link></Button></div><DataTable data={data?.skips??[]} loading={resource.loading} empty="没有跳过的题目" columns={[{accessorKey:'title',header:'题目',cell:({row})=><span className="wrap-cell">{row.original.title}</span>},{accessorKey:'course',header:'课程'},{accessorKey:'reason',header:'原因',cell:({row})=>row.original.reason==='input_too_long'?'超过模型完整编码长度':row.original.reason},{accessorKey:'updated_at',header:'时间',cell:({row})=>date(row.original.updated_at)}]}/></section></>;
}
