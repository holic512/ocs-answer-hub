export function assertTestDatabaseUrl(value:string|undefined,applicationUrl:string|undefined,resetConsent:string|undefined):string{
 if(!value)throw new Error('请填写 TEST_DB_NAME（专用测试数据库名）');
 if(resetConsent!=='1')throw new Error('重置专用测试库前必须设置 TEST_DATABASE_RESET=1');
 const url=new URL(value);
 if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('测试连接必须使用 PostgreSQL 协议');
 const database=decodeURIComponent(url.pathname.slice(1));
 if(!/^[a-zA-Z0-9_]+_test$/.test(database))throw new Error('专用测试数据库名必须以 _test 结尾');
 if(applicationUrl){const application=new URL(applicationUrl);if(decodeURIComponent(application.pathname)===decodeURIComponent(url.pathname))throw new Error('TEST_DB_NAME 不能与 DB_NAME 相同');}
 return value;
}
