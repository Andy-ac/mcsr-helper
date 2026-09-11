# MCSR Helper

MCSR 社区的资源库与日历 —— 一个**不做内容抓取、只做聚合与工具**的桌面端应用。

> **当前状态：M0（骨架）**
> 只有可用工程骨架，还没有任何业务功能。路线图见 [`docs/v1-plan.md`](docs/v1-plan.md)。

---

## 快速开始

```bash
# 前置：Node >= 22，pnpm >= 10
node -v && pnpm -v

pnpm install

# 全起：Web + API + Electron 桌面壳 ← 平时用这个
pnpm dev

# 只在浏览器里开发（Web + API，不开桌面壳）
pnpm dev:web
```

`pnpm dev:web` 之后打开 <http://localhost:5173> 即可。

---

## 仓库结构

```
apps/
  web/          React 前端 —— 唯一的前端产物（浏览器与 Electron 共用同一套）
  desktop/      Electron 主进程 + preload + 打包配置
packages/
  shared/       类型、常量、i18n 词条、种子规则
  ui/           共享组件
services/
  api/          Node/TS + Hono 后端
deploy/         Caddy / systemd / 部署脚本
docs/           方案与调研事实表
```

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | **全起**：Web + API + Electron 桌面壳 ← 平时用这个 |
| `pnpm dev:web` | Web + API（浏览器里开发，不开桌面壳） |
| `pnpm dev:api` | 只起后端（3001） |
| `pnpm dev:desktop` | 只起桌面壳（需另开 `pnpm dev:web`） |
| `pnpm build` | 构建 web + api + desktop |
| `pnpm build:installer` | 打 Windows 安装包（M3） |
| `pnpm typecheck` | 全仓类型检查 |
| `pnpm lint` / `pnpm format` | Biome 检查 / 自动修复 |
| `pnpm check` | typecheck + lint |
| `pnpm deploy` | 部署到服务器（需先配 `deploy/deploy.env`） |

---

## ⚠️ 两条改了会静默出 bug 的规则

**1. 种子必须是字符串，永远不要变成 number。**
Minecraft 种子是 64 位整数，`Number` 表示不了，会**静默截断**（不报错）。
规则与理由写在 [`packages/shared/src/seed.ts`](packages/shared/src/seed.ts) 顶部。
输入框用 `inputMode="text"`，不要用 `type="number"`（见 `packages/ui/src/SeedInput.tsx`）。

**2. `Referrer-Policy` 不能改成 `no-referrer` / `same-origin`。**
YouTube 要求嵌入客户端通过 `Referer` 头标识自己，抑制它会触发 `Error 153`，
三个平台的视频会直接播不出来。`apps/web/index.html` 与 `deploy/Caddyfile` 里都写了这个策略，
两处都有注释说明原因。

---

## 文档

- [`docs/v1-plan.md`](docs/v1-plan.md) —— **v1 完整架构、技术选型、里程碑与验收标准**
- [`docs/platform-oauth-embed-factsheet.md`](docs/platform-oauth-embed-factsheet.md) —— 各平台登录与嵌入政策的事实依据
- [`docs/research-fact-sheet-frameworks-backend.md`](docs/research-fact-sheet-frameworks-backend.md) —— 框架 / 后端 / 备案的对比调研

## 部署

见 [`deploy/README.md`](deploy/README.md)。一句话版本：

```bash
cp deploy/deploy.env.example deploy/deploy.env   # 填域名和服务器
bash deploy/deploy.sh --bootstrap                # 首次
bash deploy/deploy.sh                            # 之后每次
```
