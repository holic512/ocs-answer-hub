# 知序 · OCS Answer Hub

兼容 OCS 的单用户个人题库：**本地固定优先 → 按自定义顺序查询第三方 / AI → 有效答案自动入库**。

技术栈：Node.js 24、TypeScript、Fastify、React/Vite、PostgreSQL 17（pg_trgm）。**不依赖 Redis 或其他中间件**。

## 本地开发

需要 Node.js 24+、npm 和 Docker Compose。Windows、macOS、Linux 命令相同：

```sh
git clone https://github.com/holic512/ocs-answer-hub.git
cd ocs-answer-hub
npm ci
npm run setup:local
npm run db:up
npm run dev
```

另开终端：

```sh
npm run dev:web
```

浏览器访问 **http://127.0.0.1:5173**。首次启动自动创建 `admin`，密码在本地 `state/bootstrap-admin.json`，首次登录必须改密；密码至少 8 个字符，不强制特殊符号。

- `setup:local` 从 `.env.example` 生成真实 `.env` 和随机本地数据库密码，**已有 `.env` 不覆盖**。
- 本地数据库只监听 `127.0.0.1:15432`，开发库 `ocs_answer_hub_dev`、专用测试库 `ocs_answer_hub_test`；不会连接或迁移现有线上数据。
- 前端 5173 代理后端 18771，`.env` 中 `APP_ORIGIN` 必须与浏览器访问地址完全一致。不要混用 `localhost` 和 `127.0.0.1`。
- 手工使用已有 PostgreSQL 时，先建独立数据库、启用 pg_trgm 并修改 `.env`；不要拿生产库跑测试。

完整说明：[本地开发](docs/LOCAL_DEVELOPMENT.md) · [配置字段](docs/CONFIGURATION.md) · [部署与恢复](deploy/OPERATIONS.md)

## 验证与构建

```sh
npm test                # 未配置测试库时，仅跳过 PostgreSQL 集成套件
npm run verify          # 要求独立测试库及显式重置同意；测试 + 类型 + 构建 + 依赖审计
npx playwright install chromium
npm run test:browser    # 重置独立测试库后运行浏览器验收，不访问真实供应商
```

**集成测试和浏览器验收会清空 `TEST_DATABASE_URL` 指定的 `_test` 库 public schema。** 二者不要并发运行；校验要求 `TEST_DATABASE_RESET=1` 且不能与开发库同名。证据保存到忽略的 `artifacts/verification/`。

单进程本地运行构建产物：把 `.env` 的 `APP_ORIGIN` 改为 `http://127.0.0.1:18771`，然后 `npm run build && npm start`。生产部署请使用 HTTPS。

## 功能

- 单管理员登录、首次改密、会话及 CSRF 保护；OCS 凭证独立、可撤销、限速及每日额度。
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
