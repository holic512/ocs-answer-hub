/**
 * @file SettingsPage.tsx
 * @project ocs-answer-hub
 * @module 安全设置
 * @description 管理工作台安全设置页面。
 * @logic 通过共享会话与请求模块完成页面操作，业务状态由页面维护。
 * @dependencies React, components/ui, state/app, lib/api
 * @index_tags settings, password
 * @author holic512
 */
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Field,Heading,Icon } from '../components/workspace';
import { api } from '../lib/api';
import { useApp } from '../state/app';
export default function SettingsPage(){const {run,user,endSession,notify}=useApp();const first=Boolean(user?.mustChange);const onDone=()=>{endSession();notify('密码已更新，请重新登录');};return <><Heading title="安全设置" desc={first?'首次登录必须修改初始密码，完成后才能使用管理功能。':'单管理员账号，无公开注册。修改密码后会使所有管理会话失效。'}/><section className="card password-card"><div className="card-title"><h2>修改管理员密码</h2><Icon name="shield"/></div><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);run(async()=>{if(f.get('newPassword')!==f.get('confirm'))throw new Error('两次新密码不一致');await api('/admin/password','POST',{oldPassword:f.get('oldPassword'),newPassword:f.get('newPassword')});onDone()})}}><Field label="当前密码"><Input name="oldPassword" type="password" autoComplete="current-password" required/></Field><Field label="新密码" hint="至少 8 位，无需特殊符号；支持更长密码。"><Input name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required/></Field><Field label="确认新密码"><Input name="confirm" type="password" autoComplete="new-password" minLength={8} required/></Field><Button className="primary">更新密码并重新登录</Button></form></section></>}
