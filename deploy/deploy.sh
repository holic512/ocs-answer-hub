#!/bin/sh
# 用法：sh deploy.sh 镜像地址 [部署目录] [已有数据库网络名]
# 应用配置位于 config/config.env；同目录 .env 只保存 Compose 创建参数。
set -eu
umask 077
IMAGE=${1:?请指定镜像，例如 ghcr.io/holic512/ocs-answer-hub:1.0.2}
DEPLOY_DIR=${2:-./data/ocs-answer-hub}
case "$IMAGE" in *[!a-zA-Z0-9./:@_-]*) echo '镜像地址包含无效字符' >&2; exit 1;; esac
if [ "$#" -ge 3 ]; then
  DATABASE_NETWORK=$3
  case "$DATABASE_NETWORK" in ''|*[!a-zA-Z0-9_.-]*) echo '数据库网络名称无效' >&2; exit 1;; esac
  export DATABASE_NETWORK
fi
export APP_IMAGE="$IMAGE"
docker pull "$IMAGE"
mkdir -p "$DEPLOY_DIR"
DEPLOY_DIR=$(cd "$DEPLOY_DIR" && pwd)
if [ ! -f "$DEPLOY_DIR/compose.yml" ]; then
  # 临时文件接收成功后再移动，避免拉取模板失败留下空 Compose。
  docker run --rm --entrypoint cat "$IMAGE" /app/defaults/compose.yml > "$DEPLOY_DIR/compose.yml.tmp"
  mv "$DEPLOY_DIR/compose.yml.tmp" "$DEPLOY_DIR/compose.yml"
fi
if [ ! -e "$DEPLOY_DIR/.env" ]; then
  {
    printf '# 仅供 Docker Compose 使用，不填写应用密码。\n'
    printf 'APP_IMAGE=%s\n' "$IMAGE"
    printf 'DATABASE_NETWORK=%s\n' "${DATABASE_NETWORK:-databases}"
    printf 'BIND_ADDRESS=127.0.0.1\nAPP_PORT=18771\n'
  } > "$DEPLOY_DIR/.env"
fi
compose() { docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/compose.yml" "$@"; }
compose config --quiet
compose run --rm --no-deps init
if ! compose run --rm --no-deps app check; then
  printf '\n请检查 %s/config/config.env 及文件权限（容器用户 UID/GID 为 1000），修正后重新运行本脚本。\n' "$DEPLOY_DIR" >&2
  exit 1
fi
compose up -d --wait --wait-timeout 120 --pull never
# 启动成功后，只同步本次明确指定的镜像和网络，不替换其他 Compose 参数。
TEMP=$(mktemp "$DEPLOY_DIR/.env.XXXXXX")
trap 'rm -f "$TEMP"' EXIT HUP INT TERM
awk -v image="$IMAGE" -v network="${DATABASE_NETWORK:-}" '
  /^APP_IMAGE=/ { print "APP_IMAGE=" image; image_done=1; next }
  /^DATABASE_NETWORK=/ && network != "" { print "DATABASE_NETWORK=" network; network_done=1; next }
  { print }
  END { if (!image_done) print "APP_IMAGE=" image; if (network != "" && !network_done) print "DATABASE_NETWORK=" network }
' "$DEPLOY_DIR/.env" > "$TEMP"
mv "$TEMP" "$DEPLOY_DIR/.env"
trap - EXIT HUP INT TERM
printf '部署完成：%s\n应用配置修改后：cd "%s" && docker compose -f compose.yml restart app\n' "$IMAGE" "$DEPLOY_DIR"

printf "首次使用请在浏览器打开应用，在初始化页面设置管理员账号和密码；已有账号不会重建。\n"
