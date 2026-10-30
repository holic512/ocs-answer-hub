import type {Diagnose} from './providers.js';

type Output={text:string;usage?:any};
const numericUsage=(u:any)=>u&&typeof u==='object'?Object.fromEntries(Object.entries(u).filter(([,v])=>typeof v==='number')):undefined;
const contentText=(content:any):string|undefined=>{
 if(typeof content==='string')return content;
 if(Array.isArray(content))return content.filter(c=>c&&(!c.type||['text','output_text'].includes(c.type))).map(c=>typeof c.text==='string'?c.text:typeof c.text?.value==='string'?c.text.value:'').join('');
 return undefined;
};
export function extractAiOutput(response:any,diagnose?:Diagnose):Output|null{
 const fail=(code:string,message:string)=>{diagnose?.({stage:'mapping',status:'failed',code,message});return null;};
 const wrapped=['data','result'].map(k=>response?.[k]).find(v=>v&&typeof v==='object'&&(v.choices||v.output||v.error||typeof v.output_text==='string'));
 const r=(response?.choices||response?.output||response?.error||response?.object==='response'||typeof response?.output_text==='string')?response:(wrapped??response);
 if(r?.error){const value=[r.error?.code,r.error?.type].filter(v=>typeof v==='string').join(' ').toLowerCase();const message=/model|deployment/.test(value)?'上游返回模型不可用或未找到，请检查模型名及模型权限':/auth|api.?key|permission/.test(value)?'上游返回鉴权或权限错误，请检查该来源API Key':/rate|quota|credit|balance/.test(value)?'上游返回限流或额度错误，请检查余额和请求额度':'上游返回业务错误，请检查模型、接口协议及参数（HTTP200不代表AI调用成功）';return fail('upstream_error',message);}
 const choice=r?.choices?.[0];
 if(choice){
  const reason=choice.finish_reason;
  if(reason==='length'||reason==='max_tokens')return fail('output_limit','模型输出被Token上限截断，尚未得到完整答案；请提高maxTokens或降低推理强度');
  if(reason==='content_filter'||choice.message?.refusal)return fail('model_refusal','模型拒绝回答或触发内容限制，未采用答案');
  let text=contentText(choice.message?.content);if(text===undefined)text=contentText(choice.text);
  if(text?.trim()){diagnose?.({stage:'provider',status:'passed',message:'AI最终回答提取成功'});return {text,usage:numericUsage(r.usage)};}
  if(choice.message?.reasoning_content||choice.message?.reasoning||choice.message?.analysis)return fail('reasoning_only','模型只返回推理内容，没有最终答案；不会把推理过程当答案');
  if(choice.delta)return fail('stream_response','上游返回流式增量，但本次请求需要完整非流式回答，请关闭上游强制流式');
  return fail('empty_answer','模型没有返回最终回答，请检查输出上限、模型能力及接口协议');
 }
 if(r?.object==='response'||Array.isArray(r?.output)||typeof r?.output_text==='string'){
  if(r.status==='failed')return fail('upstream_error','Responses接口报告生成失败，请检查模型及上游服务状态');
  if(r.status==='incomplete')return fail('output_limit','Responses输出未完成，请检查maxTokens和推理预算');
  if(['queued','in_progress'].includes(r.status))return fail('incomplete_response','上游任务仍在生成，本服务需要返回已完成的回答');
  const output=Array.isArray(r.output)?r.output:[];
  if(output.some((x:any)=>x?.type==='message'&&x.content?.some((c:any)=>c.type==='refusal')))return fail('model_refusal','模型拒绝回答，未采用答案');
  const text=typeof r.output_text==='string'?r.output_text:output.filter((x:any)=>x?.type==='message'&&(!x.role||x.role==='assistant')).map((x:any)=>contentText(x.content)??'').join('');
  if(text.trim()){diagnose?.({stage:'provider',status:'passed',message:'Responses兼容最终回答提取成功'});return {text,usage:numericUsage(r.usage)};}
  if(output.some((x:any)=>x?.type==='reasoning'))return fail('reasoning_only','上游仅返回推理项，没有最终回答，请增加输出预算');
  return fail('empty_answer','Responses接口未返回最终回答文本');
 }
 return fail('response_mapping','未识别到Chat Completions或Responses最终回答结构，请检查接口地址与协议选择');
}
