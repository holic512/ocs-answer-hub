# 知序 · OCS Answer Hub

兼容 OCS 网课助手的个人题库，提供本地题库管理、第三方查题和 AI 答案查询。查询时先查本地，再按后台设置的顺序调用外部来源，有效答案自动保存到本地。

技术栈：**Node.js 24 · TypeScript · Fastify · React / Vite · PostgreSQL 17 · Prisma**。服务器推荐使用 Docker 镜像安装，无需安装 Node.js。

## 首次初始化（部署后第一步）

**应用连接数据库后，如果数据库中没有管理员，会优先显示「初始化管理员」页面。自行设置账号、密码和确认密码，完成后登录。**

- 管理员密码至少 8 个字符，不强制特殊符号；系统不自动生成管理员密码，也不生成明文密码文件。
- 新账号无需再次强制改密。已有账号直接进入登录流程，重启、重建和升级不会覆盖账号。
- 旧版账号的数据及已有改密要求保持兼容。管理员登录密码与数据库密码是两套独立凭据。

## 导航

[服务器安装](#服务器安装推荐) · [日常运维](#日常运维) · [使用与 OCS 接入](#使用与-ocs-接入) · [本地开发](#本地开发) · [开发残留清理](#开发残留清理) · [常见问题](#常见问题) · [参考文档](#参考文档)

## 功能与边界

- 管理本地题目，支持导入、导出、保守模糊匹配、答案版本和冲突记录。
- 支持言溪、通用 HTTP 及 OpenAI 兼容接口；来源可排序、启停和单独测试，本地题库始终优先。
- 为 OCS 生成独立调用凭证与题库配置，支持限速、每日额度和凭证撤销。
- 展示查询统计及脱敏诊断；AI 答案标记为未核验，不能保证答案正确。
- 应用运行配置外置，重启加载；运行日志持久化并自动轮转，启动自动执行待应用的数据库版本迁移。

## 服务器安装（推荐）

### 1. 准备环境

需要 Linux、Python 3.8+、Docker Engine、Docker Compose 插件，以及可访问的 PostgreSQL 17 数据库。运维脚本仅使用 Python 标准库，无需 pip 依赖。以下示例使用有 Docker 权限且可读写 `/data` 的账号执行。

Docker 安装按发行版选择[官方安装教程](https://docs.docker.com/engine/install/)，并安装 [Compose 插件](https://docs.docker.com/compose/install/linux/)。安装后检查：

```sh
python3 --version
docker version
docker compose version
```

应用镜像名称为 `ghcr.io/holic512/ocs-answer-hub`，工作流构建 `linux/amd64` 和 `linux/arm64`。**需要仓库的 GitHub Actions 已成功发布镜像**；`latest` 跟随 main，固定版本标签使用已发布的版本号。私有镜像需先执行 `docker login ghcr.io`。

### 2. 准备数据库与网络

应用安装脚本不创建数据库或数据库账号。已有专用数据库可直接使用；新库可由数据库管理员在 `psql` 中执行下面的示例，使用 `\password` 交互设置密码：

```sql
CREATE ROLE answer_hub LOGIN;
\password answer_hub
CREATE DATABASE answer_hub OWNER answer_hub;
\connect answer_hub
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

`pg_trgm` 用于模糊检索，需由有权限的数据库管理员安装；缺少时应用保留原有降级行为。应用账号需拥有目标库及相应建表、改表权限，以执行版本迁移。

Compose 使用名为 `databases` 的外部网络。如果数据库已在其他自定义网络内，安装时直接使用实际网络名。如果需要新网络，可执行：

```sh
docker network create databases
# 仅当现有 PostgreSQL 容器尚未连接此网络时执行，替换为实际容器名。
docker network connect databases 你的数据库容器名
```

同一自定义网络中的数据库可通过容器名或网络别名连接。远程数据库填写实际 IP / 域名，并确保允许应用网络访问。**应用容器里的 `127.0.0.1` 指向应用自身。**

### 3. 获取运维脚本并安装

服务器无需克隆源码，从镜像取出运维脚本即可：

```sh
mkdir -p /data/ocs-answer-hub
cd /data/ocs-answer-hub

# 可替换为 GHCR 中已发布的固定版本标签。
IMAGE=ghcr.io/holic512/ocs-answer-hub:latest
docker pull "$IMAGE"
docker run --rm --entrypoint cat "$IMAGE" /app/defaults/deploy.py > deploy.py

# databases 替换为前一步确认的数据库网络名。
python3 deploy.py install --dir /data/ocs-answer-hub --image "$IMAGE" --network databases
```

安装顺序是：拉取镜像 → 初始化缺失目录和配置 → 校验配置 → 启动容器并等待健康检查。首次配置模板没有数据库密码，因此**第一次安装会在配置校验处停止并提示填写配置，这是预期流程**。提前放置了有效配置时可直接完成安装。

### 4. 填写配置并启动

编辑 `/data/ocs-answer-hub/config/config.env`，按实际数据库信息填写：

```dotenv
# 地址不含协议和端口，Docker 数据库使用容器名或网络别名。
DB_HOST=你的数据库容器名
DB_PORT=5432
DB_NAME=answer_hub
DB_USER=answer_hub
# 按原文填写，包含 # 或空格时使用引号。
DB_PASSWORD="填写数据库密码"

# 必须与浏览器实际访问地址一致，不带末尾斜杠。
APP_ORIGIN=http://127.0.0.1:18771
```

随后启动并查看状态：

```sh
python3 deploy.py start --dir /data/ocs-answer-hub
python3 deploy.py status --dir /data/ocs-answer-hub
```

已有配置必须完整保留，安装和升级不会覆盖。预置配置时，目录及文件需允许容器 UID/GID `1000:1000` 读取；建议目录权限 `700`、配置文件权限 `600`。具体做法见[部署说明](deploy/OPERATIONS.md#首次部署前预置配置)。

### 5. 访问并创建管理员

默认只监听服务器的 `127.0.0.1:18771`。首次可在自己电脑上建立 SSH 隧道：

```sh
ssh -L 18771:127.0.0.1:18771 用户名@服务器地址
```

保持连接，在电脑浏览器访问 `http://127.0.0.1:18771`，创建管理员并登录。

日常远程使用建议配置 HTTPS 反向代理，将站点转发到服务器 `127.0.0.1:18771`，再将 `APP_ORIGIN` 改为实际域名，例如 `https://questions.example.com`，并重启应用。之后通过该域名访问；OCS 配置也使用同一地址。

### 部署后的目录

```text
/data/ocs-answer-hub/
├── deploy.py           # 运维脚本
├── compose.yml         # 容器定义，已有文件不自动覆盖
├── .env                # 仅 Docker 镜像、网络、宿主机端口参数
├── config/
│   └── config.env      # 应用运行配置及数据库凭据
├── logs/
│   └── app.log         # 运行日志，自动轮转
└── storage/
    └── master.key      # 自动生成的加密主密钥，必须保留
```

题库、管理员、来源配置和调用凭证存于 PostgreSQL。上游配置使用主密钥加密，数据库备份与 `storage/master.key` 应配套保存。数据库密码和上游密钥仅供服务端读取。

## 日常运维

以下命令在 `/data/ocs-answer-hub` 中执行：

```sh
python3 deploy.py start   --dir /data/ocs-answer-hub
python3 deploy.py restart --dir /data/ocs-answer-hub
python3 deploy.py stop    --dir /data/ocs-answer-hub
python3 deploy.py status  --dir /data/ocs-answer-hub
python3 deploy.py logs    --dir /data/ocs-answer-hub --tail 100
python3 deploy.py check   --dir /data/ocs-answer-hub

# 拉取并更新当前记录的镜像；latest 获取新内容，固定版本继续使用该版本。
python3 deploy.py update --dir /data/ocs-answer-hub
```

切换到指定版本：

```sh
# 将目标版本替换为已发布的实际标签。
python3 deploy.py update --dir /data/ocs-answer-hub --image ghcr.io/holic512/ocs-answer-hub:目标版本
```

| 变更内容 | 生效方式 |
| --- | --- |
| `config/config.env` 中的应用配置 | `restart`：校验后重启，重新读取配置 |
| `.env` / `compose.yml` 中的 Docker 端口、网络或挂载 | `start`：按需重新创建容器 |
| 镜像版本 | `update`：拉取目标镜像、校验并重新创建 |
| 停止服务 | `stop`：保留容器、配置和业务数据 |

首次安装或更新可使用 `--bind`、`--port` 调整宿主机监听参数；离线导入镜像后可加 `--no-pull`。完整参数见 [Python 运维说明](delpoy/README.md)。

升级前备份 PostgreSQL、`config/config.env`、`storage/`、`compose.yml` 和部署参数 `.env`。迁移失败时应用停止启动，不会清空数据库；脚本不会自动回滚数据库。恢复时应停止应用，并恢复同一备份时点的数据库及密钥。

### 日志文件

Docker 部署将应用日志保存到 `/data/ocs-answer-hub/logs/app.log`，同时保留 Docker 控制台输出。日志采用 JSON 行格式，记录 UTC 时间、级别和消息；单文件达到 10 MiB 后轮转，最多保留 `app.log.1`～`app.log.3` 三份历史文件。启动、API 请求、管理操作、查题回退及来源测试诊断都会落盘，无需增加配置项。页面显示的请求编号可关联对应日志；详细事件和排错方法见[日志与追溯](docs/LOGGING.md)。

```sh
tail -n 100 /data/ocs-answer-hub/logs/app.log
tail -f /data/ocs-answer-hub/logs/app.log
```

重启、重新创建及镜像升级均保留宿主机日志。本地开发日志保存在项目根目录 `logs/app.log`，开发清理脚本不删除运行日志。

已有部署的 `compose.yml` 不会被脚本覆盖；升级到日志持久化版本前，需按[部署说明](deploy/OPERATIONS.md#已有部署增加日志挂载)补充 `logs/` 挂载，再重新创建容器。

## 使用与 OCS 接入

1. 在「检索来源」添加言溪、HTTP 或 AI 来源。参考 [examples/providers](examples/providers/)，替换凭据、地址和模型等占位符；示例不会自动导入或启用。
2. 按需要启用来源并调整顺序，本地题库始终先查。单源测试可测试禁用或未保存配置，不写题库、不扣本服务凭证额度，但可能消耗上游额度。
3. 在「查题工作台」验证查询结果，确认来源及答案正确。
4. 在「OCS 接入」创建调用凭证、生成 JSON，粘贴到 OCS 第三方题库配置；用户脚本需允许实际部署域名的 `@connect`。

OCS 凭证与上游密钥独立，生成的 OCS 配置不包含上游密钥。通用 HTTP 配置只支持字段映射和模板，不执行自定义 JavaScript handler。详细字段及 AI 配置见[配置参考](docs/CONFIGURATION.md#题库源配置)。

## 本地开发

需要 Node.js 24+、npm；使用仓库自带本地数据库时还需 Docker Compose。在项目根目录执行：

```sh
git clone https://github.com/holic512/ocs-answer-hub.git
cd ocs-answer-hub
npm ci

# 仅首次需要：生成 .env，再启动隔离的本地 PostgreSQL。
node scripts/setup-local.mjs
docker compose -f compose.dev.yaml up -d --wait

# 日常开发：一个命令启动前后端，Ctrl+C 一起停止。
npm run dev
```

访问 `http://127.0.0.1:5173`。`setup-local.mjs` 不覆盖已有 `.env`，只为本地数据库生成密码；管理员仍由首次页面创建。使用已有 PostgreSQL 时填写 `.env` 的五项数据库字段，无需启动本地 Docker 数据库。

本地数据库默认映射到 `127.0.0.1:15432`，测试数据库由验收工具自动创建到独立临时容器。前端默认 `5173`，通过代理访问后端 `18771`；`APP_ORIGIN` 必须与浏览器地址一致。停止本地数据库并保留数据：

```sh
docker compose -f compose.dev.yaml stop
```

构建前后端：

```sh
npm run build
```

产物位于 `dist/server` 和 `dist/web`。镜像部署不需要服务器手动构建；GitHub Actions 从源码完成镜像构建。更多说明见[本地开发](docs/LOCAL_DEVELOPMENT.md)。

## 检查与测试

```sh
npm run typecheck
npm test
python3 -B -m unittest discover -s tests -p test_deploy.py
```

运行 `npm test` 需要 Docker。数据库测试自动创建独立临时 PostgreSQL 容器，使用随机端口和密码，结束后自动清理；不读取 `.env` 或连接业务数据库，无需填写测试配置。浏览器验收使用 Playwright 默认 Chromium，报告与截图固定保存到 `artifacts/verification`。

浏览器、迁移及 Docker 生命周期验收的直接命令见[本地开发](docs/LOCAL_DEVELOPMENT.md#测试安全)、[数据库迁移](docs/DATABASE_AND_VERSIONING.md#验证)和[部署验收](deploy/OPERATIONS.md#备份与验收)。

## 开发残留清理

在停止开发服务和验收任务后执行；脚本会定位仓库根目录：

```sh
# 先查看将清理的项目。
node scripts/clean.mjs --dry-run

# 清理可重新生成的开发产物。
node scripts/clean.mjs
```

清理范围为构建产物 `dist/`、验收报告与截图 `artifacts/`、覆盖率报告、Playwright 报告、Vite / 工具缓存及运维测试 Python 缓存。需要保留的验收证据应先移出这些目录。

脚本不清理 `node_modules` 依赖本身、`.env`、`data/`、`config/`、`state/`、`storage/`、`logs/`、备份、数据库、Docker 容器或数据卷。清理后可直接 `npm run dev`，需要打包时重新运行 `npm run build`。

## 常见问题

| 现象 | 检查方式 |
| --- | --- |
| GHCR 拉取失败或找不到镜像 | 确认 Actions 已发布对应标签，检查包可见性；私有包先登录 GHCR |
| 安装停在数据库密码校验 | 填写 `config/config.env`，然后执行 `start` |
| 数据库连接失败 | 检查五项数据库字段、网络和数据库权限；容器内不要用 `127.0.0.1` 连接另一个容器 |
| 配置不可读取 | 检查配置目录及文件是否允许 UID/GID 1000 读取 |
| 登录或初始化提示请求来源不被允许 | `APP_ORIGIN` 要与地址栏协议、域名、端口完全一致，修改后 `restart` |
| 本地端口被占用 | 检查已有进程；前端端口随 `APP_ORIGIN`，默认后端代理指向 `18771` |
| 改了 Docker 端口但未生效 | 重新执行 `start` 创建容器，仅 `restart` 不更新映射 |
| 修改数据库密码后连接失败 | 已初始化的 PostgreSQL 不会随配置文件自动改密，先同步数据库账号密码 |
| 升级迁移失败 | 查看应用日志和迁移记录，按[迁移说明](docs/DATABASE_AND_VERSIONING.md)处理，保留业务数据 |
| 丢失主密钥后上游配置无法解密 | 恢复原主密钥，或重新填写上游密钥；不要给旧数据库随意更换主密钥 |

上游支持 HTTP / HTTPS、自定义端口、公网、局域网、容器主机名、回环地址及 IPv6，无需配置白名单。HTTP 会明文传输题目及凭据；容器内的回环地址指向应用容器自身。

## 参考文档

| 文档 | 内容 |
| --- | --- |
| [配置参考](docs/CONFIGURATION.md) | 数据库、运行配置和三类上游来源字段 |
| [部署与恢复](deploy/OPERATIONS.md) | Compose、预置配置、发布规则及旧部署迁移 |
| [Python 运维](delpoy/README.md) | 安装、启停、更新、日志及离线参数 |
| [本地开发](docs/LOCAL_DEVELOPMENT.md) | 开发环境、测试隔离及目录说明 |
| [数据库与版本](docs/DATABASE_AND_VERSIONING.md) | Prisma 迁移与每次提交的版本递增规则 |
| [日志与追溯](docs/LOGGING.md) | 请求编号、操作审计、查题链路、脱敏及排错方法 |
| [界面规范](DESIGN.md) | 现有组件、间距、圆角和交互约定 |

应用版本取自 `package.json`；每次提交递增补丁号，超过 20 时次版本号加一。仓库当前未提供 LICENSE 文件，使用和分发前请与维护者确认授权。
