import {readFileSync,writeFileSync,existsSync,chmodSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const target=path.resolve('.env');
if(existsSync(target)){
  console.log('.env 已存在，保留原配置。');
}else{
  const template=readFileSync(fileURLToPath(new URL('../.env.example',import.meta.url)),'utf8');
  const password=randomBytes(24).toString('hex');
  writeFileSync(target,template.replaceAll('REPLACE_WITH_LOCAL_PASSWORD',password),{mode:0o600,flag:'wx'});
  if(process.platform!=='win32')chmodSync(target,0o600);
  console.log('已生成带随机数据库密码的本地 .env，请勿提交到仓库。');
}
console.log('下一步：运行 npm run db:up；使用已有数据库时直接填写 .env 中的数据库配置。');
