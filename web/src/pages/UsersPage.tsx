/**
 * @file UsersPage.tsx
 * @project ocs-answer-hub
 * @module 用户管理
 * @description 管理账号、额度与密码，查看每日用量。
 * @logic 创建后要求改密，启停和额度更新提交后刷新；密码重置撤销会话。
 * @dependencies React, lib/api, context/app, components
 * @index_tags users, quota, admin
 * @author holic512
 */
import {useEffect,useState} from 'react';
import {api} from '../lib/api';import {useApp} from '../context/app';
import {Heading,Field,Empty} from '../components/workspace';import {Button} from '../components/ui/button';import {Input,NativeSelect} from '../components/ui/input';
export default function UsersPage(){const {run,busy,notify}=useApp();const [items,setItems]=useState<any[]>([]);const [reset,setReset]=useState<number|null>(null);
 async function load(){setItems((await api('/admin/users')).items);}useEffect(()=>{void run(load);},[]);
 return <><Heading title="用户管理" desc="工作台与 OCS 共用用户额度。新用户和重置密码后的用户需先修改密码。"/>
 <section className="card"><h2>创建账号</h2><form className="form-grid" onSubmit={e=>{e.preventDefault();const form=e.currentTarget;const d=Object.fromEntries(new FormData(form));void run(async()=>{await api('/admin/users','POST',{...d,daily_limit:Number(d.daily_limit),rpm:Number(d.rpm)});form.reset();await load();notify('账号已创建');});}}><Field label="账号"><Input name="username" required maxLength={100} autoComplete="off"/></Field><Field label="初始密码"><Input name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password"/></Field><Field label="角色"><NativeSelect name="role"><option value="user">普通用户</option><option value="admin">管理员</option></NativeSelect></Field><Field label="每日额度"><Input name="daily_limit" type="number" min={0} max={100000} defaultValue={2000} required/></Field><Field label="每分钟次数"><Input name="rpm" type="number" min={1} max={600} defaultValue={60} required/></Field><Button className="primary" disabled={busy}>创建用户</Button></form></section>
 <section className="card"><h2>账号与使用情况</h2>{!items.length?<Empty text="正在读取账号"/>:items.map(u=><div key={u.id}><form className="toolbar" onSubmit={e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget));void run(async()=>{await api(`/admin/users/${u.id}`,'PUT',{daily_limit:Number(d.daily_limit),rpm:Number(d.rpm),disabled:d.disabled==='true'});await load();notify('用户设置已保存');});}}><strong>{u.username} · {u.role==='admin'?'管理员':'普通用户'}</strong><span>今日 {u.day_count} 次</span><Field label={`${u.username} 每日额度`}><Input name="daily_limit" type="number" min={0} max={100000} defaultValue={u.daily_limit} required/></Field><Field label={`${u.username} 每分钟次数`}><Input name="rpm" type="number" min={1} max={600} defaultValue={u.rpm} required/></Field><Field label={`${u.username} 状态`}><NativeSelect name="disabled" defaultValue={String(u.disabled)}><option value="false">启用</option><option value="true">禁用</option></NativeSelect></Field><Button disabled={busy}>保存</Button><Button type="button" onClick={()=>setReset(reset===u.id?null:u.id)}>重置密码</Button></form>{reset===u.id&&<form className="toolbar" onSubmit={e=>{e.preventDefault();const password=new FormData(e.currentTarget).get('password');void run(async()=>{await api(`/admin/users/${u.id}/password`,'POST',{password});setReset(null);notify('密码已重置，现有会话已退出');});}}><Field label={`${u.username} 新临时密码`}><Input name="password" type="password" minLength={8} maxLength={128} required autoComplete="new-password"/></Field><Button disabled={busy}>确认重置</Button></form>}</div>)}</section></>;
}
