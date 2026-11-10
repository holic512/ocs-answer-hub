/**
 * @file core.ts
 * @project ocs-answer-hub
 * @module HTTP 公共契约
 * @description 请求身份、分页、事务与输入边界。
 * @logic 入口校验后使用类型明确的身份和分页，业务事务统一提交或回滚。
 * @dependencies fastify, pg, zod
 * @index_tags contracts, transaction, pagination
 * @author holic512
 */
import type {FastifyRequest} from 'fastify';
import type pg from 'pg';
import {z} from 'zod';
export type Actor={id:number;username:string;role:'admin'|'user';must_change:boolean;csrf:string};
declare module 'fastify' {interface FastifyRequest {actor:Actor}}
export const fail=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export const idSchema=z.string().uuid();
export const userIdSchema=z.coerce.number().int().positive().max(2147483647);
export const paginationSchema=z.object({page:z.coerce.number().int().min(1).max(1000000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(30)});
export const questionSchema=z.object({title:z.string().trim().min(1).max(8000),options:z.union([z.string().max(20000),z.array(z.string().max(2000)).max(50)]).optional(),type:z.enum(['single','multiple','judgement','completion','unknown']).default('unknown'),images:z.array(z.union([z.string().max(20000),z.object({url:z.string().max(20000)})])).max(10).optional(),suggestion_title:z.string().max(8000).optional(),suggestion_options:z.string().max(20000).optional(),course:z.string().trim().max(200).optional()});
export function actor(req:FastifyRequest){return req.actor;}
export async function transaction<T>(pool:pg.Pool,work:(client:pg.PoolClient)=>Promise<T>):Promise<T>{const c=await pool.connect();try{await c.query('BEGIN');const result=await work(c);await c.query('COMMIT');return result;}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}}
