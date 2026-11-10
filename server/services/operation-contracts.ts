/**
 * @file operation-contracts.ts
 * @project ocs-answer-hub
 * @module services
 * @description 持久任务与计划的输入和实体契约。
 * @logic HTTP 与到期计划共用任务输入契约，数据库实体不含隐式 any。
 * @dependencies zod, core
 * @index_tags operations, contracts
 * @author holic512
 */
import {z} from 'zod';
import {idSchema} from '../core.js';
export const generationConfig=z.object({provider_id:idSchema,course:z.string().trim().min(1).max(200),seed_ids:z.array(idSchema).min(1).max(20),max_rounds:z.number().int().min(1).max(50).default(5),max_questions:z.number().int().min(1).max(500).default(50),batch_size:z.number().int().min(1).max(20).default(10)});
export type GenerationConfig=z.infer<typeof generationConfig>;
export const jobSchema=z.discriminatedUnion('kind',[generationConfig.extend({kind:z.literal('generation')}),z.object({kind:z.literal('backfill'),rebuild:z.boolean().default(false)})]);
export type JobInput=z.infer<typeof jobSchema>;
export const scheduleSchema=z.object({name:z.string().trim().min(1).max(100),kind:z.enum(['backfill','generation']),enabled:z.boolean().default(false),mode:z.enum(['interval','daily']).default('interval'),interval_minutes:z.number().int().min(1).max(10080).default(5),time_of_day:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).default('03:00'),config:z.record(z.string(),z.unknown()).default({})}).superRefine((d,ctx)=>{if(d.kind==='generation'&&!generationConfig.safeParse(d.config).success)ctx.addIssue({code:'custom',path:['config'],message:'生成计划需要课程、AI 和种子题'});});
export type ScheduleInput=z.infer<typeof scheduleSchema>;
export type Schedule=ScheduleInput&{id:string;user_id:number|null;next_run_at:Date;last_run_at:Date|null;created_at:Date;updated_at:Date};
export type Seed={id:string;title:string;type:string;options:string[];answer:string;course:string};
export type JobStatus='queued'|'running'|'completed'|'failed'|'cancelled';
export type Job={id:string;kind:'backfill'|'generation';user_id:number;provider_id:string|null;course:string;status:JobStatus;max_rounds:number;max_questions:number;batch_size:number;round:number;accepted:number;attempts:number;max_attempts:number;cancel_requested:boolean;lease_until:Date|null;lease_token:string|null;cursor_id:string|null;processed:number;skipped_count:number;error:string|null;seed_snapshot:Seed[];schedule_id:string|null;created_at:Date;updated_at:Date;merged?:boolean};
export type JobFilters={page:number;pageSize:number;kind?:Job['kind'];status?:JobStatus};
