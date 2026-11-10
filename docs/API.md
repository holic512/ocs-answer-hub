# 接口索引

以下路径包含 `/api` 前缀。系统为单系统，普通用户仅能访问本人工作区；管理员拥有独立管理及运维权限。列表通常返回 `{items,total,page,pageSize}`，默认 `page=1`、`pageSize=30`，最大 `100`；统计、配置、导出及详情采用各自结构。

## 认证

| 方法与路径 | 输入／结果 |
| --- | --- |
| `GET /api/setup` | `{required,registrationEnabled,registrationCredits,tokenDefaults:{daily_limit,rpm,max_daily_limit,max_rpm}}` |
| `POST /api/setup` | 首次初始化 `{username,password,confirmPassword}` |
| `POST /api/register` | 同上；受注册开关约束 |
| `POST /api/login` | `{username,password}`，返回账号、角色、`csrf`、`mustChange` |
| `GET /api/admin/me` | 当前账号及 CSRF；保留的公共会话接口，普通用户也可访问 |
| `POST /api/admin/password` | `{oldPassword,newPassword}` |
| `POST /api/admin/logout` | 退出会话 |

密码长度 `8～128`。会话有效期 12 小时，Cookie 为 HttpOnly、SameSite Strict，HTTPS 使用 Secure。认证写操作需 Cookie、`X-CSRF-Token`，请求 `Origin` 必须等于 `APP_ORIGIN`；初始化、登录、注册不要求会话／CSRF，但同样校验 `Origin`。忘记密码由管理员重置。

## 本人工作区

| 方法与路径 | 输入／结果 |
| --- | --- |
| `GET/POST /api/workspace/tokens` | 列表支持 `q`；新增 `{name,daily_limit?,rpm?,expires_at?}` |
| `PUT /api/workspace/tokens/:id` | 同上编辑；到期时间为 ISO 时间或 `null` |
| `POST /api/workspace/tokens/:id/revoke` | 撤销 |
| `DELETE /api/workspace/tokens/:id` | 删除，历史查询保留凭证快照 |
| `POST /api/workspace/query` | `{tokenId,title,type,options,images?,course?}`，必须选择本人凭证 |
| `GET /api/workspace/usage` | `{id,username,role,balance,frozen,available,requests,hits}`，请求数为中国标准时间当日 |
| `GET /api/workspace/credits` | 顶层余额／冻结／可用及分页 `items` 流水 |
| `GET /api/workspace/recent` | 最近 20 次查询 `{items}` |
| `GET /api/workspace/query-events` | 本人查询列表、失败分组；详情 `/:id`，失败导出 `/export` |

创建凭证返回 `{id,token,config}`，完整 `token` 只返回一次。限额按凭证，积分按账号；受理与结算规则见[配置](CONFIGURATION.md#账号积分与凭证)。题型为 `single`、`multiple`、`judgement`、`completion`，查询还兼容 `unknown`。

积分流水项为 `{id,amount,balance,reason,actor_id,actor_name,event_id,created_at}`。`amount` 带正负号，`balance` 为该笔之后余额；没有 `kind` 字段。查询成功 `code=1`，`answer` 为规范化字符串；未获得答案 `code=0`，包含 `message`、`attempts` 等诊断。积分不足 HTTP `402`，限额／繁忙 HTTP `429`，HTTP 成功本身不代表命中。

## OCS

`POST /api/ocs/query` 使用 `Authorization: Bearer 凭证`，兼容 JSON `token`。题目字段和响应结构沿用查询协议，不需要网页会话或 CSRF。生成的 wrapper 已包含认证及结果映射，不含 AI 密钥。管理员可用 `POST /api/admin/ocs-config {token}` 为已有有效明文凭证重新生成 `{config}`；服务端不能从哈希找回明文。

## 管理

| 方法与路径 | 说明 |
| --- | --- |
| `GET/POST /api/admin/users` | 列表 `q,role=all\|admin\|user,status=all\|active\|disabled\|deleted`；新增 `{username,password,role}` |
| `GET/PUT/DELETE /api/admin/users/:id` | GET 直接返回用户对象；PUT `{username,role,disabled}`；DELETE 软删除，保留记录 |
| `POST /api/admin/users/:id/password` | `{password}`，清除会话并要求改密 |
| `GET/POST /api/admin/users/:id/credits` | 查询流水；调整 `{amount,reason}`，非零整数 `-1000000～1000000` |
| `/api/admin/tokens` 及 `/:id`、`/:id/revoke` | 与工作区相同 CRUD；GET 支持 `user_id`，POST 可指定 `user_id` |
| `GET/PUT /api/admin/settings` | 完整系统设置，字段见[配置](CONFIGURATION.md#系统设置) |
| `GET/POST /api/admin/providers` | 仅 `kind:'ai'`；完整字段见[AI 表单配置](CONFIGURATION.md#ai-表单配置) |
| `PUT/DELETE /api/admin/providers/:id` | 编辑／删除；编辑 `apiKey:''` 保留旧密钥 |
| `POST /api/admin/providers/reorder` | `{ids:[配置ID]}` |
| `POST /api/admin/providers/test` | 草稿测试 `{provider,question?}`；`provider` 为完整表单对象 |
| `POST /api/admin/providers/:id/test` | 已保存配置测试，可传 `{provider?,question?}` 覆盖草稿；不保存 |
| `GET/POST /api/admin/questions` | 列表 `q,course,type`；题目字段 `title,type,options,images,course,answer` |
| `PUT/DELETE /api/admin/questions/:id` | 编辑／软删除 |
| `GET /api/admin/questions/:id/versions` | `{items}`，包含答案、操作、快照、时间 |
| `GET /api/admin/courses` | 课程列表 |
| `GET /api/admin/export` | `{format:'ocs-answer-hub-v2',items}` |
| `POST /api/admin/import` | `{preview:true,overwrite:false,items}`；最多 500 条，默认预览且不覆盖重复题 |
| `GET /api/admin/stats` | `{totals,questions,sources,daily,recent}`；查询汇总最近 30 天，缓存 15 秒，题目数为当前总数 |
| `GET /api/admin/query-events` | 全局记录；详情和失败导出路径同工作区 |

`/api/admin/query` 作为兼容入口保留，同样必须传本人 `tokenId`，不绕过积分或凭证限额。用户删除会撤销其凭证、清除会话、取消活动任务并关闭所属计划；必须保留至少一名有效管理员。

查询记录支持 `q,status,from,to,source,page,pageSize,view,group_key`，管理接口另支持 `user_id`；`view=failures` 聚合重复失败。纯日期按中国标准时间日边界处理。这里的 `source` 是一次查询的命中／尝试通道，不是已移除的题目字段。

## 运维

| 方法与路径 | 输入／结果 |
| --- | --- |
| `GET /api/admin/operations/vector` | 模型 `ready,reason,extension`、`coverage:{total,indexed,pending,skipped}`、最近跳过列表 `skips` |
| `POST /api/admin/operations/vector/run` | `{rebuild?:false}`，返回 `202` 任务；重建会让现有向量失效 |
| `GET/POST /api/admin/operations/jobs` | 分页，筛选 `kind,status`；POST 见下方任务对象 |
| `GET /api/admin/operations/jobs/:id` | `{job,items,total,page,pageSize}`，`items` 是生成结果／过滤原因 |
| `POST /api/admin/operations/jobs/:id/cancel` | 取消，已入库题目保留 |
| `POST /api/admin/operations/jobs/:id/retry` | 仅未取消且未达重试上限的失败任务 |
| `GET/POST /api/admin/operations/schedules` | 分页／创建完整计划对象 |
| `PUT/DELETE /api/admin/operations/schedules/:id` | 编辑完整对象／删除计划 |
| `POST /api/admin/operations/schedules/:id/run` | 手动唤醒该计划，使用相同参数派发任务 |

回填任务为 `{kind:'backfill',rebuild:false}`。生成任务为 `{kind:'generation',provider_id,course,seed_ids,max_rounds,max_questions,batch_size}`；种子 `1～20` 个，均须属于该课程。默认 `5` 轮、`50` 题、每批 `10` 题，上限分别 `50/500/20`。

计划字段为 `{name,kind,enabled,mode,interval_minutes,time_of_day,config}`；`kind` 为 `backfill|generation`，`mode` 为 `interval|daily`，间隔 `1～10080` 分钟，每日时间为 `HH:mm`（中国标准时间）。生成 `config` 填上述生成参数，回填可填 `{rebuild:false}`；返回增加 `id,next_run_at,last_run_at` 等字段。执行与恢复限制见[运维说明](MULTIUSER_UPGRADE.md)。
