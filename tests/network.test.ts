import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import{once}from'node:events';import{safeRequest}from'../server/security.js';
test('real HTTP transport accepts loopback without allowlist and reports redirects',{timeout:10000},async()=>{const s=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/redirect'){res.writeHead(302,{Location:'http://169.254.169.254/latest/meta-data/'});res.end('{}')}else res.end(JSON.stringify({ok:true}));});s.listen(0,'127.0.0.1');await once(s,'listening');const port=(s.address() as any).port;try{assert.equal((await safeRequest(`http://127.0.0.1:${port}/`,'GET',{},null,1000)).ok,true);await assert.rejects(()=>safeRequest(`http://127.0.0.1:${port}/redirect`,'GET',{},null,1000),/HTTP 302/);}finally{s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()));}});

test('pooled HTTP transport reuses sockets, bounds connections and recovers after a timeout',{timeout:10000},async()=>{
 const {createUpstreamTransport}=await import('../server/security.js');const transport=createUpstreamTransport();
 let sockets=0,active=0,peak=0;
 const server=http.createServer((req,res)=>{active++;peak=Math.max(peak,active);res.on('close',()=>active--);res.setHeader('Content-Type','application/json');setTimeout(()=>{if(!res.destroyed)res.end(JSON.stringify({auth:req.headers.authorization}));},req.url==='/slow'?100:10);});
 server.on('connection',()=>sockets++);server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as any).port}`;
 try{
  for(let i=0;i<8;i++)assert.equal((await transport.request(url,'GET',{Authorization:`fixture-${i}`},null,1000)).auth,`fixture-${i}`);
  assert(sockets<8);const before=sockets;
  await Promise.all(Array.from({length:12},()=>transport.request(url,'GET',{},null,1000)));assert(peak<=4);assert(sockets<=before+3);
  await assert.rejects(transport.request(url+'/slow','GET',{},null,20),{code:'UPSTREAM_TIMEOUT'});
  assert.equal((await transport.request(url,'GET',{Authorization:'after-timeout'},null,1000)).auth,'after-timeout');
 }finally{await transport.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
