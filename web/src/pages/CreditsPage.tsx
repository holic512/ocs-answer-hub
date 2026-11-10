import type {CreditPage} from '../../../shared/api-types';
/**
 * @file CreditsPage.tsx
 * @project ocs-answer-hub
 * @module 积分账本
 * @description 展示账号可用积分、冻结积分与逐笔收支。
 * @logic 个人和管理员用户详情复用分页账本，数据从服务端加载。
 * @dependencies hooks/use-resource, components/ui
 * @index_tags credits, ledger
 * @author holic512
 */
import {useState} from 'react';
import {Heading} from '../components/workspace';
import {DataTable} from '../components/ui/data-table';
import {Feedback} from '../components/ui/alert';
import {Badge} from '../components/ui/badge';
import {useResource} from '../hooks/use-resource';
import {date,fmt} from '../lib/format';
export default function CreditsPage(){return <><Heading title="积分账本" desc="成功获得一道题的答案使用 1 积分；查询失败不扣积分。"/><CreditLedger/></>;}
export function CreditLedger({userId}:{userId?:number}){
 const [page,setPage]=useState(1),resource=useResource<CreditPage>(`${userId?`/admin/users/${userId}`:'/workspace'}/credits?page=${page}`),data=resource.data;
 return <><Feedback error={resource.error}/><dl className="balance-strip"><div><dt>可用积分</dt><dd>{fmt(data?.available)}</dd></div><div><dt>账号余额</dt><dd>{fmt(data?.balance)}</dd></div><div><dt>处理中冻结</dt><dd>{fmt(data?.frozen)}</dd></div></dl><DataTable loading={resource.loading} data={data?.items??[]} page={page} pageSize={data?.pageSize??30} total={data?.total??0} onPageChange={setPage} empty="还没有积分流水" columns={[
 {accessorKey:'created_at',header:'时间',cell:({row})=>date(row.original.created_at)},
 {id:'kind',header:'类型',cell:({row})=>row.original.event_id?'查题消费':row.original.actor_name?'管理员调整':'积分赠送'},
 {accessorKey:'amount',header:'变动',cell:({row})=><Badge tone={Number(row.original.amount)>0?'green':'gray'}>{Number(row.original.amount)>0?'+':''}{row.original.amount}</Badge>},
 {accessorKey:'balance',header:'变动后余额'},
 {accessorKey:'reason',header:'说明',cell:({row})=><span className="wrap-cell">{row.original.reason??'—'}</span>}
 ]}/></>;
}
