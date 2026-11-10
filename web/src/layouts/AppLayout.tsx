/**
 * @file AppLayout.tsx
 * @project ocs-answer-hub
 * @module 工作台布局
 * @description 分离个人工作台、系统管理和运维导航，统一主题和页面反馈。
 * @logic 权限决定管理分组可见性，路由内容渲染到唯一主区域。
 * @dependencies react-router, lucide-react, context/app
 * @index_tags layout, navigation, roles
 * @author holic512
 */
import {useEffect,useRef,useState} from 'react';
import {Link,NavLink,Outlet,useLocation} from 'react-router';
import {Search,History,KeyRound,Coins,Settings,LayoutDashboard,BookOpen,Users,BrainCircuit,Sparkles,Database,CalendarClock,Activity,SlidersHorizontal,Moon,Sun,LogOut,type LucideIcon} from 'lucide-react';
import {Button} from '../components/ui/button';
import {useApp} from '../context/app';
type Navigation={title:string;admin?:boolean;links:[string,string,LucideIcon][]};
const groups:Navigation[]=[{title:'工作台',links:[['query','查题工作台',Search],['history','我的查询',History],['tokens','调用凭证',KeyRound],['credits','积分账本',Coins],['settings','账号安全',Settings]]},{title:'管理',admin:true,links:[['overview','系统概览',LayoutDashboard],['users','用户管理',Users],['questions','本地题库',BookOpen],['providers','AI 配置',BrainCircuit],['iteration','题库迭代',Sparkles],['admin-history','全部查询',History],['system-settings','系统设置',SlidersHorizontal]]},{title:'运维',admin:true,links:[['vector','向量索引',Database],['schedules','自动化任务',CalendarClock],['executions','执行记录',Activity]]}];
export default function AppLayout(){
 const [theme,setTheme]=useState(()=>localStorage.getItem('theme')??'light');
 useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('theme',theme);},[theme]);
 const {user,error,notice,clearError,run,logout}=useApp(),location=useLocation(),main=useRef<HTMLElement>(null);
 useEffect(()=>{clearError();main.current?.focus();window.scrollTo(0,0);},[location.pathname]);
 const label=groups.flatMap(g=>g.links).find(([path])=>`/${path}`===location.pathname)?.[1]??'工作台';
 return <div className="app-layout"><a className="skip-link" href="#main">跳到主要内容</a><aside className="sidebar"><Link className="brand" to="/query"><span className="brand-symbol">知</span><span className="brand-name">知序<span className="brand-caption">题库工作台</span></span></Link><nav className="app-nav" aria-label="主导航">{groups.filter(g=>!g.admin||user?.role==='admin').map(g=><div className="nav-group" key={g.title}><p>{g.title}</p>{g.links.map(([path,text,Icon])=><NavLink to={`/${path}`} key={path}><Icon size={17}/><span>{text}</span></NavLink>)}</div>)}</nav><div className="sidebar-bottom"><Button className="theme-toggle" onClick={()=>setTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?<Sun size={16}/>:<Moon size={16}/>}<span>{theme==='dark'?'浅色主题':'深色主题'}</span></Button><div className="user-row"><span className="avatar">{user?.username.slice(0,1).toUpperCase()}</span><span className="user-info">{user?.username}<small>{user?.role==='admin'?'管理员':'普通用户'}</small></span><Button size="icon" aria-label="退出登录" onClick={()=>run(logout)}><LogOut size={16}/></Button></div></div></aside><div className="app-body"><header className="workspace-header"><span>{label}</span><span className="muted">知序 v{__APP_VERSION__}</span></header><main className="app-main" id="main" ref={main} tabIndex={-1}>{error&&<div className="feedback feedback-error" role="alert"><span>{error}</span><Button onClick={clearError} size="sm">关闭</Button></div>}{notice&&<div className="feedback feedback-success" role="status">{notice}</div>}<Outlet/></main></div></div>;
}
