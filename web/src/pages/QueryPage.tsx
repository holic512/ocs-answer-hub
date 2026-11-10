import type {Page} from '../../../shared/contracts';
import type {Token,Usage,QueryResult} from '../../../shared/api-types';
/**
 * @file QueryPage.tsx
 * @project ocs-answer-hub
 * @module 查题工作台
 * @description 使用本人凭证查题并展示答案、消费结果和调用链。
 * @logic 凭证选择与题目表单提交服务端；仅成功答案扣1积分，失败保留原输入。
 * @dependencies react-hook-form, zod, hooks/use-resource, components/ui
 * @index_tags query, credentials, credits
 * @author holic512
 */
import {useState} from 'react';
import {Link} from 'react-router';
import {Controller,useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {Search,Copy} from 'lucide-react';
import {Button} from '../components/ui/button';
import {Input,Textarea} from '../components/ui/input';
import {Select} from '../components/ui/select';
import {Badge} from '../components/ui/badge';
import {FormField} from '../components/ui/form';
import {Feedback} from '../components/ui/alert';
import {Empty,Heading,labels} from '../components/workspace';
import {QueryTrace} from '../components/QueryTrace';
import {useResource,useAction} from '../hooks/use-resource';
import {api} from '../lib/api';
import {failureLabel} from '../lib/query-status';
const schema=z.object({tokenId:z.string().min(1,'请选择有效凭证'),title:z.string().trim().min(1,'请输入题目').max(8000),type:z.string(),options:z.string(),course:z.string().max(200),images:z.string()});
type Values=z.infer<typeof schema>;
export default function QueryPage(){
 const tokens=useResource<Page<Token>>('/workspace/tokens?pageSize=100'),usage=useResource<Usage>('/workspace/usage'),action=useAction(),copy=useAction();const [result,setResult]=useState<QueryResult|null>(null);
 const form=useForm<Values>({resolver:zodResolver(schema),defaultValues:{tokenId:'',title:'',type:'single',options:'',course:'',images:''}});
 const valid=(tokens.data?.items??[]).filter((t)=>!t.revoked&&(!t.expires_at||new Date(t.expires_at)>new Date()));
 async function submit(data:Values){setResult(null);await action.execute(async()=>{const answer=await api<QueryResult>('/workspace/query','POST',{...data,images:data.images.split('\n').map(x=>x.trim()).filter(Boolean)});setResult(answer);await usage.reload();});}
 return <><Heading title="查题工作台" desc="先检索本地题库，未命中时由 AI 作答。"><div className="query-usage">可用 <strong>{usage.data?.available??'—'}</strong> 积分<span>成功一次使用 1 积分</span></div></Heading><Feedback error={tokens.error||usage.error}/><div className="query-grid"><section className="card"><form onSubmit={form.handleSubmit(submit)} noValidate><FormField label="调用凭证" hint="网页查询同样使用凭证的每日和每分钟限额。" error={form.formState.errors.tokenId?.message}><Controller name="tokenId" control={form.control} render={({field})=><Select value={field.value} onChange={e=>field.onChange(e.target.value)}><option value="">请选择凭证</option>{valid.map((t)=><option key={t.id} value={t.id}>{t.name} · {t.daily_limit} 次/日</option>)}</Select>}/></FormField>{!tokens.loading&&!valid.length&&<p className="inline-note">还没有有效凭证，先<Link to="/tokens">创建调用凭证</Link>。</p>}<div className="form-grid"><FormField label="题型"><Controller name="type" control={form.control} render={({field})=><Select value={field.value} onChange={e=>field.onChange(e.target.value)}>{Object.entries(labels).map(([k,v])=><option value={k} key={k}>{v}</option>)}</Select>}/></FormField><FormField label="课程（可选）" error={form.formState.errors.course?.message}><Input {...form.register('course')} placeholder="用于匹配本地题目"/></FormField></div><FormField label="题目" error={form.formState.errors.title?.message}><Textarea rows={4} {...form.register('title')} placeholder="输入完整题干，保留数字、单位和否定词"/></FormField><FormField label="选项" hint="单选和多选每行一个选项，判断与填空可留空。"><Textarea rows={4} {...form.register('options')} placeholder={'A. 选项一\nB. 选项二'}/></FormField><details className="advanced-fields"><summary>图片题设置</summary><FormField label="图片地址" hint="每行一个 HTTP / HTTPS 地址，AI 配置需支持图片。"><Textarea rows={2} {...form.register('images')}/></FormField></details><Feedback error={action.error}/><Button variant="default" className="full" disabled={action.pending||!valid.length}><Search size={16}/>{action.pending?'正在查题…':'查询答案'}</Button></form></section><section className="card result-card" aria-live="polite"><div className="card-title"><h2>查询结果</h2>{result&&<Badge tone={result.code===1?'green':'amber'}>{result.code===1?'查询成功':'未获得答案'}</Badge>}</div>{action.pending?<div className="empty" role="status"><div className="spinner"/><strong>正在检索与作答</strong><span>请保留当前页面。</span></div>:result?<><div className="answer-box"><small>{result.code===1?'答案':failureLabel(result.failureCode)}</small><h3>{result.answer??result.message??'请调整题目或稍后重试。'}</h3>{result.code===1&&<div className="section-toolbar"><span className="muted">{result.source} · {result.durationMs} ms · 消费 1 积分</span><Button size="sm" aria-label="复制答案" onClick={()=>copy.execute(()=>navigator.clipboard.writeText(result.answer??''),'答案已复制')}><Copy size={15}/>复制</Button></div>}</div><Feedback error={copy.error} message={copy.message}/><details className="advanced-fields"><summary>查看查询链路</summary><QueryTrace attempts={result.attempts}/>{result.requestId&&<p className="muted mono">请求编号：{result.requestId}</p>}</details><Button asChild variant="outline"><Link to="/history">查看我的查询记录</Link></Button></>:<Empty text="输入题目开始查询" detail="成功返回答案后才会消费积分。"/>}</section></div></>;
}
