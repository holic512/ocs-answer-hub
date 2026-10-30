# 本地开发与仓库交接

## 环境和启动

1. 安装 Node.js 24（可使用 `.nvmrc`）和 Docker Desktop / Docker Compose。
2. `npm ci && node scripts/setup-local.mjs`，自动生成随机数据库密码及被忽略的 `.env`。
3. `docker compose -f compose.dev.yaml up -d --wait`，首次初始化应用数据库和默认的 `ocs_answer_hub_test` 测试库；自定义测试库名需自行建库。只使用本项目独立 Docker volume。
4. 运行 `npm run dev`，同时启动后端和前端；打开 http://127.0.0.1:5173，按 Ctrl+C 一起停止。构建使用 `npm run build`。
5. 打开页面，数据库无管理员时先设置管理员账号和密码，然后登录。管理员登录密码与数据库密码、API token、加密主密钥是不同的东西。

Node 自动加载项目根 `.env`，无需 shell `source`，兼容 PowerShell。已有环境变量优先于 `.env`。`setup:local` 不覆盖已有配置；如手改本地 PG 密码，已初始化的 volume 不会同步改密码，应通过数据库管理方式同步，勿为改密码随意删 volume。

`docker compose -f compose.dev.yaml stop` 停止本地 PostgreSQL但保留数据。通常不要用 `docker compose down -v`；`-v` 会删除本地数据库，源码迁移不需要此命令。

## 不使用 Docker

手工准备 PostgreSQL 17，创建 `ocs_answer_hub_dev` 和 `ocs_answer_hub_test` 两个**仅本地开发**的数据库，授权开发角色在各自 public schema 建表，并预装 `CREATE EXTENSION IF NOT EXISTS pg_trgm;`。填写 `.env` 的 `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER`、`DB_PASSWORD`。应用启动自动执行 Prisma 版本迁移。修改模型和提交版本规则见 `docs/DATABASE_AND_VERSIONING.md`。

`compose.dev.yaml` 使用的 PostgreSQL超级用户仅适用于回环地址上的隔离开发，不能直接照搬生产；生产必须使用独立低权限角色。

## 测试安全

新示例默认 `TEST_DATABASE_RESET=0`。运行数据库集成测试前，确认专用测试库可清空，再将此项改为 `1`；仅运行非数据库测试时，将 `TEST_DB_NAME` 留空。

- `npm test`：单元与网络夹具；如果没有 `TEST_DB_NAME`，数据库套件明确 skipped。
- `node --env-file-if-exists=.env scripts/verify.mjs`：必须有 `TEST_DB_NAME` 和 `TEST_DATABASE_RESET=1`；依次测试、类型检查、构建、生产依赖审计。
- `node --env-file-if-exists=.env --import tsx scripts/browser-acceptance.ts`：先构建并安装 Chromium；自身创建浏览器夹具，不依赖先跑集成测试。
- 测试库名必须以 `_test` 结尾且与 `DB_NAME`不同；仍需自己确认它是专用库。测试会 `DROP SCHEMA public CASCADE`，**绝不能连接线上或承载其他业务的数据**。
- 数据库集成测试与浏览器验收不能同时运行，它们会重置同一个专用测试库。
- Chrome 已安装时可设置 `BROWSER_EXECUTABLE_PATH`；受控容器必须关闭 sandbox 时显式设 `BROWSER_NO_SANDBOX=1`，普通桌面不需要。
- 测试只使用合成题目和本地/注入式上游，不调用实际第三方或 AI；通过不代表真实供应商已通过。

## 目录

| 路径 | 内容 |
| --- | --- |
| `server/` | API、鉴权、查题引擎、上游协议、安全传输、数据库结构 |
| `web/` | React 中文管理界面 |
| `tests/` | 单元、HTTP 夹具、独立 PostgreSQL 回归 |
| `scripts/` | 可移植的本地配置与验收工具 |
| `examples/providers/` | 无密钥来源配置示例 |
| `deploy/` | 新环境部署模板及运维说明 |
| `.env.example` | 本地环境变量示例 |
| `.env`、`state/`、`artifacts/` | 私密/生成文件，不入 Git |

## 当前交接边界

源码包含已上线的 AI 最终回答兼容修复；本轮增加的配置、文档、脚本可移植性调整仅用于开发仓库，**没有部署到线上**。

私密配置包中的 `production/.env` 和 `production/compose.yaml` 是只读备存，不是本地启动入口。线上题库、供应商实际配置、管理员账号、OCS 凭证继续留在原数据库中；本轮不导出或迁移。新电脑按上述步骤建立全新隔离环境即可。
