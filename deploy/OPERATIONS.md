# 部署与恢复

本文件是**新环境模板**，不包含当前线上凭据；整理仓库不等于重新部署现有服务。

## 新部署

1. 准备独立 PostgreSQL 数据库与低权限项目角色，启用 pg_trgm。禁止应用使用数据库管理员。
2. 在仓库根 `npm ci && npm run build`。构建会生成 Prisma 客户端；Dockerfile 使用预构建的 `dist`，不是自动从 TS 构建；源码克隆后不能跳过此步。
3. 将 `deploy/compose.yaml` 复制为仓库根 `compose.yaml`，`deploy/.env.example` 复制为根 `.env` 并填写当前部署真实值，私密文件权限 0600，**不要把本地开发 .env 覆盖成生产配置**。
4. 配置 `DATABASE_NETWORK` 为已有数据库外部 Docker 网络，`DB_HOST`为该网络可访问的地址，`APP_ORIGIN` 为准确的 HTTPS 访问域名。
5. 创建 `state/`（容器 UID 1000 可写，目录0700）；`docker compose build app && docker compose up -d app`。只管理应用，不重建共享数据库/其他服务。
6. 应用仅映射主机 `127.0.0.1:18771`，由独立 HTTPS 反代公开。证书、DNS、反代和防火墙的修改必须另行确认。

容器内 `HOST=0.0.0.0`、`STATE_DIR=/app/state` 由 compose 明确设置，不表示数据库公开。主机的可访问地址和容器内地址不是一回事。

首次启动管理员凭据在 `state/bootstrap-admin.json`，改密后删除；`state/master.key` 必须持久保存。已有管理员不会因为更新而重置。启动会先应用 Prisma 待执行迁移，失败则停止启动；迁移及旧库接管规则见 `docs/DATABASE_AND_VERSIONING.md`。

## 更新与验收

先在专用测试库运行 `npm run verify`，必要时运行浏览器验收。打包不含 node_modules、state、真实环境、证据；保存旧应用镜像和源码。只替换已测发布，`docker compose build app && docker compose up -d app` 不动数据库。

验收：HTTPS 正常校验证书；`/api/health` 为200；未登录后台 API 为401；错误/撤销凭证不可查题；新前端资源与构建匹配；已有账号、题库、来源和主密钥保留。真实 OCS 客户端及供应商需单独验收，不拿夹具或 HTTP 200 冒充有效答案成功。

## 备份

最少同时备份 `pg_dump`、主密钥和部署 `.env`，目录0700、文件0600，离线私密保管。先在独立恢复数据库验证，禁止向生产直接 `pg_restore --clean`。源码仓库不是数据备份；本轮交接未导出生产数据库或主密钥。

## 上游和限制

支持 HTTP/HTTPS 及合法自定义端口；HTTP 会明文传输题目和上游密钥，网站 HTTPS 不保护该链路。HTTPS 证书仍验证、DNS 地址固定、不跟随重定向；未授权私网/回环/元数据默认拒绝，通过 `UPSTREAM_ALLOW_HOSTS` 精确授权受控内网。

首版本地保守中文模糊，不是向量。逐源串行、有效答案即停止，超时/无答案/不匹配回退。AI自动学习但未核验，不能保证准确。单次上游预算55秒，每源1～45秒，同题并发合并，不同题对同来源排队并计入时限。
