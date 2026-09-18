# 参与贡献

贡献之前先把这一段读完 —— 这个仓库的**代码注释是中文的**，而且注释里写的
不是"这段代码在做什么"，是"**为什么是这样**"和"**换一种写法的代价是什么**"。
那不是在写文档，那是这个项目唯一的质量来源（见下面「几条看不出来但必须守的规矩」）。

> **English summary.** MCSR Helper is a community resource library / calendar /
> video & live tracker for Minecraft speedrunning. Docs, code comments and
> commit messages are written in Chinese on purpose — see the "house rules"
> section for the conventions that are not inferable from the code, and read
> `SECURITY.md` before reporting a vulnerability.

---

## 跑起来

```bash
# 前置：Node >= 22.15、pnpm >= 10（版本要求是真的，见下面那段）
node -v && pnpm -v

pnpm install

# 平时用这个：Web(5173) + API(3001)，浏览器里开发
pnpm dev:web

# 需要桌面壳时（另开一个终端，或用 pnpm dev 一次起三个）
pnpm dev
```

打开 <http://localhost:5173>。`pnpm dev` 会额外起 Electron；只想调界面的话
`pnpm dev:web` 更快。

**为什么 Node 的下限是 22.15**（这不是随手写的数字）：`services/api/src/ranked-seed-errors.test.ts`
用 `node:module` 的 `registerHooks()` 把 `apps/web` 的 `@/` 别名挂进 API 的测试进程，
而那个 API 是 **v22.15.0** 才有的。版本不够时 pnpm 只打一行 `[WARN] Unsupported
engine` 就照常往下跑，真正红的是**整个 api 测试套件**在 import 那一刻报
`registerHooks is not a function` —— 错误指向那个测试文件、不指向 node 版本。
（完整记录在根 `package.json` 的 `//engines` 里，包括"它其实不是门禁"这件事。）

## 提交之前：两道门禁都要绿

```bash
pnpm -w check                     # ① typecheck + 全部测试 + biome
pnpm -F @mcsr/web check:all       # ② 十一个渲染自检 × 两种语言（含 ①）
```

两条**都要报**，不能只报第一条：`pnpm -w check` 里**没有**渲染自检，
所以「`pnpm check` 绿」从来不等于「界面还是对的」。

★ **`apps/web` 没有测试运行器** —— 那十一个渲染自检脚本
（`apps/web/scripts/*.tsx`）是**web 层唯一**的自动化覆盖。所以：

- 改界面就必须改/加对应的自检脚本，否则那次改动**没有任何自动化判据**；
- `check:all` 里 `--en` 那一遍**不是可选的**：词条泄漏只有在英文渲染下才暴露；
- 新增一个自检脚本时，别忘了把它加进 `check:all` 的链条里
  （`apps/web/package.json` 的 `//check:all` 里那句"十一个"是**手抄的**）。

## 几条看不出来、但必须守的规矩

这些是踩过坑才有的，光读代码推不出来。

1. **注释写"为什么"和"代价"**，不写"这段在做什么"。
   注释里要能回答：为什么是这个形状、试过什么别的、换回去会发生什么、
   这个取舍把什么代价放在了明面上。仓库里那些带 ⚠️ 的长注释就是模板。
2. **绝不为缺失值填 `0`（或空串）。** 拿不到就是 `null` / `NULL` / 界面上印「—」。
   `0` 看起来像一条真实数据：播放量 `0` 与"上游没给播放量"、时长 `0` 秒与"不知道多长"
   （会把 `short` 标签打错）、`viewer_count = 0` 与"不知道有几个人在看" ——
   它们一旦写成同一个值，**就没有任何东西能把它们分开了**。
3. **每一条断言都必须能红。** 一条永远成立的断言比没有断言更坏：它会让下一个人以为
   "这里有人看着"。所以：
   - 反向断言（"页面上不该出现 X"）必须配**正向对照**（同一次运行里证明 X 该出现时会出现）；
   - 判据本身要有**探针**（"把前缀删掉，这条还绿吗？"）；
   - 变异测试是最低要求：**改坏实现，断言要红**。不红就说明它其实什么都没测。
4. **跨层的名字是契约，一处改就处处改。**
   - 服务端新增一个错误 `code` → `services/api/src/error-codes.test.ts` 的 `KNOWN_CODES`
     会当场变红，逼你决定"界面显示什么"（前端映射或显式登记为通用文案）；
   - 新增/改动 `reason` → 同一文件的 `SEED_REASONS`；
   - 加词条 → **两种语言都要加**（`services/api/src/i18n-keys.test.ts` 守着对齐，
     而且 `t('字面量')` 的键必须真实存在）。
5. **数据库只存在于服务器上。** 本地不要建库、更不要提交：`services/api/data/`、
   `*.db` / `*.db-wal` / `*.db-shm` 都被忽略，`.gitignore` 里那段注释记着为什么
   （"即使后来删掉，历史里也还在"）。
6. **密钥、别人的地址、服务器的 IP 都不进版本库。** 环境变量分三类、安装位置各不相同，
   见根目录 `.env.example` 的索引；服务器上的那类住在 `/etc/mcsr-helper/*.env`
   （`deploy/*.env.example` 是模板，`*` 的真文件**不提交**）。
   同理：像"某个上游服务的地址"这种东西**不给默认值** —— 默认值会被静默继承，
   于是每个照抄本仓的人都在对**别人**的服务器做请求（写接口还会往对方库里插记录）。
7. **提交信息**沿用本仓的形状：`类型(范围): 做了什么`，例如
   `feat(live): 一个知道谁在直播的任务`、`fix(videos): 搜索框把空串当成没给`、
   `test(tracking): 自检覆盖了三个平台的跳过分支`。
   一句话说清"做了什么"就够，**不要**写"update files"这类没有信息量的信息。

## 部署相关的改动

`deploy/` 下的东西会直接影响线上：部署脚本、systemd 单元、Caddyfile。
改它们之前读 `deploy/README.md`，并且注意本仓那两条硬规矩：

- **配置即代码**：单元文件与 Caddyfile 每次部署都会被同步过去，所以"在服务器上手改
  配置文件"这个动作会被下一次部署**静默抹掉** —— 需要长期存在的值要放进
  `EnvironmentFile` 指向的文件（`/etc/mcsr-helper/*.env`），或者改版本库里的模板。
- **两份清单要对齐**：`deploy/deploy.sh` 里 `scp` 的清单与远程 `rm` 的清单必须逐项对应，
  加了文件就两边都加（漏掉的不会报错，只会在 `/tmp` 里留下一份 root 属主的文件）。

## 报安全问题

**不要开公开 issue。** 私下的报告方式、在范围内的东西、以及这个项目在安全上
**真实**的能力边界（这是一个社区项目、只跑着一份部署），都写在
[`SECURITY.md`](SECURITY.md) 里。请先读那一份。

## 许可

MIT，见 [`LICENSE`](LICENSE)。你提交的改动会以同一条许可发布。
