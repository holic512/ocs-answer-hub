/**
 * @file AppLayout.tsx
 * @project ocs-answer-hub
 * @module 后台布局
 * @description 后台公共导航、主内容出口、账号操作与版本。
 * @logic 路由决定导航选中态，业务页面渲染到唯一主内容区域。
 * @dependencies react-router, state/app, components/ui
 * @index_tags layout, navigation
 * @author holic512
 */
import {useEffect,useRef} from 'react';
import {Link,NavLink,Outlet,useLocation} from 'react-router';
import {Button} from '../components/ui/button';
import {Icon} from '../components/workspace';
import {useApp} from '../state/app';
const navigation=[['overview','概览'],['questions','本地题库'],['providers','检索来源'],['query','查题工作台'],['tokens','OCS 接入'],['settings','安全设置']];
export default function AppLayout(){
 const {user,error,notice,clearError,run,logout}=useApp();const location=useLocation();const main=useRef<HTMLElement>(null);
 useEffect(()=>{clearError();main.current?.focus();window.scrollTo(0,0);},[location.pathname]);
 return <div className="app-layout">
  <a className="skip-link" href="#main">跳到主要内容</a>
  <aside className="sidebar">
   <Link className="brand" to="/overview" aria-label="知序首页"><span className="brand-symbol">知</span><span className="brand-name">知序</span></Link>
   <nav className="app-nav" aria-label="主导航">{navigation.map(([id,label])=><NavLink key={id} to={`/${id}`} aria-label={label} title={label}><Icon name={id}/><span>{label}</span></NavLink>)}</nav>
   <div className="sidebar-bottom"><Button className="user-row" aria-label={`退出登录（${user?.username}）`} title="退出登录" onClick={()=>run(logout)}><span className="avatar">{user?.username.slice(0,1).toUpperCase()}</span><span className="user-info">{user?.username}<small>退出登录</small></span><Icon name="logout" size={18}/></Button></div>
  </aside>
  <div className="app-body"><main className="app-main" id="main" ref={main} tabIndex={-1}>
   {error&&<div className="error dismiss" role="alert">{error}<Button aria-label="关闭错误提示" onClick={clearError}>×</Button></div>}<Outlet/>
  </main><footer className="app-footer">知序 v{__APP_VERSION__}</footer></div>
  {notice&&<div className="toast" role="status"><Icon name="check" size={17}/>{notice}</div>}
 </div>;
}
