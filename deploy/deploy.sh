#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 一条命令完成部署。
#
#   bash deploy/deploy.sh              # 日常部署
#   bash deploy/deploy.sh --bootstrap  # 首次部署（先初始化服务器）
#   bash deploy/deploy.sh --skip-build # 跳过本地构建（只推已有产物）
#
# 做的事：本地构建 → 打包 → scp 到服务器 → 解包 → 重启 API → 自检
#
# 为什么用「本地构建 + 传产物」而不是「服务器上构建」：
#   香港轻量服务器通常只有 2 核 2G，在上面跑 Vite 构建既慢又占内存，
#   而本机构建只要几十秒。传过去的产物总共不到 5 MB。
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ---------- 读取配置 ----------
if [[ ! -f deploy/deploy.env ]]; then
  echo "✗ 缺少 deploy/deploy.env" >&2
  echo "  先执行: cp deploy/deploy.env.example deploy/deploy.env  然后填写" >&2
  exit 1
fi
# shellcheck disable=SC1091
set -a && source deploy/deploy.env && set +a

: "${MCSR_SSH_HOST:?deploy.env 里缺 MCSR_SSH_HOST}"
: "${MCSR_DOMAIN:?deploy.env 里缺 MCSR_DOMAIN}"

WEB_DIR="${MCSR_WEB_DIR:-/srv/mcsr-helper/web}"
API_DIR="${MCSR_API_DIR:-/srv/mcsr-helper/api}"
API_SERVICE="${MCSR_API_SERVICE:-mcsr-helper-api}"
SSH_PORT="${MCSR_SSH_PORT:-22}"

SSH_OPTS=(-p "$SSH_PORT" -o StrictHostKeyChecking=accept-new)
STEP=0
say() { STEP=$((STEP + 1)); printf '\n\033[36m[%d] %s\033[0m\n' "$STEP" "$*"; }
ok() { printf '\033[32m    ✓ %s\033[0m\n' "$*"; }

BUILD=1
BOOTSTRAP="${MCSR_BOOTSTRAP:-0}"
for arg in "$@"; do
  case "$arg" in
    --skip-build) BUILD=0 ;;
    --bootstrap) BOOTSTRAP=1 ;;
    *) echo "未知参数: $arg" >&2; exit 1 ;;
  esac
done

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ---------- 构建 ----------
if [[ "$BUILD" == "1" ]]; then
  say "本地构建 (web + api)"
  pnpm -F @mcsr/web build
  pnpm -F @mcsr/api build
  ok "构建完成"
else
  say "跳过构建"
fi

[[ -f apps/web/dist/index.html ]] || { echo "✗ apps/web/dist/index.html 不存在" >&2; exit 1; }
[[ -f services/api/dist/server.js ]] || { echo "✗ services/api/dist/server.js 不存在" >&2; exit 1; }

say "打包产物"
tar -czf "$TMP/web.tgz" -C apps/web/dist .
tar -czf "$TMP/api.tgz" -C services/api/dist .
printf '    web %s  api %s\n' \
  "$(du -h "$TMP/web.tgz" | cut -f1)" "$(du -h "$TMP/api.tgz" | cut -f1)"

say "上传到 $MCSR_SSH_HOST"
scp "${SSH_OPTS[@]}" -q \
  "$TMP/web.tgz" "$TMP/api.tgz" \
  deploy/mcsr-helper-api.service deploy/Caddyfile deploy/bootstrap-server.sh \
  "$MCSR_SSH_HOST:/tmp/"
ok "上传完成"

# ---------- 首次初始化 ----------
if [[ "$BOOTSTRAP" == "1" ]]; then
  say "初始化服务器（安装 Node / Caddy / 目录 / systemd）"
  ssh "${SSH_OPTS[@]}" "$MCSR_SSH_HOST" \
    "MCSR_DOMAIN='$MCSR_DOMAIN' MCSR_WEB_DIR='$WEB_DIR' MCSR_API_DIR='$API_DIR' \
     bash /tmp/bootstrap-server.sh /tmp/mcsr-helper-api.service /tmp/Caddyfile"
  ok "初始化完成"
fi

# ---------- 部署 ----------
say "解包并重启服务"
ssh "${SSH_OPTS[@]}" "$MCSR_SSH_HOST" bash -s <<REMOTE
set -euo pipefail
SUDO="\$( [ "\$(id -u)" -eq 0 ] && echo '' || echo 'sudo' )"

# 前端：先解到临时目录再整体替换，避免解包中途失败留下半成品
rm -rf ${WEB_DIR}.new && mkdir -p ${WEB_DIR}.new
tar -xzf /tmp/web.tgz -C ${WEB_DIR}.new
rm -rf ${WEB_DIR}.old && mv ${WEB_DIR} ${WEB_DIR}.old 2>/dev/null || true
mv ${WEB_DIR}.new ${WEB_DIR}
rm -rf ${WEB_DIR}.old
\$SUDO chown -R mcsr:mcsr ${WEB_DIR}

# API：单文件 bundle
mkdir -p ${API_DIR}
tar -xzf /tmp/api.tgz -C ${API_DIR}
\$SUDO chown -R mcsr:mcsr ${API_DIR}

\$SUDO systemctl restart ${API_SERVICE}
sleep 1
\$SUDO systemctl is-active --quiet ${API_SERVICE} && echo "    API 服务运行中" || {
  echo "    ✗ API 启动失败，日志："; \$SUDO journalctl -u ${API_SERVICE} -n 30 --no-pager; exit 1; }

# 本机自检 API
curl -fsS --max-time 5 http://127.0.0.1:3001/api/health >/dev/null && echo "    API 本机自检通过"

rm -f /tmp/web.tgz /tmp/api.tgz /tmp/Caddyfile /tmp/mcsr-helper-api.service /tmp/bootstrap-server.sh
REMOTE
ok "部署完成"

# ---------- 线上自检 ----------
if [[ -n "${MCSR_HEALTHCHECK_URL:-}" ]]; then
  say "线上自检 $MCSR_HEALTHCHECK_URL"
  for i in 1 2 3 4 5; do
    if curl -fsS --max-time 10 "$MCSR_HEALTHCHECK_URL"; then
      echo ""
      ok "线上自检通过 —— https://$MCSR_DOMAIN 已可用"
      exit 0
    fi
    echo "    第 $i 次未通过，5 秒后重试（首次部署时 Caddy 正在签发证书，属正常）"
    sleep 5
  done
  echo "✗ 线上自检失败。排查顺序：" >&2
  echo "  1. 域名 A 记录是否已指向服务器 IP" >&2
  echo "  2. 云厂商安全组是否放行 80/443（最容易漏的一步）" >&2
  echo "  3. ssh $MCSR_SSH_HOST 'journalctl -u caddy -n 50 --no-pager'" >&2
  exit 1
fi
