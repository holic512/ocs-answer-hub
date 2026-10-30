/**
 * @file deployment-acceptance.mjs
 * @project ocs-answer-hub
 * @module 部署验收
 * @description 使用临时 PostgreSQL、网络和宿主机绑定目录验证镜像部署生命周期。
 * @logic 初始化、预置配置、校验、重启、重建、模拟镜像升级及持久化，结束仅清理本次资源。
 * @dependencies Docker Compose, node:assert, node:child_process, node:fs
 * @index_tags deployment, docker, verification
 * @author holic512
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const image=process.env.DEPLOYMENT_TEST_IMAGE??'ocs-deployment-check:base';
const upgrade=`ocs-deployment-check:upgrade-${process.pid}`;
const project=`ocs-deploy-${process.pid}`;
const network=project+'-net';
const postgres=project+'-postgres';
const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'ocs-deployment-')));
const preplaced=path.join(directory,'preplaced');
const steps=[];
let activeImage=image;
let networkCreated=false,postgresCreated=false,upstreamCreated=false,upgradeCreated=false;
const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:8*1024*1024,...options}).trim();
const operations=args=>execFileSync('python3',['-B','delpoy/deploy.py',...args,'--dir',directory],{encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:8*1024*1024,env:{...process.env,COMPOSE_PROJECT_NAME:project}}).trim();
const compose=(args,dir=directory)=>docker(['compose','--project-name',dir===preplaced?project+'-preplaced':project,'--project-directory',dir,'-f',path.join(dir,'compose.yml'),...args],{env:{...process.env,APP_IMAGE:activeImage,DATABASE_NETWORK:network,APP_PORT:'0',BIND_ADDRESS:'127.0.0.1'}});
const helper=(code,input,dir=directory)=>docker(['run','--rm','-i','--user','0:0','--entrypoint','node','--mount',`type=bind,source=${dir},target=/fixture`,image,'-e',code],{input});
const configText=(origin='https://first.example.com')=>`DB_HOST=postgres\nDB_PORT=5432\nDB_NAME=answer_hub\nDB_USER=postgres\nDB_PASSWORD=isolated-deployment-fixture\nAPP_ORIGIN=${origin}\n`;
const writeConfig=(text,dir=directory)=>helper("const fs=require('fs');fs.mkdirSync('/fixture/config',{recursive:true,mode:0o700});fs.chownSync('/fixture/config',1000,1000);fs.writeFileSync('/fixture/config/config.env',fs.readFileSync(0),{mode:0o600});fs.chmodSync('/fixture/config/config.env',0o600);fs.chownSync('/fixture/config/config.env',1000,1000);",text,dir);
const hash=(file,dir=directory)=>helper(`const fs=require('fs'),crypto=require('crypto');console.log(crypto.createHash('sha256').update(fs.readFileSync('/fixture/${file}')).digest('hex'));`,undefined,dir);
const appId=()=>compose(['ps','-q','app']);
const inspect=()=>JSON.parse(docker(['inspect',appId()]))[0];
const probeOrigin=origin=>Number(compose(['exec','-T','app','node','-e',`fetch('http://127.0.0.1:18771/api/login',{method:'POST',headers:{origin:${JSON.stringify(origin)},'Content-Type':'application/json'},body:JSON.stringify({username:'invalid-fixture',password:'invalid-fixture'})}).then(r=>console.log(r.status))`]));
async function healthy(){
 for(let attempt=0;attempt<40;attempt++){
  try{compose(['exec','-T','app','node','dist/server/deployment.js','health']);return;}catch{}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 throw new Error('临时应用未通过健康检查');
}
try{
 docker(['image','inspect',image]);
 docker(['network','create',network]);networkCreated=true;
 docker(['run','-d','--rm','--name',postgres,'--network',network,'--network-alias','postgres','-e','POSTGRES_PASSWORD=isolated-deployment-fixture','-e','POSTGRES_DB=answer_hub','postgres:17-alpine']);postgresCreated=true;
 for(let attempt=0;attempt<40;attempt++){try{docker(['exec',postgres,'pg_isready','-U','postgres']);break;}catch{if(attempt===39)throw new Error('临时 PostgreSQL 未就绪');await new Promise(resolve=>setTimeout(resolve,250));}}
 let firstInstallRejected=false;
 try{operations(['install','--no-pull','--image',image,'--network',network,'--port','0']);}catch{firstInstallRejected=true;}
 assert(firstInstallRejected);assert((await fs.stat(path.join(directory,'compose.yml'))).isFile());
 const generated=hash('config/config.env');
 compose(['run','--rm','--no-deps','init']);assert.equal(hash('config/config.env'),generated);
 let rejected=false;try{compose(['run','--rm','--no-deps','app','check']);}catch{rejected=true;}assert(rejected,'默认空数据库密码必须被拒绝');
 steps.push('首次初始化生成私密配置；重复初始化不覆盖；未填写数据库密码时拒绝启动');

 await fs.mkdir(preplaced);await fs.copyFile('deploy/compose.yaml',path.join(preplaced,'compose.yml'));
 writeConfig(configText(),preplaced);const before=hash('config/config.env',preplaced);
 compose(['run','--rm','--no-deps','init'],preplaced);assert.equal(hash('config/config.env',preplaced),before);
 compose(['run','--rm','--no-deps','app','check'],preplaced);
 steps.push('首次部署前预置配置完整保留；省略可选字段时使用默认值');

 writeConfig(configText());operations(['start']);await healthy();
 const installedConfig=hash('config/config.env');
 operations(['install','--no-pull']);assert.equal(hash('config/config.env'),installedConfig);
 operations(['check']);operations(['status']);operations(['logs','--tail','5']);
 const upstream=project+'-upstream';
 docker(['run','-d','--rm','--name',upstream,'--network',network,'--network-alias','local-upstream','--entrypoint','node',image,'-e',"require('http').createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({answer:'private-network-fixture'}));}).listen(8080,'0.0.0.0')"]);upstreamCreated=true;
 const internalAnswer=compose(['exec','-T','app','node','--input-type=module','-e',"import {safeRequest} from './dist/server/security.js';console.log(JSON.stringify(await safeRequest('http://local-upstream:8080/query','GET',{},null,5000)))"]);
 assert.equal(JSON.parse(internalAnswer).answer,'private-network-fixture');
 steps.push('容器内通过内网主机名直接请求真实 HTTP 上游，无需白名单或网段授权');

 const setupStatus=()=>JSON.parse(compose(['exec','-T','app','node','-e',"fetch('http://127.0.0.1:18771/api/setup').then(r=>r.text()).then(console.log)"]));
 assert.equal(setupStatus().required,true);
 assert.equal(helper("console.log(require('fs').existsSync('/fixture/storage/bootstrap-admin.json'))"),'false');
 const initialized=compose(['exec','-T','app','node','-e',"fetch('http://127.0.0.1:18771/api/setup',{method:'POST',headers:{origin:'https://first.example.com','Content-Type':'application/json'},body:JSON.stringify({username:'deployment-admin',password:'setup-fixture-password',confirmPassword:'setup-fixture-password'})}).then(r=>console.log(r.status))"]);
 assert.equal(initialized,'201');assert.equal(setupStatus().required,false);
 steps.push('新数据库不生成管理员或明文密码文件，通过网页初始化接口创建管理员后关闭初始化入口');

 assert.equal(inspect().Mounts.find(m=>m.Destination==='/app/config').RW,false);
 assert.equal(inspect().Mounts.find(m=>m.Destination==='/app/logs').RW,true);
 const logMarker='deployment-log-persistence-fixture';
 helper("require('fs').appendFileSync('/fixture/logs/app.log',JSON.stringify({message:'deployment-log-persistence-fixture'})+'\\n')");
 const persistedLog=()=>helper("console.log(require('fs').readFileSync('/fixture/logs/app.log','utf8'))");
 assert(persistedLog().includes('知序已启动'));
 const probeLog=compose(['exec','-T','app','node','--input-type=module','-e',`
 const headers={origin:'https://first.example.com','Content-Type':'application/json'};
 const login=await fetch('http://127.0.0.1:18771/api/login',{method:'POST',headers,body:JSON.stringify({username:'deployment-admin',password:'setup-fixture-password'})});
 const session=await login.json();
 const tested=await fetch('http://127.0.0.1:18771/api/admin/providers/test',{method:'POST',headers:{...headers,cookie:login.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':session.csrf},body:JSON.stringify({provider:{name:'deployment-diagnostics-fixture',kind:'http',config:{url:'http://local-upstream:8080/query',answerPath:'answer'}},question:{title:'1+2',type:'single',options:['2','3']}})});
 console.log(JSON.stringify(await tested.json()));`]);
 const tested=JSON.parse(probeLog);assert.equal(tested.failureCode,'answer_mismatch');assert(tested.requestId);
 const records=persistedLog().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 assert(records.some(row=>row.event==='provider-test'&&row.requestId===tested.requestId));
 assert(records.some(row=>row.event==='http.request.completed'&&row.requestId===tested.requestId));
 assert(persistedLog().includes('deployment-diagnostics-fixture'));
 assert(!persistedLog().includes('setup-fixture-password'));assert(!persistedLog().includes('isolated-deployment-fixture'));
 steps.push('真实来源测试的诊断和 HTTP 完成日志按 requestId 关联并写入宿主机文件，登录及数据库密码未记录');
 assert.equal(inspect().Config.Env.some(v=>v.startsWith('DB_PASSWORD=')),false);
 assert.equal(probeOrigin('https://first.example.com'),401);
 compose(['exec','-T','app','node','-e',"require('fs').writeFileSync('/app/storage/persistence-fixture','preserved')"]);
 const key=hash('storage/master.key');
 docker(['exec',postgres,'psql','-U','postgres','-d','answer_hub','-c',`UPDATE settings SET value='{"deployment_fixture":"preserved"}'::jsonb WHERE id=1`]);
 steps.push('只读配置挂载、非 root 启动和自动迁移成功；数据库密码未注入容器环境');

 writeConfig(configText('https://second.example.com'));const customized=hash('config/config.env');
 operations(['restart']);await healthy();
 assert.equal(probeOrigin('https://second.example.com'),401);assert.equal(probeOrigin('https://first.example.com'),403);
 steps.push('修改访问地址后仅重启容器，新地址生效，旧地址被拒绝');

 const oldId=appId();
 compose(['up','-d','--force-recreate','--wait','--wait-timeout','120','--pull','never','app']);await healthy();
 assert.notEqual(appId(),oldId);assert.equal(hash('config/config.env'),customized);assert.equal(hash('storage/master.key'),key);
 assert(persistedLog().includes(logMarker));
 steps.push('重新创建容器后配置与加密主密钥保留');

 const oldImage=inspect().Image;
 // 验收基础镜像仅加载到 Docker Engine；独立的 Buildx 容器无法直接使用它。
 const engineBuilder=docker(['context','show']);
 docker(['buildx','build','--builder',engineBuilder,'--load','-t',upgrade,'-f','-','.'],{input:`FROM ${image}\nUSER root\nRUN printf '\\n# 新镜像的模板变更，旧配置不会被覆盖\\n' >> /app/defaults/config.env\nLABEL deployment.verification=next\nUSER node\n`});upgradeCreated=true;
 activeImage=upgrade;
 operations(['update','--no-pull','--image',upgrade]);await healthy();
 assert((await fs.readFile(path.join(directory,'.env'),'utf8')).includes('APP_IMAGE='+upgrade));
 assert.notEqual(inspect().Image,oldImage);assert.equal(hash('config/config.env'),customized);assert.equal(hash('storage/master.key'),key);
 assert(persistedLog().includes(logMarker));
 steps.push('启动日志持久化到宿主机 logs/app.log，重启、重建和镜像升级后原日志保留');
 assert.equal(helper("console.log(require('fs').readFileSync('/fixture/storage/persistence-fixture','utf8'))"),'preserved');
 assert.equal(docker(['exec',postgres,'psql','-U','postgres','-d','answer_hub','-tAc',"SELECT value->>'deployment_fixture' FROM settings WHERE id=1"]),'preserved');
 assert.equal(probeOrigin('https://second.example.com'),401);
 steps.push('切换到不同镜像 ID 和新版模板后，原配置、存储文件、密钥和数据库数据保留');

 writeConfig(configText()+'PORT=invalid\n');let invalidRejected=false;
 try{compose(['run','--rm','--no-deps','app','check']);}catch(error){invalidRejected=true;assert(!String(error.stderr).includes('isolated-deployment-fixture'));}
 assert(invalidRejected);writeConfig(configText('https://second.example.com'));
 steps.push('无效配置在启动前被拒绝，错误输出不包含配置密码');
 operations(['stop']);const stoppedId=compose(['ps','--all','-q','app']);assert.equal(JSON.parse(docker(['inspect',stoppedId]))[0].State.Running,false);
 operations(['start']);await healthy();assert.equal(hash('storage/master.key'),key);
 assert.equal(setupStatus().required,false);assert.equal(docker(['exec',postgres,'psql','-U','postgres','-d','answer_hub','-tAc','SELECT username FROM administrators WHERE id=1']),'deployment-admin');
 steps.push('Python 运维 install/start/restart/update/stop/status/logs/check 均通过；安装更新使用已有本地镜像，未测试远程拉取');
 console.log(JSON.stringify({passed:true,scope:'本地真实 Docker Compose、独立 PostgreSQL、宿主机目录绑定；升级使用本地模拟新版镜像，未发布 GHCR',steps},null,2));
}finally{
 try{compose(['down','--remove-orphans']);}catch{}
 try{compose(['down','--remove-orphans'],preplaced);}catch{}
 if(upstreamCreated)try{docker(['rm','-f',project+'-upstream']);}catch{}
 if(postgresCreated)try{docker(['rm','-f',postgres]);}catch{}
 if(networkCreated)try{docker(['network','rm',network]);}catch{}
 if(upgradeCreated)try{docker(['image','rm',upgrade]);}catch{}
 try{helper("const fs=require('fs');for(const name of ['config','storage','logs','preplaced'])fs.rmSync('/fixture/'+name,{recursive:true,force:true});");}catch{}
 await fs.rm(directory,{recursive:true,force:true});
}
