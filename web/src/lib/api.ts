/**
 * @file api.ts
 * @project ocs-answer-hub
 * @module 管理接口客户端
 * @description 统一 API 请求、CSRF 凭据与请求编号错误信息。
 * @logic 会话模块更新 CSRF，各页面通过同一入口请求接口。
 * @dependencies fetch
 * @index_tags api, csrf
 * @author holic512
 */
let csrf='';
export function setCsrf(value:string){csrf=value;}
export async function api(url:string,method='GET',body?:unknown){
 const response=await fetch(`/api${url}`,{method,headers:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const data=await response.json();
 if(!response.ok){const requestId=data.requestId??response.headers.get('X-Request-ID');const message=data.error??`请求失败 ${response.status}`;throw Object.assign(new Error(requestId?`${message}（请求编号：${requestId}）`:message),{status:response.status,requestId});}
 return data;
}
