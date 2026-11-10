# 本地开发与仓库交接

## 环境和启动

需要 Node.js 24、npm、PostgreSQL 17；数据库必须提供 `vector` 和 `pg_trgm` 扩展。本仓库 `compose.dev.yaml` 使用 `pgvector/pgvector:0.8.2-pg17`；使用其它镜像时需确认包含 pgvector，普通 `postgres` 镜像通常不提供该扩展二进制。不要为安装扩展删除已有数据库卷。

```sh
npm ci
node scripts/setup-local.mjs
# 启动包含 pgvector 的隔离开发数据库
# 使用已有开发数据库时跳过本行，填写 .env 五项数据库字段
docker compose -f compose.dev.yaml up -d --wait
npm run dev
```

打开 `http://127.0.0.1:5173`，先初始化管理员。后端默认 `18771`；前端代理 API，`APP_ORIGIN` 必须匹配地址栏。`Ctrl+C` 一起停止前后端。构建使用 `npm run build`，产物为 `dist/server`、`dist/web`。

`setup-local.mjs` 生成 `.env` 与随机数据库密码，不覆盖已有配置。Node 自动加载根 `.env`，无需 shell `source`，已有环境变量优先。管理员密码、数据库密码、OCS 凭证和主密钥各自独立。初始管理员获得 20 分，普通注册默认 20 分，系统设置可调整后续注册赠分。

本地 Docker 默认映射 `127.0.0.1:15432`。`docker compose -f compose.dev.yaml stop` 停止数据库并保留数据；不要用 `down -v` 升级或改密码。已初始化的卷不会因修改 `.env` 自动变更库名、账号或密码。

使用现有数据库时，由数据库管理员在开发库执行：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

授予开发角色必要迁移权限，填写 `.env` 的 `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER`、`DB_PASSWORD`。本地数据库超级用户只适用于隔离开发，生产使用项目专用账号。迁移、备份和版本规则见[数据库说明](DATABASE_AND_VERSIONING.md)。

## 可选本地模型

普通本地／AI 查题不要求安装向量模型。RAG、课程种子生成和向量维护需要固定 BGE-small-zh-v1.5 INT8：

```sh
node scripts/install-embedding.mjs /absolute/path/models/bge-small-zh-v1.5
```

设置 `LOCAL_EMBEDDING_PATH` 为该绝对目录，重启，再到向量索引页面检查。默认计划会自动回填，也可手动执行；向量未完整覆盖期间 RAG 暂关闭，生成任务不能绕过去重。详见[运维](MULTIUSER_UPGRADE.md)。

## 验证与测试安全

```sh
npm run typecheck
npm test
npm run build
python3 -B -m unittest discover -s tests -p test_deploy.py
```

数据库测试自动使用独立临时 PostgreSQL 容器，不加载业务 `.env`，采用随机密码和回环随机端口，结束后删除本次容器。运行需可用 Docker，不需要测试数据库配置。测试使用合成题目和本地／注入式 AI，不证明真实供应商已通过。

`node scripts/verify.mjs` 按脚本执行测试、类型检查、构建与依赖审计。浏览器验收先构建，首次执行 `npx playwright install chromium`，再执行 `node --import tsx scripts/browser-acceptance.ts`；报告和截图保存到 `artifacts/verification`。浏览器脚本需与当前页面契约保持同步，不能以构建成功替代交互验收。

## AI 诊断

在 AI 配置表单测试地址、协议、模型、输出预算和输出模式。测试直接请求 AI，不写题库／正式查询、不扣本系统积分或凭证次数，但可能产生供应商费用。失败反馈保留请求编号与阶段，结合 `logs/app.log` 查找 HTTP 异常；正式查询的回退、JSON／选项错误及 RAG 原因在查询记录查看。具体见[日志与追溯](LOGGING.md)。

## 目录与分层

| 路径 | 内容 |
| --- | --- |
| `server/app.ts`、`server/modules/` | 应用装配与认证、用户、凭证、题库、AI、系统设置、查询、运维接口 |
| `server/accounts.ts`、`engine.ts`、`jobs.ts`、`semantic.ts` | 积分／受理、查询编排、持久任务、本地向量与 RAG |
| `server/ai/`、`providers.ts`、`ai-output.ts` | 提示词／输出契约、AI 协议请求与最终回答提取 |
| `shared/` | 前后端公共契约 |
| `web/` | React 桌面界面，shadcn/Radix、Tailwind、RHF+Zod、TanStack 表格 |
| `prisma/` | 当前模型、固定旧基线、增量迁移 |
| `tests/`、`scripts/` | 测试、本地配置、模型安装和验收工具 |
| `examples/providers/` | 无密钥 AI 配置参考，页面使用表单 |
| `deploy/` | 部署模板与运维脚本 |
| `.env`、`state/`、`storage/`、`logs/`、`artifacts/` | 私密／生成文件，不入 Git |

## 开发产物清理

停止服务和验收任务后执行 `node scripts/clean.mjs --dry-run` 检查，再执行 `node scripts/clean.mjs`。只清理固定构建、报告和缓存目录，保留依赖、配置、数据库、主密钥、运行日志及备份；需要保留的验收证据先移出 `artifacts/`。
