import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readdirSync,readFileSync,statSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
if(!process.env.TEST_DATABASE_URL||process.env.TEST_DATABASE_RESET!=='1'){
 console.error('Full verification requires a dedicated TEST_DATABASE_URL and TEST_DATABASE_RESET=1. Run npm run setup:local && npm run db:up first.');process.exit(1);
}
const evidence=path.resolve(process.env.EVIDENCE_DIR??'artifacts/verification');
mkdirSync(evidence,{recursive:true,mode:0o700});
function collect(directory){return readdirSync(directory).flatMap(name=>{const file=path.join(directory,name);return statSync(file).isDirectory()?collect(file):[file];});}
const files=['server','web','tests','scripts','deploy'].filter(existsSync).flatMap(collect).concat(['package.json','package-lock.json','vite.config.ts','tsconfig.json','tsconfig.server.json','compose.dev.yaml','.env.example','.dockerignore']);
const hash=createHash('sha256');for(const file of files.sort())hash.update(file).update(readFileSync(file));
const sourceHash=hash.digest('hex');
const commands=[['test'],['run','typecheck'],['run','build'],['audit','--omit=dev','--registry=https://registry.npmjs.org']];
let failed=false;const results=[];
for(const args of commands){
 const command=process.env.npm_execpath?process.execPath:(process.platform==='win32'?'npm.cmd':'npm');
 const actualArgs=process.env.npm_execpath?[process.env.npm_execpath,...args]:args;
 const result=spawnSync(command,actualArgs,{encoding:'utf8',env:process.env,shell:process.platform==='win32'&&!process.env.npm_execpath,maxBuffer:5*1024*1024});
 const name=args.join('-').replace(/[^\w-]/g,'_');
 writeFileSync(path.join(evidence,name+'.txt'),`source_sha256=${sourceHash}\ncommand=npm ${args.join(' ')}\nexit=${result.status}\n${result.stdout??''}\n${result.stderr??''}`,{mode:0o600});
 process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');
 results.push({command:['npm',...args].join(' '),exit:result.status});if(result.status!==0)failed=true;
}
writeFileSync(path.join(evidence,'verification.json'),JSON.stringify({sourceHash,at:new Date().toISOString(),results},null,2),{mode:0o600});
console.log(JSON.stringify({sourceHash,results}));process.exitCode=failed?1:0;
