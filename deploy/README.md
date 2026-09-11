# 部署

目标拓扑：

```
用户
 │
 ▼
Caddy (443, 自动 HTTPS)  ── /api/*  ──▶  Node API (127.0.0.1:3001)
 │                                        systemd: mcsr-helper-api
 ├── 静态前端 /srv/mcsr-helper/web
 └── /installer/* ──▶ Cloudflare R2（安装包与自动更新源，M3 才需要）
```

**没有容器、没有编排。** 两个进程 + 一个静态目录，这是单人维护成本最低的形态。

---

## 一次性准备

1. **买域名**，把 A 记录指向服务器 IP。
2. **买香港轻量服务器**（2 核 2G 起，腾讯云 ¥38/月 或 阿里云 SWAS ~$4.5/月）。
   选香港的理由：大陆 RTT 12–82ms，且实测是唯一对中国大陆无明显跨境劣化的节点。
   **境外服务器不需要 ICP 备案。**
3. **在云厂商控制台的安全组里放行 80 和 443。**
   这是最容易漏的一步 —— 本机的 ufw 管不到云安全组，漏了会导致 Caddy 签不下证书，
   而报错信息只会说"连接超时"，看不出是安全组。
4. 把域名写进两处：
   - `packages/shared/src/constants.ts` 里的 `SITE.productionOrigin`（Electron 与前端读它）
   - `deploy/deploy.env` 里的 `MCSR_DOMAIN`（Caddy 读它）

## 首次部署

```bash
cp deploy/deploy.env.example deploy/deploy.env
# 编辑 deploy/deploy.env，至少填 MCSR_SSH_HOST / MCSR_DOMAIN

bash deploy/deploy.sh --bootstrap
```

`--bootstrap` 会在服务器上安装 Node 22 + Caddy、创建 `mcsr` 用户与 `/srv/mcsr-helper/`、
装好 systemd 单元并把 Caddyfile 写进 `/etc/caddy/`。

**首次执行时线上自检可能会失败一两次** —— Caddy 正在向 Let's Encrypt 申请证书，
这一步通常要几秒到几十秒。脚本会自动重试 5 次。

## 日常部署

```bash
bash deploy/deploy.sh
```

本地构建 → 打包（web 和 api 两个压缩包，合计不到 5 MB）→ scp → 解包 → 重启 API → 自检。

用「本地构建 + 传产物」而不是「服务器上构建」，是因为香港轻量服务器通常只有 2 核 2G，
在上面跑 Vite 构建既慢又占内存，而本机只要几十秒。

## 出问题时

```bash
ssh <服务器>
sudo systemctl status mcsr-helper-api
sudo journalctl -u mcsr-helper-api -n 100 --no-pager   # API 日志
sudo journalctl -u caddy -n 100 --no-pager             # 证书 / 路由日志
sudo tail -f /var/log/caddy/mcsr-helper.log            # 访问日志
```

| 症状 | 最可能的原因 |
|---|---|
| `https://域名` 打不开，但 `http://IP` 有响应 | 域名 A 记录没生效，或安全组没放行 443 |
| Caddy 一直签不下证书 | 安全组没放行 **80**（Let's Encrypt 的 HTTP-01 校验走 80） |
| 页面正常但 API 报错 | `mcsr-helper-api` 没起来，看 journalctl |
| 前端一直拿到旧版本 | Caddy 给 `index.html` 设的 `no-cache` 被改掉了 |

## 备份（M6 落地）

M1 之后 SQLite 文件在 `/srv/mcsr-helper/api/data/`。计划是每晚：

```bash
sqlite3 /srv/mcsr-helper/api/data/mcsr.db "VACUUM INTO '/tmp/mcsr-$(date +%F).db'"
# 再推到 Cloudflare R2
```

**并且要实际演练一次恢复** —— 没演练过的备份不算备份。这是 M6 的验收项之一。

---

## 文件说明

| 文件 | 作用 |
|---|---|
| `deploy.env.example` | 配置模板，复制成 `deploy.env` 后填写（`deploy.env` 已被 gitignore） |
| `deploy.sh` | 一条命令部署；`--bootstrap` 首次初始化，`--skip-build` 只推已有产物 |
| `bootstrap-server.sh` | 服务器首次初始化，由 `deploy.sh --bootstrap` 自动上传执行 |
| `Caddyfile` | 反向代理 + HTTPS + **响应头（Referrer-Policy / CSP）** |
| `mcsr-helper-api.service` | API 的 systemd 单元，含沙箱加固 |

> `Caddyfile` 里的 `Content-Security-Policy` 中 `frame-src` 列了三个视频平台。
> **新增视频平台时必须同步改这里**，否则那个平台的视频会静默地播不出来
> （iframe 被 CSP 拦截，控制台才有报错，界面上什么提示都没有）。
