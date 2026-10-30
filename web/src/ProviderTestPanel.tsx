import {Button} from './components/ui/button';
import {Textarea, NativeSelect} from './components/ui/input';
import {Badge} from './components/ui/badge';
import {useState} from 'react';
type Props={provider:any;sourceId?:string;run:(fn:()=>Promise<any>)=>Promise<any>;api:(url:string,method?:string,body?:any)=>Promise<any>};
export default function ProviderTestPanel({provider,sourceId,run,api}:Props){
 const[title,setTitle]=useState('1+2等于几？'),[type,setType]=useState('single'),[options,setOptions]=useState('A. 2\nB. 3\nC. 4'),[result,setResult]=useState<any>(null),[pending,setPending]=useState(false);
 const types:Record<string,string>={single:'单选题',multiple:'多选题',judgement:'判断题',completion:'填空题',unknown:'其他'};
 const stages:Record<string,string>={config:'配置校验',dns:'域名解析',connect:'连接与传输',http:'HTTP状态',json:'JSON解析',response:'上游响应',provider:'业务状态',mapping:'响应字段',answer:'答案匹配',request:'请求诊断'};
 const execute=()=>{if(!title.trim())return;setPending(true);setResult(null);run(async()=>setResult(await api(sourceId?`/admin/providers/${sourceId}/test`:'/admin/providers/test','POST',{provider,question:{title,type,options}}))).finally(()=>setPending(false));};
 return <div className="provider-test-panel">
  <div className="notice neutral"><div><strong>仅测试「{provider.name}」</strong><p>跳过本地及其他来源，未启用也可测试；不保存配置、不入库、不计入查题统计。会实际请求上游，可能消耗题库或AI额度。</p></div></div>
  <div className="form-grid"><label className="field"><span>测试题型</span><NativeSelect aria-label="测试题型" value={type} onChange={e=>setType(e.target.value)}>{Object.entries(types).map(([k,v])=><option value={k} key={k}>{v}</option>)}</NativeSelect></label><div className="test-source-state"><Badge tone="gray">{provider.enabled?'来源已启用':'来源未启用，也可测试'}</Badge><small>使用当前配置 · 超时 {provider.timeout_ms/1000} 秒</small></div></div>
  <label className="field"><span>测试题目</span><Textarea aria-label="测试题目" rows={2} value={title} onChange={e=>setTitle(e.target.value)} required/></label>
  <label className="field"><span>测试选项</span><Textarea aria-label="测试选项" rows={3} value={options} onChange={e=>setOptions(e.target.value)}/><small>建议用该题库已有的题目；接口连通但未收录本题，不等于链路故障。</small></label>
  <Button type="button" className="primary full" disabled={pending||!title.trim()} onClick={execute}>{pending?'正在测试该来源…':'开始测试'}</Button>
  {pending&&<div className="test-wait" role="status"><div className="spinner"/>正在检查连接、响应解析与答案匹配…</div>}
  {result&&<section className="test-report" aria-label="题库源测试结果"><div className="test-report-heading"><div><Badge className={`${result.status==='passed'?'green':result.status==='no_answer'?'amber':'gray'}`}>{result.status==='passed'?'链路通过':result.status==='no_answer'?'接口已响应，本题未命中':'测试未通过'}</Badge><p>{result.reachable?'已收到上游响应':'未完成上游响应'} · {result.durationMs} ms{result.httpStatus?` · HTTP ${result.httpStatus}`:''}</p></div><Badge tone="gray">不入库</Badge></div>
  {result.warnings?.map((w:string,i:number)=><p className="test-warning" key={i}>{w}</p>)}
  {result.answer&&<div className="answer-box"><small>本次测试答案 · 未核验正确率</small><h3>{result.answer}</h3></div>}
  <ol className="test-chain">{result.steps?.map((step:any,i:number)=><li key={i}><span className={`test-step-symbol ${step.status}`}>{step.status==='passed'?'✓':step.status==='no_answer'?'—':'!'}</span><div><strong>{stages[step.stage]??step.stage}</strong><p>{step.message}</p></div>{step.durationMs!==undefined&&<small>{step.durationMs} ms</small>}</li>)}</ol></section>}
 </div>;
}
