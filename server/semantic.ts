/**
 * @file semantic.ts
 * @project ocs-answer-hub
 * @module 本地向量与 RAG
 * @description 固定 BGE-small-zh-v1.5 INT8 本地推理、保守向量匹配和可信度过滤。
 * @logic PostgreSQL 保存向量及内容摘要；拒绝过期、歧义、冲突及不兼容候选，RAG 只读取人工核验数据。
 * @dependencies pg, @huggingface/transformers, search, security, concurrency
 * @index_tags embedding, pgvector, rag, local-inference
 * @author holic512
 */
import type pg from 'pg';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {canonicalAnswer,prepare,type Prepared} from './search.js';
import {digest} from './security.js';
import {ConcurrencyPool} from './concurrency.js';

export const EMBEDDING_MODEL='BAAI/bge-small-zh-v1.5:int8:cls:v1';
export const EMBEDDING_REVISION='75c43b069aac4d136ba6bc1122f995fedcfd2781';
export const EMBEDDING_SHA256='b9837c19ce154ff0726d398ee77abbc03a7faf0476c6f93016c84e531be7ebb5';
// These thresholds deliberately trade recall for precision; calibrate against reviewed questions before lowering.
export const SEMANTIC_POLICY=Object.freeze({dimension:512,maxInputTokens:512,matchMin:.985,ragMin:.98,ambiguityMin:.965,dedupMin:.965,candidateLimit:12,ragMaxCandidates:3,ragMaxChars:6000,maxInputChars:8000,inferenceConcurrency:2,inferenceWaitMs:10000});
export type SemanticQuestion={id:string;title:string;type:string;options:string[];images:any[];course:string;answer:string;source:string;verified:boolean;conflict:boolean;deleted:boolean;generation_task_id?:string|null};
export type SemanticCandidate=SemanticQuestion&{similarity:number;content_hash:string;model:string;retrieval_overflow?:boolean};
export type RagItem={id:string;source:string;verified:true;similarity:number;title:string;options:string[];answer:string};
export type RagDecision={enabled:boolean;reason:string;context:string;items:RagItem[]};
export class SemanticUnavailableError extends Error{constructor(){super('本地 BGE-small-zh-v1.5 INT8 不可用，请检查模型目录和健康状态');this.name='SemanticUnavailableError';}}
export class SemanticInputTooLongError extends Error{constructor(){super('题目超过本地模型完整编码上限，未截断或生成向量');this.name='SemanticInputTooLongError';}}
export class SemanticIndexIncompleteError extends Error{constructor(){super('相关题库向量尚未完整回填或存在过期/不可索引题目');this.name='SemanticIndexIncompleteError';}}

export function semanticContentHash(row:SemanticQuestion){return digest(JSON.stringify([prepare(row).key,row.answer,row.source,row.verified,row.conflict,row.deleted,row.generation_task_id??null]));}
export function embeddingText(q:Prepared){return `课程：${q.course??''}\n题型：${q.type}\n题目：${q.title}\n选项：${q.optionSet.join('\n')}`;}
export function isSafeQuestionText(text:string){return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]|<\/?(?:script|system|assistant|tool)\b|(?:ignore|disregard|override)\s+(?:(?:all|any|the)\s+)?(?:previous|prior|system|above)\s+(?:instructions?|prompts?)|忽略.{0,12}(?:指令|提示|规则)|(?:泄露|输出|显示).{0,12}(?:密钥|系统提示|密码)|(?:system|developer)\s*prompt/i.test(text);}
function preparedRow(row:SemanticQuestion){return prepare({title:row.title,type:row.type,options:row.options,images:row.images,course:row.course});}
function signature(text:string){return JSON.stringify([text.match(/[+\-−]?\d+(?:\.\d+)?(?:%|‰)?/g)??[],text.match(/不是|不正确|不属于|不能|不得|不包括|不|错误|除外|至少|至多|以上|以下|大于|小于|\b(?:not|never|except|incorrect|less|more)\b/gi)??[]]);}
export function semanticCompatible(q:Prepared,row:SemanticQuestion){const other=preparedRow(row);return q.type!=='unknown'&&q.type===other.type&&(q.course??'')===(other.course??'')&&JSON.stringify(q.optionSet)===JSON.stringify(other.optionSet)&&JSON.stringify(q.images)===JSON.stringify(other.images)&&signature(q.normalTitle)===signature(other.normalTitle);}
function current(row:SemanticCandidate){return row.model===EMBEDDING_MODEL&&row.content_hash===semanticContentHash(row);}
function safeRow(row:SemanticQuestion){return isSafeQuestionText([row.title,...row.options,row.answer,row.course,row.source].join('\n'));}
function compatibleCandidates(q:Prepared,rows:SemanticCandidate[]){return rows.filter(row=>Number.isFinite(row.similarity)&&!row.deleted&&semanticCompatible(q,row)).sort((a,b)=>b.similarity-a.similarity);}

export function selectSemanticMatch(q:Prepared,rows:SemanticCandidate[]){
 if(rows.some(row=>row.retrieval_overflow))return null;
 const near=compatibleCandidates(q,rows).filter(row=>row.similarity>=SEMANTIC_POLICY.ambiguityMin);
 if(near.length!==1||near.some(row=>!current(row)))return null;
 const row=near[0];
 if(row.similarity<SEMANTIC_POLICY.matchMin||row.conflict||!row.verified||!safeRow(row))return null;
 const answer=canonicalAnswer(canonicalAnswer(row.answer,preparedRow(row)),q);return answer?{row,answer,similarity:row.similarity}:null;
}
export function buildRag(q:Prepared,rows:SemanticCandidate[]):RagDecision{
 const empty=(reason:string):RagDecision=>({enabled:false,reason,context:'',items:[]});
 if(rows.some(row=>row.retrieval_overflow))return empty('candidate_limit');
 if(!rows.length)return empty('no_candidates');
 const candidates=compatibleCandidates(q,rows),near=candidates.filter(row=>row.similarity>=SEMANTIC_POLICY.ambiguityMin);
 if(near.some(row=>!current(row)))return empty('stale_candidate');
 if(!near.length)return empty(candidates.length?'low_similarity':'incompatible_or_stale');
 if(near.some(row=>row.conflict))return empty('conflicting_candidate');
 if(near.length>1)return empty('ambiguous_candidates');
 const filtered=near.filter(row=>row.similarity>=SEMANTIC_POLICY.ragMin&&row.verified&&!row.generation_task_id&&safeRow(row)&&canonicalAnswer(canonicalAnswer(row.answer,preparedRow(row)),q));
 if(!filtered.length)return empty('unverified_generated_unsafe_or_low_similarity');
 const items:RagItem[]=[];
 for(const row of filtered.slice(0,SEMANTIC_POLICY.ragMaxCandidates)){
  const item:RagItem={id:row.id,source:row.source,verified:true,similarity:row.similarity,title:row.title,options:row.options,answer:canonicalAnswer(row.answer,preparedRow(row))!};
  if(JSON.stringify([...items,item]).length>SEMANTIC_POLICY.ragMaxChars)continue;
  items.push(item);
 }
 return items.length?{enabled:true,reason:'verified_high_similarity_unique',context:JSON.stringify(items),items}:empty('context_budget');
}

export class SemanticService{
 private loader?:Promise<import('@huggingface/transformers').FeatureExtractionPipeline>;
 private ready=false;
 private reason='not_loaded';
 private queue=new ConcurrencyPool(SEMANTIC_POLICY.inferenceConcurrency);
 constructor(public pool:pg.Pool,private localPath=process.env.LOCAL_EMBEDDING_PATH){}
 async embed(text:string):Promise<number[]>{
  if(text.length>SEMANTIC_POLICY.maxInputChars)throw new SemanticInputTooLongError();
  const release=await this.queue.acquire(Date.now()+SEMANTIC_POLICY.inferenceWaitMs);
  if(!release)throw new SemanticUnavailableError();
  try{const extractor=await this.load();
   // The pipeline otherwise silently truncates at 512 tokens, hiding conditions near the end of a question.
   const tokens=extractor.tokenizer(text,{truncation:false,padding:false,return_tensor:false});
   if(tokens.input_ids.length>SEMANTIC_POLICY.maxInputTokens)throw new SemanticInputTooLongError();
   const output=await extractor(text,{pooling:'cls',normalize:true});const vector=Array.from(output.data,Number);if(vector.length!==SEMANTIC_POLICY.dimension||vector.some(value=>!Number.isFinite(value)))throw new Error('unexpected_embedding_dimension');this.ready=true;this.reason='ready';return vector;}
  catch(error){if(error instanceof SemanticInputTooLongError)throw error;this.ready=false;this.reason='local_model_unavailable';throw new SemanticUnavailableError();}
  finally{release();}
 }
 async indexQuestion(row:SemanticQuestion){
  let vector:number[];
  try{vector=await this.embed(embeddingText(preparedRow(row)));}
  catch(error){if(!(error instanceof SemanticInputTooLongError))throw error;
   await this.pool.query(`WITH removed AS (DELETE FROM question_vectors WHERE question_id=$1)
    INSERT INTO vector_index_skips(question_id,content_hash,model,reason) VALUES($1,$2,$3,'input_too_long')
    ON CONFLICT(question_id) DO UPDATE SET content_hash=EXCLUDED.content_hash,model=EXCLUDED.model,reason=EXCLUDED.reason,updated_at=now()`,[row.id,semanticContentHash(row),EMBEDDING_MODEL]);
   return {indexed:false,reason:'input_too_long'} as const;
  }
  await this.pool.query(`WITH cleared AS (DELETE FROM vector_index_skips WHERE question_id=$1)
   INSERT INTO question_vectors(question_id,embedding,content_hash,model) VALUES($1,$2::vector,$3,$4) ON CONFLICT(question_id) DO UPDATE SET embedding=EXCLUDED.embedding,content_hash=EXCLUDED.content_hash,model=EXCLUDED.model,updated_at=now()`,[row.id,JSON.stringify(vector),semanticContentHash(row),EMBEDDING_MODEL]);
  return {indexed:true} as const;
 }
 async candidates(q:Prepared):Promise<SemanticCandidate[]>{
  const vector=await this.embed(embeddingText(q));
  // Inspect the whole partition in one database snapshot: a missing vector must not become a hidden second candidate.
  const result=await this.pool.query(`SELECT q.*,v.content_hash,v.model,1-(v.embedding <=> $1::vector) AS similarity,s.question_id AS skipped_id
   FROM questions q LEFT JOIN question_vectors v ON v.question_id=q.id LEFT JOIN vector_index_skips s ON s.question_id=q.id
   WHERE NOT q.deleted AND q.type=$2 AND q.course=$3`,[JSON.stringify(vector),q.type,q.course??'']);
  if(result.rows.some(row=>row.skipped_id||!current(row)))throw new SemanticIndexIncompleteError();
  const rows:SemanticCandidate[]=result.rows.filter(row=>Number.isFinite(row.similarity)&&row.similarity>=SEMANTIC_POLICY.ambiguityMin).sort((a,b)=>b.similarity-a.similarity||a.id.localeCompare(b.id)).slice(0,SEMANTIC_POLICY.candidateLimit+1);
  return rows.map(row=>({...row,retrieval_overflow:rows.length>SEMANTIC_POLICY.candidateLimit}));
 }
 async match(q:Prepared,rows?:SemanticCandidate[]){try{return selectSemanticMatch(q,rows??await this.candidates(q));}catch(error){if(error instanceof SemanticUnavailableError||error instanceof SemanticInputTooLongError||error instanceof SemanticIndexIncompleteError)return null;throw error;}}
 async rag(q:Prepared,rows?:SemanticCandidate[]):Promise<RagDecision>{try{return buildRag(q,rows??await this.candidates(q));}catch(error){const reason=error instanceof SemanticUnavailableError?'model_unavailable':error instanceof SemanticInputTooLongError?'input_too_long':error instanceof SemanticIndexIncompleteError?'index_incomplete':null;if(reason)return {enabled:false,reason,context:'',items:[]};throw error;}}
 async health(){
  const extension=(await this.pool.query("SELECT extversion FROM pg_extension WHERE extname='vector'")).rows[0]?.extversion??null;
  const coverage=(await this.pool.query(`SELECT (SELECT count(*)::int FROM questions WHERE NOT deleted) total,(SELECT count(*)::int FROM question_vectors WHERE model=$1) indexed,(SELECT count(*)::int FROM vector_index_skips s JOIN questions q ON q.id=s.question_id WHERE NOT q.deleted) skipped`,[EMBEDDING_MODEL])).rows[0];
  if(this.localPath&&!this.loader)try{await this.embed('本地模型健康检查');}catch{}
  return {model:EMBEDDING_MODEL,dimension:SEMANTIC_POLICY.dimension,ready:this.ready,reason:this.localPath?this.reason:'model_path_not_configured',extension,coverage};
 }
 private load(){return this.loader??=this.initialize();}
 private async initialize(){
  try{
   if(!this.localPath||!path.isAbsolute(this.localPath))throw new Error('absolute_local_model_path_required');
   const config=JSON.parse(await readFile(path.join(this.localPath,'config.json'),'utf8'));
   if(config.model_type!=='bert'||config.hidden_size!==512||config.num_hidden_layers!==4||config.num_attention_heads!==8||config.vocab_size!==21128)throw new Error('bge_small_zh_v15_configuration_required');
   const weight=await readFile(path.join(this.localPath,'onnx/model_int8.onnx'));
   if(createHash('sha256').update(weight).digest('hex')!==EMBEDDING_SHA256)throw new Error('bge_int8_weight_checksum_mismatch');
   const {pipeline,env}=await import('@huggingface/transformers');
   env.allowRemoteModels=false;env.allowLocalModels=true;env.useFSCache=false;
   const extractor=await pipeline('feature-extraction',this.localPath,{dtype:'int8',device:'cpu',local_files_only:true,session_options:{intraOpNumThreads:2,interOpNumThreads:1}});
   this.ready=true;this.reason='ready';return extractor;
  }catch{this.ready=false;this.reason='local_model_unavailable';throw new SemanticUnavailableError();}
 }
}
