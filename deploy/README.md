# 部署

目标拓扑：

```
用户
 │
 ▼
Caddy (443, 自动 HTTPS)  ── /api/*  ──▶  Node API (127.0.0.1:3001)
 │                                        systemd: mcsr-helper-api
 ├── 静态前端 /srv/mcsr-helper/web
 └── /installer/* ──▶ /srv/mcsr-helper/releases（安装包 + latest.yml，桌面端自动更新的源）
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

## 发布桌面安装包（`--with-installer`）

桌面端的更新源**就是本站自己**：Caddy 把 `/installer/*` 映射到服务器上的
`/srv/mcsr-helper/releases/`（见 `Caddyfile` 里那个 `handle` 块），electron-updater 读的是
那份 `latest.yml`；首页那个"下载客户端"入口读的也是它（`GET /api/desktop/release`
每次都现读 `<releasesDir>/latest.yml`，见 `services/api/src/routes/desktop.ts`）。

**1. 本地出安装包**

```bash
pnpm -F @mcsr/desktop build     # esbuild 打主进程 + preload
pnpm build:installer            # = pnpm -F @mcsr/desktop dist（electron-builder）
```

产物三件套落在 `apps/desktop/release/`：`latest.yml`、`MCSR Helper-Setup-<版本>.exe`、
同名 `.blockmap`。

- ⚠️ **版本号的唯一来源是 `apps/desktop/package.json` 的 `version`**（electron-builder 从那里取，
  没有人手写版本号）。写这份文档时发布的是 **0.0.5**；发新版时改那个字段，再回来核这一节里的示例数字。
- ⚠️ `apps/desktop/release/` **是 gitignore 的**（`.gitignore` 的 `release/`）—— 安装包是产物，
  一个字节都不进版本库。
- ⚠️ 旧版本的 exe 会一直留在 `release/` 里（服务端也**刻意不删**：删掉一个正被下载中的文件
  会让那次更新静默失败），所以打包时**按 `latest.yml` 里那个版本挑文件**，不能 `./*.exe`
  （`deploy.sh` 就是这么做的，见它那一段注释）。

**2. 发布**（在仓库根目录；Windows 上要走 Git Bash —— 本机 PATH 上的 `bash` 是没装发行版的
WSL 存根，`pnpm deploy` 会在第一行之前就失败）

```bash
& "C:\Program Files\Git\bin\bash.exe" deploy/deploy.sh --with-installer
```

⚠️ **安装包必须与前端产物同批上线，而且安装包要先到位。** 两个理由，方向相同：

- 新版本的页面会要求 **0.0.5 才有的桌面能力**（`window.mcsr.modFolders` 在不在；没有它
  那一栏显示"需要桌面版 0.0.5"）—— 前端先上线、安装包后到，用户就会停在一个
  "它要 0.0.5，而 0.0.5 还不存在"的状态里；
- 首页那句"下载客户端 vX"读的是**服务器上的** `latest.yml` ⇒ 清单先上线而 exe 没到，
  客户端只会拿到 404，而 electron-updater 只报"更新失败"、不会说"是清单位置不对"。

`deploy.sh` 的做法：安装包**单独一次 `scp`**、在所有其他产物**之前**传上去（远端这时还没开始
换任何东西）；远端那一段里**先换前端产物**（`${WEB_DIR}`），最后才把 `/tmp/installer.tgz`
解到 `/srv/mcsr-helper/releases/`。⚠️ 这两个动作之间因此有一个**几秒级**的窗口：新页面已经在
线上要 0.0.5，而 `releases/` 里还是上一版的 `latest.yml`（此时客户端检查更新会说"已是最新"，
下一次检查就正常了 —— 不是崩溃，老壳走的是 v1 的降级支路）。要消掉它就得把远端那一段里
解安装包的动作提到换前端之前；本仓今天**没有**这么做，这里如实记着。

⇒ **这一版的页面不要用一次「不带 `--with-installer`」的部署先发出去** —— 那正是"web 先于 app"，
用户会停在一个"要 0.0.5 而拿不到 0.0.5"的状态里（`latest.yml` 还是上一版，客户端检查更新会说
"已是最新"）。也不要手工往 `/srv/mcsr-helper/releases/` 里丢文件：那个目录和 `deploy/` 下的
配置是同一个心智模型（正常路径只有 `deploy.sh` 这一条）。

**3. 部署后回读**（⚠️ `deploy.sh` 的自检**不读安装包** —— 它只回读 CSP、`/api/file-catalog`、
`/api/mod-catalog` 三样，「安装包到没到位」只能自己看，所以这一节不是可选的）：

```bash
curl -sS https://<域名>/installer/latest.yml     # ⇒ version: 0.0.5（与 package.json 一致）
# ⚠️ exe 的文件名里有空格 ⇒ 手工 curl 要把它编码成 %20
curl -sS -o /dev/null -w '%{http_code} %{size_download}\n' \
  "https://<域名>/installer/MCSR%20Helper-Setup-0.0.5.exe"   # ⇒ 200，且字节数与 latest.yml 的 size 相同
curl -sS https://<域名>/api/desktop/release      # ⇒ 首页下载入口那份 JSON，version 同样是 0.0.5
```

`latest.yml` **不许被缓存**：`Caddyfile` 里那条 `@manifest` 规则专门给它 `no-cache`
（理由写在那一段注释里 —— 它一旦被缓存住，用户会一直看到"已是最新版本"）。
安装包本身相反，文件名带版本号，`Cache-Control: immutable` 是对的。

## ⚠️⚠️ 改 `deploy/**` 之后必须做的一件事：部署后回读

**两条门禁都管不到这个目录。** `biome.json` 的 `files.includes` 只有 `**/*.ts` /
`**/*.tsx` / `**/*.json`，而全仓**没有任何代码读 `deploy/`** ⇒ 把 `Caddyfile` 那一行 CSP 的
`connect-src` 改回 `'self'`，`pnpm check` 与 `check:all` 照样 **exit 0**。线上坏了的表现是
**三个面板在浏览器里静默失效**（浏览器控制台之外没有任何提示），而直连失败
**在服务端日志里一个字都没有**。`caddy validate` **不算**证据 —— 它只证语法对（§5.78）。

⇒ **规矩**：凡改动 `deploy/` 下任何文件的提交，**提交信息正文里要带"部署后回读命令 + 预期读数"**。
`deploy.sh` 的线上自检里已经织进了这条回读，而且**不是**一句告警：回读不过 ⇒
部署命令以 **1** 退出（响应头已经同步到线上了，但那次自检不算过）。

```bash
# 1) 抓两段响应头（只读；这两个 curl 就是 deploy.sh 自检里做的那一件事）
curl -sS -D - -o /dev/null -w '<<<%{http_code} %{url_effective}\n' https://<域名>/                  > /tmp/cap.txt
curl -sS -D - -o /dev/null -w '<<<%{http_code} %{url_effective}\n' https://<域名>/api/ranked/status >> /tmp/cap.txt

# 2) 判（预期值现读 deploy/Caddyfile，不写死任何域名或平台清单）
bash deploy/verify-csp.sh --headers /tmp/cap.txt
# 退出码：0 = 四项全过；1 = 有项没过（逐项标出是哪一项）；2 = 判据没跑起来（空输入 / 没找到 Caddyfile）
```

**预期读数**（正常时四项全过、`exit 0`）：`connect-src` = `'self'` + `Caddyfile` 里那两个域名、
**无通配符**、`/api/ranked/status` **匿名 200**、`frame-src` 与 `Caddyfile` **逐项相同**
（今天 = `'self'` + `www.youtube.com` / `www.youtube-nocookie.com` / `player.twitch.tv` /
`player.bilibili.com` / `www.bilibili.com`）。

**它必须能红，而且不许靠"改线上配置再部署一次"来证明**（那是在生产上造假失败）：把副本里的
`connect-src` 改成 `'self'` 再喂给它，它必须非零退出并**指名 `connect-src`**：

```bash
sed "s|connect-src [^;]*|connect-src 'self'|g" /tmp/cap.txt > /tmp/cap-broken.txt
bash deploy/verify-csp.sh --headers /tmp/cap-broken.txt   # 期望 exit 1，输出里点名 connect-src
```

⚠️ 回读脚本**只打印状态行与被查的那两个头的取值**，**不打印输入全文** ——
输入里可能有 `Set-Cookie` 一类的东西，而这个脚本的输出是要贴进提交信息的。

⚠️ **代价（写在这里，别当成没有）**：这条回读住在 `MCSR_HEALTHCHECK_URL` 那条自检里，
所以 `deploy.env` 里那个变量留空时它**不会跑**（与线上自检本身同进同退）。
往 `deploy/` 里加东西时，请照这个形状把判据也加进去。

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

> `content/` 下的**内容文件**既不是密钥、也不在 `/etc/mcsr-helper/` 下，所以**故意不在上面这张表里**：
> 其中**要上线的那几份**每次部署被同步到 `/srv/mcsr-helper/content/`（**哪几份**见下一节的表 ——
> `content/upstream/` 的上游快照与 `content/mod-overrides.json` 是**构建期输入、故意不上传**）。
> 另外它们与「文件说明」里的 `deploy/` 那些也不同 —— 它们不在 `deploy/` 目录下。

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

### 内容文件（`content/`）：**表里这几份**每次部署同步，但**不是**每份都要 import

仓库 `content/` 下**表里这几份**会被 `deploy.sh` 上传（scp 清单里各一项）并装到
`/srv/mcsr-helper/content/`（`install -m 0644`，root 属主；服务以 `mcsr` 跑，只需要读）。
它们**不是密钥**，所以不住 `/etc/mcsr-helper/` 下；但它们同样是"配置即代码"——
**在服务器上手改会在下一次部署里被静默抹掉**，与 `Caddyfile` / systemd 单元同一条纪律。

⚠️ **不是** `content/` 整个目录：`content/upstream/{mods,extra}.json`（上游快照）与
`content/mod-overrides.json`（生成 mod 目录的输入）是**构建期输入、故意不上传** ——
服务器上既没有生成器、也没有它们的落点，改它们**不会**影响线上。

| 文件 | 装到哪 | 需要 import 吗 | 谁读它 |
|---|---|---|---|
| `content/resources.json` | `/srv/mcsr-helper/content/resources.json` | **要**：部署时以 `mcsr` 身份跑 `import.js --apply --file …` 把条目写进库（`source='import'`） | 导入脚本（部署时读一次文件），之后是库 |
| `content/file-catalog.json` | `/srv/mcsr-helper/content/file-catalog.json` | **不要**：它没有查询/编辑需求 ⇒ 不建表、不导入；`GET /api/file-catalog` 在**每次请求**时现读这个文件（配置即代码，理由写在 `services/api/src/routes/fileCatalog.ts` 的文件头） | API 进程（每次请求） |
| `content/mod-catalog.json` | `/srv/mcsr-helper/content/mod-catalog.json` | **不要**：同 `content/file-catalog.json`（没有查询/编辑需求 ⇒ 不建表、不导入）；`GET /api/mod-catalog` 在**每次请求**时现读这个文件（**故意不缓存校验结论**，代价与理由写在 `services/api/src/routes/modCatalog.ts` 里那段 304 注释中） | API 进程（每次请求） |

⚠️ 「不需要 import」有一个**直接代价**，写在这里而不是留着让人自己发现：
这两份目录不进数据库，所以**没有任何一次 SQL 层面的校验** —— 它们到没到位、能不能用，
只能由端点自己的回读来证明。`deploy.sh` 的线上自检就是干这个的：`/api/health` 通过之后
先回读 CSP，再依次回读 `/api/file-catalog` 与 `/api/mod-catalog`
（判据脚本分别是 `deploy/verify-file-catalog.sh` / `deploy/verify-mod-catalog.sh`），
**任一条回读不过就 `exit 1`、整次部署算失败**（⚠️ 整块自检住在 `MCSR_HEALTHCHECK_URL` 里：
那个变量在 `deploy.env` 里留空时它不跑 —— 见上面「改 `deploy/**` 之后必须做的一件事」那一节）。
⇒ 即便如此，部署完（或怀疑它坏了）时仍然可以自己回读一次：

```bash
# ① 抓成文件。⚠️ `-w` 写的那行「<<<状态码 URL」尾标是判据脚本的**必填**输入
#    （正文里没有状态码，"必须是 200"就判不了 ⇒ 没有尾标 = 退出码 2），别只打到屏幕上。
curl -sS -w '\n<<<%{http_code} %{url_effective}\n' https://<域名>/api/file-catalog > /tmp/file-catalog.txt
curl -sS -w '\n<<<%{http_code} %{url_effective}\n' https://<域名>/api/mod-catalog  > /tmp/mod-catalog.txt

# ② 交给判据脚本，拿一份**自动裁决**（在仓库根目录跑；这是与 `deploy.sh` 自检同一个脚本）。
#    退出码：0 = 三项全过 / 1 = 有一项没过（脚本标出是哪一项）/ 2 = 判据**没跑起来**。
bash deploy/verify-file-catalog.sh --body /tmp/file-catalog.txt
bash deploy/verify-mod-catalog.sh  --body /tmp/mod-catalog.txt   # ⚠️ v2 只认 --body（不吃 stdin）
```

**预期读数**（判据脚本会自己逐项打印；只用 ① 看正文的话，就是下面这几样）：
`200` + 一份 JSON 正文；
`/api/file-catalog` 的 `version` 是 `1`、`items` 里有 `mcsrranked`；
`/api/mod-catalog` 的 `schema` 是 `2`、`releases` 是非空数组。
出错时每一类都有自己的 error 名（不吞错误、也不会"回一个空目录"）：
文件没送到 ⇒ `catalog_unavailable`；JSON 坏了 ⇒ `catalog_invalid_json`；
字段缺/多/`id` 重复 ⇒ `catalog_invalid` + `problems` 里**点名**是哪个字段
（两条端点共用这同一套 error 名）。

⚠️ **失败的原因不在响应体里，它只进日志。** 响应体只回上面那个 error 名
（`catalog_invalid` 那一档另带 `problems` —— 那是我们自己的字段级说明，不含服务器路径）。
理由是这条端点**公开无鉴权**：`path` 是服务器上的绝对路径、`detail` 是底层引擎的报错原文
（JSON 解析失败时那串文本里**可能带文件内容的片段**），而匿名调用者要的只是"能不能拿到目录"。
⇒ 排障因此**多一步**：

```bash
sudo journalctl -u mcsr-helper-api -n 50 --no-pager    # 看前缀 [file-catalog] / [mod-catalog] 那一行
```

## 文件说明

| 文件 | 作用 |
|---|---|
| `deploy.env.example` | 部署配置模板，复制成 `deploy.env` 后填写（`deploy.env` 已被 gitignore） |
| `deploy.sh` | 一条命令部署；`--bootstrap` 首次初始化，`--skip-build` 只推已有产物，`--with-installer` 顺带发布桌面安装包与 `latest.yml`（见上一节） |
| `verify-csp.sh` | **部署后回读的判据**：吃一份抓好的响应头文本（stdin 或 `--headers`），核对 CSP 四项与 `/api/ranked/status`；预期值**现读** `Caddyfile`。能单独调用 ⇒ 不碰生产配置就能证明"它会红"（见上面那一节） |
| `verify-file-catalog.sh` | **部署后回读的判据（`/api/file-catalog`）**：吃一份抓好的响应（`--body <文件>`，也接受 stdin），核对 ① 状态码 200 ② `version === 1` ③ `items` 非空。退出码 0 = 三项全过 / 1 = 有项没过 / 2 = 判据没跑起来。`deploy.sh` 的线上自检会调它 |
| `verify-mod-catalog.sh` | **部署后回读的判据（`/api/mod-catalog`）**：同一个形状与同一套退出码，字段换成 v2 的 —— ① 状态码 200 ② `schema === 2` ③ `releases` 非空。⚠️ 只认 `--body <文件>`（**不吃 stdin**）。`deploy.sh` 的线上自检会调它 |
| `bootstrap-server.sh` | 服务器首次初始化，由 `deploy.sh --bootstrap` 自动上传执行 |
| `Caddyfile` | 反向代理 + HTTPS + **响应头（Referrer-Policy / CSP）**；旧域名跳转是它 `import` 出来的可选片段 |
| `mcsr-helper-api.service` | API 的 systemd 单元，含沙箱加固与三个 seeds 变量的说明 |
| `mail.env.example` | 发信密钥的模板（真文件在服务器 `/etc/mcsr-helper/mail.env`） |
| `track.env.example` | 视频追踪凭据的模板（真文件在同目录 `track.env`） |
| `seeds.env.example` | 种子上游地址的模板（真文件在同目录 `seeds.env`；**没有默认值**，见上面那段） |

> `Caddyfile` 里的 `Content-Security-Policy` 中 `frame-src` 列的是这些 host：
> `'self'` / `www.youtube.com` / `www.youtube-nocookie.com` / `player.twitch.tv` /
> `player.bilibili.com` / `www.bilibili.com`（上面那段回读每次部署都会拿它们与线上逐项比对）。
> **新增嵌入 host 时必须同步改这里**，否则那个平台的视频会静默地播不出来
> （iframe 被 CSP 拦截，控制台才有报错，界面上什么提示都没有）。
> ⚠️ 同一个平台也可能有**多个 host**：B站直播走的是 `www.bilibili.com` 那个
> 「活动播放器」，与视频嵌入用的 `player.bilibili.com` **不是同一个**（`Caddyfile` 里记着这次踩坑）。
