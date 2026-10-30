import {readFileSync,writeFileSync,existsSync,chmodSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const target=path.resolve('.env');
if(existsSync(target)){
  console.log('.env already exists; left unchanged.');
}else{
  const template=readFileSync(fileURLToPath(new URL('../.env.example',import.meta.url)),'utf8');
  const password=randomBytes(24).toString('hex');
  writeFileSync(target,template.replaceAll('REPLACE_WITH_LOCAL_PASSWORD',password),{mode:0o600,flag:'wx'});
  if(process.platform!=='win32')chmodSync(target,0o600);
  console.log('Created private .env for isolated local development. No production configuration was used.');
}
console.log('Next: npm run db:up');
