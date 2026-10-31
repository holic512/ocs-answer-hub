/**
 * @file AuthLayout.tsx
 * @project ocs-answer-hub
 * @module 认证布局
 * @description 登录与初始化共用品牌区域和唯一主内容出口。
 * @logic 子路由渲染认证表单，统一显示操作反馈。
 * @dependencies react-router, state/app
 * @index_tags layout, auth
 * @author holic512
 */
import {Outlet} from 'react-router';
import {useApp} from '../state/app';
export default function AuthLayout(){const {notice}=useApp();return <div className="auth-layout"><div className="auth-brand"><div className="brand-symbol">知</div><p className="auth-brand-name">知序</p><p>你的个人题库，按自己的顺序检索。</p></div><main className="auth-main">{notice&&<div className="notice" role="status">{notice}</div>}<Outlet/></main></div>;}
