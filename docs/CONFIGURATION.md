# 配置参考

## 应用和开发环境变量

| 变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | 应用 PostgreSQL URL，生产使用项目专户；密码含特殊字符时按 URL 百分号编码 |
| `APP_ORIGIN` | 浏览器访问的准确 origin，不带末尾 `/`；本地 Vite 为 `http://127.0.0.1:5173`，直跑构建为 `http://127.0.0.1:18771` |
| `HOST` / `PORT` | 后端监听，默认 `127.0.0.1` / `18771`；不要把开发服务器暴露公网 |
| `STATE_DIR` | 主密钥和首次凭证目录，相对路径以启动目录为准，本地 `./state`、容器 `/app/state` |
| `MASTER_KEY` | 可选 64 位十六进制密钥；不设时生成并持久化 `STATE_DIR/master.key`，不能随意更换 |
| `UPSTREAM_ALLOW_HOSTS` | 逗号分隔的精确主机/IP，默认空；仅用于显式授权私网来源，不能用通配符放开整个网络 |
| `PG_LOCAL_USER` / `PG_LOCAL_PASSWORD` / `PG_LOCAL_PORT` | 仅 `compose.dev.yaml` 使用，本地 PG 默认回环端口 15432；与 URL 中凭据一致 |
| `TEST_DATABASE_URL` | 专用 `_test` 库 URL；禁止与应用库混用 |
| `TEST_DATABASE_RESET` | `1` 表示允许重置上述专用测试库，绝非生产迁移开关 |
| `EVIDENCE_DIR` | 可选测试证据目录，默认 `artifacts/verification` |
| `BROWSER_EXECUTABLE_PATH` | 可选 Chrome/Chromium 完整可执行路径；未设用 Playwright Chromium |
| `BROWSER_NO_SANDBOX` | 受控 Linux 容器环境确有需要才设 `1` |
| `DATABASE_NETWORK` | 仅新部署 compose 模板使用，已有数据库的 Docker 外部网络名 |

Redis 未被应用使用，不需要 Redis 密码。

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
