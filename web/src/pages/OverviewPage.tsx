import type {Overview} from '../../../shared/api-types';
/**
 * @file OverviewPage.tsx
 * @project ocs-answer-hub
 * @module 系统概览
 * @description 汇总本地题库、请求状态、近期活动与查询耗时。
 * @logic 只读取系统统计接口，详情入口指向全局查询与运维页面。
 * @dependencies hooks/use-resource, components/ui
 * @index_tags overview, metrics, admin
 * @author holic512
 */
import {Link} from 'react-router';
import {RefreshCw} from 'lucide-react';
import {Heading} from '../components/workspace';
import {Button} from '../components/ui/button';
import {Badge} from '../components/ui/badge';
import {DataTable} from '../components/ui/data-table';
import {Feedback} from '../components/ui/alert';
import {useResource} from '../hooks/use-resource';
import {date,fmt} from '../lib/format';
import {queryStatuses} from '../lib/query-status';
export default function OverviewPage(){const resource=useResource<Overview>('/admin/stats'),data=resource.data,t=data?.totals;return <><Heading title="系统概览" desc="题库规模、查询表现与最近活动。"><Button variant="outline" disabled={resource.loading} onClick={()=>resource.reload()}><RefreshCw size={15}/>刷新</Button></Heading><Feedback error={resource.error}/><dl className="balance-strip overview-strip"><div><dt>本地题目</dt><dd>{fmt(data?.questions?.total)}</dd></div><div><dt>近30天请求</dt><dd>{fmt(t?.requests)}</dd></div><div><dt>近30天成功</dt><dd>{fmt(t?.hits)}</dd></div><div><dt>本地命中率</dt><dd>{t?.requests?Math.round(100*t.local_hits/t.requests):0}<small>%</small></dd></div><div><dt>平均响应</dt><dd>{fmt(t?.avg_ms)}<small>ms</small></dd></div></dl><div className="dashboard-grid"><section className="card"><div className="card-title"><h2>近 30 天查询量</h2><Button asChild size="sm"><Link to="/admin-history">全部查询</Link></Button></div><div className="activity-bars">{(data?.daily??[]).map((d)=><div key={d.day}><span>{d.day}</span><div><i style={{width:`${Math.max(1,100*d.count/Math.max(1,...(data?.daily??[]).map((v)=>v.count)))}%`}}/></div><strong>{fmt(d.count)}</strong></div>)}</div></section><section className="card"><div className="card-title"><h2>查询状态与渠道</h2></div><div className="source-list">{(data?.sources??[]).map((s)=><div key={s.source}><span>{s.source}</span><strong>{fmt(s.count)} 次</strong></div>)}</div><div className="overview-links"><Link to="/admin-history?status=failed&view=failures">失败请求 {fmt(t?.failed)}</Link><Link to="/executions">后台执行记录</Link></div></section></div><section className="card table-card"><div className="card-title"><h2>最近查询</h2><Button asChild variant="outline" size="sm"><Link to="/admin-history">查看全部</Link></Button></div><DataTable loading={resource.loading} data={data?.recent?.slice(0,10)??[]} columns={[{accessorKey:'title',header:'题目',size:520,cell:({row})=><span className="wrap-cell line-clamp">{row.original.title}</span>},{accessorKey:'token_name',header:'调用凭证',cell:({row})=>row.original.token_name??'已删除凭证'},{accessorKey:'source',header:'查询渠道',cell:({row})=>row.original.source??'—'},{accessorKey:'status',header:'状态',cell:({row})=><Badge tone={row.original.status==='hit'?'green':'gray'}>{queryStatuses[row.original.status]}</Badge>},{accessorKey:'duration_ms',header:'耗时',cell:({row})=>`${row.original.duration_ms} ms`},{accessorKey:'created_at',header:'时间',cell:({row})=>date(row.original.created_at)}]}/></section></>;}
