# 图标来源与许可 / Icon sources and licensing

这些文件是从各站点**下载并自托管**的，不是热链。

## 为什么自托管

热链对方站点的 favicon 看起来更省事，但有两个实际问题：

1. **GitHub 头像走 `avatars.githubusercontent.com`**，在大陆访问很慢甚至不通 ——
   而本项目的主要用户就在大陆。热链等于让一部分用户永远看不到图。
2. **站点的 favicon 经常变动、消失、或者被 Cloudflare 拦**。
   实测 `paceman.gg` 对任何请求都返回 403（连浏览器 UA + Referer 都不放行）。

自托管之后图标一定拿得到，而且总共只有 13 KB。

## 用法

这些图标是**站点标识**，通常归各站点所有。本项目把它们放在资源条目旁边，
用途是标识并链接到对应站点（industry-standard nominative use）—— 这与浏览器
书签、RSS 阅读器显示站点图标是同一类用法。

**如果任何站点的所有者要求移除，删掉对应文件并在 `content/resources.json`
里去掉该条目的 `imageUrl` 即可** —— 会自动退回首字母方块，不影响功能。

## 来源

| 文件 | 来源 | 原始尺寸 |
|---|---|---|
| `mcsrranked.png` | `https://mcsrranked.com/favicon.ico` | 184×184 |
| `mcsrranked-docs.png` | `https://docs.mcsrranked.com/assets/img/icon.png` | 32×32 |
| `speedrun.png` | `https://www.speedrun.com/favicon.ico` | 最大 256×256 |
| `minecraft-wiki.png` | `https://minecraft.wiki/images/Apple-touch-icon.png` | 160×160 |
| `ninjabrain.png` | `https://github.com/Ninjabrain1.png` | 160×160 |
| `paceman.png` | `https://github.com/PaceMan-MCSR.png`（paceman.gg 本身 403） | 128×128 |
| `mcsr-ranked-mod.png` | Modrinth API `icon_url`，项目 `mcsr-ranked` | 256×256 |

全部统一转换为 128×128 PNG（保留透明通道），调色板量化到 64 色。
原始总量 206 KB → 现总量 13 KB。
