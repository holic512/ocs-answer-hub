/**
 * @file use-resource.ts
 * @project ocs-answer-hub
 * @module 页面异步数据
 * @description 读取资源、丢弃过期响应并保留局部操作反馈。
 * @logic URL改变触发读取，卸载或新请求使旧响应失效，页面独立维护提交状态。
 * @dependencies React, lib/api
 * @index_tags data, hooks, feedback
 * @author holic512
 */
import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from '../lib/api';
export function useResource<T>(url:string|null){
 const [data,setData]=useState<T|null>(null),[loading,setLoading]=useState(Boolean(url)),[error,setError]=useState('');
 const generation=useRef(0);
 const reload=useCallback(async()=>{
  const id=++generation.current;if(!url){setData(null);setLoading(false);return;}
  setLoading(true);setError('');
  try{const result=await api<T>(url);if(id===generation.current)setData(result);}
  catch(e){if(id===generation.current){setData(null);setError(e instanceof Error?e.message:'读取失败，请重试');}}
  finally{if(id===generation.current)setLoading(false);}
 },[url]);
 useEffect(()=>{setData(null);void reload();return()=>{generation.current++;};},[reload]);
 return {data,loading,error,reload,setData};
}
export function useAction(){
 const [pending,setPending]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function execute<T>(fn:()=>Promise<T>,success=''){
  setPending(true);setError('');setMessage('');
  try{const result=await fn();setMessage(success);return result;}
  catch(e){setError(e instanceof Error?e.message:'操作失败，请重试');return undefined;}
  finally{setPending(false);}
 }
 return {pending,error,message,execute,clear:()=>{setError('');setMessage('');}};
}

export function useDebouncedValue<T>(value:T,delay=300){const [debounced,setDebounced]=useState(value);useEffect(()=>{const timer=setTimeout(()=>setDebounced(value),delay);return()=>clearTimeout(timer);},[value,delay]);return debounced;}
