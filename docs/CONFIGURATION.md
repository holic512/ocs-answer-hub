# 配置参考

## 最少需要填写的数据库配置

本地使用项目根 `.env`，示例见 `.env.example`；镜像部署使用 `config/config.env`，参考 `deploy/config.env.example`；`deploy/.env.example` 仅配置镜像、网络和宿主机端口。示例与实际配置使用同一组字段。不再使用 `DATABASE_URL`、`TEST_DATABASE_URL` 或 `PG_LOCAL_*`。

```dotenv
# 数据库地址，不带协议和端口
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=answer_hub
DB_USER=answer_hub
# 直接填写原密码，不需要 URL 编码；包含 # 或空格时用引号包裹
DB_PASSWORD="请填写数据库密码"
```

| 变量 | 含义与填写要求 |
| --- | --- |
| `DB_HOST` | 数据库地址；本机填 `127.0.0.1`，容器填写容器内可访问地址 |
| `DB_PORT` | PostgreSQL 端口，默认 `5432`；本项目开发 Docker 默认 `15432` |
| `DB_NAME` | 已创建的数据库名称 |
| `DB_USER` | 数据库用户名，生产使用项目专用低权限账号 |
| `DB_PASSWORD` | 数据库密码原文，应用自动处理连接地址编码 |

`node scripts/setup-local.mjs` 会生成中文注释的 `.env` 和随机密码，不覆盖已有文件。本地 Docker 直接复用相同字段，无需再维护一份账号密码。已有数据库卷不会因修改 `.env` 自动更新账号、密码或库名，需在数据库中同步修改。

## 应用配置

| 变量 | 用途 |
| --- | --- |
| `APP_ORIGIN` | 浏览器实际访问地址，不带末尾 `/`；开发为 `http://127.0.0.1:5173`，构建后直连为 `http://127.0.0.1:18771` |
| `HOST` / `PORT` | 后端监听地址和端口，默认 `127.0.0.1` / `18771` |
| `STATE_DIR` | 保存加密主密钥及持久文件；本地 `./state`，新镜像容器 `/app/storage` |
| `MASTER_KEY` | 高级可选项，64 位十六进制；默认自动生成并保存，不可随意更换 |
| `UPSTREAM_ALLOW_HOSTS` | 高级可选项，私网上游精确主机/IP 白名单，英文逗号分隔，默认空 |
| `DATABASE_NETWORK` | 仅容器部署使用，已有数据库的 Docker 外部网络名 |

## 测试配置（普通运行不需要）

| 变量 | 用途 |
| --- | --- |
| `TEST_DB_NAME` | 独立测试库名，必须以 `_test` 结尾；复用上述连接信息，留空则跳过数据库集成测试 |
| `TEST_DATABASE_RESET` | `1` 允许清空专用测试库，示例默认 `0`；测试前明确开启 |
| `EVIDENCE_DIR` | 测试证据目录，默认 `artifacts/verification` |
| `BROWSER_EXECUTABLE_PATH` | 可选 Chrome/Chromium 可执行文件路径 |
| `BROWSER_NO_SANDBOX` | 受控 Linux 容器确有需要时设 `1`，普通桌面无需设置 |

旧配置升级：将原连接地址中的主机、端口、库名、用户名、密码分别填入五个字段；原测试连接地址只保留库名至 `TEST_DB_NAME`。删除旧连接地址与重复的 `PG_LOCAL_*` 字段。进程环境变量优先于 `.env`。

## 题库源配置

来源在后台设置并加密存于数据库，**不是自动从 `.env` / JSON 文件加载**。`examples/providers/*.json` 是配置编辑器内容的参考，不是 OCS wrapper 也不是包含 name/kind/enabled 的完整 API 对象。创建来源时选择正确类型，优先级在界面调整，本地始终第一。

### 言溪（yanxi）

使用 `yanxi.json`，`token` 填自己的言溪凭据；专用适配器固定请求官方 `https://tk.enncy.cn/query`，不接受自定义地址。答案匹配、图片和题干补充字段由适配器处理；需别的地址时用通用 HTTP 类型。

### 通用 HTTP（http）

`http.json` 演示 POST JSON、Authorization、请求模板以及字段路径：`successPath` / `successValue`、`questionPath`、`answerPath`。GET 也支持。仅支持字段映射和 `${title}`、`${options}`、`${type}` 模板，**不执行不可信 JavaScript handler**；OCS wrapper 不能原样当通用 HTTP 配置导入。

### AI（ai）

`ai-chat.json` 使用 `baseUrl`、`apiKey`、`model`、`apiFormat:chat`；`ai-responses.json` 使用 Responses。`apiFormat:auto` 仅在 URL 明确包含 `/responses` 时选择 Responses，否则使用 Chat Completions；不自动发两遍请求。

- `baseUrl` 可为 API 根、`/v1` 或完整 chat/completions、responses 路径；无需重复拼接。
- `maxTokens` 是 64～16384 的整数，设置足够输出预算；实际模型仍可能有自己的限制。
- `jsonMode` 请求供应商的 JSON 模式，仅在供应商支持时开启。
- `enableThinking` 可选 boolean。Agnes 默认 false，其他模型未设置则不附加此字段；显式 true 会启用思考，可能消耗更多额度。
- `vision` 控制是否向支持视觉的模型传图片。
- 只接受完整的最终答案 JSON；推理片段、工具调用、截断和业务错误不视为答案。

不要把真实 token / apiKey 写回示例或 Git。需要私密保存时使用 Git 已忽略的本地文件；网页后台保存的有效配置仍在数据库中。

## 镜像外置配置

设置 CONFIG_FILE 时，服务端每次启动重新读取该文件。文件值优先于同名环境变量，可选字段缺失时使用默认值；不会自动补写或覆盖已有配置。外置配置支持中文注释，需每项单独一行，不接受未知字段、重复字段或跨行值。完整部署流程见 `deploy/OPERATIONS.md`。本地开发未设置 CONFIG_FILE 时继续使用根 .env，兼容原开发流程。
