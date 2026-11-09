/**
 * @file HistoryPage.tsx
 * @project ocs-answer-hub
 * @module 查询记录
 * @description 按权限查看查询记录、聚合重复失败和导出失败题目。
 * @logic URL 保存筛选与页码，详情展示请求快照及逐源诊断，失败分组保留逐次历史。
 * @dependencies React, react-router, lib/api, components/ui, QueryTrace
 * @index_tags history, failures, export
 * @author holic512
 */
import {useEffect,useState} from 'react';
import {useSearchParams} from 'react-router';
import {Button} from '../components/ui/button';
import {Badge} from '../components/ui/badge';
import {Input} from '../components/ui/input';
import {Select} from '../components/ui/select';
import {Modal} from '../components/ui/dialog';
import {Empty,Field,Heading,labels} from '../components/workspace';
import {QueryTrace} from '../components/QueryTrace';
import {useApp} from '../context/app';
import {api} from '../lib/api';
import {date,download,fmt} from '../lib/format';
import {failureLabel,queryStatuses} from '../lib/query-status';

export default function HistoryPage(){
 const {user,run,busy}=useApp();const [params,setParams]=useSearchParams();
 const [response,setResponse]=useState<any>(null),[users,setUsers]=useState<any[]>([]),[detail,setDetail]=useState<any>(null);
 const endpoint=user?.role==='admin'?'/admin/query-events':'/workspace/query-events';
 const query=params.toString(),grouped=params.get('view')==='failures',page=Number(params.get('page')??1);
 const responseKey=`${endpoint}?${query}`,data=response?.key===responseKey?response.data:null;
 useEffect(()=>{let active=true;void run(async()=>{const result=await api(`${endpoint}?${query}`);if(active)setResponse({key:responseKey,data:result});});return()=>{active=false;};},[endpoint,query]);
 useEffect(()=>{if(user?.role==='admin')void run(async()=>setUsers((await api('/admin/users')).items));},[user?.role]);
 function change(values:Record<string,string>){const next=new URLSearchParams(params);for(const [key,value]of Object.entries(values)){if(value&&value!=='__all__')next.set(key,value);else next.delete(key);}next.delete('page');setParams(next);}
 async function open(id:string,groupKey?:string,groupPage=1){
  const item=(await api(`${endpoint}/${id}`)).item;
  let related:any=null;
  if(groupKey){const filters=new URLSearchParams(params);filters.set('view','records');filters.set('status','failed');filters.set('group_key',groupKey);filters.set('page',String(groupPage));related=await api(`${endpoint}?${filters}`);}
  setDetail({item,related,groupKey,groupPage});
 }
 const summary=data?.summary;
 return <><Heading title="查询记录"><Button className="secondary" disabled={busy} onClick={()=>run(async()=>{const filters=new URLSearchParams(params);filters.delete('page');download('知序-失败题目.json',await api(`${endpoint}/export?${filters}`));})}>导出失败题目</Button></Heading>
  <div className="history-summary" aria-label="查询统计">{[['all','全部',summary?.requests],['hit','成功',summary?.hits],['failed','失败',summary?.failed],['pending','处理中',summary?.pending]].map(([status,label,count])=><Button key={status} className={(params.get('status')??'all')===status?'secondary':''} onClick={()=>change({status:String(status),view:status==='failed'?'failures':'records'})}>{label} <strong>{count===undefined?'—':fmt(count)}</strong></Button>)}</div>
  <section className="card history-card">
   <form className="history-filters" key={query} onSubmit={event=>{event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget)) as Record<string,string>;change({...values,view:grouped&&values.status==='failed'?'failures':'records'});}}>
    <Field label="题目"><Input name="q" defaultValue={params.get('q')??''} placeholder="搜索题干" maxLength={300}/></Field>
    <Field label="状态"><Select name="status" defaultValue={params.get('status')??'all'}><option value="all">全部状态</option><option value="failed">全部失败</option>{Object.entries(queryStatuses).map(([key,value])=><option value={key} key={key}>{value}</option>)}</Select></Field>
    <Field label="来源"><Select name="source" defaultValue={params.get('source')??'__all__'}><option value="__all__">全部来源</option>{(data?.sources??[]).map((source:string)=><option value={source} key={source}>{source}</option>)}</Select></Field>
    <Field label="开始日期"><Input type="date" name="from" defaultValue={params.get('from')??''}/></Field>
    <Field label="结束日期"><Input type="date" name="to" defaultValue={params.get('to')??''}/></Field>
    {user?.role==='admin'&&<Field label="用户"><Select name="user_id" defaultValue={params.get('user_id')??'__all__'}><option value="__all__">全部用户</option>{users.map(item=><option value={item.id} key={item.id}>{item.username}</option>)}</Select></Field>}
    <Button className="secondary" disabled={busy}>筛选</Button><Button type="button" onClick={()=>setParams({})}>重置</Button>
   </form>
   <div className="history-view"><div role="group" aria-label="记录视图"><Button className={!grouped?'secondary':''} onClick={()=>change({view:'records'})}>逐次记录</Button><Button className={grouped?'secondary':''} onClick={()=>change({view:'failures',status:'failed'})}>重复失败</Button></div><span className="muted">{data?`共 ${fmt(data.total)} ${grouped?'组':'条'}`:'正在读取…'}</span></div>
   {data?.items.length?<div className="table-scroll"><table className="history-table"><thead><tr><th>题目</th>{grouped?<><th>失败次数</th><th>最近原因</th><th>首次 / 最近失败</th></>:<><th>状态</th><th>来源 / 失败原因</th><th>时间</th></>}<th>操作</th></tr></thead><tbody>{data.items.map((row:any)=><tr key={grouped?row.group_key:row.id}>
    <td className="history-question"><span>{row.title}</span><small className="history-mobile-meta muted">{grouped||!['hit','pending'].includes(row.status)?failureLabel(row.failure_code):row.status==='hit'?row.source:''}<span className="block">{date(grouped?row.last_failure:row.created_at)}</span></small>{row.approximate&&<small className="muted block">历史记录 · 按题干近似分组</small>}</td>
    {grouped?<><td><strong>{row.failure_count} 次</strong></td><td className="history-reason">{failureLabel(row.failure_code)}</td><td>{date(row.first_failure)}<small className="block muted">{date(row.last_failure)}</small></td></>:<><td><Badge tone={row.status==='hit'?'green':row.status==='pending'?'gray':'amber'}>{queryStatuses[row.status]??row.status}</Badge></td><td className="history-reason">{row.status==='hit'?row.source:row.status==='pending'?'—':failureLabel(row.failure_code)}</td><td>{date(row.created_at)}</td></>}
    <td><Button className="secondary" disabled={busy} onClick={()=>run(()=>open(row.id,grouped?row.group_key:undefined))}>详情</Button></td>
   </tr>)}</tbody></table></div>:<Empty text={data?'没有符合条件的记录':'正在读取查询记录'} detail={data?'调整筛选条件，或在查题工作台提交题目。':'请稍候。'}/>}
   <div className="pagination"><span>第 {page} 页</span><Button disabled={busy||page<=1} onClick={()=>{const next=new URLSearchParams(params);next.set('page',String(page-1));setParams(next);}}>上一页</Button><Button disabled={busy||!data||page*data.pageSize>=data.total} onClick={()=>{const next=new URLSearchParams(params);next.set('page',String(page+1));setParams(next);}}>下一页</Button></div>
  </section>
  {detail&&<Modal title="查询详情" onClose={()=>setDetail(null)}>
   <h3 className="history-detail-title">{detail.item.title}</h3><p className="muted">{queryStatuses[detail.item.status]} · {new Date(detail.item.created_at).toLocaleString()} · {detail.item.duration_ms} ms</p>
   {detail.item.question_snapshot?<><p>{labels[detail.item.question_snapshot.type]??'其他'}{detail.item.question_snapshot.course?` · ${detail.item.question_snapshot.course}`:''}</p>{detail.item.question_snapshot.options&&<pre className="history-options">{Array.isArray(detail.item.question_snapshot.options)?detail.item.question_snapshot.options.join('\n'):detail.item.question_snapshot.options}</pre>}{detail.item.question_snapshot.images?.length>0&&<p>图片：{detail.item.question_snapshot.images.map((image:any,index:number)=><span className="block history-image-url" key={index}>{typeof image==='string'?image:image.url}</span>)}</p>}</>:<p className="notice">历史记录未保存完整题目，选项、图片和课程无法恢复。</p>}
   {detail.item.failure_code&&<p className="history-failure">{failureLabel(detail.item.failure_code)}</p>}
   <QueryTrace attempts={detail.item.attempts}/>
   <dl className="query-identifiers"><dt>请求编号</dt><dd>{detail.item.request_id??'历史记录未保存'}</dd><dt>执行编号</dt><dd>{detail.item.query_id??'历史记录未保存'}</dd></dl>
   {detail.related&&<div className="related-failures"><h3>本组失败记录 · {detail.related.total} 次</h3>{detail.related.items.map((event:any)=><Button className={event.id===detail.item.id?'secondary':''} key={event.id} disabled={busy} onClick={()=>run(()=>open(event.id,detail.groupKey,detail.groupPage))}>{date(event.created_at)} · {failureLabel(event.failure_code)}</Button>)}<div className="pagination"><span>第 {detail.groupPage} 页</span><Button disabled={busy||detail.groupPage<=1} onClick={()=>run(()=>open(detail.item.id,detail.groupKey,detail.groupPage-1))}>上一页</Button><Button disabled={busy||detail.groupPage*detail.related.pageSize>=detail.related.total} onClick={()=>run(()=>open(detail.item.id,detail.groupKey,detail.groupPage+1))}>下一页</Button></div></div>}
  </Modal>}
 </>;
}
