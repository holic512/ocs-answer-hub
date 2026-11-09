import {failureLabel,ragReasons} from '../lib/query-status';

export function QueryTrace({attempts=[]}:{attempts?:any[]}){
 return <div className="trace">{attempts.map((attempt,index)=><div key={index}>
  <span className={`trace-dot ${attempt.status==='hit'?'hit':''}`}/>
  <div className="trace-content"><strong>{attempt.source}</strong><small>{attempt.kind==='rag'||attempt.source==='RAG'?ragReasons[attempt.reason]??(attempt.status==='enabled'?'已启用参考':'已跳过参考'):attempt.message??(attempt.code?failureLabel(attempt.code):({hit:'已命中',miss:'未命中',error:'调用失败',skipped:'已跳过',conflict:'答案冲突'} as Record<string,string>)[attempt.status])}</small>
   {attempt.code&&<small>{attempt.stage?`${attempt.stage} · `:''}{attempt.code}{attempt.httpStatus?` · HTTP ${attempt.httpStatus}`:''}</small>}
   {attempt.candidateAnswer!==undefined&&<p className="candidate-answer">候选答案：{Array.isArray(attempt.candidateAnswer)?attempt.candidateAnswer.join(' # '):attempt.candidateAnswer}</p>}
   {attempt.ai&&<small>{attempt.ai.model} · {attempt.ai.apiFormat} · 输出上限 {attempt.ai.maxTokens}{attempt.ai.vision?' · 支持图片':''}</small>}
  </div><span>{attempt.durationMs!==undefined?`${attempt.durationMs} ms`:''}</span>
 </div>)}</div>;
}
