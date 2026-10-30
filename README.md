# 知序 · OCS Answer Hub

兼容 OCS 的单用户个人题库：**本地固定优先 → 按自定义顺序查询第三方 / AI → 有效答案自动入库**。

技术栈：Node.js 24、TypeScript、Fastify、React/Vite、PostgreSQL 17（pg_trgm）。**仅需 PostgreSQL，无需其他中间件**。

## 首次初始化（部署后第一步）

**应用连接数据库后，若没有管理员，浏览器会优先显示「初始化管理员」页面。请自行设置管理员账号、密码和确认密码，完成后使用该账号登录。**

系统不再自动生成管理员密码，也不再生成 `bootstrap-admin.json`。新创建的账号无需再次强制改密。管理员是否存在以数据库为准；已有账号时直接进入登录流程，重启或升级不会重新创建或覆盖账号。旧版账号的数据和已有改密要求保持不变。

## 本地开发

需要 Node.js 24+、npm 和 Docker Compose。Windows、macOS、Linux 命令相同：

```sh
git clone https://github.com/holic512/ocs-answer-hub.git
cd ocs-answer-hub
npm ci
node scripts/setup-local.mjs
docker compose -f compose.dev.yaml up -d --wait
npm run dev
```

`npm run dev` 同时启动后端和前端，按 Ctrl+C 一起停止；无需另开终端。

构建前后端产物：

```sh
npm run build
```

浏览器访问 **http://127.0.0.1:5173**。数据库没有管理员时，先在初始化页面设置账号和密码，完成后登录；密码至少 8 个字符，不强制特殊符号。

- `setup:local` 从 `.env.example` 生成真实 `.env` 和随机本地数据库密码，**已有 `.env` 不覆盖**。
- 本地数据库只监听 `127.0.0.1:15432`，开发库 `ocs_answer_hub_dev`、专用测试库 `ocs_answer_hub_test`；不会连接或迁移现有线上数据。
- 前端 5173 代理后端 18771，`.env` 中 `APP_ORIGIN` 必须与浏览器访问地址完全一致。不要混用 `localhost` 和 `127.0.0.1`。
- 手工使用已有 PostgreSQL 时，先建独立数据库、启用 pg_trgm 并修改 `.env`；不要拿生产库跑测试。

完整说明：[本地开发](docs/LOCAL_DEVELOPMENT.md) · [配置字段](docs/CONFIGURATION.md) · [部署与恢复](deploy/OPERATIONS.md)

## 验证与构建

```sh
npm test                # 未配置测试库时，仅跳过 PostgreSQL 集成套件；配置后须开启 TEST_DATABASE_RESET=1
node --env-file-if-exists=.env scripts/verify.mjs          # 要求独立测试库及显式重置同意；测试 + 类型 + 构建 + 依赖审计
npx playwright install chromium
node --env-file-if-exists=.env --import tsx scripts/browser-acceptance.ts    # 重置独立测试库后运行浏览器验收，不访问真实供应商
```

**集成测试和浏览器验收会清空 `TEST_DB_NAME` 指定的 `_test` 库 public schema。** 二者不要并发运行；校验要求 `TEST_DATABASE_RESET=1` 且不能与开发库同名。证据保存到忽略的 `artifacts/verification/`。

单进程本地运行构建产物：把 `.env` 的 `APP_ORIGIN` 改为 `http://127.0.0.1:18771`，然后 `npm run build && node --env-file-if-exists=.env dist/server/index.js`。生产部署请使用 HTTPS。

## 功能

- 首次页面创建单管理员、登录、会话及 CSRF 保护；OCS 凭证独立、可撤销、限速及每日额度。
- 本地精确 / 保守中文模糊检索、人工维护、导入导出、答案版本与冲突记录。
- 言溪、通用 HTTP、OpenAI 兼容 AI；来源可排序、单源独立测试，命中即停止后续检索。
- 有效外部答案自动学习；AI 标记未核验但可复用。选项答案保存文本而不是旧字母，避免变序误用。
- 请求和来源统计、响应阶段诊断。没有答案明确未命中；**不保证所有答案正确**，首版不含向量搜索。

## 上游配置与 OCS

示例位于 [examples/providers](examples/providers/)，在「检索来源」选择对应类型，再将示例 JSON 填入配置编辑器并替换占位符；不会自动导入或启用。

AI 支持 Chat Completions、Responses 的最终回答、文本块与 data/result 包装，发送 `stream:false`。不把推理、工具调用、截断、未完成任务当答案；HTTP 200 业务错误有脱敏诊断。`apiFormat`、`maxTokens`、`enableThinking` 详见配置文档。Agnes 问答默认关闭思考，可显式开启。

「OCS 接入」创建调用凭证并生成 JSON，粘贴到 OCS 第三方题库配置；用户脚本需允许**实际部署域名**的 `@connect`。上游密钥不进入 OCS JSON。

单源「测试」可测试禁用/未保存来源；不走本地和后续回退，不写题库、不计查题统计，但可能消耗上游额度。

## 私密配置与数据

仓库只存示例。`.env`、`state/`、密钥、当前生产 `compose.yaml`、备份与验收产物均不提交。

生产环境配置由独立私密配置包交付，**不要解压进仓库并强制加入 Git**。生产数据库地址不适用于新电脑，也不应拿来开发。现有题库、账号、供应商密钥保存在数据库；`state/master.key` 用于解密上游配置，丢失无法恢复。本次源码交接**不含数据库、主密钥或数据迁移**，线上应用不变。

上游支持 HTTP / HTTPS 及自定义端口，但 HTTP 链路会明文传输题目和上游密钥；网站 HTTPS 不保护这一段。保留 SSRF、DNS 固定及证书验证；私网需部署者通过 `UPSTREAM_ALLOW_HOSTS` 精确授权。

## 数据库与版本管理

数据库结构由 Prisma Schema 和版本迁移管理，启动自动应用待执行迁移。系统初始版本为 `1.0.0`，提交时自动递增补丁号，超过 20 后次版本号进一。详见 [数据库迁移与系统版本](docs/DATABASE_AND_VERSIONING.md)。

## GHCR 镜像部署

GitHub Actions 自动构建完整镜像，main 发布 latest，版本 Tag 发布对应版本。服务器使用 `deploy/deploy.sh` 拉取并部署，应用运行配置外置到 `data/ocs-answer-hub/config/config.env`，状态保存在 `storage/`，修改应用配置后重启即可生效。首次生成模板后需填写数据库密码。完整命令、升级及旧版迁移见 [部署与恢复](deploy/OPERATIONS.md)。

## Python 基础运维

`python3 delpoy/deploy.py install` 提供安装入口，并支持 start、restart、update、stop、status、logs、check。仅使用 Python 3.8+ 标准库，复用现有 Docker Compose 和外置配置。服务器建议通过 `--dir` 指定绝对部署路径。详见 [Python 运维说明](delpoy/README.md)。
