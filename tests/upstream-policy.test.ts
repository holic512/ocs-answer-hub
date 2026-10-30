import test from 'node:test';import assert from 'node:assert/strict';import {validateUrl} from '../server/security.js';import {validateProvider} from '../server/providers.js';
test('upstreams support HTTP HTTPS public IP and custom TCP ports',()=>{for(const url of ['http://example.com:8080/query','https://example.com:8443/v1','http://8.8.8.8:9000/search','https://example.com:65535/query'])assert.equal(validateUrl(url).href,url);assert.doesNotThrow(()=>validateProvider('ai',{baseUrl:'http://example.com:8000/v1',model:'test',apiKey:'test'}));});
test('upstreams accept private IPv4 IPv6 loopback and internal hostnames without an allowlist',()=>{
 for(const url of ['http://127.0.0.1:8000','http://localhost:8000','http://10.0.0.1:80','http://192.168.1.2:8080/query','http://172.16.0.2/query','http://169.254.169.254/latest/meta-data/','http://[::1]:8000/v1','http://[fd00::1]:8000','http://[::ffff:127.0.0.1]:8000','http://ollama:11434/v1']){
  assert.doesNotThrow(()=>validateUrl(url));
  assert.doesNotThrow(()=>validateProvider('ai',{baseUrl:url,model:'local-model',apiKey:'fixture'}));
 }
});
test('upstream URLs still require HTTP HTTPS and separate credential fields',()=>{
 for(const url of ['file:///etc/passwd','ftp://example.com/file','gopher://example.com:6379','http://user:password@example.com','http://example.com/#fragment'])assert.throws(()=>validateUrl(url));
});
