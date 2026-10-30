/**
 * @file config.ts
 * @project ocs-answer-hub
 * @module 配置
 * @description 从常规数据库字段构造内部连接地址，不要求用户编码密码。
 * @logic 校验入口配置，测试库复用连接参数并使用独立库名。
 * @dependencies node:process, node:url
 * @index_tags config, database
 * @author holic512
 */
export function databaseUrl(env:NodeJS.ProcessEnv=process.env,test=false):string|undefined {
 const name=test?env.TEST_DB_NAME:env.DB_NAME;
 if(test&&!name)return undefined;
 for(const key of ['DB_HOST','DB_USER','DB_PASSWORD'] as const){if(!env[key])throw new Error(`请在 .env 中填写 ${key}（${{DB_HOST:'数据库地址',DB_USER:'数据库用户名',DB_PASSWORD:'数据库密码'}[key]}）`);}
 if(!name)throw new Error('请在 .env 中填写 DB_NAME（数据库名）');
 const port=env.DB_PORT??'5432';
 if(!/^\d+$/.test(port)||Number(port)<1||Number(port)>65535)throw new Error('DB_PORT（数据库端口）必须是 1～65535 的整数');
 const url=new URL('postgresql://localhost');
 url.hostname=env.DB_HOST!;url.port=port;url.username=encodeURIComponent(env.DB_USER!);url.password=encodeURIComponent(env.DB_PASSWORD!);url.pathname='/'+encodeURIComponent(name);
 return url.toString();
}
