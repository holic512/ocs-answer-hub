# 多用户、向量和 AI 题库升级

## 兼容升级与数据保护

运行时仍是 Node.js 24、Fastify、React/Vite、Prisma 7 和 PostgreSQL。增加固定版本 Transformers.js 的本地 ONNX CPU 推理。容器改为 Debian slim（ONNX Runtime 需要 glibc/libgomp），无需 Redis。

先停止旧应用接收请求，备份 PostgreSQL（`pg_dump -Fc`）以及 `storage/master.key` 和私密配置，验证备份可读后升级。数据库服务器先安装与 PostgreSQL 大版本对应的 pgvector 0.8.x；有权限的数据库管理员执行 `CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;`。模型不在数据库中，也不写入 Git/镜像。

新应用启动通过原有 `migrate()` 执行 `prisma migrate deploy`，有数据库 advisory lock。只增加两条迁移，不修改已发布初始迁移，不运行 `db push`、`migrate reset` 或清空数据。缺少扩展时事务回滚并停止启动。旧系统只有 schema_migrations 的数据库仍按原基线核对后接管。

- 保留 administrators 表、id=1、原密码哈希与强制改密标记；只扩展角色、禁用和额度字段。序列从已有最大 id 之后分配。
- 原 sessions、api_tokens 和 query_events 归属 id=1。原 token 哈希、明文配置兼容性、有效期、限额和计数不变；无需重新签发 OCS 凭证。
- 管理员新用户额度默认 2000/天、60/分钟，迁移合并当前日 token 已用量（不会低于已消耗数量）。可在用户管理调整。新账号由管理员创建，无公开注册；新建/重置密码要求首次改密。
- 题目、答案版本、来源密文、查询记录和配置均保留。新表是 question_vectors、background_jobs、generation_previews，题目增加生成溯源。
- 旧管理查题 `/api/admin/query` 保留，使用同一扣额链路；新入口 `/api/workspace/query`。原 `/api/ocs/query` 请求和返回格式不变。

迁移测试对旧基线中的每张原始业务表按原字段逐项比较，验证账号、会话、哈希、计数和数据不变，并重复部署。回退不要删除新表或重置迁移历史；旧版本不理解用户会话，因此不得在创建普通用户后直接换回旧服务。优先向前修复；确需恢复时停机后使用已验证备份并由运维评估升级后新增数据。

## 本地 BGE-small-zh-v1.5 INT8

模型为中文 BGE-small-zh-v1.5，**512 维**，CLS pooling、L2 normalize，CPU signed INT8。官方 ONNX 转换仓库 [Xenova/bge-small-zh-v1.5](https://huggingface.co/Xenova/bge-small-zh-v1.5)，原始架构见 [BAAI config](https://huggingface.co/BAAI/bge-small-zh-v1.5/blob/main/config.json)。不支持其他模型或远程 Embedding API。

```sh
node scripts/install-embedding.mjs /absolute/path/models/bge-small-zh-v1.5
```

安装脚本固定模型 revision 并核验权重 SHA256。联网只发生在人工安装阶段；运行时 `allowRemoteModels=false`、`local_files_only=true`、`dtype=int8`，只读取 `onnx/model_int8.onnx`。不能使用 FP32、UINT8 或其它模型兜底。也可在有网络的机器安装后离线复制整个目录。

本地 `.env` 或外置 `config/config.env` 设置 `LOCAL_EMBEDDING_PATH=/absolute/path/models/bge-small-zh-v1.5`，重启生效。Compose 部署可安装到 `storage/models/bge-small-zh-v1.5`，容器路径配置 `/app/storage/models/bge-small-zh-v1.5`。可改用独立只读 bind mount 到相同绝对路径；保持运行用户可读。建议 2 CPU / 2 GiB 起步，实际按题长与并发压测。

管理员 `/api/admin/semantic/health` 和 AI 题库任务页面展示扩展版本、模型状态与覆盖量。公共 `/api/health` 只报告 API/数据库基本存活。模型未配置或故障时向量检索返回未命中，RAG 记录 model_unavailable，精确/安全模糊和外部来源仍可使用；生成和回填明确失败，不跳过去重。修复路径/文件后重启服务。模型状态不是业务答案正确率证明。

在 AI 题库任务页提交“回填题库向量”。每批 10 题，持久化 UUID 游标、已处理数和跳过数，失败保留游标，进程重启或租约到期可恢复。更新已有答案、核验状态、冲突状态或来源会使旧向量摘要失效；须新建回填任务刷新。超出模型 512 token 的输入禁止静默截断，记录 vector_index_skips 原因并推进游标；题型/课程分区内存在缺失、过期或超长向量时，整个分区关闭向量命中/RAG，继续精确/安全模糊和外部检索。生成要求完整向量覆盖；存在无法编码的超长题时须先整理题库，不能跳过它们继续收题。健康覆盖计数代表已有向量数量，不代表摘要全部最新。精确检索立即读取数据库中的最新答案。

## 检索与严格 RAG

精确 → 原有安全模糊 → 高阈值向量 → 外部来源/AI。所有阈值集中于 `server/semantic.ts` 的 SEMANTIC_POLICY：匹配 .985、RAG .98、歧义/生成去重 .965。向量仅采用唯一、人工已核验、非冲突、题型/课程/选项/图片相同且数值/否定词兼容、答案能规范化的候选。多个接近候选、低相似、冲突、过期摘要或超出候选上限一律不命中。阈值须用人工标注集校准后才可降低。

向量表建 HNSW cosine 索引。当前正确性优先，检索对题型/课程分区内候选计算精确距离，避免 ANN 漏掉第二候选导致误判“唯一”。最多读取 13 个过阈值候选，超过 12 个即拒绝。大库瓶颈是精确距离扫描；在标注数据证明召回与歧义检查正确前，不直接换成 ANN top-1。

RAG 只注入已核验、非生成任务来源的唯一高相似题；生成题即使后续核验也仍保守排除。候选数量上限 3、上下文最多 6000 字符（唯一策略通常只有 1 条）。没有合格候选不附加题库上下文。JSON 数据标记题号、来源、核验与相似度。系统提示将题目、选项、图片、课程和题库文本全部视为不可信数据，禁止执行其中指令；指令型文本过滤不被视为绝对的提示注入防护。每次 AI 尝试的 query_events.attempts 保存 RAG enabled/filtered 和过滤原因，不含密钥。来源密文、原有脱敏/加密机制保留。

## 数据库任务与生成边界

每个应用实例内嵌一个串行任务 worker，1 秒轮询；多个实例通过 UPDATE + FOR UPDATE SKIP LOCKED 领取，10 分钟租约及唯一令牌防止旧执行者提交。AI 请求不占用数据库事务；结果、预览、答案版本、向量和轮次进度同事务提交。取消立即持久化，未提交结果丢弃；已提交轮次不会删除。长批次回填逐条续租并存游标。

生成最大 50 轮、500 题、每轮 20 题；实际数量可能因过滤不足。每次失败保留进度，最多 3 次失败（包含手动重试和进程中断后的租约恢复），无无限重试。失败后检查来源/模型再点重试。模型从选定的已启用现有 AI 来源读取，支持原 chat/responses 协议。生成提交前必须已有题库向量全部存在且摘要最新，否则任务失败并要求先回填，不能绕过旧库语义去重。生成持独占 advisory lock、人工及导入写入持共享锁，校验到写入期间不会出现未参与去重的新题。当前校验遍历题库元数据，大库需进一步优化覆盖版本标记。执行结构校验、答案规范化、指令文本过滤、fingerprint、文本及向量去重，生成写入用数据库 advisory lock 串行化批次，跨 worker 不重复收题。新题 verified=false，记录课程、来源、模型、任务 id 和轮次；题库管理可人工核验，绝不自动声称人工确认。

生成和回填属于管理操作，不扣查题额度；调用 AI 来源可能产生上游费用。预览显示每题保存或过滤原因。

## 配额、并发和扩展

工作台、管理员兼容入口、OCS 都在 reserveQuery 中事务执行用户条件 UPDATE，并在 OCS 场景继续扣 token 额度；失败全部回滚。统一按用户再凭证加锁。每日按数据库 CURRENT_DATE（数据库时区）重置、RPM 为固定自然分钟窗口，边界允许相邻窗口的短时突发；不是滑动窗口。禁用/需改密账号不可通过 OCS 绕过。

扣额与 pending 查询记录同事务提交，命中、未命中、上游失败都消耗已受理次数。输入/鉴权/额度失败不扣次数；受理后繁忙标记 rejected 并保留次数，避免靠重试绕过额度。进程崩溃可留下 pending，这是受理审计而非成功记录；不会自动重放或退款导致重复外部请求。管理、导入导出、来源测试和任务不扣查题次数。

初始目标：单实例支持 5–20 个同时查题调用；20 个不同题工作槽、每来源最多 4 个并发、同题合并外部工作（每个调用者分别计次/记账）、总来源预算 55 秒。本地 ONNX 最多 2 个推理、最多等待 10 秒。数据库池最多 12、连接等待 5 秒、SQL 超时 8 秒。密码哈希、CPU 推理、慢 AI 和大题库距离扫描是主要瓶颈。网络入口已有每 IP 粗限流，用户额度/RPM 的正确性只由数据库决定。

新增 sessions(user_id)、api_tokens(user_id)、query_events(user_id,created_at DESC)、任务领取索引、预览索引和 HNSW 索引；原题干和查询日期索引保留。水平扩展时共享 PostgreSQL 与同一 master.key，私密配置、模型文件统一部署；不缓存答案状态，因此跨实例纠错立即可见。任务和额度无需粘性会话。每实例 12 连接和每来源 4 并发会随副本数相乘，先按数据库连接预算/上游合同限制副本数量；后续可独立部署 worker、采用 PgBouncer transaction pooling（验证 Prisma/迁移专用直连）和数据库全局来源槽位。未引入未经验证的消息队列。

自动测试覆盖 20 路混合 HTTP 额度、20 路 RPM、token 扣额回滚、权限隔离、密码/禁用、跨实例答案一致性、20 个不同题来源并发上限、模型本地推理、阈值/RAG、迁移字段保留、生成过滤和租约恢复。测试结果与实际环境限制见交付报告；单次开发机压测不等同长期 SLA。

## 依赖安全补丁

Transformers 3.8.1 间接依赖的 sharp 固定覆盖至 0.35.5，并同步其原生包和 libvips，修复 [libheif](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) 与 [librsvg](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) 高危公告。升级 Transformers 时应重新评估该 scoped override；Node 24、真实本地推理、原生图像模块加载及多架构镜像需继续通过 CI。

现有 @fastify/static 10.1.8 的 glob/minimatch 依赖链仍有中危公告：[glob 取消后遍历](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)、[minimatch 模式放大](https://github.com/advisories/GHSA-g3hv-75wg-m249)。当前静态服务使用默认 wildcard 路由，未执行该 glob 遍历分支，也未向用户开放 glob 模式输入。修复版本涉及 glob 14、minimatch 11 和 path-scurry 3 的兼容升级，须跟进上游更新并验证后部署；目前不能声称依赖漏洞已全部清零。
