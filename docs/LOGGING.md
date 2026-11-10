# 运行日志与问题追溯

关键运行事件同时写入控制台和 `logs/app.log`；Docker 默认对应 `/data/ocs-answer-hub/logs/app.log`。每行 JSON，包含 UTC 时间、级别、事件名与上下文字段。单文件达到 10 MiB 后轮转，最多保留三份历史文件；重启追加，开发清理脚本不删除日志。需长期留存时在轮转前归档。

日志用于运行排错；查询记录、积分账本、答案版本与任务执行记录以 PostgreSQL 为准，日志不是完整备份。

## 定位请求

API 响应头 `X-Request-ID` 返回请求编号，页面失败反馈也显示编号；服务端错误 JSON 包含 `requestId`。

```sh
tail -n 100 /data/ocs-answer-hub/logs/app.log
tail -f /data/ocs-answer-hub/logs/app.log
grep -F '页面显示的请求编号' /data/ocs-answer-hub/logs/app.log*
```

`requestId` 区分每次 HTTP 调用；`queryId` 标识实际查询执行。同题并发可共享执行编号，但每个请求有独立查询记录、凭证计数与积分结算。任务使用 `jobId` 定位。

| 事件 | 内容 |
| --- | --- |
| `application.*`、`database.*` | 启动／关闭、结构检测、迁移阶段、耗时和脱敏错误 |
| `http.request.completed`、`http.request.failed` | 请求编号、方法、路由、账号、状态和耗时；异常代码／调用位置 |
| `admin.action` | 成功写操作的操作者、资源和脱敏输入；该历史事件名也用于本人凭证等认证写操作 |
| `query.ai.completed`、`query.ai.failed` | 实际 AI 查询执行编号、配置 ID、提示词版本、用量或脱敏异常 |
| `job.failed`、`worker.failed` | 任务／调度失败及代码位置 |

正式查题完整的本地命中、AI 回退、失败码与 RAG 跳过原因主要在数据库查询记录的 `attempts`，不要假定每个阶段都有独立日志事件。AI 表单测试的响应反馈提供阶段和请求编号，不写正式查询或积分记录。

## 脱敏与分享

密码、Token、API Key、Authorization、Cookie、CSRF、会话、密钥、密码哈希、密文和推理字段按字段名隐藏；已知凭据在文本中回显时也会替换。URL 隐藏账号、密码、查询参数和片段，不打印完整请求头或原始上游响应。

日志仍可能包含业务题目、答案及配置变更内容，分享前检查。字符串、数组、对象层级和字段数均有限制；错误只保留名称、代码、约束与调用位置，不输出可能携带凭据的原始数据库详情或子进程输出。

## 查询记录与失败排查

「我的查询」始终访问 `/api/workspace/query-events`，管理员全局记录访问 `/api/admin/query-events`。两者均支持分页、`/:id` 详情及 `/export` 失败导出；普通用户只能访问本人记录。筛选支持 `q,status,from,to,source,page,pageSize,view,group_key`，管理接口另有 `user_id`。纯日期按中国标准时间日边界筛选。

记录包含受理题目快照、指纹、请求／执行编号、最终状态和逐次尝试。历史记录缺失的选项或诊断不从当前题库反推。凭证删除后保留名称快照。查询的 `source` 表示执行通道；题库已不保存旧来源／核验／冲突字段。

排查顺序：

1. 用请求编号确认鉴权、校验、积分不足（402）或限流／繁忙（429），不要只看 HTTP 是否 200。
2. 打开记录详情，区分本地未命中、AI 不确定、网络请求失败、`output_limit` 截断、`response_mapping` JSON 失败和 `answer_mismatch` 选项不匹配。
3. RAG 的 `index_incomplete`、`model_unavailable` 代表跳过参考，普通 AI 查询仍可继续；到向量索引页面查看覆盖及跳过原因。
4. 成功返回本地／AI 答案才扣 1 分；失败释放冻结，已受理的凭证次数保留。使用积分流水核对最终扣费，不从日志次数推算。
5. 修复配置后先在 AI 表单测试，再使用本人凭证复测正式查询。真实模型、协议和结构化输出模式需在实际供应商验证。

重复失败视图按指纹聚合；旧记录没有指纹时按题干近似分组。失败导出包含当前筛选的全部最终失败记录，不受当前页限制，不包含处理中请求；导出内容也可能包含业务题目，应按业务数据管理。
