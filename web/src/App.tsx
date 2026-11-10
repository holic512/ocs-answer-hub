/**
 * @file App.tsx
 * @project ocs-answer-hub
 * @module 应用路由
 * @description 初始化、登录注册、个人工作台、管理和运维的权限路由。
 * @logic 初始化优先，角色守卫隔离管理与运维，页面按需加载，个人记录独立于全局记录。
 * @dependencies React, react-router, context/app, layouts
 * @index_tags router, roles, lazy
 * @author holic512
 */
import {lazy,Suspense,useEffect} from 'react';
import {Navigate,Outlet,Route,Routes,useLocation} from 'react-router';
import {Button} from './components/ui/button';
import {api} from './lib/api';
import {useApp} from './context/app';
import AppLayout from './layouts/AppLayout';
import AuthLayout from './layouts/AuthLayout';
import InitialSetup from './InitialSetup';
import LoginPage from './pages/LoginPage';
const OverviewPage=lazy(()=>import('./pages/OverviewPage'));
const QuestionsPage=lazy(()=>import('./pages/QuestionsPage'));
const ProvidersPage=lazy(()=>import('./pages/ProvidersPage'));
const QueryPage=lazy(()=>import('./pages/QueryPage'));
const HistoryPage=lazy(()=>import('./pages/HistoryPage'));
const TokensPage=lazy(()=>import('./pages/TokensPage'));
const CreditsPage=lazy(()=>import('./pages/CreditsPage'));
const SettingsPage=lazy(()=>import('./pages/SettingsPage'));
const SystemSettingsPage=lazy(()=>import('./pages/SystemSettingsPage'));
const UsersPage=lazy(()=>import('./pages/UsersPage'));
const JobsPage=lazy(()=>import('./pages/JobsPage'));
const VectorPage=lazy(()=>import('./pages/VectorPage'));
const SchedulesPage=lazy(()=>import('./pages/SchedulesPage'));
const ExecutionsPage=lazy(()=>import('./pages/ExecutionsPage'));
const NotFoundPage=lazy(()=>import('./pages/NotFoundPage'));
export default function App(){
 const {loaded,setupRequired,user,error,loadUser,completeSetup}=useApp(),location=useLocation();
 useEffect(()=>{const titles:Record<string,string>={'/setup':'初始化管理员','/login':'登录','/register':'注册','/overview':'系统概览','/questions':'本地题库','/providers':'AI 配置','/query':'查题工作台','/history':'我的查询','/tokens':'调用凭证','/credits':'积分账本','/users':'用户管理','/iteration':'题库迭代','/settings':'账号安全','/system-settings':'系统设置','/vector':'向量索引','/schedules':'自动化任务','/executions':'执行记录','/admin-history':'全部查询'};document.title=`${titles[location.pathname]??'知序工作台'} · 知序`;},[location.pathname]);
 if(!loaded)return <main className="boot" role="status">知序 · 正在检查初始化状态</main>;
 if(setupRequired===null)return <main className="boot"><p role="alert">{error||'无法连接系统'}</p><Button variant="outline" onClick={()=>loadUser()}>重新连接</Button></main>;
 if(setupRequired&&location.pathname!=='/setup')return <Navigate to="/setup" replace/>;
 if(!setupRequired&&location.pathname==='/setup')return <Navigate to={user?'/query':'/login'} replace/>;
 return <Suspense fallback={<div className="boot" role="status">正在载入页面…</div>}><Routes><Route element={<AuthLayout/>}><Route path="setup" element={<InitialSetup api={api} onComplete={completeSetup}/>}/><Route path="login" element={user?<Navigate to={user.mustChange?'/settings':location.state?.from??'/query'} replace/>:<LoginPage/>}/><Route path="register" element={user?<Navigate to="/query" replace/>:<LoginPage key="register" registerMode/>}/></Route><Route element={<RequireSession/>}><Route element={<AppLayout/>}><Route index element={<Navigate to="/query" replace/>}/><Route path="query" element={<QueryPage/>}/><Route path="history" element={<HistoryPage/>}/><Route path="tokens" element={<TokensPage/>}/><Route path="credits" element={<CreditsPage/>}/><Route path="settings" element={<SettingsPage/>}/><Route element={<RequireAdmin/>}><Route path="overview" element={<OverviewPage/>}/><Route path="users" element={<UsersPage/>}/><Route path="questions" element={<QuestionsPage/>}/><Route path="providers" element={<ProvidersPage/>}/><Route path="iteration" element={<JobsPage/>}/><Route path="jobs" element={<Navigate to="/iteration" replace/>}/><Route path="admin-history" element={<HistoryPage adminMode/>}/><Route path="system-settings" element={<SystemSettingsPage/>}/><Route path="vector" element={<VectorPage/>}/><Route path="schedules" element={<SchedulesPage/>}/><Route path="executions" element={<ExecutionsPage/>}/></Route><Route path="*" element={<NotFoundPage/>}/></Route></Route></Routes></Suspense>;
}
function RequireSession(){const {user}=useApp(),location=useLocation();if(!user)return <Navigate to="/login" replace state={{from:location.pathname+location.search}}/>;if(user.mustChange&&location.pathname!=='/settings')return <Navigate to="/settings" replace/>;return <Outlet/>;}
function RequireAdmin(){const {user}=useApp();return user?.role==='admin'?<Outlet/>:<Navigate to="/query" replace/>;}
