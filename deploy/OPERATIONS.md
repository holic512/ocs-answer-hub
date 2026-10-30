# 镜像发布、部署与恢复

## 首次初始化（部署后第一步）

**应用连接数据库后，若没有管理员，浏览器会优先显示「初始化管理员」页面。请自行设置管理员账号、密码和确认密码，完成后使用该账号登录。**

系统不再自动生成管理员密码，也不再生成 `bootstrap-admin.json`。新创建的账号无需再次强制改密。管理员是否存在以数据库为准；已有账号时直接进入登录流程，重启或升级不会重新创建或覆盖账号。旧版账号的数据和已有改密要求保持不变。

## 方案与目录

GitHub Actions 从源码构建完整 Node.js/Fastify、React/Vite、Prisma 镜像并发布 GHCR，服务器无需安装 Node.js 或克隆源码。现有 PostgreSQL 继续使用，不新建共享数据库或其他中间件。

```text
data/
└── ocs-answer-hub/
    ├── config/
    │   └── config.env       # 应用运行配置与私密数据库凭据
    ├── storage/             # 加密主密钥及持久文件
    ├── compose.yml          # 容器定义，已有文件不自动替换
    └── .env                 # 仅保存镜像、网络、宿主机端口等 Compose 参数
```

沿用项目已有环境变量格式，避免增加 YAML 解析依赖。应用运行配置只有 `config/config.env` 一处；同目录 `.env` 只用于 Docker Compose 创建容器，不参与应用配置加载。数据库业务数据仍在原 PostgreSQL 中。

镜像内 `/app/defaults/config.env` 是无密钥模板，`/app/config/config.env` 是外置配置，二者分离。一次性 init 容器以 root 创建缺失文件并准备目录；长期运行的应用使用 UID/GID 1000、只读根文件系统和只读配置目录。已有配置不覆盖，不自动改写内容、权限或字段。

## GitHub Actions 与标签

工作流：`.github/workflows/docker.yml`。

- 推送 `main`：测试后发布 `ghcr.io/holic512/ocs-answer-hub:latest` 和提交 SHA 标签。
- 推送与应用版本一致的 `vX.Y.Z`：发布 `X.Y.Z`、`vX.Y.Z` 和 SHA 标签；Tag 与 package.json 不一致时拒绝发布。
- `latest` 只跟随 main，发布旧版本 Tag 不会覆盖它。
- PR：测试并构建镜像，不登录或推送 GHCR。
- 发布前在临时 PostgreSQL 和目录中执行完整部署生命周期验收，失败不发布镜像。
- 镜像包含 linux/amd64 和 linux/arm64；构建缓存使用 GitHub Actions cache。
- Actions 使用固定提交 SHA，发布权限限定为内容读取及包写入，认证使用内置 GITHUB_TOKEN，不需要把生产数据库密码配置到 GitHub。

仓库管理员需允许 Actions 写入 Packages。首次发布后，如需匿名拉取，应将 GHCR 包可见性设为 public；私有包则先在服务器使用有 `read:packages` 权限的凭据执行 `docker login ghcr.io`。本仓库配置不会自动改变包可见性。

应用版本由已有提交钩子管理；Tag 只标记提交，不增加版本。确认当前提交版本后再创建对应 Tag，不要提前写死下一个版本。

## 首次部署

准备 Docker Engine 与 Compose 插件、已创建的 PostgreSQL 数据库及项目账号。数据库应可通过已有 Docker 外部网络访问，pg_trgm 由数据库管理员安装。迁移账号需要相应建表及改表权限。

只需 Docker 即可从镜像取出部署脚本，无需克隆源码或安装 Node.js：

```sh
IMAGE=ghcr.io/holic512/ocs-answer-hub:latest
docker pull "$IMAGE"
docker run --rm --entrypoint cat "$IMAGE" /app/defaults/deploy.sh > deploy.sh
# 将“已有数据库网络名”替换为实际值；部署路径可改为绝对路径。
sh deploy.sh "$IMAGE" ./data/ocs-answer-hub 已有数据库网络名
```

脚本顺序：拉取镜像 → 创建部署目录 → 从镜像导出缺失的 compose.yml → 初始化缺失配置及存储目录 → 以应用用户校验配置 → Compose 创建并等待应用健康。

首次没有配置时，init 会生成模板；由于模板不包含真实数据库密码，校验会停止并提示填写配置。这是正常的首次配置流程，不会启动一个连接错误数据库的应用。

编辑 `data/ocs-answer-hub/config/config.env`：

```dotenv
DB_HOST=postgres
DB_PORT=5432
DB_NAME=answer_hub
DB_USER=answer_hub
DB_PASSWORD="填写原数据库密码"
APP_ORIGIN=https://questions.example.com
```

数据库地址必须是容器网络可访问地址。`127.0.0.1` 在应用容器中指向应用自身。密码按原文填写，无需 URL 编码；包含 #、空格时使用引号。配置每项单独一行，不支持跨行字符串；字段拼写错误、重复字段、无效端口、访问地址、主密钥等会被拒绝，错误不会输出配置值。

填写后再次运行相同部署命令。配置与 storage 已存在时不会覆盖。

### 首次部署前预置配置

可以提前创建 `config/config.env`，内容参考 `deploy/config.env.example`。配置文件及目录须允许容器 UID 1000 读取，例如在 Linux 上：

```sh
mkdir -p data/ocs-answer-hub/config
# 将准备好的配置放入 config/config.env 后执行：
chown 1000:1000 data/ocs-answer-hub/config data/ocs-answer-hub/config/config.env
chmod 700 data/ocs-answer-hub/config
chmod 600 data/ocs-answer-hub/config/config.env
```

脚本保留预置配置的字节内容及权限，不会为了通过校验自动放宽用户文件权限。已有文件不可读取时应先修正权限。

### 不使用部署脚本

将 `deploy/compose.yaml` 保存为部署目录的 `compose.yml`，将 `deploy/.env.example` 保存为同目录 `.env` 并修改镜像、数据库网络和端口：

```sh
cd data/ocs-answer-hub
docker compose -f compose.yml pull
docker compose -f compose.yml run --rm --no-deps init
# 填写或预先放置 config/config.env。
docker compose -f compose.yml run --rm --no-deps app check
docker compose -f compose.yml up -d --wait
```

应用启动先加载并校验配置，再按版本执行 Prisma 迁移，成功后才监听端口。初始化过程不创建外部数据库或数据库账号。

## 配置修改与升级

### 修改应用运行配置

修改 `config/config.env` 后执行：

```sh
cd data/ocs-answer-hub
docker compose -f compose.yml run --rm --no-deps app check
docker compose -f compose.yml restart app
```

配置在每次进程启动时从文件重新读取，不在镜像构建时固定。文件值优先于同名进程环境变量，缺失的可选字段使用代码默认值。升级不会向用户文件补写新字段，不覆盖已有配置。

前端使用相对 `/api`，未注入数据库密码、密钥或固定 API 域名；浏览器访问地址由服务端运行配置 APP_ORIGIN 决定，用于请求来源校验及生成 OCS 配置。静态构建仅注入应用版本号，无需新增运行时公开配置接口。

### 修改 Docker 创建参数

修改 `.env` 或 `compose.yml` 中的端口映射、网络、挂载等参数后，需要重新创建容器：

```sh
docker compose -f compose.yml up -d --force-recreate --wait
```

仅 restart 不会更新上述 Docker 参数。若修改应用内部 PORT，需同时更新 Compose 的容器目标端口，避免映射不一致。通常只修改 APP_PORT，保持容器内部 18771。

### 镜像升级

使用已经发布的目标版本替换命令中的版本号：

```sh
sh deploy.sh ghcr.io/holic512/ocs-answer-hub:目标版本 ./data/ocs-answer-hub
```

已有部署可省略网络参数，继续使用原 `.env`；若明确传入新网络，脚本会按新网络重新创建容器。脚本不替换已有 compose.yml，也不修改 config/config.env；启动成功后仅同步 .env 中的镜像及明确指定的网络参数。

手动升级也可修改 `.env` 的 APP_IMAGE，然后依次执行 pull、init、check、up。新版 Compose 模板若涉及挂载或网络变化，应审阅后手动合并，脚本不会自动替换用户容器定义。

### 从旧版 state/.env 部署迁移

先备份并停止旧应用，保留 PostgreSQL。将原 state 目录内容完整复制到 storage，或将新 Compose 的存储绑定源改为原 state 绝对路径。将旧应用 `.env` 中的五项数据库配置和 APP_ORIGIN 填入 config/config.env。配置仅保留数据库、访问地址及所需监听和存储字段，不再填写测试参数、上游白名单或手动密钥。

如果旧部署曾通过环境变量手动指定加密主密钥，请先将原值保存为 `storage/master.key` 并设置应用用户可读取的权限，再移除旧密钥配置。必须保留原 master.key；不要让旧数据库配上新生成的密钥。容器用户保持 UID/GID 1000，原有文件应具有对应读写权限。应用会接管已确认的旧数据库基线；不会重置管理员或清空题库。

## 备份与验收

备份 PostgreSQL、config/config.env、storage/master.key，以及 compose.yml 和 Compose 参数 .env。真实配置、状态、备份不能提交 Git；Docker 构建上下文采用白名单，不发送宿主机部署目录和真实 .env。

本地验收：

```sh
docker build -f deploy/Dockerfile -t ocs-deployment-check:base .
node scripts/deployment-acceptance.mjs
```

该测试创建独立 PostgreSQL、网络和宿主机临时绑定目录，覆盖首次初始化、预置配置、错误配置、只读挂载、修改后重启、容器重建、模拟新版镜像升级及配置/密钥/数据库数据持久化；结束清理本次测试资源。模拟镜像升级用于验证持久化，不代表 GHCR 发布或线上升级已完成。

真实 GHCR 发布需将工作流提交并推送到 GitHub 后观察 Actions。真实反代、HTTPS、OCS 客户端和供应商调用需要另行验收，不以本地夹具或镜像构建成功代替。

## Python 运维入口

新增 `delpoy/deploy.py`，提供 install、start、restart、update、stop、status、logs、check，复用本文部署目录。使用 Python 3.8+ 标准库，无需 pip 依赖。原 Shell 脚本继续兼容；命令和参数见 `delpoy/README.md`。镜像内同时保存 `/app/defaults/deploy.py`，供服务器取出使用。
