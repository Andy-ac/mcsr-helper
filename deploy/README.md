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

## 配置放在哪（部署相关的环境变量）

三类，位置不一样，**放错地方的表现是"改了没反应"或"下一次部署被抹掉"**：

| 放哪 | 是什么 | 谁读它 |
|---|---|---|
| `deploy/deploy.env`（本机，gitignored） | 部署目标：`MCSR_SSH_HOST` / `MCSR_SSH_PORT` / `MCSR_SSH_KEY` / `MCSR_DOMAIN` / `MCSR_LEGACY_DOMAIN` / 目录与服务名 | `deploy.sh`（本地） |
| `/etc/mcsr-helper/*.env`（**服务器**上，0600 root） | 密钥与服务器侧配置：`mail.env`（`RESEND_API_KEY`）、`track.env`（`MCSR_YOUTUBE_KEY` / `MCSR_TWITCH_ID` / `MCSR_TWITCH_SECRET`）、`seeds.env`（`MCSR_SEED_API_BASE` / `MCSR_SEED_WRITE_ENABLED`） | systemd 单元里的 `EnvironmentFile=` |
| `deploy/*.env.example` | 上面两类的**模板**（不含任何真实值，可以提交） | 人 |

⚠️⚠️ **不要把服务器侧的值写进 systemd 单元文件**（`deploy/mcsr-helper-api.service` 之类）：
那些文件在版本库里，而 `deploy.sh` **每次部署**都会 `cmp` + `install` 覆盖服务器上的同名文件
—— 在服务器上手改单元会在下一次部署里被**静默抹掉**，而部署脚本报的是成功。
需要长期存在的值只应该待在 `EnvironmentFile` 指向的文件里（那些文件 `deploy.sh` 不碰，
它只装 `.example` 模板）。

⚠️ 改了 `EnvironmentFile` 指向的文件之后：**长驻进程要 restart**（`mcsr-helper-api`），
因为它是进程启动时读的；`Type=oneshot` 的 timer 作业不用（每一轮都是新进程）。

### ⚠️⚠️ 两个"必须与部署同步做"的动作

**1. 排位赛种子的上游地址（`MCSR_SEED_API_BASE`）—— 不做就会静默失去这个功能。**

上游地址**没有代码内的默认值**了（它原来写死成 owner 自己的另一台机器；公开之后
那等于让每个照抄本仓的人都把请求打到**别人**的服务器上，而补录接口会往对方数据库里写记录）。
所以升级到这一版时，必须在**同一次部署**里把地址显式补上：

```bash
# 在服务器上（文件不存在就建一个，权限必须是 0600 root）
sudo install -d -m 0755 /etc/mcsr-helper
sudo install -m 0600 -o root -g root /dev/null /etc/mcsr-helper/seeds.env
sudo nano /etc/mcsr-helper/seeds.env      # 写 MCSR_SEED_API_BASE=<上游地址>
sudo systemctl daemon-reload && sudo systemctl restart mcsr-helper-api
```

模板见 `deploy/seeds.env.example`（含"写入默认关闭，要开写 `MCSR_SEED_WRITE_ENABLED=1`"）。
不配的表现是**明确**的：`/seeds` 页面说「本站没有配置种子数据源 —— 这不是临时故障，
重复尝试也不会有变化」，接口回 `503 seed_not_configured`，日志里（只打一次）指到这个文件。

**2. 旧域名 301（`MCSR_LEGACY_DOMAIN`）——不做就会少一段跳转。**

`Caddyfile` 里那一段现在是**可选**的：它 `import` 一个目录
（`/etc/caddy/mcsr-helper-legacy/*.caddy`），而 deploy.sh 只在
`MCSR_LEGACY_DOMAIN` **非空**时才生成那个文件。**默认是空的** ——
原来那个默认值指向 owner 自己的旧域名，而它已经被 Spamhaus DBL 列名过
（phishing + botnet C&C），不该被任何人继承。

⇒ 如果你的站点确实有旧域名要保留跳转，把域名写进 `deploy/deploy.env` 的
`MCSR_LEGACY_DOMAIN`；否则什么都不用做，部署会打印一行"未配置旧域名跳转"。
反向的情况更要小心：**原来依赖那个默认值**的站点（也就是生产），
部署时如果 `deploy.env` 里没有这一行，deploy.sh 会**移除**已有的跳转并打印一条
⚠️ 提示（旧链接会变成死链）—— 那就是提醒你去把域名补上。

## 文件说明

| 文件 | 作用 |
|---|---|
| `deploy.env.example` | 部署配置模板，复制成 `deploy.env` 后填写（`deploy.env` 已被 gitignore） |
| `deploy.sh` | 一条命令部署；`--bootstrap` 首次初始化，`--skip-build` 只推已有产物 |
| `bootstrap-server.sh` | 服务器首次初始化，由 `deploy.sh --bootstrap` 自动上传执行 |
| `Caddyfile` | 反向代理 + HTTPS + **响应头（Referrer-Policy / CSP）**；旧域名跳转是它 `import` 出来的可选片段 |
| `mcsr-helper-api.service` | API 的 systemd 单元，含沙箱加固与三个 seeds 变量的说明 |
| `mail.env.example` | 发信密钥的模板（真文件在服务器 `/etc/mcsr-helper/mail.env`） |
| `track.env.example` | 视频追踪凭据的模板（真文件在同目录 `track.env`） |
| `seeds.env.example` | 种子上游地址的模板（真文件在同目录 `seeds.env`；**没有默认值**，见上面那段） |

> `Caddyfile` 里的 `Content-Security-Policy` 中 `frame-src` 列了三个视频平台。
> **新增视频平台时必须同步改这里**，否则那个平台的视频会静默地播不出来
> （iframe 被 CSP 拦截，控制台才有报错，界面上什么提示都没有）。
