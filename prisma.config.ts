import {defineConfig} from 'prisma/config';
import {loadRuntimeConfig} from './server/config';
// 内部覆盖仅供启动迁移使用，日常仍填写 .env 中的五项数据库字段。
export default defineConfig({schema:'prisma/schema.prisma',migrations:{path:'prisma/migrations'},datasource:{url:process.env.PRISMA_DATABASE_URL??(process.argv.includes('generate')||process.argv.includes('validate')?'postgresql://generate:generate@127.0.0.1:5432/generate':loadRuntimeConfig().databaseUrl)}});
