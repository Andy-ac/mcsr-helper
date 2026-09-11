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

# ⚠️ ssh 用 -p 指定端口，而 scp 用的是 **大写 -P**。
# 写混了的后果非常迷惑：scp 会把端口号当成一个"要上传的本地文件"，
# 报 `scp: stat local "22": No such file or directory` —— 看起来像路径问题，其实是参数问题。
SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
SCP_OPTS=(-o StrictHostKeyChecking=accept-new)
if [[ "$SSH_PORT" != "22" ]]; then
  SSH_OPTS+=(-p "$SSH_PORT")
  SCP_OPTS+=(-P "$SSH_PORT")
fi
# 如果配置了私钥就用它，并禁止回退到其他密钥/agent —— 避免"用了错误的密钥却以为是密码问题"
if [[ -n "${MCSR_SSH_KEY:-}" ]]; then
  KEY_PATH="${MCSR_SSH_KEY/#\~/$HOME}"
  if [[ ! -f "$KEY_PATH" ]]; then
    echo "✗ MCSR_SSH_KEY 指向的私钥不存在: $KEY_PATH" >&2
    exit 1
  fi
  SSH_OPTS+=(-i "$KEY_PATH" -o IdentitiesOnly=yes)
  SCP_OPTS+=(-i "$KEY_PATH" -o IdentitiesOnly=yes)
fi
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
scp "${SCP_OPTS[@]}" -q \
  "$TMP/web.tgz" "$TMP/api.tgz" \
  content/resources.json \
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

# Caddyfile：每次部署都同步 —— 配置即代码。
#
# ⚠️ 这里踩过三个坑，都记下来：
#
# 1. 最初只在 --bootstrap 时上传它，于是改了 Caddyfile 永远不生效。
#    这类"改了没反应"最难查，因为部署脚本本身报的是成功。
#
# 2. 只按"文件是否变化"决定要不要重载是错的：如果上一次重载失败，
#    文件已经装上了、内容也就"无变化"了，于是永远不会再重载。
#    所以这里改成：校验通过就**总是**重载（reload 是优雅的、毫秒级、幂等）。
#
# 3. 校验必须带上 MCSR_DOMAIN。Caddyfile 首行是域名占位符，变量为空时会退化成
#    一个孤立的左花括号，Caddy 会把它当成全局选项块解析，然后报出完全误导性的
#    "unrecognized global option: encode"。systemd 里有这个变量，shell 里没有。
if [ -f /tmp/Caddyfile ]; then
  if ! cmp -s /tmp/Caddyfile /etc/caddy/Caddyfile; then
    echo "    Caddyfile 有变化，安装并校验"
  else
    echo "    Caddyfile 内容未变，仍会校验并重载以确保生效"
  fi
  \$SUDO install -m 0644 /tmp/Caddyfile /etc/caddy/Caddyfile
  if \$SUDO env MCSR_DOMAIN='${MCSR_DOMAIN}' caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    \$SUDO systemctl reload caddy
    echo "    Caddy 已重载"
  else
    echo "    ✗ Caddyfile 校验失败，已保留旧配置继续运行。错误如下："
    \$SUDO env MCSR_DOMAIN='${MCSR_DOMAIN}' caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -5 || true
  fi
fi

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

# systemd 单元：和 Caddyfile 一样属于"配置即代码"，每次部署都同步。
# ⚠️ 它原先也只在 --bootstrap 时上传 —— 和 Caddyfile 是同一个坑：
#    改了配置却永远不生效，而部署脚本报的是成功。
#    单元文件改动需要 daemon-reload，否则 systemctl 用的还是旧定义。
if [ -f /tmp/mcsr-helper-api.service ]; then
  if ! cmp -s /tmp/mcsr-helper-api.service /etc/systemd/system/mcsr-helper-api.service; then
    echo "    systemd 单元有变化，安装并 daemon-reload"
    \$SUDO install -m 0644 /tmp/mcsr-helper-api.service /etc/systemd/system/mcsr-helper-api.service
    \$SUDO systemctl daemon-reload
  else
    echo "    systemd 单元未变"
  fi
fi

# ---------- 内容导入 ----------
#
# ⚠️ 数据库**只存在于服务器上**，绝不由本地覆盖。
#    早先想过把本地 .db 一起传上去 —— M1 阶段能用（内容全部来自
#    content/resources.json，库是派生数据），但 M2 之后库里会有用户提交的内容，
#    覆盖就等于删库，而且部署脚本还会报成功。
#    所以改成：传内容文件 + 在服务器上跑导入脚本。
#    导入脚本只碰 source='import' 的记录，用户提交的内容不受影响
#    （这条不变量有测试守着，见 services/api/src/resources.test.ts）。
if [ -f /tmp/resources.json ]; then
  mkdir -p /srv/mcsr-helper/content
  \$SUDO install -m 0644 /tmp/resources.json /srv/mcsr-helper/content/resources.json

  # 以 mcsr 用户身份运行导入，因为数据库目录属于它。
  # 用 root 跑会在 WAL 模式下生成 root 属主的 -wal / -shm 文件，
  # 之后服务（以 mcsr 运行）就写不进去了 —— 而且是静默失败。
  #
  # ⚠️ 不能写成 "\$SUDO -u mcsr ..."：当以 root 直接登录时 \$SUDO 是空字符串，
  #    那行会变成 "-u mcsr env ..."，bash 把 -u 当成命令名报
  #    "line 76: -u: command not found"。用函数按身份分派更稳。
  as_mcsr() {
    if [ "\$(id -u)" -eq 0 ]; then
      runuser -u mcsr -- "\$@"
    else
      sudo -u mcsr "\$@"
    fi
  }

  cd /srv/mcsr-helper
  # DB_PATH 显式给出，避免"cwd 不同 → 打开了另一个库文件"这种静默错误。
  if as_mcsr env DB_PATH=${API_DIR}/data/mcsr.db \\
       node ${API_DIR}/import.js --apply --file /srv/mcsr-helper/content/resources.json; then
    echo "    内容导入完成"
  else
    echo "    ✗ 内容导入失败（服务仍会启动，沿用现有数据）"
  fi
fi

\$SUDO systemctl restart ${API_SERVICE}
sleep 1
\$SUDO systemctl is-active --quiet ${API_SERVICE} && echo "    API 服务运行中" || {
  echo "    ✗ API 启动失败，日志："; \$SUDO journalctl -u ${API_SERVICE} -n 30 --no-pager; exit 1; }

# 本机自检 API
curl -fsS --max-time 5 http://127.0.0.1:3001/api/health >/dev/null && echo "    API 本机自检通过"

rm -f /tmp/web.tgz /tmp/api.tgz /tmp/Caddyfile /tmp/mcsr-helper-api.service /tmp/bootstrap-server.sh /tmp/resources.json
REMOTE
ok "部署完成"

# ---------- 线上自检 ----------
if [[ -n "${MCSR_HEALTHCHECK_URL:-}" ]]; then
  say "线上自检 $MCSR_HEALTHCHECK_URL"

  # ⚠️ 自检必须能绕开两件事：
  #   1. 本机 DNS —— 在中国大陆查境外域名可能被拦截/污染，会得到"域名没生效"的
  #      假象（我们踩过：同一个权威服务器，两个地点问出两个答案）。
  #   2. NAT hairpin —— 这台服务器是内网 10.0.0.2 + 公网 NAT，
  #      从服务器 curl 自己的公网 IP 会直接失败。
  # 所以把域名硬解析到服务器的公网 IP，让检查只验证"服务是否真的在跑"。
  CURL_RESOLVE=()
  SSH_HOST_ONLY="${MCSR_SSH_HOST##*@}"
  if [[ -n "$MCSR_DOMAIN" && "$SSH_HOST_ONLY" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    CURL_RESOLVE+=(--resolve "$MCSR_DOMAIN:443:$SSH_HOST_ONLY")
    CURL_RESOLVE+=(--resolve "$MCSR_DOMAIN:80:$SSH_HOST_ONLY")
    echo "    （自检时把 $MCSR_DOMAIN 固定解析到 $SSH_HOST_ONLY，以排除本机 DNS 干扰）"
  fi

  for i in 1 2 3 4 5; do
    if curl -fsS ${CURL_RESOLVE[@]+"${CURL_RESOLVE[@]}"} --max-time 10 "$MCSR_HEALTHCHECK_URL"; then
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
