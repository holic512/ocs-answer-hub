/**
 * @file App.tsx
 * @project ocs-answer-hub
 * @module 应用路由
 * @description 初始化与会话守卫、认证布局和后台页面路由。
 * @logic 初始化优先，登录后恢复目标页，旧账号强制改密，未知路径展示返回入口。
 * @dependencies React, react-router, state/app, layouts, pages
 * @index_tags router, guards, app
 * @author holic512
 */
import {useEffect} from 'react';
import {Navigate,Outlet,Route,Routes,useLocation} from 'react-router';
import {Button} from './components/ui/button';
import {api} from './lib/api';
import {useApp} from './state/app';
import AppLayout from './layouts/AppLayout';
import AuthLayout from './layouts/AuthLayout';
import InitialSetup from './InitialSetup';
import LoginPage from './pages/LoginPage';
import OverviewPage from './pages/OverviewPage';
import QuestionsPage from './pages/QuestionsPage';
import ProvidersPage from './pages/ProvidersPage';
import QueryPage from './pages/QueryPage';
import TokensPage from './pages/TokensPage';
import SettingsPage from './pages/SettingsPage';
import NotFoundPage from './pages/NotFoundPage';
export default function App(){
 const {loaded,setupRequired,user,error,loadUser,completeSetup}=useApp();const location=useLocation();
 useEffect(()=>{const titles:Record<string,string>={'/setup':'初始化管理员','/login':'登录','/overview':'概览','/questions':'本地题库','/providers':'检索来源','/query':'查题工作台','/tokens':'OCS 接入','/settings':'安全设置'};document.title=`${titles[location.pathname]??'页面不存在'} · 知序`;},[location.pathname]);
 if(!loaded)return <main className="boot" role="status">知序 · 正在检查初始化状态</main>;
 if(setupRequired===null)return <main className="boot"><p role="alert">{error||'无法检查系统初始化状态'}</p><Button className="secondary" onClick={()=>loadUser()}>重新连接</Button></main>;
 if(setupRequired&&location.pathname!=='/setup')return <Navigate to="/setup" replace state={{from:location.pathname+location.search}}/>;
 if(!setupRequired&&location.pathname==='/setup')return <Navigate to={user?'/overview':'/login'} replace state={location.state}/>;
 return <Routes>
  <Route element={<AuthLayout/>}><Route path="setup" element={<InitialSetup api={api} onComplete={completeSetup}/>}/><Route path="login" element={user?<Navigate to={user.mustChange?'/settings':location.state?.from??'/overview'} replace/>:<LoginPage/>}/></Route>
  <Route element={<RequireSession/>}><Route element={<AppLayout/>}>
   <Route index element={<Navigate to="/overview" replace/>}/>
   <Route path="overview" element={<OverviewPage/>}/><Route path="questions" element={<QuestionsPage/>}/><Route path="providers" element={<ProvidersPage/>}/><Route path="query" element={<QueryPage/>}/><Route path="tokens" element={<TokensPage/>}/><Route path="settings" element={<SettingsPage/>}/><Route path="*" element={<NotFoundPage/>}/>
  </Route></Route>
 </Routes>;
}
function RequireSession(){const {user}=useApp();const location=useLocation();if(!user)return <Navigate to="/login" replace state={{from:location.pathname+location.search}}/>;if(user.mustChange&&location.pathname!=='/settings')return <Navigate to="/settings" replace/>;return <Outlet/>;}
