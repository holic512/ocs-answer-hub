# 本地开发与仓库交接

## 环境和启动

1. 安装 Node.js 24（可使用 `.nvmrc`）和 Docker Desktop / Docker Compose。
2. `npm ci && node scripts/setup-local.mjs`，自动生成随机数据库密码及被忽略的 `.env`。
3. `docker compose -f compose.dev.yaml up -d --wait`，只初始化应用数据库。只使用本项目独立 Docker volume。
4. 运行 `npm run dev`，同时启动后端和前端；打开 http://127.0.0.1:5173，按 Ctrl+C 一起停止。构建使用 `npm run build`。
5. 打开页面，数据库无管理员时先设置管理员账号和密码，然后登录。管理员登录密码与数据库密码、API token、加密主密钥是不同的东西。

Node 自动加载项目根 `.env`，无需 shell `source`，兼容 PowerShell。已有环境变量优先于 `.env`。`setup-local.mjs` 不覆盖已有配置；如手改本地 PG 密码，已初始化的 volume 不会同步改密码，应通过数据库管理方式同步，勿为改密码随意删 volume。

`docker compose -f compose.dev.yaml stop` 停止本地 PostgreSQL但保留数据。通常不要用 `docker compose down -v`；`-v` 会删除本地数据库，源码迁移不需要此命令。

## 不使用 Docker

手工准备 PostgreSQL 17，创建 `ocs_answer_hub_dev` 开发数据库，授权开发角色在 public schema 建表，并预装 `CREATE EXTENSION IF NOT EXISTS pg_trgm;`。填写 `.env` 的 `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER`、`DB_PASSWORD`。应用启动自动执行 Prisma 版本迁移。修改模型和提交版本规则见 `docs/DATABASE_AND_VERSIONING.md`。

`compose.dev.yaml` 使用的 PostgreSQL超级用户仅适用于回环地址上的隔离开发，不能直接照搬生产；生产必须使用独立低权限角色。

## 测试安全

测试不加载 `.env`，数据库测试及浏览器验收自动创建独立临时 PostgreSQL 17 容器，使用随机密码和回环随机端口；不连接开发或业务数据库，结束后删除本次容器。运行前需要可用的 Docker，无需填写测试配置。

- `npm test`：单元、真实 HTTP 及独立 PostgreSQL 集成和迁移测试。
- `node scripts/verify.mjs`：依次测试、类型检查、构建、生产依赖审计。
- `npx playwright install chromium`：首次安装 Playwright 默认浏览器。
- `node --import tsx scripts/browser-acceptance.ts`：先运行 `npm run build`，再执行浏览器验收；不依赖手动启动开发服务。
- 报告与截图固定保存到 `artifacts/verification`，可通过清理脚本移除。
- 测试只使用合成题目和本地/注入式上游，不调用实际第三方或 AI；通过不代表真实供应商已通过。

## 来源测试诊断日志

后台单源测试的开始、请求阶段和结果均会记录；失败时，服务端输出以 `[provider-test]` 开头的单行 JSON 日志。开发环境查看 `npm run dev` 所在终端或项目根 `logs/app.log`；Docker 部署查看宿主机 `logs/app.log` 或运维脚本 `logs` 输出。

日志包含来源、模型、HTTP 状态、失败阶段和耗时。答案匹配失败时额外记录提取答案的类型、值和解析后的选项；模型最终输出不是有效 JSON 时记录截断后的最终文本。配置中的凭据会脱敏，不输出完整请求、请求头、推理字段或原始上游错误。详细诊断不返回浏览器，也不写入题库或查题统计。

页面会显示请求编号，可按编号检索同一次操作的全部日志。完整事件、脱敏和查询方法见[日志与追溯](LOGGING.md)。分享问题时提供对应的请求编号和日志即可。测试题目与答案可能是业务内容，分享前仍应检查是否适合公开。

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
| `.env`、`state/`、`logs/`、`artifacts/` | 私密/生成文件，不入 Git |

## 开发产物清理

先停止开发服务或验收任务，再执行：

```sh
node scripts/clean.mjs --dry-run
node scripts/clean.mjs
```

脚本仅清理固定目录中的构建产物、验收报告和工具缓存；保留依赖本身、配置、数据库、密钥、运行日志及备份。需要保留的验收证据请先移出 `artifacts/`。清理后 `npm run dev` 可直接启动，打包时重新执行 `npm run build`。
