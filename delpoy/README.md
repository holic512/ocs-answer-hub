# Python 基础运维

目录名按项目要求使用 `delpoy`，原 `deploy/` 继续保存镜像构建和 Compose 模板。

需要 Python 3.8+、Docker Engine 和 Docker Compose 插件，无需 pip 依赖。`install` 安装知序应用，不自动安装 Docker、不创建数据库、不修改现有数据库网络。

## 安装

```sh
python3 delpoy/deploy.py install --dir /data/ocs-answer-hub --network 已有数据库网络名
```

默认镜像为 `ghcr.io/holic512/ocs-answer-hub:latest`；可用 `--image` 指定已发布版本，`--port` 指定宿主机端口，`--bind` 指定宿主机 IP。默认仅绑定 `127.0.0.1:18771`。

安装会拉取镜像，初始化缺失的 Compose 和配置，校验后启动。首次生成的配置没有数据库密码，脚本会提示编辑 `/data/ocs-answer-hub/config/config.env`，填写后运行 `start` 即可。提前放置的配置、已有 Compose 和持久化数据不覆盖。

## 常用操作

下面均使用同一个部署目录；不传 `--dir` 时默认当前工作目录下的 `data/ocs-answer-hub`，服务器建议始终使用绝对路径。

```sh
# 启动；也用于应用修改后的 Compose 参数，会按需重新创建容器。
python3 delpoy/deploy.py start --dir /data/ocs-answer-hub

# 修改 config/config.env 后重启，仅重启应用，不改变 Docker 创建参数。
python3 delpoy/deploy.py restart --dir /data/ocs-answer-hub

# 拉取已保存的镜像并更新；latest 获取最新内容，固定版本继续使用原版本。
python3 delpoy/deploy.py update --dir /data/ocs-answer-hub

# 升级到指定的已发布版本；成功后保存新镜像版本。
python3 delpoy/deploy.py update --dir /data/ocs-answer-hub --image ghcr.io/holic512/ocs-answer-hub:目标版本

# 停止，保留容器、配置、存储和数据库数据。
python3 delpoy/deploy.py stop --dir /data/ocs-answer-hub

# 状态、日志和配置校验。
python3 delpoy/deploy.py status --dir /data/ocs-answer-hub
python3 delpoy/deploy.py logs --dir /data/ocs-answer-hub --tail 100
python3 delpoy/deploy.py logs --dir /data/ocs-answer-hub -f
python3 delpoy/deploy.py check --dir /data/ocs-answer-hub
```

安装或更新支持 `--no-pull`，用于已通过 `docker load` 导入镜像的离线环境。`--port 0` 可让 Docker 自动分配宿主机端口，通过 `status` 查看。

应用配置在 `config/config.env`；镜像、网络、端口参数在部署目录 `.env`。首次安装会创建 Compose 参数文件；后续安装或更新仅在成功后同步 Compose 参数，不读取或打印数据库密码。更新失败不自动回滚数据库，请查看日志处理迁移或连接错误。

已有 Shell 部署目录也可以直接通过本脚本管理。私有镜像需先执行 `docker login ghcr.io`；Docker 权限不足时，请使用有 Docker 权限的账号或自行通过 sudo 执行。

## 从镜像获取脚本

发布了包含本脚本的新镜像后，服务器无需克隆仓库：

```sh
docker run --rm --entrypoint cat ghcr.io/holic512/ocs-answer-hub:latest /app/defaults/deploy.py > deploy.py
python3 deploy.py install --dir /data/ocs-answer-hub --network 已有数据库网络名
```

## 开发验证

```sh
python3 -B -m unittest discover -s tests -p test_deploy.py
# 构建验收镜像后执行既有部署生命周期验收，包含 Python 运维命令。
npm run test:deployment
```

部署验收使用独立临时 PostgreSQL、网络和绑定目录，安装和更新使用本地镜像；结束自动清理本次测试资源，不连接业务数据库。
