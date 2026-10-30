import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
// @ts-expect-error 可执行脚本为原生 ESM，使用真实脚本验证提交行为。
import {nextVersion} from '../scripts/bump-version.mjs';
test('version patch rolls over after 20 without changing major',()=>{
 assert.equal(nextVersion('1.0.0'),'1.0.1');
 assert.equal(nextVersion('1.0.19'),'1.0.20');
 assert.equal(nextVersion('1.0.20'),'1.1.0');
 assert.equal(nextVersion('1.9.20'),'1.10.0');
});
test('commit hook stages synchronized versions and does not increment twice on retry',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hub-version-'));
 const git=(...args:string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
 try{
  git('init','-q');git('config','user.name','Version Test');git('config','user.email','version@example.invalid');git('config','core.hooksPath','.githooks');
  await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({version:'1.0.20'}));
  await fs.writeFile(path.join(dir,'package-lock.json'),JSON.stringify({version:'1.0.20',packages:{'':{version:'1.0.20'}}}));
  git('add','.');git('commit','-qm','fixture');
  await fs.mkdir(path.join(dir,'scripts'));await fs.mkdir(path.join(dir,'.githooks'));
  await fs.copyFile('scripts/bump-version.mjs',path.join(dir,'scripts/bump-version.mjs'));
  await fs.copyFile('.githooks/pre-commit',path.join(dir,'.githooks/pre-commit'));await fs.chmod(path.join(dir,'.githooks/pre-commit'),0o755);
  const run=()=>execFileSync(process.execPath,['scripts/bump-version.mjs'],{cwd:dir});
  run();run();assert.equal(JSON.parse(git('show',':package.json')).version,'1.1.0');
  git('add','.');git('commit','-qm','next');assert.equal(JSON.parse(git('show','HEAD:package-lock.json')).packages[''].version,'1.1.0');
  await fs.writeFile(path.join(dir,'fixture.txt'),'next');git('add','.');git('commit','-qm','next');
  assert.equal(JSON.parse(git('show','HEAD:package.json')).version,'1.1.1');
  assert.equal(git('status','--porcelain'),'');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
