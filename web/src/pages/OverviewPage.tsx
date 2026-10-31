/**
 * @file OverviewPage.tsx
 * @project ocs-answer-hub
 * @module 概览
 * @description 管理工作台概览页面。
 * @logic 通过共享会话与请求模块完成页面操作，业务状态由页面维护。
 * @dependencies React, components/ui, context/app, lib/api
 * @index_tags overview, page
 * @author holic512
 */
import { useCallback,useEffect,useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Empty,Heading,Icon } from '../components/workspace';
import { api } from '../lib/api';
import { date,fmt } from '../lib/format';
import { useApp } from '../context/app';
export default function OverviewPage(){const {run}=useApp();const[s,setS]=useState<any>();const load=useCallback(()=>run(async()=>setS(await api('/admin/stats'))),[]);useEffect(()=>{load()},[load]);if(!s)return <div className="boot">正在读取统计…</div>;const t=s.totals,q=s.questions;return <><Heading title="概览" desc="查看题库积累、查询统计和最近检索。"><Button asChild className="primary"><Link to="/query"><Icon name="query" size={16}/>开始查题</Link></Button></Heading><div className="overview-banner"><div className="banner-icon"><Icon name="questions" size={29}/></div><div><h3>让你自己的题库，永远排在第一位。</h3><p>本地未命中时，按配置逐级检索；一旦找到有效答案，立即保存并返回。</p></div><Button asChild><Link to="/providers">管理检索顺序 <Icon name="arrow" size={16}/></Link></Button></div><div className="metrics">{[{label:'本地题目',value:q.total,unit:'道',meta:'持续积累，随时可用',icon:'questions'},{label:'累计查题',value:t.requests,unit:'次',meta:`${fmt(t.hits)} 次成功返回答案`,icon:'query'},{label:'本地命中率',value:t.requests?Math.round(100*t.local_hits/t.requests):0,unit:'%',meta:'减少重复外部调用',icon:'shield'},{label:'平均响应',value:t.avg_ms,unit:'ms',meta:'所有查题请求的平均耗时',icon:'overview'}].map(m=><section className="metric" key={m.label}><div>{m.label}<span><Icon name={m.icon} size={17}/></span></div><strong>{fmt(m.value)}<em>{m.unit}</em></strong><small>{m.meta}</small></section>)}</div><div className="dashboard-grid"><section className="card"><div className="card-title"><div><h2>检索活动</h2><p>近 7 天的查询记录</p></div></div><div className="chart">{s.daily.map((d:any)=><div className="chart-col" key={d.day}><span>{d.count||''}</span><div style={{height:`${Math.max(3,140*d.count/Math.max(1,...s.daily.map((x:any)=>x.count)))}px`}}/><small>{d.day}</small></div>)}</div></section><section className="card"><div className="card-title"><div><h2>答案来源</h2><p>每次返回，都有来源可循</p></div><Icon name="providers" size={18}/></div>{s.sources.length?<div className="source-list">{s.sources.map((x:any,i:number)=><div key={x.source}><span className={`source-marker s${i%3}`}/><span>{x.source}</span><strong>{fmt(x.count)}<small>次</small></strong></div>)}</div>:<Empty text="等待第一次检索" detail="配置来源或添加本地题目，即可开始。"/>}<div className="mini-status"><span>未核验答案 <b>{q.unverified}</b></span><span>待处理冲突 <b>{q.conflicts}</b></span></div></section></div><section className="card recent"><div className="card-title"><div><h2>最近检索</h2><p>查看答案命中与逐级回退记录</p></div><Button className="text-button" onClick={()=>load()}><Icon name="refresh" size={15}/>刷新</Button></div>{s.recent.length?<div className="table-scroll"><table><thead><tr><th>题目</th><th>调用凭证</th><th>来源</th><th>状态</th><th>耗时</th><th>时间</th></tr></thead><tbody>{s.recent.slice(0,10).map((r:any)=><tr key={r.id}><td className="title-cell">{r.title}</td><td>{r.token_name??'后台查题'}</td><td>{r.source??'—'}</td><td><Badge tone={r.status==='hit'?'green':'gray'}>{r.status==='hit'?'已命中':'未命中'}</Badge></td><td>{r.duration_ms} ms</td><td>{date(r.created_at)}</td></tr>)}</tbody></table></div>:<Empty text="还没有查题记录" detail="在查题工作台试一题，或将配置添加到 OCS。"/>}</section></>}
