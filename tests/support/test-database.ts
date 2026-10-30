export function assertTestDatabaseUrl(value:string|undefined,applicationUrl:string|undefined,resetConsent:string|undefined):string{
 if(!value)throw new Error('TEST_DATABASE_URL is required');
 if(resetConsent!=='1')throw new Error('TEST_DATABASE_RESET=1 is required before resetting isolated test data');
 const url=new URL(value);
 if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('A PostgreSQL test URL is required');
 const database=decodeURIComponent(url.pathname.slice(1));
 if(!/^[a-zA-Z0-9_]+_test$/.test(database))throw new Error('The dedicated test database name must end in _test');
 if(applicationUrl){const application=new URL(applicationUrl);if(decodeURIComponent(application.pathname)===decodeURIComponent(url.pathname))throw new Error('TEST_DATABASE_URL must not name the DATABASE_URL application database');}
 return value;
}
