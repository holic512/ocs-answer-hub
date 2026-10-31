/**
 * @file QueryPage.tsx
 * @project ocs-answer-hub
 * @module 查题工作台
 * @description 多用户统一查题、剩余额度与个人历史页面。
 * @logic 通过共享会话与请求模块完成页面操作，业务状态由页面维护。
 * @dependencies React, components/ui, context/app, lib/api
 * @index_tags query, page
 * @author holic512
 */
import { useState,useEffect } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Empty,Field,Heading,Icon,QuestionFields } from '../components/workspace';
import {Input} from '../components/ui/input';
import { api } from '../lib/api';
import { useApp } from '../context/app';
export default function QueryPage(){const {run}=useApp();const[result,setResult]=useState<any>(null),[pending,setPending]=useState(false),[usage,setUsage]=useState<any>(null),[recent,setRecent]=useState<any[]>([]);async function refresh(){const [u,r]=await Promise.all([api('/workspace/usage'),api('/workspace/recent')]);setUsage(u);setRecent(r.items);}useEffect(()=>{void run(refresh);},[]);return <><Heading title="查题工作台" desc="本地题库优先，未命中时按来源逐级检索。每次查题计入当前账号额度。"/><p role="status">{usage?`今日已用 ${usage.day_count} / ${usage.daily_limit} 次 · 剩余 ${usage.remaining} 次 · 每分钟 ${usage.rpm} 次`:'正在读取额度…'}</p><div className="query-grid"><section className="card"><div className="card-title"><h2>输入题目</h2></div><form onSubmit={e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));setPending(true);run(async()=>{setResult(null);try{setResult(await api('/workspace/query','POST',data));}finally{await refresh();}}).finally(()=>setPending(false))}}><QuestionFields/><Field label="课程（可选）" hint="与题库课程保持一致，可提高匹配准确性。"><Input name="course" maxLength={200}/></Field><Button className="primary full" disabled={pending}><Icon name="query" size={17}/>{pending?'按优先级检索中…':'查找答案'}</Button></form></section><section className="card result-card"><div className="card-title"><h2>检索结果</h2>{result&&<Badge tone={result.code===1?'green':'gray'}>{result.code===1?'找到答案':'未命中'}</Badge>}</div>{pending?<div className="empty"><div className="spinner"/><strong>正在逐级查找</strong><span>命中后自动停止，并沉淀到本地题库。</span></div>:result?<><div className="answer-box"><small>{result.code===1?'答案':'检索状态'}</small><h3>{result.answer??result.message}</h3>{result.code===1&&<p>{result.source} · {result.verified?'人工已核验':'未核验，请自行确认'} · {result.durationMs} ms</p>}</div><h4>检索链路</h4><div className="trace">{result.attempts?.map((a:any,i:number)=><div key={i}><span className={`trace-dot ${a.status==='hit'?'hit':''}`}/><div><strong>{a.source}</strong><small>{a.message??({hit:'已命中',miss:'未命中',busy:'来源繁忙，已降级',skipped:'已跳过',error:'调用失败'} as any)[a.status]}</small></div><span>{a.durationMs!==undefined?`${a.durationMs} ms`:''}</span></div>)}</div></>:<Empty text="一个问题，一个可追溯的答案" detail="左侧填写题目，查看本地及外部来源如何逐级回退。"/>}</section></div><section className="card"><div className="card-title"><h2>最近查题</h2></div>{recent.length?<div className="table-scroll"><table><thead><tr><th>题目</th><th>状态</th><th>来源</th><th>时间</th></tr></thead><tbody>{recent.map(r=><tr key={r.id}><td>{r.title}</td><td>{({hit:'已命中',miss:'未命中',pending:'已受理',error:'失败',rejected:'繁忙'} as any)[r.status]??r.status}</td><td>{r.source??'—'}</td><td>{new Date(r.created_at).toLocaleString()}</td></tr>)}</tbody></table></div>:<Empty text="还没有查题记录" detail="提交题目后，这里会显示你的检索记录。"/>}</section></>}
