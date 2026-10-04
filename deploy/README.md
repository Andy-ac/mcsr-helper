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

**本地自查**（别只看"构建成功"。下面这几条量的**是打包进去的那份字节**，不是仓库里的源码；
⚠️ 括号里的数字是 **0.0.5 这一次**的读数 —— 以后加了通道要现数一遍，别照抄）：

```bash
ASAR=apps/desktop/release/win-unpacked/resources/app.asar

# ① electron-updater 比的是**打进 asar 的那一份 package.json**，不是仓库里那份：
grep -ao '"version": "0.0.5"' "$ASAR" | wc -l    # ⇒ 1
grep -ao '"version": "0.0.4"' "$ASAR" | wc -l    # ⇒ 0（阴性对照：旧值一个都不该剩）
#    ⚠️ 第二条找不到时会以 **1** 退出 —— 但这**只在你的 shell 开了 `set -o pipefail` 时成立**；
#       默认的交互式 Git Bash（以及本文件里这些块）是 **0**（管道的退出码取最后一个命令）。
#       两种情况下**要读的都是 `wc -l` 打出来的那个数字**，不是退出码。不放心就写成
#       `n=$(grep -ao '"version": "0.0.4"' "$ASAR" | wc -l); echo "$n"` 再判那个 $n。
# ② 主进程真的注册了那些 handler（= main.ts 1 + file-updates 8 + mod-folders 15）
grep -ao 'ipcMain.handle(' "$ASAR" | wc -l       # ⇒ 24
# ③ 渲染进程发起的 invoke 与它**一对一**（只数 handle 不数 invoke 的话，少接一条也看不出来）
grep -ao 'ipcRenderer.invoke(' "$ASAR" | wc -l   # ⇒ 24
grep -ao 'modFolders' apps/desktop/dist/preload.cjs | wc -l   # ⇒ 2（> 0 即那一组被暴露了）
```

⚠️ 上面用的是 `grep -ao … | wc -l` 而**不是** `grep -c`：`-c` 数的是**行**，
而打包产物是压过的 JS —— 一行里可能挤着几十个匹配，"数行"会在别的产物上悄悄少数。
（这一组命令在 2026-10-03 用 Git Bash 真跑过，读数就是右边那几个数。）

> ⚠️ **不要**拿"通道名字符串在不在产物里"当接线证据 —— 那是"看着有、其实什么都没测"：
> 那 16 个串全都住在**一个**共享常量对象里，把 `initModFolders` 整段删掉、只留常量，
> 它们照样在。⚠️ **而且这些串在产物里有三份**（逐文件实测，合计 **50** 处）：
> `dist/main.cjs` **16**、`dist/preload.cjs` **17**、以及**被打包进去的**
> `node_modules/@mcsr/shared/src/desktop.ts` **17** —— 连共享源码都在里面，
> 所以"串在不在产物里"离"接线在不在"更远了一层。能承载结论的只有 ②③ 两条。

那三个数怎么复跑（asar 的头里每个文件都带 `offset`/`size`，所以能**按偏移归属**、不靠猜）：

```bash
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
const raw = readFileSync('apps/desktop/release/win-unpacked/resources/app.asar');
const hs = raw.readUInt32LE(12);                       // 头（JSON）的字节长度
const tree = JSON.parse(raw.subarray(16, 16 + hs).toString('utf8'));
const base = 16 + hs;                                  // 文件内容的起点
const files = [];
(function walk(node, prefix) {
  for (const [name, v] of Object.entries(node.files ?? {})) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (v.files) walk(v, p);
    else if (v.offset != null) files.push({ p, o: Number(v.offset), s: Number(v.size ?? 0) });
  }
})(tree, '');
const needle = Buffer.from('mcsr:modfolders-');
const hits = new Map();
let total = 0;
for (let i = raw.indexOf(needle); i !== -1; i = raw.indexOf(needle, i + needle.length)) {
  total += 1;
  const rel = i - base;
  const owner = files.find((f) => rel >= f.o && rel < f.o + f.s);
  const key = owner ? owner.p : '（归不到文件）';
  hits.set(key, (hits.get(key) ?? 0) + 1);
}
console.log('出现次数 =', total);
for (const [p, n] of [...hits].sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${p}`);
JS
# 第二条独立读数（应当与上面那个 出现次数 相同）：整份 asar 的裸字节扫描
grep -ao 'mcsr:modfolders-' apps/desktop/release/win-unpacked/resources/app.asar | wc -l
```

⚠️ 跑出来的 `出现次数` 与那个 `wc -l` **必须相等**；不相等就说明有条目被漏掉
（2026-10-03 就是这么发现"逐文件之和 33 ≠ 裸扫描 50"的：那次是 `listPackage` 在 Windows 上返回
`\dist\main.cjs` 这种反斜杠路径、直接喂给 `extractFile` 一个都取不到 —— 所以这里按**偏移**归属，
不走那条路）。

⚠️★ **这一节的已知缺口（2026-10-04 记录，未修）**：上面 ①②③ 与那两个复跑块读的**全是**
`release/win-unpacked/resources/app.asar` —— 那是**打包器的输入**，**不是**发布出去的那份字节。
**没有任何一步打开那个 exe**、把它**内部**的 asar 取出来与这一份比 ⇒ 今天能说的只是"输入里是什么"，
**不是**"用户下载到的那个 exe 里是什么"。⇒ 真正把**已发布的字节**钉到清单上的是**部署之后**那一次回读：
把**下载回来的 exe** 现算 sha512 与 `latest.yml` 里的 `sha512` 比对（本文件安装器一节 ② 里已经写着
这一条判据）。⚠️ 在那一次比对跑过之前，"这个 exe 里的 asar 就是我量过的那一份"**是推断，不是读数**。

**2. 发布前：先把线上那个库备份出来**（这一步**不在** `deploy.sh` 里）

`deploy.sh` 的链上是**没有备份的**（全文 grep 不到 `backup`/`VACUUM`），而这次发布**会写库**：
`:551-578` 在服务器上以 `mcsr` 身份跑 `import.js --apply`（只碰 `source='import'` 的记录，
但它是真的写）。⇒ **清单第一条就是把库拷出来。**

⚠️ 服务器上**没有 `sqlite3`**（`bash: line 9: sqlite3: command not found`，2026-09-15 实测）
⇒ 本文件下面那节「备份（M6 落地）」里原来那条 `sqlite3 … VACUUM INTO …` **照着做必然失败**。
能跑的是 **`node` + `node:sqlite`**（API 自己就用它 ⇒ node 一定在）。
做法是**连上服务器**再把下面这一段贴上去跑（它自己会回读校验）：

```bash
ssh <服务器>
```

```bash
# 在服务器上（做法取自 2026-09-15「迁移 018」那次**真的用过**的备份脚本；
# 原来那一份住在开发机一个被 gitignore 的目录里 ⇒ 下面这一段就是它的正式落点）。
# ⚠️ 表清单**动态取**（不写死）：硬编码一份会随迁移过期，而"清单过期"的表现是漏备份一张表。
# ⚠️ 2026-10-04 **实跑订正**：这一段原来挂在 `sudo -u mcsr` 下 —— **照字面跑必然失败**。
#    实测：`/srv/mcsr-helper/backup` 是 `root:root 755`（历史那几份备份也都是 root 建的），
#    所以 `mcsr` 建不了那个快照，报的是 `unable to open database: …/mcsr-<戳>.-pre…db`（看着像"库坏了"，
#    其实是**权限**）。⇒ 以 **root** 跑（root 能读那份 `drwx------ mcsr` 的库；产出与历史备份同属 root）。
#    要改成以 mcsr 跑，就得先 `install -d -o mcsr -g mcsr /srv/mcsr-helper/backup`。
node --input-type=module <<'JS'
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
// ⚠️ DB / DIR 可以用环境变量覆盖 —— 这不是给生产的旋钮，是为了**能在本机副本上真跑一遍**
//    （本文件下面那几条读数就是这么来的）。默认值就是生产路径。
const DB = process.env.MCSR_BACKUP_DB ?? '/srv/mcsr-helper/api/data/mcsr.db';
const DIR = process.env.MCSR_BACKUP_DIR ?? '/srv/mcsr-helper/backup';
mkdirSync(DIR, { recursive: true });
const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
const one = (db, sql) => Object.values(db.prepare(sql).get())[0];
const tableNames = (db) =>
  db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name);

let currentOut = '';
// ★ 失败就把这一轮那份副本删掉：它的名字长得像一份可用备份，留着就是个陷阱。
//   ⚠️ **所有**失败路径都走这个函数（不只下面循环里那个 MISMATCH）—— 2026-10-03 判修。
const bail = (msg) => {
  if (currentOut) rmSync(currentOut, { force: true });
  console.log(`✗ ${msg}`);
  process.exit(1);
};

// ★ 先确认源库在：`new DatabaseSync(路径不对)` 会**静默新建一个空库** ⇒ 于是"备份"出来一个
//   4096 字节的空文件、`tables compared = 0 mismatch = 0`（**满足了判据却什么都没测**），
//   然后在 `_migrations` 那一句抛 `no such table` —— 看起来像脚本坏了，而目录里还留着一个
//   **名字看着能用**的空备份。⇒ 路径不对就什么都不做。
if (!existsSync(DB)) {
  bail(`源库不存在：${DB} —— 什么都不做（不新建、不留文件；路径写错了不该留下一份"空备份"）`);
}

// ★ 为什么是一个"最多跑两次"的循环（2026-10-03 判修）：`VACUUM INTO` 本身是**一致快照**，
//   但"活库 vs 副本"的逐表比较有一个窗口 —— 期间只要有一次并发写（或一次 DDL），
//   计数 / 表清单就会不同。那不是"备份坏了"，是"**活库动过**"。
//   ⇒ 重跑一次；两次都对不上才判失败。原来那版会把它报成"没有备份"（fail-closed 但会误判）。
let attempt = 0;
let bad = 0;
let compared = 0;
try {
  for (attempt = 1; attempt <= 2; attempt += 1) {
    currentOut = `${DIR}/mcsr-${stamp()}-pre0.0.5.db`;
    const live = new DatabaseSync(DB, { readOnly: true });
    live.exec(`VACUUM INTO '${currentOut}'`); // 目标文件已存在会报错 ⇒ 时间戳保证唯一
    const bak = new DatabaseSync(currentOut, { readOnly: true });

    // ⚠️ 表清单**两边各取一次**再并成全集：只从活库取的话，期间一条迁移建了新表，
    //    就会对着副本 `SELECT COUNT(*)` 一张不存在的表 —— 那是**抛异常**，不是报错。
    const liveTables = tableNames(live);
    const bakTables = tableNames(bak);
    const all = [...new Set([...liveTables, ...bakTables])].sort();
    compared = all.length;
    bad = 0;
    for (const t of all) {
      const inLive = liveTables.includes(t);
      const inBak = bakTables.includes(t);
      if (!inLive || !inBak) {
        console.log(`  MISSING TABLE ${t}（live=${inLive} backup=${inBak}）`);
        bad += 1;
        continue;
      }
      const a = one(live, `SELECT COUNT(*) AS n FROM "${t}"`);
      const b = one(bak, `SELECT COUNT(*) AS n FROM "${t}"`);
      if (String(a) !== String(b)) {
        console.log(`  MISMATCH ${t} live=${a} backup=${b}`);
        bad += 1;
      }
    }
    bak.close();
    live.close();

    if (bad === 0) break;
    rmSync(currentOut, { force: true });
    console.log(`  ⚠️ 第 ${attempt} 次对不上（${bad} 处）—— 活库在备份期间动过（并发写 / DDL）。` +
      `重跑一次（已删掉这份没通过校验的副本）。`);
  }
} catch (error) {
  // 把"未捕获的异常"变成一句能读懂的话（它多半意味着路径 / 库不对，而不是脚本坏了）
  bail(`快照或读取时出错：${error.message}（先确认 ${DB} 是一份能读的库）`);
}

// ★ 不匹配就先退：后面那些读数**一句都不许挡在它前面**
//   （2026-10-03 判修：原来 `process.exit(1)` 写在最后，而它前面有一句会抛的 SQL ⇒
//    一次**好备份**反而打不出 `BACKUP_TABLES_MATCH=true`，于是被读成"没有备份"。）
if (bad > 0) {
  bail('两次都对不上 ⇒ 这次**不算有备份**，把脚本重跑一遍（活库可能一直在写）。');
}
// ★ 空库不是备份：`compared === 0` 会让下面那句 `mismatch = 0` 变成"什么都没测"
if (compared === 0) {
  bail(`这个库里一张表都没有（${DB}）⇒ 这份快照没有意义（路径 / 库不对？）`);
}

console.log(`backup -> ${currentOut} ${statSync(currentOut).size} bytes（第 ${attempt} 次取到的快照）`);
console.log(`tables compared = ${compared} mismatch = 0`);
const bak = new DatabaseSync(currentOut, { readOnly: true });
console.log('fk violations =', bak.prepare('PRAGMA foreign_key_check').all().length);
// ⚠️ `_migrations` 的列是 **(name, applied_at)** —— 它**没有 `id` 列**
//    （建表在 `services/api/src/db/migrate.ts` 的 `runMigrations` 里；
//      写 `SELECT MAX(id)` 会在 `prepare` 那一刻就抛 `no such column: id`）。
const migCount = one(bak, 'SELECT COUNT(*) AS n FROM _migrations');
const lastMig =
  bak.prepare('SELECT name FROM _migrations ORDER BY applied_at DESC LIMIT 1').get()?.name ?? '（空）';
console.log(`migrations = ${migCount}（最后一条 = ${lastMig}）`);
bak.close();
console.log('BACKUP_TABLES_MATCH=true');
JS
```

**备份成立的判据**（只认这三样，别只看"文件有了"）：`BACKUP_TABLES_MATCH=true`、
`fk violations = 0`、以及 `tables compared = N mismatch = 0` 那一行里 `mismatch` 是 **0**。
⚠️ 如果中途看到一行 `⚠️ 第 1 次对不上（N 处）—— 活库在备份期间动过…重跑一次`，
那是**正常**的（说明那一刻有人在写库），最终以**后面的** `BACKUP_TABLES_MATCH=true` 为准；
只有两次都对不上才是"没有备份"。
（那行 `migrations = N（最后一条 = …）` 是"备份那一刻库里跑到第几号迁移"的读数 ——
判断迁移状态**用它**，不要看主文件的 mtime，理由见下。）
⚠️ **不要用 `ls` 的 mtime 判断"迁移跑没跑"**：库在 WAL 模式下主文件只在检查点之后才更新，
迁移可能早就跑完了而 mtime 还是十几个小时前（2026-09-15 实测过一次：`_migrations` 已是 18，
主文件 mtime 比部署时间早 12 小时）。
⚠️ **上面这一段里"依赖库结构"的部分，本机就能验、也必须验**（2026-10-03 判修）：
`_migrations` 的列、以及"逐表比行数"这件事，都躺在**仓库里**（建表那处是
`services/api/src/db/migrate.ts`）⇒ 不要拿"它只在服务器上跑"当挡箭牌。

**已经在本机跑过的几遍**（拿 `services/api/data/` 那份库的**副本**跑，不碰原文件）——
⚠️ **复跑时必须把 `-wal` / `-shm` 一起拷过去**，理由见下面第 ④ 条：

```bash
# 复跑用的副本：★ 三件套都要（只拷 mcsr.db 会得到一份**旧的**、却"看起来完全正常"的备份）
W=$(mktemp -d)
for s in '' '-wal' '-shm'; do cp "services/api/data/mcsr.db$s" "$W/mcsr.db$s"; done
# 然后把上面那段脚本存成 backup.mjs（去掉第一行的 `sudo -u mcsr `）再跑：
MCSR_BACKUP_DB="$W/mcsr.db" MCSR_BACKUP_DIR="$W/bak" node backup.mjs
```

```
① 库结构 / 那一句会抛的 SQL
   `_migrations` 的真实列：name TEXT PRIMARY KEY / applied_at INTEGER NOT NULL ⇒ **没有 id 列**
   旧写法 `SELECT MAX(id) AS n FROM _migrations` ⇒ ✗ Error: no such column: id

② 静默的库（没有并发写）—— 一次就过
   backup -> 434176 bytes（第 1 次取到的快照）
   tables compared = 19 mismatch = 0 / fk violations = 0
   migrations = 23（最后一条 = 023_live_status）/ BACKUP_TABLES_MATCH=true        ⇒ 退出码 0

③ 备份期间**活库一直在写** —— 第 1 次对不上、第 2 次过
   MISMATCH t9_demo live=8 backup=2
   ⚠️ 第 1 次对不上（1 处）—— 活库在备份期间动过（并发写 / DDL）。重跑一次（已删掉这份没通过校验的副本）。
   backup -> 438272 bytes（第 2 次取到的快照）
   tables compared = 20 mismatch = 0 / fk violations = 0 / BACKUP_TABLES_MATCH=true ⇒ 退出码 0
   目录里只剩那一份通过校验的副本（没通过的那份已被删掉）

④ ★ 只拷主文件 vs 三件套 —— **为什么那个 `cp` 必须带 -wal / -shm**
   只拷 `mcsr.db`：     159744 bytes / tables compared = 8  / migrations = 7（007_editor_role）
                        / fk 0 / BACKUP_TABLES_MATCH=true ⇒ **退出码 0**
   三件套都拷：         434176 bytes / tables compared = 19 / migrations = 23（023_live_status）
                        / fk 0 / BACKUP_TABLES_MATCH=true ⇒ 退出码 0
   ⇒ 前者是一份**旧的**备份，而它**每一条判据都过**（库在 WAL 模式下主文件要等检查点才更新）。
     这就是"必须带上 `-wal`"的理由：**这一种失败没有任何读数会提醒你**。

⑤ 路径写错 / 空库（本轮加的守卫）
   源库不存在：         ✗ 源库不存在：…（退出码 1）；备份目录里**什么都没有留下**，
                        源路径上也没有被新建任何文件
   存在但是个空库：     ✗ 这个库里一张表都没有（…）（退出码 1）；那份空快照被删掉
```

★ **同一把刀对着更早两轮的脚本**：`9971e1c` 那段在同样的并发写下打印
`MISMATCH t9_demo live=6 backup=0` / `tables compared = 20 mismatch = 1`，
**以退出码 1 结束、没有 `BACKUP_TABLES_MATCH=true`**，而且那份没通过校验的副本**留在盘上**
（名字长得像一份可用备份）⇒ "会误报没有备份"是**实测**。而 `MCSR_BACKUP_DB` 指向不存在的文件时，
更早那版会打印 `4096 bytes` / `tables compared = 0 mismatch = 0`（**满足了判据却什么都没测**）
再以 `no such table: _migrations` 崩掉，并在目录里留下那个 4096 字节的空备份。

⇒ **"没验过"只剩下一件事**：没有对**生产那份库**真的跑过一次（那要连上服务器）；
上面那些判据与 SQL 本身已经被本机这几遍钉住了。
第一次在生产跑请把输出留下：`BACKUP_TABLES_MATCH=true` 与 `mismatch = 0` 没出现，
就等于**没有备份**，那就不要往下走。
（把这一步做进 `deploy.sh` —— 做成"迁移之前 + 回读之后才算成功"—— 是一条已知的待办：
上面那句"链上没有备份"就是它的现状，别以为它已经被解决了。）

**3. 发布**（在仓库根目录；Windows 上要走 Git Bash —— 本机 PATH 上的 `bash` 是没装发行版的
WSL 存根，`pnpm deploy` 会在第一行之前就失败）

**发布前预检**（这三条**必须**在按下回车之前看一眼，它们各自都有"部署报成功而实际上
没做 / 做错了"的形态。⚠️ 这一段是**建议性**的：`deploy.sh` 不读它、没有任何东西强制它 ——
它的唯一目的就是让"我这次会跳过整块线上自检"这件事**至少是响的**。
⇒ **只有印出来的 `✗` 算数，别把它的退出码当门禁。** 只看"有没有值"，**不打印值**）：

```bash
# 在仓库根目录跑（也可以把 deploy/deploy.env 换成别的文件，例如一个副本）
(
  # ★ 不要自己去解析 .env：deploy.sh:28 是 `set -a && source deploy/deploy.env && set +a`，
  #   所以这里也在**子 shell 里 source 一次**、再直接测变量 —— 这样引号、行尾空白、
  #   行尾 `# 注释`、以及"同一个键写两次"（bash 取**最后**一次赋值）全都与它一致。
  #   （2026-10-03 判修：自己解析会在上面那几种形态上与 deploy.sh 漂开，而后果是
  #    "整块线上自检被跳过、部署照样 exit 0"却看着像通过了。）
  set -a
  # shellcheck disable=SC1090,SC1091
  . "${1:-deploy/deploy.env}" >/dev/null 2>&1 || {
    echo "  ✗ 读不了 ${1:-deploy/deploy.env}（source 失败）—— 先确认这个文件在不在、能不能被 bash 读"
    exit 1
  }
  set +a

  fail=0
  need() { # $1 = 键名；$2 = 为空时那句"会坏成什么样"
    local v="${!1:-}"
    if [ -n "$v" ]; then echo "  ok   $1 已设置（长度 ${#v}）"; else echo "  ✗    $1 为空 —— $2"; fail=1; fi
  }

  need MCSR_SSH_HOST        'deploy.sh 直接拒绝运行（:30）'
  need MCSR_DOMAIN          'deploy.sh 直接拒绝运行（:31）'
  need MCSR_HEALTHCHECK_URL '★ 整块线上自检会被跳过，而部署**照样 exit 0**（:599）'

  if [ -n "${MCSR_LEGACY_DOMAIN:-}" ]; then
    echo "  ok   MCSR_LEGACY_DOMAIN 已设置（长度 ${#MCSR_LEGACY_DOMAIN}）"
  else
    echo "  ⚠️  MCSR_LEGACY_DOMAIN 为空 —— 这是**合法**配置（= 不做旧域名跳转），但这次部署会**移除**已有的 301（旧链接变死链，:55-62）"
  fi

  # 缺这一行与显式写 0 是**同义**的（deploy.sh 的 `${MCSR_BOOTSTRAP:-0}`）⇒ 两者都报 ok
  if [ "${MCSR_BOOTSTRAP:-0}" = 0 ]; then
    echo '  ok   MCSR_BOOTSTRAP=0（这次不会 bootstrap）'
  else
    echo "  ⚠️  MCSR_BOOTSTRAP='${MCSR_BOOTSTRAP}' —— 不是 0 就会顺带跑 bootstrap-server.sh（装 Node/Caddy、建用户）"
  fi

  exit $fail
)
```

- ★ **`MCSR_HEALTHCHECK_URL` 为空 ⇒ 整块线上自检被跳过，而部署照样 `exit 0`**
  （`deploy.sh:599` 那个 `if` 包住了 CSP + `/api/file-catalog` + `/api/mod-catalog` 三条回读）
  ⇒ 那意味着一次"成功"的部署**一个回读都没做**。这一条是本节所有回读的前提。
- ⚠️ **"实际上为空"有一堆写法**，都会造成上面那条后果：`K=""`、`K="" `（尾随空格）、
  `K=""` + TAB、`K="" # 暂时停用`、`K=   `（纯空白）、**同一个键写两次而最后一个是 `K=""`**
  （bash 是**后者胜**）。⇒ 这就是上面**不自己解析、而是 `source` 一次**的理由。
- **`MCSR_LEGACY_DOMAIN` 为空**是**合法**配置（= 不做旧域名跳转），但部署会把**上一次留下的**
  301 删掉 ⇒ 所以它是 ⚠️ 而不是 ✗ —— 要的就是"你看见它、并且知道自己在做什么"。
- **`MCSR_BOOTSTRAP` 不是 0** ⇒ 这一次会顺带 `bootstrap-server.sh`（装 Node/Caddy、建用户）。

**这一段本机跑过 17 种形态**（真 `deploy/deploy.env` + 五种"有值"写法 + **六种"实际上为空"**
+ 空 LEGACY + 缺 BOOTSTRAP + `MCSR_BOOTSTRAP=1` + 空 `MCSR_SSH_HOST` + 文件不存在）：
**六种"实际上为空"全部被拦且点名 `MCSR_HEALTHCHECK_URL`**；`export K=v` / 带引号 / 带行尾注释
都读作 `ok`；空的 `MCSR_LEGACY_DOMAIN` **只出 ⚠️ 不出 ✗**；文件不存在时明说"读不了"。

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
解到 `/srv/mcsr-helper/releases/`。

⚠️★ **这两步之间的那个窗口要按"失败分支"读，不是按"几秒钟"读**（2026-10-03 判修）：
脚本是 `set -euo pipefail`（`:250`），所以从**前端换完**（`:357`）到**安装包解完**
（`:513-519`，那句 `tar -xzf` 在 `:515`）之间，任何一处失败都会让脚本**带着非零退出码停下**，而这时线上是"**新页面 + 上一版的
`latest.yml`**"这个组合，并且它会**一直保持**到有人再跑一次 —— `:433`/`:502` 那两句
`systemctl enable --now` 是**故意不吞错误**的，`install -m 0644`、`:583` 那句 `exit 1` 同理。
⇒ **清单里必须有一条**：**若这一次部署在"换前端"之后以非零退出码结束，立刻重跑一次
`--with-installer` 跑到成功**（重跑是幂等的；不要以为"下次客户端检查更新就好了"）。
这个窗口的时长取决于部署走多快，不是几秒的物理限制 —— 失败会让它变成永久。
（要根治就得把远端解安装包的动作提到换前端之前；本仓今天**没有**这么做，这里如实记着。
另一处同族的细节：`:154` 把 `latest.yml` 放在 tar 的**第一个成员**里 ⇒ **解包时**清单先于
那 107 MB 的 exe 到位；今天靠"解包很快 + 清单不被缓存"自愈，换成 CDN/R2 而 `.exe` 被标
immutable 时要重新想一遍。）

⇒ **这一版的页面不要用一次「不带 `--with-installer`」的部署先发出去** —— 那正是"web 先于 app"，
用户会停在一个"要 0.0.5 而拿不到 0.0.5"的状态里（`latest.yml` 还是上一版，客户端检查更新会说
"已是最新"）。也不要手工往 `/srv/mcsr-helper/releases/` 里丢文件：那个目录和 `deploy/` 下的
配置是同一个心智模型（正常路径只有 `deploy.sh` 这一条）。

**4. 部署后回读**（⚠️ `deploy.sh` 的自检**不读安装包** —— 它只回读 CSP、`/api/file-catalog`、
`/api/mod-catalog` 三样，「安装包到没到位」只能自己看，所以这一节不是可选的。
⚠️★ **与第 3 步那段预检不同：这一节不是"建议性"的** —— 下面的判据自带退出码，
**非 0 就是没过**（预检那边反过来：只有印出来的 `✗` 算数、退出码不算门禁）。）

⚠️ 回读**必须带 `--resolve`**：本机 DNS 不可信（同 `deploy.sh` 自己的自检，`:602-614` 就是把
域名硬解析到服务器 IP 的）。不带它，S7 那条判据很可能是**假失败**。

```bash
IP=<服务器公网 IP>                    # deploy/deploy.env 里 MCSR_SSH_HOST 去掉 user@
# ★ 2026-10-04 实跑订正：**必须加 `--noproxy '*'`**。本机（或任何装了 HTTP 代理的环境）上
#   curl 会走 CONNECT，回读到的"响应头"里会混进代理自己的
#   `HTTP/1.1 200 Connection established` 段 ⇒ 下面那条 CSP 判据读到的是代理那一段，
#   于是报 `✗ 响应里没有 Content-Security-Policy 头`（**假失败**），而部署**明明成功了**，
#   却以非零退出码收场 ⇒ 触发"换前端之后非零就要立刻重跑"那条纪律，白跑一次。
#   （同族的第 ③ 条也受影响：它抓到的 URL 会变成首页而不是 `/api/ranked/status`。）
R=(--resolve <域名>:443:$IP --noproxy '*')

# ① 抓：清单（头 + 正文）、exe、首页那份 JSON。三条都是只读 GET。
curl -sS "${R[@]}" -D /tmp/latest.yml.head -o /tmp/latest.yml https://<域名>/installer/latest.yml
#    ⚠️ 文件名里有空格 ⇒ URL 里必须编码成 %20
curl -sS "${R[@]}" -o /tmp/setup.exe -w '%{http_code} %{size_download}\n' \
     "https://<域名>/installer/MCSR%20Helper-Setup-0.0.5.exe" > /tmp/exe.code
curl -sS "${R[@]}" -o /tmp/release.json https://<域名>/api/desktop/release

# ② 判：**任一条不符就以非零退出**（下面这六条就是全部判据；跑完只需看退出码 + 有没有 ✗）
fail=0
grep -q '^version: 0\.0\.5$' /tmp/latest.yml \
  || { echo '✗ latest.yml 的 version 不是 0.0.5'; fail=1; }
grep -qi '^cache-control: *no-cache' /tmp/latest.yml.head \
  || { echo '✗ latest.yml 少了 Cache-Control: no-cache（Caddyfile:130-131 那条规则没生效）'; fail=1; }
#    ⚠️ 这一条不是装饰：那条 `@manifest path *latest.yml` 规则**曾经静默失效过**
#    （安装包拿到了 immutable、而 latest.yml 一个 Cache-Control 都没有，见 `Caddyfile:121-129`）。
#    清单被缓存住的表现是"用户永远看到已是最新版本"，而我们这边一点痕迹都没有。
MANIFEST_SIZE=$(sed -n 's/^  *size: *\([0-9]\{1,\}\)$/\1/p' /tmp/latest.yml | head -1)
MANIFEST_SHA=$(sed -n 's/^sha512: *//p' /tmp/latest.yml | head -1)
[ "$(cut -d' ' -f1 /tmp/exe.code)" = 200 ] \
  || { echo '✗ exe 不是 200'; fail=1; }
[ "$(cut -d' ' -f2 /tmp/exe.code)" = "$MANIFEST_SIZE" ] \
  || { echo "✗ exe 的字节数与清单的 size 不一致（$(cut -d' ' -f2 /tmp/exe.code) vs $MANIFEST_SIZE）"; fail=1; }
#    ★ 最强、也最便宜的一条：把**下载下来的那份 exe** 的 sha512 与清单里的对一遍
[ "$(openssl dgst -sha512 -binary /tmp/setup.exe | base64 -w0)" = "$MANIFEST_SHA" ] \
  || { echo '✗ exe 的 sha512 与清单里的不一致（文件被换了 / 传坏了 / 清单不是这一份）'; fail=1; }
grep -q '"version":"0.0.5"' /tmp/release.json \
  || { echo '✗ /api/desktop/release 的 version 不是 0.0.5（首页那一格：用户看得见的就是它）'; fail=1; }
[ "$fail" = 0 ] && echo '✓ 安装包回读全过' || echo '✗ 安装包回读有项没过'
exit $fail          # ← 这一节只要看这一个退出码：0 = 全过
```

★ 这一段判据**在本机用真产物跑过**（2026-10-03 判修）：正例退出码 **0**（并且它顺手独立复核了
`sha512` —— 拿盘上那个 112,480,275 字节的 exe 现算，与清单逐字符相同）；三种**红证**都非零：
把清单 version 改成 0.0.4、给 exe 追加一个字节（sha512 与 size 同时变）、拿掉响应头里的
`no-cache`。⇒ **只有"对生产那一次 GET"没有跑过**，判据本身不是"看起来对"。
（安装包那一侧相反：文件名带版本号 ⇒ `Cache-Control: public, max-age=31536000, immutable`
是对的，见 `Caddyfile:132-133`，**不要**把它改成 no-cache。）

> ⚠️★ **上面那个"112,480,275"作废（2026-10-04 文档订正波）**：0.0.5 的安装器**重打过一次**
> （收口波改了 `apps/desktop/src/**` 与 `packages/shared/src/**` ⇒ 打进 `app.asar` 的东西变了，
> 必须重打、重验）⇒ 那一版 exe 的读数不再有效。**本次现读**（`apps/desktop/release/` 下那一份）：
>
> - `MCSR Helper-Setup-0.0.5.exe`：**112,481,525** 字节，
>   `sha512` = `+VY0lUz28K6J7e3erobwu00mw2zl4feFqzJNpI4XFIVYWCzieUzIsPT0vzXLm9K2ja0qFejlo2zQkwwNzJ7UnQ==`；
> - `latest.yml` **351** 字节（`version: 0.0.5`；它里面的 `size` 与 `sha512` 与上面那份 exe **逐字符相同**）、
>   `MCSR Helper-Setup-0.0.5.exe.blockmap` **118,393** 字节、
>   `win-unpacked/resources/app.asar` **8,607,765** 字节。
>
> ★ 上面那个块（②）的**判据形状一个字都没变** —— 它照样是"部署后要跑的那一段"，变的只是**示例读数**。
> 而且真跑时 `MANIFEST_SIZE` / `MANIFEST_SHA` 是脚本自己从线上那份 `latest.yml` 现读的 ⇒
> **不需要**为了换读数去改这一段（下次发版要改的只有那两处 `version: 0.0.5`）。

```bash
# ③ 部署之后库还在不在（这次部署会重启 API ⇒ 会跑迁移；备份就是为这一步存在的）
#    连上服务器跑；读数与**第 2 步那份备份打印的**比对：
#    migrations 条数应当相同（这次没有新迁移 ⇒ 今天两边都应是 23、最后一条 023_live_status）
ssh <服务器>
```
```bash
sudo -u mcsr node --input-type=module <<'JS'
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/srv/mcsr-helper/api/data/mcsr.db', { readOnly: true });
console.log('migrations =', db.prepare('SELECT COUNT(*) AS n FROM _migrations').get().n,
  '（最后一条 =', (db.prepare('SELECT name FROM _migrations ORDER BY applied_at DESC LIMIT 1').get()?.name ?? '（空）') + '）');
console.log('fk violations =', db.prepare('PRAGMA foreign_key_check').all().length);
JS
```
⚠️ 这一段的读数**不是**"随便看一眼"：`migrations` 比第 2 步那份**少了**，说明迁移没跑完
（而 API 是起来过的）；`fk violations` 不是 0 就更要停下。**它俩的期望值来自第 2 步自己打印的行**
—— 不要凭记忆填一个数字。

```bash
# ④ 剩下三条由 deploy.sh 自检覆盖（CSP / /api/file-catalog / /api/mod-catalog）：
#    整次部署的退出码就是它们的结论 —— 非零就是没过，看它逐项打印的那一行。
#    ⚠️ 前提是预检里 `MCSR_HEALTHCHECK_URL` 非空（为空 ⇒ 这一段整块不跑而退出码仍是 0）。
```

**5. 回滚：安装器**回不去**，坏的 0.0.5 只能靠 0.0.6 顶掉**

发布之前先把这条读一遍，因为它决定了"万一 0.0.5 是坏的怎么办"的答案：

- **`latest.yml` 没有存档**：`deploy.sh:515` 把安装包 tgz 解到 `/srv/mcsr-helper/releases/`，
  而 tgz 里只有**新版本**那一份清单 ⇒ 上一次的清单被**覆盖**掉（旧版本的 `.exe` 文件还在，
  但"更新源指向哪个版本"这件事只有一个格子）。
- **客户端不会降级**：`apps/desktop/src/updater.ts:101-106` 设了 `autoDownload` /
  `autoInstallOnAppQuit` / `allowPrerelease`，而全仓**没有** `allowDowngrade`（`git grep` 现读
  无输出）⇒ 走 electron-updater 的默认值 `false` ⇒ 就算把 `latest.yml` 退回 0.0.4，
  **已经装了 0.0.5 的用户也不会被带回 0.0.4**。
- ⇒ **唯一的自动补救是发 0.0.6**。手工降级只有一条路：用户自己去 `/installer/` 下载旧 exe
  重装（服务器上 0.0.1–0.0.4 的 exe 都还在）—— 那不是一条能运营的路，别把它写进应急预案。
- **前端/API 的回滚**：`${WEB_DIR}.old` 在部署成功后被删掉（`:356`）⇒ 盘上没有"上一版前端"；
  要回滚前端只能**检出旧提交再部署一次**。⚠️ 那一次如果**带** `--with-installer`，
  它会用旧提交里的 `version` 重新打一份 `latest.yml` 并**把线上清单也退回去** ——
  那是"同时回滚安装器"，是另一个动作，别顺手做。要只回滚前端就用**不带**
  `--with-installer` 的那次部署（代价：页面上"需要桌面版 0.0.5"那句话会消失一阵，
  已装 0.0.5 的用户看不出该更新）。
- **库的回滚**：只有上面第 2 步那份备份。`deploy.sh` 不备份、也不装备份计划。

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

M1 之后 SQLite 文件在 `/srv/mcsr-helper/api/data/`。计划是每晚做一次、再推到 Cloudflare R2。

⚠️⚠️ **这一节原来教的是 `sqlite3 … "VACUUM INTO …"`，而那条命令在这台服务器上跑不了**
（2026-09-15 实测：`bash: line 9: sqlite3: command not found`）。**一份照着做必然失败的文档
比没有文档更坏**：它让人以为自己有备份，而失败正好发生在"要出事了才去备份"的那一刻。
⇒ 现在**能跑**的是 `node` + `node:sqlite`（API 自己就用它 ⇒ node 一定在），做法与回读判据
（逐表比行数、`foreign_key_check`、`_migrations`）写在上面「发布桌面安装包」那一节的
**第 2 步**里 —— 那一节就是这条纪律现在的落点，别再照着下面这条旧命令做：

```bash
# ✗ 跑不了（服务器上没有 sqlite3 这个命令）—— 留在这里只为说明它错在哪
sqlite3 /srv/mcsr-helper/api/data/mcsr.db "VACUUM INTO '/tmp/mcsr-$(date +%F).db'"
```

⚠️ **今天备份仍然是手工动作**：`deploy.sh` 全文搜不到 `backup` / `备份` / `VACUUM`，
所以部署链上**没有**任何一次自动备份。（正确做法是把它做成 `deploy.sh` 里
"迁移之前 + 回读之后才算成功"的一步 —— 在那之前，第 2 步就是唯一的备份动作，
别指望部署会替你备份。）

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
| `deploy.sh` | 一条命令部署；`--bootstrap` 首次初始化，`--skip-build` 只推已有产物，`--with-installer` 顺带发布桌面安装包与 `latest.yml`（见上面「**发布桌面安装包**」那一节 —— 那一节里还带着**发布前的备份**与**部署后回读**两张清单） |
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
