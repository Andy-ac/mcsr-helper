#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 一条命令完成部署。
#
#   bash deploy/deploy.sh              # 日常部署
#   bash deploy/deploy.sh --bootstrap  # 首次部署（先初始化服务器）
#   bash deploy/deploy.sh --skip-build # 跳过本地构建（只推已有产物）
#   bash deploy/deploy.sh --with-installer  # 顺带发布桌面安装包与 latest.yml
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
# 旧域名：只用于 301 跳转到新域名。
# 给一个默认值而不是允许为空 —— Caddyfile 里那行一旦退化成孤立的花括号，
# Caddy 会把它当成全局选项块解析，报出与真正原因毫无关系的错误。
: "${MCSR_LEGACY_DOMAIN:=legacy.example.invalid}"

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
# 发布安装包是**显式**动作：它 109MB，不该成为日常部署的副产品。
WITH_INSTALLER=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) BUILD=0 ;;
    --bootstrap) BOOTSTRAP=1 ;;
    --with-installer) WITH_INSTALLER=1 ;;
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

# ---------- 桌面安装包 ----------
# ⚠️ 顺序：**先传安装包，再传 latest.yml**。
#    反过来的话中间有一个窗口期，latest.yml 指向的 exe 还没到位，
#    此时检查更新的客户端会拿到 404 —— 而 electron-updater 只会报
#    "更新失败"，不会告诉你"是清单先到了"。
INSTALLER_TGZ=""
if [[ "$WITH_INSTALLER" == "1" ]]; then
  say "打包桌面安装包"
  if [[ ! -f apps/desktop/release/latest.yml ]]; then
    echo "✗ apps/desktop/release/latest.yml 不存在。先跑：" >&2
    echo "    pnpm build:installer" >&2
    exit 1
  fi
  # 只打包 latest.yml + exe + blockmap。
  # 不要把 release/ 整个目录打进去 —— 里面还有 win-unpacked/（解包目录，
  # 几百 MB 且对客户端毫无用处）。
  INSTALLER_TGZ="$TMP/installer.tgz"
  ( cd apps/desktop/release && tar -czf "$INSTALLER_TGZ" latest.yml ./*.exe ./*.exe.blockmap )
  printf '    installer %s\n' "$(du -h "$INSTALLER_TGZ" | cut -f1)"
  ok "安装包已打包（在后台传，先继续部署其余部分）"
fi

say "上传到 $MCSR_SSH_HOST"
# Caddy 的域名是通过 systemd drop-in 注入的，所以它同样是"配置即代码"的一部分，
# 必须跟着每次部署走 —— 见下面远程块里的详细说明。
cat > "$TMP/caddy-domain.conf" <<CADDYENV
[Service]
Environment=MCSR_DOMAIN=${MCSR_DOMAIN}
Environment=MCSR_LEGACY_DOMAIN=${MCSR_LEGACY_DOMAIN}
CADDYENV

# 安装包不在常规 scp 列表里：它是可选的，而且 109MB 传起来很慢。
if [[ -n "$INSTALLER_TGZ" ]]; then
  # 单独一次 scp，传完再继续 —— 和其余产物混在一起的话，
  # 一个 109MB 的文件会拖慢整个部署，而且失败时很难判断卡在哪一个。
  scp "${SCP_OPTS[@]}" -q "$INSTALLER_TGZ" "$MCSR_SSH_HOST:/tmp/installer.tgz"
  printf '    安装包已上传\n'
fi

scp "${SCP_OPTS[@]}" -q \
  "$TMP/web.tgz" "$TMP/api.tgz" \
  content/resources.json \
  deploy/mcsr-helper-api.service deploy/Caddyfile deploy/bootstrap-server.sh \
  "$TMP/caddy-domain.conf" \
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

# ---------------------------------------------------------------------------
# Caddy：域名 drop-in + Caddyfile，两者都每次部署都同步 —— 配置即代码。
#
# ⚠️ 这里踩过四个坑，全记下来：
#
# 1. 最初只在 --bootstrap 时上传 Caddyfile，于是改了它永远不生效。
#    这类"改了没反应"最难查，因为部署脚本本身报的是成功。
#
# 2. 只按"文件是否变化"决定要不要重载是错的：如果上一次重载失败，
#    文件已经装上了、内容也就"无变化"了，于是永远不会再重载。
#    所以这里改成：校验通过就**总是**重载（reload 是优雅的、毫秒级、幂等）。
#
# 3. 校验必须带上 MCSR_DOMAIN。Caddyfile 首行是域名占位符，变量为空时会退化成
#    一个孤立的左花括号，Caddy 会把它当成全局选项块解析，然后报出完全误导性的
#    "unrecognized global option: encode"。systemd 里有这个变量，shell 里没有。
#
# 4. **域名本身也要同步**。MCSR_DOMAIN 是通过 systemd drop-in 注入 Caddy 的
#    （bootstrap-server.sh 写的），而那个 drop-in 原先也只在 --bootstrap 时写 ——
#    和坑 1 一模一样。换域名时它会一直监听旧域名、给旧域名签证书，
#    而部署脚本报成功。
#
#    ⚠️⚠️ 而且这条**不能靠 reload 生效**：`systemctl reload caddy` 只是让 Caddy
#         重新读 Caddyfile，**进程的环境变量还是旧的**。Environment= 的改动
#         必须 restart 才会被进程看到。
#         所以下面用 CADDY_NEEDS_RESTART 标记：只有 drop-in 真的变了才重启
#         （重启会让 TLS 握手短暂不可用，没必要每次都做）。
# ---------------------------------------------------------------------------
CADDY_NEEDS_RESTART=0
if [ -f /tmp/caddy-domain.conf ]; then
  DROPIN=/etc/systemd/system/caddy.service.d/mcsr-helper.conf
  if ! \$SUDO cmp -s /tmp/caddy-domain.conf "\$DROPIN"; then
    echo "    Caddy 域名 drop-in 有变化，安装（之后需要 restart 才生效）"
    \$SUDO mkdir -p /etc/systemd/system/caddy.service.d
    \$SUDO install -m 0644 /tmp/caddy-domain.conf "\$DROPIN"
    \$SUDO systemctl daemon-reload
    CADDY_NEEDS_RESTART=1
  fi
fi

if [ -f /tmp/Caddyfile ]; then
  if ! \$SUDO cmp -s /tmp/Caddyfile /etc/caddy/Caddyfile; then
    echo "    Caddyfile 有变化，安装并校验"
  else
    echo "    Caddyfile 内容未变，仍会校验并确认生效"
  fi
  \$SUDO install -m 0644 /tmp/Caddyfile /etc/caddy/Caddyfile
  if \$SUDO env MCSR_DOMAIN='${MCSR_DOMAIN}' MCSR_LEGACY_DOMAIN='${MCSR_LEGACY_DOMAIN}' \
       caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    if [ "\$CADDY_NEEDS_RESTART" = "1" ]; then
      # 首次给新域名签证书会花几秒到几十秒，所以这里等它就绪
      \$SUDO systemctl restart caddy
      echo "    Caddy 已重启（域名变更必须重启，reload 读不到新的环境变量）"
    else
      \$SUDO systemctl reload caddy
      echo "    Caddy 已重载"
    fi
  else
    echo "    ✗ Caddyfile 校验失败，已保留旧配置继续运行。错误如下："
    \$SUDO env MCSR_DOMAIN='${MCSR_DOMAIN}' MCSR_LEGACY_DOMAIN='${MCSR_LEGACY_DOMAIN}' \
      caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -5 || true
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

# ---------- 桌面安装包 ----------
#
# 解到 /srv/mcsr-helper/releases/，由 Caddy 从 /installer/* 提供
# （见 deploy/Caddyfile 里那个 handle 块）。
#
# ⚠️ **不删旧版本的 exe**。安装包文件名带版本号，新旧互不冲突；
#    而删掉一个可能正被某个客户端下载中的文件，会让那次更新静默失败
#    —— 客户端只会看到"下载失败"，而我们这边什么都不会发现。
if [ -f /tmp/installer.tgz ]; then
  mkdir -p /srv/mcsr-helper/releases
  tar -xzf /tmp/installer.tgz -C /srv/mcsr-helper/releases
  \$SUDO chown -R mcsr:mcsr /srv/mcsr-helper/releases
  echo "    安装包已就位："
  ls -1 /srv/mcsr-helper/releases/ | sed 's/^/      /'
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

rm -f /tmp/installer.tgz /tmp/web.tgz /tmp/api.tgz /tmp/Caddyfile /tmp/mcsr-helper-api.service /tmp/bootstrap-server.sh /tmp/resources.json /tmp/caddy-domain.conf
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
