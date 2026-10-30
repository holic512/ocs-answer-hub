#!/usr/bin/env python3
"""
@file deploy.py
@project ocs-answer-hub
@module Linux 基础运维
@description 使用 Python 3 标准库管理现有 Docker Compose 部署。
@logic 安装初始化、配置校验、启停重启、拉取更新，保留配置及持久化数据。
@dependencies Python 3.8+, Docker Engine, Docker Compose 插件
@index_tags deployment, operations, linux
@author holic512
"""
import argparse
import ipaddress
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

DEFAULTS = {
    "APP_IMAGE": "ghcr.io/holic512/ocs-answer-hub:latest",
    "DATABASE_NETWORK": "databases",
    "BIND_ADDRESS": "127.0.0.1",
    "APP_PORT": "18771",
}


def main():
    args = arguments()
    directory = args.directory.expanduser().resolve()
    if args.command != "install" and not (directory / "compose.yml").is_file():
        raise RuntimeError("此目录尚未安装，请先运行 install，或用 --dir 指定已有部署目录")
    settings = settings_for(directory, args)
    require_docker()
    if args.command in ("install", "update"):
        if args.no_pull:
            run(["docker", "image", "inspect", settings["APP_IMAGE"]], capture=True)
        else:
            run(["docker", "pull", settings["APP_IMAGE"]])
        if args.command == "install":
            initialize(directory, settings)
        start(directory, settings)
        save_settings(directory / ".env", settings)
        print("{}完成：{}".format("安装" if args.command == "install" else "更新", settings["APP_IMAGE"]))
        if args.command == "install":
            print("请在浏览器打开应用；数据库没有管理员时会优先显示初始化页面，由你设置账号和密码。")
    elif args.command == "start":
        start(directory, settings)
        print("应用已启动，配置与数据目录：{}".format(directory))
    elif args.command == "restart":
        compose(directory, settings, "run", "--rm", "--no-deps", "app", "check")
        compose(directory, settings, "restart", "app")
        wait_healthy(directory, settings)
        print("应用已重启并通过健康检查；端口、网络、挂载变更请使用 start 重新创建容器")
    elif args.command == "stop":
        compose(directory, settings, "stop")
        print("应用已停止，容器、配置、存储和数据库数据均保留")
    elif args.command == "status":
        compose(directory, settings, "ps", "--all")
    elif args.command == "logs":
        flags = ["logs", "--tail", str(args.tail)]
        if args.follow:
            flags.append("--follow")
        compose(directory, settings, *flags, "app")
    elif args.command == "check":
        compose(directory, settings, "config", "--quiet")
        compose(directory, settings, "run", "--rm", "--no-deps", "app", "check")


def arguments():
    parser = argparse.ArgumentParser(description="知序基础运维，Python 3 标准库，无需 pip 安装依赖")
    parser.add_argument("command", choices=["install", "start", "restart", "update", "stop", "status", "logs", "check"], help="安装、启动、重启、更新、停止、状态、日志、配置校验")
    parser.add_argument("--dir", dest="directory", type=Path, default=Path.cwd() / "data" / "ocs-answer-hub", help="部署目录，默认 ./data/ocs-answer-hub；服务器推荐使用绝对路径")
    parser.add_argument("--image", help="安装/更新使用的镜像，默认沿用已保存镜像，首次默认 latest")
    parser.add_argument("--network", help="安装/更新使用的已有数据库 Docker 网络，首次默认 databases")
    parser.add_argument("--port", type=int, help="安装/更新使用的宿主机端口，默认 18771；0 表示 Docker 自动分配")
    parser.add_argument("--bind", help="安装/更新使用的宿主机 IP，默认 127.0.0.1")
    parser.add_argument("--no-pull", action="store_true", help="安装/更新使用已有本地镜像，适合离线部署")
    parser.add_argument("--tail", type=int, default=100, help="显示最近多少行日志，默认 100")
    parser.add_argument("-f", "--follow", action="store_true", help="持续跟踪日志，Ctrl+C 退出")
    args = parser.parse_args()
    if args.command not in ("install", "update") and any(value is not None for value in (args.image, args.network, args.port, args.bind)):
        parser.error("--image、--network、--port、--bind 仅用于 install 或 update；其他参数请修改部署目录 .env")
    if args.no_pull and args.command not in ("install", "update"):
        parser.error("--no-pull 仅用于 install 或 update")
    if args.tail < 0:
        parser.error("--tail 不能小于 0")
    return args


def settings_for(directory, args):
    settings = dict(DEFAULTS)
    file = directory / ".env"
    if file.exists():
        for line in file.read_text(encoding="utf-8").splitlines():
            key, separator, value = line.strip().partition("=")
            if separator and key.strip() in DEFAULTS:
                value = value.strip()
                if len(value) >= 2 and value[0] in "\"'" and value[-1] == value[0]:
                    value = value[1:-1]
                else:
                    value = value.split("#", 1)[0].strip()
                settings[key.strip()] = value
    for attribute, key in (("image", "APP_IMAGE"), ("network", "DATABASE_NETWORK"), ("port", "APP_PORT"), ("bind", "BIND_ADDRESS")):
        value = getattr(args, attribute)
        if value is not None:
            settings[key] = str(value)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9./:@_-]*", settings["APP_IMAGE"]):
        raise RuntimeError("APP_IMAGE 镜像地址无效")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", settings["DATABASE_NETWORK"]):
        raise RuntimeError("DATABASE_NETWORK 网络名称无效")
    if not settings["APP_PORT"].isdigit() or not 0 <= int(settings["APP_PORT"]) <= 65535:
        raise RuntimeError("APP_PORT 必须是 0～65535 的整数")
    try:
        address = ipaddress.ip_address(settings["BIND_ADDRESS"].strip("[]"))
    except ValueError:
        raise RuntimeError("BIND_ADDRESS 必须是有效 IP 地址") from None
    settings["BIND_ADDRESS"] = "[{}]".format(address) if address.version == 6 else str(address)
    return settings


def require_docker():
    if not shutil.which("docker"):
        raise RuntimeError("请先安装 Docker Engine 和 Docker Compose 插件，再运行本脚本")
    run(["docker", "compose", "version"], capture=True)
    run(["docker", "info", "--format", "{{.ServerVersion}}"], capture=True)


def run(command, capture=False, env=None):
    return subprocess.run(command, check=True, text=True, stdout=subprocess.PIPE if capture else None, env=env)


def compose(directory, settings, *command, capture=False):
    environment = dict(os.environ)
    environment.update(settings)
    return run(["docker", "compose", "--project-directory", str(directory), "-f", str(directory / "compose.yml")] + list(command), capture=capture, env=environment)


def initialize(directory, settings):
    directory.mkdir(parents=True, exist_ok=True)
    file = directory / "compose.yml"
    if not file.exists():
        template = run(["docker", "run", "--rm", "--entrypoint", "cat", settings["APP_IMAGE"], "/app/defaults/compose.yml"], capture=True).stdout
        with file.open("x", encoding="utf-8") as stream:
            stream.write(template)
    if not (directory / ".env").exists():
        save_settings(directory / ".env", settings)


def start(directory, settings):
    compose(directory, settings, "config", "--quiet")
    compose(directory, settings, "run", "--rm", "--no-deps", "init")
    try:
        compose(directory, settings, "run", "--rm", "--no-deps", "app", "check")
    except subprocess.CalledProcessError:
        raise RuntimeError("请填写或修正 {}/config/config.env，并检查 UID/GID 1000 的文件权限；修正后运行 start".format(directory)) from None
    compose(directory, settings, "up", "-d", "--wait", "--wait-timeout", "120", "--pull", "never")


def wait_healthy(directory, settings):
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        environment = dict(os.environ)
        environment.update(settings)
        result = subprocess.run(["docker", "compose", "--project-directory", str(directory), "-f", str(directory / "compose.yml"), "exec", "-T", "app", "node", "dist/server/deployment.js", "health"], env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if result.returncode == 0:
            return
        time.sleep(1)
    raise RuntimeError("重启后健康检查超时，请运行 status 和 logs 检查应用")


def save_settings(file, settings):
    lines = file.read_text(encoding="utf-8").splitlines(keepends=True) if file.exists() else ["# 仅供 Docker Compose 使用；应用密码放在 config/config.env。\n"]
    seen = set()
    output = []
    for line in lines:
        match = re.match(r"\s*([A-Z_]+)\s*=", line)
        if match and match[1] in settings:
            key = match[1]
            output.append("{}={}\n".format(key, settings[key]))
            seen.add(key)
        else:
            output.append(line)
    if output and not output[-1].endswith("\n"):
        output[-1] += "\n"
    output.extend("{}={}\n".format(key, value) for key, value in settings.items() if key not in seen)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=str(file.parent), delete=False) as stream:
        temporary = Path(stream.name)
        stream.write("".join(output))
    try:
        os.replace(str(temporary), str(file))
    finally:
        if temporary.exists():
            temporary.unlink()


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
    except subprocess.CalledProcessError as error:
        print("操作失败（退出码 {}），请检查上述 Docker 提示、Docker 服务及当前用户权限。".format(error.returncode), file=sys.stderr)
        sys.exit(1)
    except (RuntimeError, OSError) as error:
        print("操作失败：{}".format(error), file=sys.stderr)
        sys.exit(1)
