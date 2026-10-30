/**
 * @file bump-version.mjs
 * @project ocs-answer-hub
 * @module 提交版本管理
 * @description 在提交前同步应用和锁文件版本。
 * @logic 从 HEAD 计算下个版本，超过 20 时进位，更新并暂存清单。
 * @dependencies node:child_process, node:fs, Git
 * @index_tags version, git, hooks
 * @author holic512
 */
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export function nextVersion(version){
 const match=/^(\d+)\.(\d+)\.(\d+)$/.exec(version);
 if(!match)throw new Error('版本号必须是 x.y.z 格式');
 const [,major,minor,patch]=match.map(Number);
 return `${major}.${minor+(patch>=20?1:0)}.${patch>=20?0:patch+1}`;
}
if(process.argv[1]===fileURLToPath(import.meta.url))bump();
function bump(){
 const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
 const files=['package.json','package-lock.json'];
 // 避免自动暂存两个清单中尚未暂存的其他改动。
 for(const file of files)if(git('diff','--',file))throw new Error(`请先暂存 ${file} 的修改，再提交以自动更新版本号`);
 const base=JSON.parse(git('show','HEAD:package.json')).version;
 const version=nextVersion(base);
 for(const file of files){const data=JSON.parse(readFileSync(file,'utf8'));data.version=version;if(file==='package-lock.json')data.packages[''].version=version;writeFileSync(file,JSON.stringify(data,null,2)+'\n');}
 git('add','--',...files);
 console.log(`系统版本：${base} → ${version}`);
}
