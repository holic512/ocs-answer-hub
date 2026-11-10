/**
 * @file providers.ts
 * @project ocs-answer-hub
 * @module AI 适配
 * @description OpenAI 兼容 Chat/Responses 请求、答案校验和单次格式修正。
 * @logic 使用配置指定输出模式，完整输出格式失败才在剩余预算内修正，不采用推理或截断内容。
 * @dependencies security, search, ai-output, ai/prompts
 * @index_tags ai, protocol, validation
 * @author holic512
 */
import {z} from 'zod';
import type {RagDecision} from './semantic.js';
import {safeRequest,validateUrl} from './security.js';
import {extractAiOutput} from './ai-output.js';
import {canonicalAnswer,type Prepared} from './search.js';
import {AI_SYSTEM,ANSWER_SCHEMA,answerPrompt} from './ai/prompts.js';
export type AiConfig={baseUrl:string;apiKey:string;model:string;apiFormat?:'auto'|'chat'|'responses';maxTokens?:number;jsonMode?:boolean;outputMode?:'prompt'|'json_object'|'json_schema';vision?:boolean;enableThinking?:boolean};
export type Provider={id:string;name:string;kind:'ai';enabled:boolean;priority?:number;timeout_ms:number;config:AiConfig};
export type ProviderResult={answer:string;question:string;usage?:Record<string,number>;ai:boolean};
export type Transport=typeof safeRequest;
export type ProviderDiagnostic={stage:'provider'|'mapping'|'answer';status:'passed'|'failed'|'no_answer';message:string;code?:string;details?:{answerType?:string;answer?:unknown;questionType?:string;choices?:string[];output?:string}};
export type Diagnose=(event:ProviderDiagnostic)=>void;
export const aiConfigSchema=z.object({baseUrl:z.string().min(1).max(2000),apiKey:z.string().min(1).max(2000),model:z.string().trim().min(1).max(200),maxTokens:z.number().int().min(64).max(16384).default(1500),apiFormat:z.enum(['auto','chat','responses']).default('auto'),outputMode:z.enum(['prompt','json_object','json_schema']).optional(),jsonMode:z.boolean().optional(),vision:z.boolean().default(false),enableThinking:z.boolean().optional()});
export function validateProvider(kind:string,config:unknown){if(kind!=='ai')throw new Error('仅支持 AI 配置');const parsed=aiConfigSchema.parse(config);validateUrl(parsed.baseUrl);}
const answerEnvelope=z.object({answer:z.union([z.string(),z.array(z.string()),z.null()])}).strict();
export async function queryProvider(p:Provider,q:Prepared,timeout:number,transport:Transport=safeRequest,diagnose?:Diagnose,rag?:RagDecision):Promise<ProviderResult|null>{
 const deadline=Date.now()+timeout,prompt=answerPrompt(q,rag?.enabled?rag.context:undefined);
 let repair='';
 for(let attempt=0;attempt<2;attempt++){
  const remaining=deadline-Date.now();if(remaining<1)return null;
  const output=await requestAi(p,prompt+repair,remaining,transport,q.images,AI_SYSTEM,diagnose,ANSWER_SCHEMA);if(!output)return null;
  let raw:unknown;
  try{raw=answerEnvelope.parse(JSON.parse(output.text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''))).answer;}
  catch{if(!attempt&&deadline-Date.now()>100){repair='\n上次输出格式不符合约定。请重新求解，仅输出包含 answer 的 JSON 对象。';continue;}diagnose?.({stage:'mapping',status:'failed',code:'response_mapping',message:'模型输出不符合答案 JSON 契约'});return null;}
  if(raw===null||raw===''||Array.isArray(raw)&&!raw.length){diagnose?.({stage:'answer',status:'no_answer',message:'AI 无法确定答案'});return null;}
  const mapped=Array.isArray(raw)?raw.map(value=>optionValue(value,q)):optionValue(raw as string,q);
  const answer=canonicalAnswer(mapped,q);
  if(answer){diagnose?.({stage:'answer',status:'passed',message:'答案结构与题型匹配通过'});return {answer,question:q.title,ai:true,usage:output.usage};}
  if(!attempt&&deadline-Date.now()>100){repair='\n上次答案无法映射当前选项。请核对选项 id 和题型重新作答；无法确定时 answer 为 null。';continue;}
  diagnose?.({stage:'answer',status:'failed',code:'answer_mismatch',message:'答案无法匹配当前题型或选项',details:{answer:raw,questionType:q.type,choices:q.choices}});return null;
 }
 return null;
}
function optionValue(value:string,q:Prepared){const match=/^o([1-9]\d*)$/.exec(value);return match&&(q.type==='single'||q.type==='multiple')?q.choices[Number(match[1])-1]??value:value;}
export async function requestAi(p:Provider,text:string,timeout:number,transport:Transport=safeRequest,images:(string|{url:string})[]=[],system=AI_SYSTEM,diagnose?:Diagnose,schema:object=ANSWER_SCHEMA){
 const c=p.config,base=new URL(c.baseUrl),specified=c.apiFormat??'auto',format=specified==='responses'||specified==='auto'&&/\/responses\/?$/.test(base.pathname)?'responses':'chat';
 const root=base.pathname.replace(/\/(?:chat\/completions|responses)\/?$/,'').replace(/\/+$/,'');base.pathname=`${root}/${format==='responses'?'responses':'chat/completions'}`;
 const content:Record<string,unknown>[]=[{type:format==='responses'?'input_text':'text',text}];
 if(c.vision)for(const image of images){const url=typeof image==='string'?image:image.url;validateUrl(url);content.push(format==='responses'?{type:'input_image',image_url:url}:{type:'image_url',image_url:{url}});}
 const budget=c.maxTokens??1500,mode=c.outputMode??(c.jsonMode?'json_object':'prompt');
 const outputFormat=mode==='json_schema'?{type:'json_schema',name:'quiz_output',strict:true,schema}:{type:'json_object'};
 const payload:Record<string,unknown>=format==='responses'?{model:c.model,instructions:system,input:[{role:'user',content}],max_output_tokens:budget,stream:false,...(mode!=='prompt'?{text:{format:outputFormat}}:{})}:{model:c.model,messages:[{role:'system',content:system},{role:'user',content:c.vision?content:text}],max_tokens:budget,stream:false,...(mode==='json_schema'?{response_format:{type:'json_schema',json_schema:{name:'quiz_output',strict:true,schema}}}:mode==='json_object'?{response_format:{type:'json_object'}}:{})};
 const thinking=c.enableThinking??(/^agnes-/i.test(c.model)?false:undefined);if(format==='chat'&&thinking!==undefined)payload.chat_template_kwargs={enable_thinking:thinking};
 return extractAiOutput(await transport(base.toString(),'POST',{'Content-Type':'application/json',Authorization:`Bearer ${c.apiKey}`},payload,timeout),diagnose);
}
