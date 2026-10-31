/**
 * @file app.tsx
 * @project ocs-answer-hub
 * @module 应用会话
 * @description 管理初始化检查、管理员会话、请求反馈与通知。
 * @logic 先检查初始化再恢复会话，向布局及页面提供统一状态和操作。
 * @dependencies React, lib/api
 * @index_tags session, setup, feedback
 * @author holic512
 */
import {createContext,useContext,useState,useEffect,useRef,type ReactNode} from 'react';
import {api,setCsrf} from '../lib/api';
type User={username:string;csrf:string;mustChange:boolean};
type AppState={user:User|null;loaded:boolean;setupRequired:boolean|null;error:string;notice:string;busy:boolean;loginName:string;loadUser:()=>Promise<void>;run:(fn:()=>Promise<any>)=>Promise<any>;notify:(message:string)=>void;clearError:()=>void;login:(data:Record<string,FormDataEntryValue>)=>Promise<User>;endSession:()=>void;logout:()=>Promise<void>;completeSetup:(username?:string)=>Promise<void>};
const AppContext=createContext<AppState>(null!);
export function AppProvider({children}:{children:ReactNode}){
 const [user,setUser]=useState<User|null>(null),[loaded,setLoaded]=useState(false),[setupRequired,setSetupRequired]=useState<boolean|null>(null);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState(0),[loginName,setLoginName]=useState('admin');
 const noticeTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 async function loadUser(){
  setLoaded(false);setError('');
  try{const setup=await api('/setup');setSetupRequired(setup.required);if(setup.required){endSession();return;}
   try{const current=await api('/admin/me');setCsrf(current.csrf);setUser(current);}catch(error:any){if(error.status!==401)throw error;endSession();}
  }catch(error:any){setSetupRequired(null);setError(error.message);}finally{setLoaded(true);}
 }
 useEffect(()=>{void loadUser();return ()=>clearTimeout(noticeTimer.current);},[]);
 async function run(fn:()=>Promise<any>){setPending(count=>count+1);setError('');try{return await fn();}catch(error:any){setError(error.message);return undefined;}finally{setPending(count=>count-1);}}
 function notify(message:string){clearTimeout(noticeTimer.current);setNotice(message);noticeTimer.current=setTimeout(()=>setNotice(''),4000);}
 function endSession(){setCsrf('');setUser(null);}
 async function login(data:Record<string,FormDataEntryValue>){const current=await api('/login','POST',data);setCsrf(current.csrf);setUser(current);setNotice('');return current;}
 async function logout(){await api('/admin/logout','POST',{});endSession();}
 async function completeSetup(username?:string){setLoginName(username??'');await loadUser();notify(username?'管理员已创建，请使用新账号登录':'系统已完成初始化，请登录');}
 return <AppContext.Provider value={{user,loaded,setupRequired,error,notice,busy:pending>0,loginName,loadUser,run,notify,clearError:()=>setError(''),login,endSession,logout,completeSetup}}>{children}</AppContext.Provider>;
}
export function useApp(){return useContext(AppContext);}
