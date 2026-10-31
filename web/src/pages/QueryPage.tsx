/**
 * @file QueryPage.tsx
 * @project ocs-answer-hub
 * @module 查题工作台
 * @description 管理工作台查题工作台页面。
 * @logic 通过共享会话与请求模块完成页面操作，业务状态由页面维护。
 * @dependencies React, components/ui, context/app, lib/api
 * @index_tags query, page
 * @author holic512
 */
import { useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Empty,Heading,Icon,QuestionFields } from '../components/workspace';
import { api } from '../lib/api';
import { useApp } from '../context/app';
export default function QueryPage(){const {run}=useApp();const[result,setResult]=useState<any>(null),[pending,setPending]=useState(false);return <><Heading title="查题工作台" desc="与 OCS 使用相同的检索链路。测试会实际调用启用的上游，可能消耗其额度。"/><div className="query-grid"><section className="card"><div className="card-title"><h2>输入题目</h2></div><form onSubmit={e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));setPending(true);run(async()=>setResult(await api('/admin/query','POST',data))).finally(()=>setPending(false))}}><QuestionFields/><Button className="primary full" disabled={pending}><Icon name="query" size={17}/>{pending?'按优先级检索中…':'查找答案'}</Button></form></section><section className="card result-card"><div className="card-title"><h2>检索结果</h2>{result&&<Badge tone={result.code===1?'green':'gray'}>{result.code===1?'找到答案':'未命中'}</Badge>}</div>{pending?<div className="empty"><div className="spinner"/><strong>正在逐级查找</strong><span>命中后自动停止，并沉淀到本地题库。</span></div>:result?<><div className="answer-box"><small>{result.code===1?'答案':'检索状态'}</small><h3>{result.answer??result.message}</h3>{result.code===1&&<p>{result.source} · {result.verified?'人工已核验':'未核验，请自行确认'} · {result.durationMs} ms</p>}</div><h4>检索链路</h4><div className="trace">{result.attempts?.map((a:any,i:number)=><div key={i}><span className={`trace-dot ${a.status==='hit'?'hit':''}`}/><div><strong>{a.source}</strong><small>{a.message??({hit:'已命中',miss:'未命中',busy:'来源繁忙，已降级',skipped:'已跳过',error:'调用失败'} as any)[a.status]}</small></div><span>{a.durationMs!==undefined?`${a.durationMs} ms`:''}</span></div>)}</div></>:<Empty text="一个问题，一个可追溯的答案" detail="左侧填写题目，查看本地及外部来源如何逐级回退。"/>}</section></div></>}
