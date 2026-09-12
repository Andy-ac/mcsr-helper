import { useState } from 'react';

/**
 * 资源图标：优先用条目自带的 imageUrl，其次退回到该站点的 /favicon.ico，
 * 两者都不行就渲染一个**首字母方块**。
 *
 * 为什么用 <origin>/favicon.ico 而不是某个第三方图标服务：
 *   1. 第三方服务（Google 的 s2/favicons 之类）在大陆访问不到；
 *   2. 直接向目标站点请求 favicon 是浏览器本来就有的行为，不引入新的依赖，
 *      也不会把你的用户访问记录交给第三方；
 *   3. 失败了也不影响使用 —— 有首字母方块兜底。
 *
 * 因此新增条目**零配置就有图**，想指定正式配图的再填 imageUrl。
 */
export interface ResourceIconProps {
  id: string;
  title: string;
  url: string;
  imageUrl: string | null;
}

export function ResourceIcon({ id, title, url, imageUrl }: ResourceIconProps) {
  const [failed, setFailed] = useState(false);

  const src = imageUrl ?? faviconOf(url);

  if (!src || failed) {
    return (
      <span className="rescard__letter" style={{ background: colorFor(id) }} aria-hidden="true">
        {firstGlyph(title)}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

/** 取站点的 /favicon.ico。解析失败返回 null（交给首字母方块）。 */
function faviconOf(url: string): string | null {
  try {
    const origin = new URL(url).origin;
    // 只允许 http(s)，避免 data:/javascript: 之类的伪协议混进来
    if (!/^https?:$/.test(new URL(url).protocol)) return null;
    return `${origin}/favicon.ico`;
  } catch {
    return null;
  }
}

/**
 * 标题的第一个字符。
 *
 * 用 [...str] 而不是 str[0] —— 后者会把 emoji 之类的代理对拆成半个字符，
 * 渲染出一个乱码方块。中文没问题，但英文标题里出现 emoji 并不罕见。
 */
function firstGlyph(title: string): string {
  const trimmed = title.trim();
  const first = [...trimmed][0] ?? '?';
  return first.toUpperCase();
}

/**
 * 由 id 推导一个稳定的颜色。
 *
 * 同一个条目永远得到同一个颜色（不是随机的），这样方块看起来像"这个物品的图标"，
 * 而不是每次刷新都换一个。取的是游戏里方块/矿物系的颜色。
 */
const BLOCK_COLORS = [
  '#866043', // 泥土
  '#7fb238', // 草
  '#8b8b8b', // 石头
  '#4aedd9', // 钻石
  '#c9974a', // 橡木
  '#a04a3a', // 红砖
  '#5a7fa0', // 水
  '#8a6fa8', // 紫水晶
];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return BLOCK_COLORS[hash % BLOCK_COLORS.length] ?? BLOCK_COLORS[0]!;
}
