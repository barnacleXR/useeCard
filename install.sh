#!/bin/sh
# useeCard 一键安装：下载 compose.yaml 与 .env，设置访问地址并启动。
#   curl -fsSL https://raw.githubusercontent.com/barnacleXR/useeCard/main/install.sh | sh
# 可用环境变量跳过提问：USEECARD_DIR（安装目录，默认 ./useecard）、BASE_URL、USEECARD_REF（下载的分支或标签，默认 main）、
# USEECARD_RAW（compose.yaml 与 .env.example 的下载地址前缀，用于镜像站）。
set -eu

REPO="barnacleXR/useeCard"
REF="${USEECARD_REF:-main}"
DIR="${USEECARD_DIR:-useecard}"
RAW="${USEECARD_RAW:-https://raw.githubusercontent.com/$REPO/$REF}"

say() { printf '%s\n' "$*"; }
fail() { printf '错误：%s\n' "$*" >&2; exit 1; }
ask() { # ask <提示> <默认值>
  answer=""
  # 没有可用终端（如 CI 或无终端的会话）时直接使用默认值。
  if (: </dev/tty) 2>/dev/null; then printf '%s [%s]: ' "$1" "$2" >/dev/tty; read -r answer </dev/tty || answer=""; fi
  [ -n "$answer" ] && printf '%s' "$answer" || printf '%s' "$2"
}

command -v docker >/dev/null 2>&1 || fail "未找到 docker，请先安装 Docker：https://docs.docker.com/get-docker/"
docker compose version </dev/null >/dev/null 2>&1 || fail "未找到 docker compose 插件，请升级 Docker 或安装 Compose v2。"
if command -v curl >/dev/null 2>&1; then fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then fetch() { wget -qO "$2" "$1"; }
else fail "需要 curl 或 wget。"; fi

mkdir -p "$DIR"
cd "$DIR"
say "安装目录：$(pwd)"

fetch "$RAW/compose.yaml" compose.yaml || fail "下载 compose.yaml 失败"

if [ -f .env ]; then
  say "保留已有的 .env。"
else
  fetch "$RAW/.env.example" .env || fail "下载 .env.example 失败"
  url="${BASE_URL:-}"
  if [ -z "$url" ]; then
    say ""
    say "访问地址：正式部署填反向代理后的 HTTPS 地址（如 https://card.example.com）；"
    say "只在本机试用直接回车。"
    url=$(ask "BASE_URL" "http://localhost:3090")
  fi
  case "$url" in http://*|https://*) ;; *) fail "BASE_URL 必须以 http:// 或 https:// 开头：$url" ;; esac
  url=${url%/}
  tmp=$(mktemp)
  sed "s#^BASE_URL=.*#BASE_URL=$url#" .env >"$tmp" && mv "$tmp" .env
  chmod 600 .env
fi

base=$(sed -n 's/^BASE_URL=//p' .env | head -n 1)
port=$(sed -n 's/^USEECARD_PORT=//p' .env | head -n 1)
port=${port:-3090}

say ""
say "正在拉取镜像并启动…"
# 脚本经管道（curl | sh）从标准输入读取，docker 命令一律不读标准输入，以免吞掉脚本剩余部分。
image=$(docker compose config --images useecard </dev/null)
if ! docker compose pull useecard </dev/null; then
  docker image inspect "$image" </dev/null >/dev/null 2>&1 || fail "拉取镜像 $image 失败，请检查网络后重试。"
  say "拉取失败，使用本机已有的 $image。"
fi
docker compose up -d --no-build useecard </dev/null

printf '等待服务就绪'
i=0
until docker compose exec -T useecard node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" </dev/null >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -ge 60 ] && { say ""; fail "服务未在 60 秒内就绪，请运行 docker compose logs useecard 查看日志。"; }
  printf '.'
  sleep 1
done
say " 完成"
say ""
say "useeCard 已启动，监听本机 127.0.0.1:$port。"
case "$base" in
  http://localhost*|http://127.0.0.1*) say "打开 $base ，创建管理员账号即可开始使用。" ;;
  *) say "请让反向代理把 $base 转发到 127.0.0.1:$port，然后打开 $base 创建管理员账号。" ;;
esac
say "升级：在 $(pwd) 运行 docker compose pull && docker compose up -d"
