#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 服务器首次初始化（在服务器上以 root 运行，由 deploy.sh --bootstrap 自动上传执行）
#
# 做四件事：
#   1. 安装 Node.js 22 LTS 与 Caddy
#   2. 创建 mcsr 系统用户与目录布局
#   3. 安装 systemd 单元与 Caddyfile
#   4. 放行防火墙端口
#
# 幂等：重复执行是安全的。
# ---------------------------------------------------------------------------
set -euo pipefail

WEB_DIR="${MCSR_WEB_DIR:-/srv/mcsr-helper/web}"
API_DIR="${MCSR_API_DIR:-/srv/mcsr-helper/api}"
DOMAIN="${MCSR_DOMAIN:?需要 MCSR_DOMAIN}"
UNIT_SRC="${1:?需要传入 mcsr-helper-api.service 的路径}"
CADDY_SRC="${2:?需要传入 Caddyfile 的路径}"

say() { printf '\n\033[36m==> %s\033[0m\n' "$*"; }

say "1/5 安装基础依赖"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg debian-keyring debian-archive-keyring \
  apt-transport-https rsync ufw

say "2/5 安装 Node.js 22 LTS"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -c2-3)" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
node -v

say "3/5 安装 Caddy"
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy
fi
caddy version

say "4/5 创建用户与目录"
id -u mcsr >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin mcsr
install -d -o mcsr -g mcsr -m 0755 "$WEB_DIR"
install -d -o mcsr -g mcsr -m 0755 "$API_DIR"
install -d -o mcsr -g mcsr -m 0700 "$API_DIR/data"
install -d -o caddy -g caddy -m 0755 /var/log/caddy

say "5/5 安装 systemd 单元与 Caddyfile"
install -m 0644 "$UNIT_SRC" /etc/systemd/system/mcsr-helper-api.service

install -m 0644 "$CADDY_SRC" /etc/caddy/Caddyfile
# 用 systemd override 注入域名，避免把域名写死在 Caddyfile 里。
#
# ⚠️ 这个文件在首次初始化时由这里写，之后由 **deploy.sh 每次部署同步**
#    （它同样是"配置即代码"）。只在 bootstrap 写的话，换域名时 Caddy 会一直
#    监听旧域名而部署脚本报成功 —— 我们在 Caddyfile 和 API 单元上都踩过这个坑。
#
# ⚠️ 改了这里必须 **restart**，不能用 reload：reload 只让 Caddy 重读 Caddyfile，
#    进程的环境变量还是旧的。deploy.sh 里用 CADDY_NEEDS_RESTART 处理了这件事。
mkdir -p /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/mcsr-helper.conf <<EOF
[Service]
Environment=MCSR_DOMAIN=${DOMAIN}
Environment=MCSR_LEGACY_DOMAIN=${MCSR_LEGACY_DOMAIN:-legacy.example.invalid}
EOF

systemctl daemon-reload
systemctl enable mcsr-helper-api >/dev/null 2>&1 || true

# ⚠️ 必须 restart，不能只写 `enable --now`。
#
# apt 安装 caddy 时它**已经自己启动过一次**了（用的是当时还不存在的 Caddyfile
# 和当时还不存在的 systemd 环境变量）。而 `systemctl enable --now` 对**已在运行**
# 的服务什么都不做 —— 于是新写入的 Caddyfile 和 MCSR_DOMAIN 都不会生效。
#
# 症状极其隐蔽：`systemctl is-active caddy` 显示 active、端口 80 也能通，
# 所以看起来一切正常；但 443 根本没监听，证书也不会签发，
# 日志里只有一行 warn：
#   "server is listening only on the HTTP port, so no automatic HTTPS will be applied"
#
# 这个 bug 在第一次真实部署时踩到了，所以在这里显式 restart。
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy

# 防火墙：只放行 SSH / HTTP / HTTPS。API 的 3001 端口**故意不放行**。
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
fi

say "完成。接下来："
echo "  1. 确认域名 $DOMAIN 的 A 记录已指向本机"
echo "  2. 在云厂商控制台的安全组里放行 80 / 443（本机 ufw 不管这一层）"
echo "  3. 回到本地跑: bash deploy/deploy.sh"
echo ""
echo "提示：Caddy 需要 80/443 都可达才能签发证书。"
echo "      若用的是腾讯云/阿里云香港轻量服务器，安全组默认只开 22，务必手动加 80/443。"
