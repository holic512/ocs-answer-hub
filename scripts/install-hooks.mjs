import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
if(existsSync('.git')){
 const current=spawnSync('git',['config','--local','--get','core.hooksPath'],{encoding:'utf8'});
 if(current.stdout.trim()&&current.stdout.trim()!=='.githooks'){
  console.error('检测到已有 Git hooksPath，请将 node scripts/bump-version.mjs 接入现有 pre-commit，未覆盖原配置。');
  process.exitCode=1;
 }else{
  const result=spawnSync('git',['config','--local','core.hooksPath','.githooks'],{stdio:'inherit'});
  process.exitCode=result.status??1;
 }
}
