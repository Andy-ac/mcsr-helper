/**
 * 桌面客户端的分发信息。
 *
 * ---------------------------------------------------------------------------
 * 为什么由 API 读 latest.yml，而不是让网页自己去拿
 * ---------------------------------------------------------------------------
 * 网页要显示"下载客户端 v0.0.2"，就得知道当前版本号。三个选择：
 *
 *   A. 网页直接 fetch /installer/latest.yml 然后解析
 *      → 要在浏览器里解析 YAML。为这一个文件引入一个 YAML 解析器不值得，
 *        用正则去抠机器生成的 YAML 更糟 —— 那是在对格式做没写下来的假设。
 *
 *   B. 把版本号写死在前端
 *      → 每发一个版本都要改前端并重新构建部署，而且**忘改就会显示旧版本号**，
 *        用户下载到的东西和页面写的不一致。这类错误没有任何东西会提醒你。
 *
 *   C. **让 API 读服务端那份 latest.yml，以 JSON 下发**（就是这里）
 *      → 版本号只有一个来源（electron-builder 生成的清单本身），
 *        前端不需要知道 YAML，也不可能与真实产物不一致。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 没有发布过安装包时必须是 404 而不是 500
 * ---------------------------------------------------------------------------
 * M3 之前 releases/ 目录根本不存在。如果这里抛异常，首页上会出现一个红色的
 * "出错了" —— 而"还没有发布桌面版"是一个完全正常的状态，不是错误。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';

export const desktopRoute = new Hono();

/**
 * 发布目录。
 *
 * 和 systemd 单元里的 ReadWritePaths 无关 —— 那是**写**权限，
 * 而这里只需要读（ProtectSystem=strict 不影响读）。
 */
function releasesDir(): string {
  return process.env.MCSR_RELEASES_DIR ?? '/srv/mcsr-helper/releases';
}

interface ReleaseInfo {
  version: string;
  /** 文件名（未编码）。前端负责拼出完整地址并编码。 */
  file: string;
  size: number;
  releasedAt: string | null;
}

/**
 * 从 electron-builder 生成的 latest.yml 里取出发布信息。
 *
 * ⚠️ 这个解析写得**很保守**：只认自己写的两个字段，认不出就返回 null，
 *    而不是猜。原因是这个文件的格式由 electron-builder 决定，
 *    我们没有控制权 —— 万一它改了格式，安静地返回 null
 *    （页面不显示下载入口）远好过猜出一个错的版本号让用户下载错东西。
 */
function readRelease(): ReleaseInfo | null {
  let raw: string;
  try {
    raw = readFileSync(join(releasesDir(), 'latest.yml'), 'utf8');
  } catch {
    // 还没发布过安装包 —— 正常状态
    return null;
  }

  const version = /^version:\s*(.+)$/m.exec(raw)?.[1]?.trim();
  const file = /^\s*-\s*url:\s*(.+)$/m.exec(raw)?.[1]?.trim();
  const size = Number(/^files:[\s\S]*?size:\s*(\d+)/m.exec(raw)?.[1] ?? '0');
  const releasedAt = /^releaseDate:\s*'?([^'\n]+)'?$/m.exec(raw)?.[1]?.trim() ?? null;

  if (!version || !file) return null;
  return { version, file, size: Number.isFinite(size) ? size : 0, releasedAt };
}

desktopRoute.get('/desktop/release', (c) => {
  const info = readRelease();
  if (!info) {
    // 短缓存：刚发布完不希望用户等 60 秒才看到
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({ available: false }, 404);
  }

  c.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
  return c.json({ available: true, ...info });
});
