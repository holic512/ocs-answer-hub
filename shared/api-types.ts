/**
 * @file api-types.ts
 * @project ocs-answer-hub
 * @module 业务接口契约
 * @description 工作台与管理页面使用的明确实体、结果和错误类型。
 * @logic 分页和实体字段与服务端响应对应，网络入口之外不传播任意类型。
 * @dependencies contracts
 * @index_tags contracts, workspace, management
 * @author holic512
 */
import type {CreditEntry,CreditSummary,Page,Question,QueryStatus,Role} from './contracts.js';
export type ApiError=Error&{status?:number;requestId?:string;fields?:Record<string,string>};
export type Session={id:number;role:Role;username:string;csrf:string;mustChange:boolean};
export type TokenDefaults={daily_limit:number;rpm:number;max_daily_limit:number;max_rpm:number};
export type Setup={required:boolean;registrationEnabled:boolean;registrationCredits:number;tokenDefaults:TokenDefaults};
export type User=CreditSummary&{id:number;username:string;role:Role;disabled:boolean;must_change:boolean;deleted_at:string|null;created_at:string};
export type Token={id:string;name:string;prefix:string;user_id:number;username:string;revoked:boolean;expires_at:string|null;daily_limit:number;rpm:number;day_count:number;last_used:string|null;created_at:string};
export type TokenWrite={name:string;daily_limit:number;rpm:number;expires_at:string|null};
export type TokenCreated={id:string;token:string;config:unknown};
export type AiConfig={baseUrl:string;apiKey:string;model:string;apiFormat?:'auto'|'chat'|'responses';maxTokens?:number;jsonMode?:boolean;outputMode?:'prompt'|'json_object'|'json_schema';vision?:boolean;enableThinking?:boolean};
export type AiWrite={name:string;kind:string;enabled:boolean;priority:number;timeout_ms:number;config:AiConfig};
export type AiProvider=AiWrite&{id:string;hasKey:boolean};
export type QuestionRecord=Omit<Question,'options'|'images'>&{id:string;options:string[];images:(string|{url:string})[];course:string;answer:string;hit_count:number;created_at:string;updated_at:string};
export type QuestionWrite=Question&{answer:string|string[]};
export type Revision={id:string;answer:string;operation:string;snapshot:QuestionWrite|null;created_at:string};
export type ImportPreview={total:number;valid:number;invalid:number[];duplicates?:number};
export type Attempt={source:string;kind?:string;status:string;durationMs?:number;reason?:string;message?:string;code?:string;stage?:string;httpStatus?:number;candidateAnswer?:string|string[];ai?:{model?:string;apiFormat?:string;maxTokens?:number;vision?:boolean}};
export type QueryResult={code:number;question:string;answer:string|null;source:string|null;failureCode?:string;message?:string;durationMs:number;requestId?:string;attempts:Attempt[]};
export type QueryEvent={id:string;title:string;status:QueryStatus;source:string|null;username?:string;user_id?:number;token_name:string|null;token_prefix?:string;duration_ms:number;created_at:string;failure_code:string|null;request_id?:string;query_id?:string;attempts:Attempt[];question_snapshot:Question|null;group_key?:string;approximate?:boolean;failure_count?:number;first_failure?:string;last_failure?:string};
export type QuerySummary={requests:number;hits:number;failed:number;pending:number};
export type HistoryPage=Page<QueryEvent>&{summary:QuerySummary;sources:string[]};
export type Overview={totals:QuerySummary&{local_hits:number;avg_ms:number};questions:{total:number};daily:{day:string;count:number}[];sources:{source:string;count:number;avg_ms:number}[];recent:QueryEvent[]};
export type CreditPage=Page<CreditEntry>&CreditSummary;
export type Usage=CreditSummary&{id:number;username:string;role:Role;requests:number;hits:number};
export type GenerationConfig={provider_id:string;course:string;seed_ids:string[];max_rounds:number;max_questions:number;batch_size:number};
export type Job={id:string;kind:'backfill'|'generation';course:string;status:'queued'|'running'|'completed'|'failed'|'cancelled';processed:number;accepted:number;round:number;max_rounds:number;max_questions:number;skipped_count:number;attempts:number;max_attempts:number;cancel_requested:boolean;error:string|null;created_at:string;updated_at:string};
export type GenerationPreview={id:string;round:number;question_id:string|null;data:Partial<QuestionWrite>;status:string;reason:string|null;created_at:string};
export type ExecutionPage=Page<GenerationPreview>&{job:Job};
export type Schedule={id:string;name:string;kind:'backfill'|'generation';enabled:boolean;mode:'interval'|'daily';interval_minutes:number;time_of_day:string;config:Partial<GenerationConfig>;next_run_at:string;last_run_at:string|null};
export type ScheduleWrite=Omit<Schedule,'id'|'next_run_at'|'last_run_at'>;
export type VectorHealth={ready:boolean;reason:string;extension:string|null;coverage:{total:number;indexed:number;pending:number;skipped:number};skips:{id:string;title:string;course:string;reason:string;updated_at:string}[]};
export type ProbeStep={stage:string;status:string;message:string;durationMs?:number};
export type ProbeResult={status:'passed'|'no_answer'|'failed';reachable:boolean;durationMs:number;httpStatus?:number;requestId?:string;warnings:string[];answer:string|null;steps:ProbeStep[]};
