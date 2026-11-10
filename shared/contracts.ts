/**
 * @file contracts.ts
 * @project ocs-answer-hub
 * @module 共享契约
 * @description 前后端共享分页、积分和查询身份类型。
 * @logic 数据由 API 边界校验，业务层传递确定类型。
 * @dependencies none
 * @index_tags contracts, api
 * @author holic512
 */
export type Page<T>={items:T[];total:number;page:number;pageSize:number};
export type Role='admin'|'user';
export type CreditSummary={balance:number;frozen:number;available:number};
export type QueryStatus='pending'|'hit'|'miss'|'error'|'rejected';
export type Question={title:string;type:'single'|'multiple'|'judgement'|'completion'|'unknown';options?:string|string[];course?:string;images?:(string|{url:string})[]};
export type WorkspaceQuery=Question&{tokenId:string};
export type CreditEntry={id:string;amount:number;balance:number;reason:string;actor_name:string|null;event_id:string|null;created_at:string};
