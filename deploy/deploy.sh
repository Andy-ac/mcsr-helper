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

# ---------- 旧域名（可选，**故意不给默认值**）----------
# 只用于"旧地址 301 跳到新地址"，让已经发出去的链接（聊天记录、书签、
# 别人转发的地址）不变成死链。
#
# ⚠️★ 这里原来有一个默认值，指向 owner 自己搬站之前用过的那个域名。删掉它
#    有两个理由，第二个更硬：
#      1. 默认值会被**静默继承**：clone 下来直接部署的人不会去读这一行，
#         于是"别人的旧域名"就成了他的站点的第二个域名（Caddy 还会去为它
#         申请证书，DNS 不在他手里 ⇒ 日志里一堆签发失败）；
#      2. 那个域名在 Spamhaus DBL 上被列名过（phishing + botnet C&C，
#         见 packages/shared/src/constants.ts 与 docs/v1-plan.md §域名那段）。
#         把自己的站点和它挂在同一个证书、同一台机器上，是在继承一份
#         自己没做过的坏名声 —— 而 DNSBL 的申诉成本极高。
#    ⇒ 要用旧域名的人必须**自己写出来**（写在 deploy.env 里，见 deploy.env.example）。
#
# ⚠️ 值为空 = **不做旧域名跳转**，而不是"报错退出"：Caddyfile 那一段是
#    `import` 一个匹配不到文件的 glob（明确允许为空，见下面生成那一段的说明），
#    所以"不配"是一条**正常路径**，不该让部署失败。
# ⚠️ 别在这里给它任何默认值，也别改成 `:?`（必须有值）—— 前者正是上面第 1 条
#    要修的东西，后者会让"不需要旧域名"的人部署不了。
MCSR_LEGACY_DOMAIN="${MCSR_LEGACY_DOMAIN:-}"

# ⚠️ 部署**之前**就把这件事说出来，而不是等日志滚到 Caddy 那一段才发现：
#    "原来靠那个旧默认值在跳转"的站点，这一次部署会把跳转**去掉**（旧链接变死链）。
#    这一类"升级动作本身有副作用"的事必须打在开头，读日志的人才会看见。
if [[ -z "$MCSR_LEGACY_DOMAIN" ]]; then
  printf '\033[33m⚠️  MCSR_LEGACY_DOMAIN 为空 —— 本次部署不会配置旧域名跳转（并会移除上一次留下的那份）。\n'
  printf '    如果你的站点以前靠 deploy.sh 的默认值在跳转（那是 owner 的旧域名），\n'
  printf '    请先在 deploy.env 里把它显式写出来再部署。\033[0m\n'
fi

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
  # ⚠️ 只打包 latest.yml 里指的那个版本，**不是**目录下所有 exe。
  #    release/ 会同时留着历史版本（服务端也刻意保留它们，
  #    免得删掉一个正被某个客户端下载中的文件）。用 ./*.exe 的话，
  #    第二版起每次部署都要把全部历史版本重传一遍 ——
  #    第二版传 218MB，第三版 327MB，增长得毫无意义。
  INSTALLER_VERSION="$(sed -n 's/^version: *//p' apps/desktop/release/latest.yml | head -1)"
  if [[ -z "$INSTALLER_VERSION" ]]; then
    echo "✗ 读不出 latest.yml 里的 version" >&2
    exit 1
  fi
  INSTALLER_TGZ="$TMP/installer.tgz"
  ( cd apps/desktop/release && tar -czf "$INSTALLER_TGZ" latest.yml ./*"$INSTALLER_VERSION".exe ./*"$INSTALLER_VERSION".exe.blockmap )
  echo "    只打包版本 $INSTALLER_VERSION"
  printf '    installer %s\n' "$(du -h "$INSTALLER_TGZ" | cut -f1)"
  ok "安装包已打包（在后台传，先继续部署其余部分）"
fi

say "上传到 $MCSR_SSH_HOST"
# Caddy 的域名是通过 systemd drop-in 注入的，所以它同样是"配置即代码"的一部分，
# 必须跟着每次部署走 —— 见下面远程块里的详细说明。
cat > "$TMP/caddy-domain.conf" <<CADDYENV
[Service]
Environment=MCSR_DOMAIN=${MCSR_DOMAIN}
CADDYENV

# 旧域名那一段 Caddy 配置（**可选**，默认不生成内容）。
#
# ⚠️ 为什么是"生成一个文件"而不是"把域名写进 Caddyfile"：Caddyfile 里那一段
#    现在是 `import /etc/caddy/mcsr-helper-legacy/*.caddy` —— 导入一个**匹配不到
#    任何文件的 glob** 是明确允许的（Caddy 文档：an empty glob pattern is not an error），
#    于是"没配旧域名"这件事在 Caddy 眼里就是"这里什么都不导入"，
#    不需要任何默认值，也就不会有人**静默继承**别人的旧域名。
#    （直接写 `{$MCSR_LEGACY_DOMAIN} { … }` 是不行的：变量为空时那一行会退化成
#     一个孤立的左花括号，Caddy 会把它当全局选项块解析，报出完全误导性的
#     "unrecognized global option: redir" —— 这个坑在 MCSR_DOMAIN 上踩过一次。）
#
# ⚠️ 文件名固定（legacy.caddy），所以换域名时不会在服务器上留下两份跳转。
# ⚠️ 空文件也要生成：这样下面 scp / rm 两条**清单**始终是同一份
#    （清单不对齐是本仓踩过的坑，见远程块末尾那条注释）。
: > "$TMP/legacy-domain.caddy"
if [[ -n "$MCSR_LEGACY_DOMAIN" ]]; then
  cat > "$TMP/legacy-domain.caddy" <<LEGACY
# ⚠️ 由 deploy/deploy.sh 生成，**不要手改**：下一次部署会覆盖它。
#    来源是 deploy/deploy.env 的 MCSR_LEGACY_DOMAIN（不配则不会有这个文件）。
${MCSR_LEGACY_DOMAIN} {
	redir https://${MCSR_DOMAIN}{uri} permanent
}
LEGACY
fi

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
  content/file-catalog.json \
  deploy/mcsr-helper-api.service deploy/Caddyfile deploy/bootstrap-server.sh \
  deploy/mcsr-helper-track.service deploy/mcsr-helper-track.timer deploy/track.env.example \
  deploy/mcsr-helper-ranked-streams.service deploy/mcsr-helper-ranked-streams.timer \
  deploy/mcsr-helper-live-status.service deploy/mcsr-helper-live-status.timer \
  deploy/seeds.env.example \
  "$TMP/caddy-domain.conf" "$TMP/legacy-domain.caddy" \
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
# Caddy：旧域名片段 + 域名 drop-in + Caddyfile，三者都每次部署都同步 —— 配置即代码。
#
# ⚠️ 这里踩过五个坑，全记下来：
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
#    ⚠️⚠️ 而且这条**不能靠 reload 生效**：\`systemctl reload caddy\` 只是让 Caddy
#         重新读 Caddyfile，**进程的环境变量还是旧的**。Environment= 的改动
#         必须 restart 才会被进程看到。
#         所以下面用 CADDY_NEEDS_RESTART 标记：只有 drop-in 真的变了才重启
#         （重启会让 TLS 握手短暂不可用，没必要每次都做）。
#
# 5. **旧域名那一段要在 Caddyfile 之前装好**（2026-09-19 开源前搬到下面这一段的）。
#    Caddyfile 用 \`import /etc/caddy/mcsr-helper-legacy/*.caddy\` 接住它，
#    而"glob 匹配不到文件"是**不报错**的 —— 顺序反过来的话，新 Caddyfile 会
#    先以"没有旧域名"的样子生效，旧链接静默变成死链，而部署脚本照样报成功。
# ---------------------------------------------------------------------------
CADDY_NEEDS_RESTART=0

# ---- 旧域名 301（可选；MCSR_LEGACY_DOMAIN 为空时**移除**它）----
#
# ⚠️ 内容由 deploy.sh 生成（不要手改这个目录里的文件，下一次部署会覆盖）。
# ⚠️ 空值分支**必须真的删掉**旧文件：只"不再生成"的话，上一次部署写下的
#    那个文件会留在磁盘上、被 glob 继续导入 —— 也就是"我把配置删了，
#    跳转还活着"，而 Caddyfile 里一个字都看不出它从哪来。
LEGACY_DIR=/etc/caddy/mcsr-helper-legacy
if [ -s /tmp/legacy-domain.caddy ]; then
  \$SUDO mkdir -p "\$LEGACY_DIR"
  if ! \$SUDO cmp -s /tmp/legacy-domain.caddy "\$LEGACY_DIR/legacy.caddy"; then
    \$SUDO install -m 0644 /tmp/legacy-domain.caddy "\$LEGACY_DIR/legacy.caddy"
    echo "    旧域名跳转已更新（'${MCSR_LEGACY_DOMAIN}' → '${MCSR_DOMAIN}'）"
  else
    echo "    旧域名跳转未变（'${MCSR_LEGACY_DOMAIN}'）"
  fi
else
  if \$SUDO ls "\$LEGACY_DIR"/*.caddy >/dev/null 2>&1; then
    \$SUDO rm -f "\$LEGACY_DIR"/*.caddy
    echo "    ⚠️ MCSR_LEGACY_DOMAIN 为空 —— 已移除旧域名跳转（指向旧域名的链接会变成死链；"
    echo "       要保留它们就把那个域名写进 deploy/deploy.env 再部署一次）"
  else
    echo "    未配置旧域名跳转（MCSR_LEGACY_DOMAIN 为空）"
  fi
fi

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
  # ⚠️ 校验时只需要 MCSR_DOMAIN：旧域名那一段现在是**导入的文件**（见上面第 5 条），
  #    里面的域名是 deploy.sh 生成时写死的，不再经过环境变量 ——
  #    所以这里**故意**不再传 MCSR_LEGACY_DOMAIN（传了也没人读，只会让下一个人
  #    以为 Caddyfile 里还有那个占位符）。
  if \$SUDO env MCSR_DOMAIN='${MCSR_DOMAIN}' \
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
    \$SUDO env MCSR_DOMAIN='${MCSR_DOMAIN}' \
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

# ---- 视频追踪的 timer（每 10 分钟同步一轮）----
#
# 与上面那个 api 单元**完全同一套做法**（\`cmp\` 判断未变就跳过 + install + daemon-reload），
# 只是这里有两个单元文件，所以用一层循环；\`cmp\` 那一条是本仓既有做法：
# 无条件 install 会每次部署都改 mtime，于是"文件变没变"这个信息就没了。
#
# ⚠️ 只同步**模板**（track.env.example），真正的凭据是 /etc/mcsr-helper/track.env，
#    由人在服务器上建一次（照 mail.env 的先例，见 deploy/track.env.example）。
#    模板里没有任何密钥，所以 0644 是对的；真文件必须是 0600 root。
#
# ⚠️ \`enable --now\` **每次都执行**：enable 是幂等的，而"只在首次部署时启用"这件事
#    本仓在 Caddyfile 上踩过坑（改了配置永远不生效，而部署脚本报成功）。
#    ⚠️ 单元文件改了要 \`daemon-reload\` 才会被 systemctl 看到 —— 而且 reload 之后
#    systemd 会按新的 OnCalendar 重新排期，所以**不需要** restart 那个 timer
#    （restart 只会把"下一次"的时间重新数一遍）。
# ⚠️ 锁文件所在的 /run/mcsr-helper-track **不在这里建**：那是单元里的
#    RuntimeDirectory= 由 systemd 在**每次启动单元时**建的（见 mcsr-helper-track.service）。
#    在这里 install -d 一个也能跑起来，但 /run 是 tmpfs、**每次重启都会被清空**
#    ⇒ 机器一重启这个功能就悄悄停了，直到下一次部署才复活；而 systemd 那份续得上。
#    ⇒ 所以这一段**不需要**为锁文件加任何一行，只要把单元装上 + daemon-reload 就够。
TRACK_UNITS_CHANGED=0
for unit in mcsr-helper-track.service mcsr-helper-track.timer; do
  if [ -f "/tmp/\$unit" ]; then
    if ! \$SUDO cmp -s "/tmp/\$unit" "/etc/systemd/system/\$unit"; then
      \$SUDO install -m 0644 "/tmp/\$unit" "/etc/systemd/system/\$unit"
      TRACK_UNITS_CHANGED=1
      echo "    \$unit 有变化，已安装"
    else
      echo "    \$unit 未变"
    fi
  fi
done
if [ -f /tmp/track.env.example ]; then
  \$SUDO install -d -m 0755 /etc/mcsr-helper
  \$SUDO install -m 0644 /tmp/track.env.example /etc/mcsr-helper/track.env.example
  echo "    凭据模板已就位：/etc/mcsr-helper/track.env.example"
fi

# ⚠️ 种子上游地址的模板（**不是密钥**，但它同样只应该存在于服务器上）：
#    它有自己的一段说明要讲清楚"不配 = 这条功能不可用"，而且它的真文件
#    /etc/mcsr-helper/seeds.env 是**唯一**能活过部署的位置 —— 写进单元文件
#    会被下面那段"单元有变化就 install"静默覆盖掉。见 seeds.env.example 的文件头。
if [ -f /tmp/seeds.env.example ]; then
  \$SUDO install -d -m 0755 /etc/mcsr-helper
  \$SUDO install -m 0644 /tmp/seeds.env.example /etc/mcsr-helper/seeds.env.example
  if [ ! -f /etc/mcsr-helper/seeds.env ]; then
    echo "    ⚠️ 还没有 /etc/mcsr-helper/seeds.env —— 种子功能现在返回 503 seed_not_configured，"
    echo "       模板在 /etc/mcsr-helper/seeds.env.example（照它建一个 0600 的真文件再 restart）"
  fi
fi
if [ "\$TRACK_UNITS_CHANGED" = "1" ]; then
  \$SUDO systemctl daemon-reload
fi
# ⚠️ 这一句**故意不吞错误**（不加 \`|| true\`）：装不上 timer 就等于这一轮的功能
#    一次都不会跑，而那种"部署报成功、功能根本不动"正是本仓反复踩过的坑。
\$SUDO systemctl enable --now mcsr-helper-track.timer
echo "    追踪 timer 已启用（systemctl list-timers mcsr-helper-track.timer 看下一次）"

# ---- ranked 直播链接收录的 timer（每 5 分钟一轮）----
#
# 与上面那一段**逐字同一个形状**（\`cmp\` 判断未变就跳过 + install + daemon-reload +
# \`enable --now\`），只有三处不一样，都是这个作业自己的性质：
#   · **没有凭据模板** —— 上游是公开端点、这个作业一个密钥都不用，
#     所以单元里**故意没有** \`EnvironmentFile\`（理由写在那个 .service 里）；
#   · **RuntimeDirectory 换成了它自己的名字**（\`/run/mcsr-helper-ranked-streams\`）——
#     两个作业的锁不能共用一个目录，否则"同时跑"会被误判成"重叠"；
#     那一条同样**不在这里建**（tmpfs，重启即空，理由与上面一段逐字相同）；
#   · 5 分钟而不是 10 分钟（时效：跟的是"现在谁在直播"）。
# ⚠️ 这一段**故意与上面那段分开写**，不合并成一个循环：两段的注释各自解释自己的单元，
#    而"共用一个循环"会把那句"凭据模板"的注释变成一半对一半错（上面那一个要，这个不要）。
RANKED_STREAMS_UNITS_CHANGED=0
for unit in mcsr-helper-ranked-streams.service mcsr-helper-ranked-streams.timer; do
  if [ -f "/tmp/\$unit" ]; then
    if ! \$SUDO cmp -s "/tmp/\$unit" "/etc/systemd/system/\$unit"; then
      \$SUDO install -m 0644 "/tmp/\$unit" "/etc/systemd/system/\$unit"
      RANKED_STREAMS_UNITS_CHANGED=1
      echo "    \$unit 有变化，已安装"
    else
      echo "    \$unit 未变"
    fi
  fi
done
if [ "\$RANKED_STREAMS_UNITS_CHANGED" = "1" ]; then
  \$SUDO systemctl daemon-reload
fi
# ⚠️ 同上面那一条：这一句**故意不吞错误** —— 装不上 timer 就等于这一轮的功能
#    一次都不会跑（而它正是这一轮唯一新增的"自动"行为）。
# ⚠️ 部署不校验 \`dist/ranked-streams.js\` 在不在：整个 dist/ 都在 api.tgz 里，
#    而"缺文件"的表现是 journal 里一行 \`Cannot find module\` + 退出码非零
#    （**响的**，不是静默的），不值得在这里再加一段跨主机的一致性检查。
\$SUDO systemctl enable --now mcsr-helper-ranked-streams.timer
echo "    直播收录 timer 已启用（systemctl list-timers mcsr-helper-ranked-streams.timer 看下一次）"

# ---- 直播状态与观看人数的 timer（每 3 分钟一轮，用户第 10 条）----
#
# 与上面两段**同一个形状**（\`cmp\` 判断未变就跳过 + install + daemon-reload +
# \`enable --now\`），只有两处不同，都是这个作业自己的性质：
#   · **有凭据** —— 它要 Twitch 的 app access token，所以单元里有
#     \`EnvironmentFile=-/etc/mcsr-helper/track.env\`（与 ranked-streams **相反**）。
#     ⇒ 这一段**不需要**再同步什么凭据模板：那个文件是 track 那一段装的（同一个文件）。
#   · **RuntimeDirectory 换成它自己的名字**（\`/run/mcsr-helper-live-status\`）——
#     三个作业的锁不能共用一个目录，否则"同时跑"会被误判成"重叠"；
#     那一条同样**不在这里建**（tmpfs，重启即空，理由与上面两段逐字相同）。
# ⚠️ 它**依赖一个已经跑过的迁移**（023 给 \`live_channels\` 加三列）。部署顺序是
#    "重启 API（跑迁移）→ 启用 timer"，而 API 那一段在这之前 —— 但即便顺序反过来，
#    症状也只是那一轮写库失败（\`本轮失败（db）\`，退出码非零、日志可见），
#    不会静默；下一轮 API 起来之后自己会好。
LIVE_STATUS_UNITS_CHANGED=0
for unit in mcsr-helper-live-status.service mcsr-helper-live-status.timer; do
  if [ -f "/tmp/\$unit" ]; then
    if ! \$SUDO cmp -s "/tmp/\$unit" "/etc/systemd/system/\$unit"; then
      \$SUDO install -m 0644 "/tmp/\$unit" "/etc/systemd/system/\$unit"
      LIVE_STATUS_UNITS_CHANGED=1
      echo "    \$unit 有变化，已安装"
    else
      echo "    \$unit 未变"
    fi
  fi
done
if [ "\$LIVE_STATUS_UNITS_CHANGED" = "1" ]; then
  \$SUDO systemctl daemon-reload
fi
# ⚠️ 同上面两条：这一句**故意不吞错误** —— 装不上 timer 就等于"直播中"徽章永远不更新
#    （而页面上会安安静静地一直显示上一轮的读数）。
\$SUDO systemctl enable --now mcsr-helper-live-status.timer
echo "    直播状态 timer 已启用（systemctl list-timers mcsr-helper-live-status.timer 看下一次）"

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

# ---- 可追踪文件目录（`content/file-catalog.json`）----
#
# ⚠️ 它**故意不住在下面那个 `if [ -f /tmp/resources.json ]` 里面**，尽管两者都是
#    "仓库里的内容文件、每次部署同步"。理由是那一段还包着"\$SUDO 跑 import.js 写库"，
#    而这个文件**不需要 import**（API 在每次请求时现读，见
#    `services/api/src/routes/fileCatalog.ts` 的文件头）—— 住进去的话，
#    只要哪一次 /tmp 里没有 resources.json，这个清单就**不会**被更新，
#    而表现是接口回 500 `catalog_unavailable`、部署脚本却报成功。
#    两者唯一共享的东西只有 content 目录。
if [ -f /tmp/file-catalog.json ]; then
  mkdir -p /srv/mcsr-helper/content
  \$SUDO install -m 0644 /tmp/file-catalog.json /srv/mcsr-helper/content/file-catalog.json
  echo "    文件目录已就位（不需要 import：API 每次请求现读）"
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

# ⚠️ 这一行必须与上面那条 \`scp\` 的清单**逐项对齐**：漏掉的会以 root 属主的样子
#    留在 /tmp 里（终审 M7 就是这么抓到的 —— 两个新单元没进这一行，而它不报错、
#    也不影响部署，只有人把两份清单对起来看才发现）。
#    （2026-09-19 加的两个：seeds.env.example、legacy-domain.caddy。）
#    （2026-09-24 加的一个：file-catalog.json —— 它与上面 scp 清单里的
#      `content/file-catalog.json` 是同一个文件的两端。）
rm -f /tmp/installer.tgz /tmp/web.tgz /tmp/api.tgz /tmp/Caddyfile /tmp/mcsr-helper-api.service /tmp/bootstrap-server.sh /tmp/resources.json /tmp/file-catalog.json /tmp/caddy-domain.conf /tmp/legacy-domain.caddy /tmp/mcsr-helper-track.service /tmp/mcsr-helper-track.timer /tmp/track.env.example /tmp/seeds.env.example /tmp/mcsr-helper-ranked-streams.service /tmp/mcsr-helper-ranked-streams.timer /tmp/mcsr-helper-live-status.service /tmp/mcsr-helper-live-status.timer
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

      # ---- CSP 回读（§5.78）----
      # 为什么必须有这一条：`deploy/Caddyfile` 那一行 CSP 是**安全面上唯一一处**没有任何
      # 门禁会打开的文件内容 —— biome 只看 `**/*.ts` / `**/*.tsx` / `**/*.json`，
      # 而全仓没有代码读 `deploy/`。把它改回 `connect-src 'self'` 再跑完整 `check:all`
      # 是 **exit 0**；线上坏了的表现是"三个面板在浏览器里静默失效"，而直连失败
      # **在服务端日志里一个字都没有**。`caddy validate` 也不算证据（只证语法对）。
      #
      # ⚠️ 抓取那半在这里，判断那半在 `deploy/verify-csp.sh`（可单独喂输入调用）——
      #    分开是为了让这条判据**在不碰生产配置的前提下能被证明"它会红"**：
      #    拿一份把 connect-src 改成 'self' 的副本喂进去，它必须非零退出并指名哪一项。
      # ⚠️ `-D -` 把响应头打到 stdout、`-o /dev/null` 丢掉正文、`-w` 补一行
      #    `<<<状态码 URL`（裸响应头里没有 URL，判据用它核对第 2 段真的是那个端点）。
      # ⚠️ 这里**不加 `-f`**：非 2xx 正是要观察的东西，`-f` 会让 curl 提前失败，
      #    于是"没抓到"看起来像"没那一段"，与"这项没过"分不开（§5.74）。
      # ⚠️ 抓取失败（curl 非零）一律 `exit 1`，不许当成"跳过"。
      CSP_CAPTURE="$TMP/csp-headers.txt"
      CSP_CURL_OK=1
      curl -sS ${CURL_RESOLVE[@]+"${CURL_RESOLVE[@]}"} --max-time 10 \
        -D - -o /dev/null -w '<<<%{http_code} %{url_effective}\n' \
        "https://$MCSR_DOMAIN/" >"$CSP_CAPTURE" 2>/dev/null || CSP_CURL_OK=0
      curl -sS ${CURL_RESOLVE[@]+"${CURL_RESOLVE[@]}"} --max-time 10 \
        -D - -o /dev/null -w '<<<%{http_code} %{url_effective}\n' \
        "https://$MCSR_DOMAIN/api/ranked/status" >>"$CSP_CAPTURE" 2>/dev/null || CSP_CURL_OK=0
      if [[ "$CSP_CURL_OK" != "1" ]]; then
        echo "✗ CSP 回读：响应头抓取失败（curl 非零退出）—— 没抓到就不能判通过" >&2
        exit 1
      fi
      if ! bash "$ROOT/deploy/verify-csp.sh" --headers "$CSP_CAPTURE"; then
        echo "✗ CSP 回读没过（上面逐项标了是哪一项）。Caddyfile 这一轮已经同步到线上了，但这次自检不算过。" >&2
        echo "  最可能的原因：有人手改了服务器上的 /etc/caddy/Caddyfile（下一次部署会抹掉它）。" >&2
        exit 1
      fi

      # ---- 可追踪文件目录回读（`content/file-catalog.json`）----
      # 与上面那条 CSP 回读同一个空白：`content/file-catalog.json` 每次部署都被同步到服务器，
      # 而**没有任何门禁会打开它**（biome 只看 `**/*.ts` / `**/*.tsx` / `**/*.json`，
      # 全仓没有代码读 `deploy/` 或 `content/` 之外的那份）。漏装/漏进 scp 清单的表现是
      # "桌面端「本地文件」那一栏整栏为空 + 页面上写着目录拉取失败"，而**这次部署照样报成功**
      # —— 上面那条 `rm -f /tmp/…file-catalog.json` 只能证明"清理清单里有它"，证不了"装上了"。
      #
      # ⚠️ 抓取那半在这里，判断那半在 `deploy/verify-file-catalog.sh`（可单独喂输入调用）——
      #    分开的理由与 CSP 那条一样：让判据**在不碰生产的前提下能被证明"它会红"**
      #    （拿一份坏正文喂进去，它必须非零退出并指名哪一项）。
      # ⚠️ 这里**不加 `-f`**：非 2xx 正是要观察的东西（§5.74）。
      # ⚠️ 尾标 `<<<状态码 URL` 是**必填**的：正文里没有状态码，而"必须是 200"是第一项判据。
      CATALOG_CAPTURE="$TMP/catalog-body.txt"
      CATALOG_CURL_OK=1
      curl -sS ${CURL_RESOLVE[@]+"${CURL_RESOLVE[@]}"} --max-time 10 \
        -w '\n<<<%{http_code} %{url_effective}\n' \
        "https://$MCSR_DOMAIN/api/file-catalog" >"$CATALOG_CAPTURE" 2>/dev/null || CATALOG_CURL_OK=0
      if [[ "$CATALOG_CURL_OK" != "1" ]]; then
        echo "✗ 目录回读：响应抓取失败（curl 非零退出）—— 没抓到就不能判通过" >&2
        exit 1
      fi
      if ! bash "$ROOT/deploy/verify-file-catalog.sh" --body "$CATALOG_CAPTURE"; then
        echo "✗ 目录回读没过（上面标了是哪一项）。这一轮 content/ 已经同步到线上了，但这次自检不算过。" >&2
        echo "  先确认 /srv/mcsr-helper/content/file-catalog.json 在不在（scp / install / 清理三处清单）。" >&2
        exit 1
      fi

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
