/**
 * 「追踪的博主」那一栏的分区参数（`?tplatform=`）：**两个纯函数**，读写都只有这一份。
 *
 * ===========================================================================
 * 为什么这一层存在：那条接线是这一轮**唯一一个没有任何门禁看得见**的契约
 * ===========================================================================
 * `/videos` 一个页面上有**两**面墙（用户贴的用 `?platform=&page=`，追踪的用
 * `?tpage=&tplatform=`），而"换分区要删 `tpage`、**不许碰** `platform` / `page`"
 * 这条契约（spec §8.2）原本写在 `routes/Videos.tsx` 的 `setTrackedPlatform` 里 ——
 * 那个位置**静态渲染永远够不到**：`renderToStaticMarkup` 不跑 effect、不点击、
 * 处理器一个都不执行（`apps/web/scripts/videorender.tsx` 末尾那段"覆盖边界"
 * 逐条列了这件事）。
 *
 * ⇒ 把它拆成"吃一个值、吐一个值"的纯函数之后，它就是**可以直接断言**的东西了：
 *   本仓**没有 web 测试跑器**（渲染脚本就是 web 代码的断言入口），所以这几条断言
 *   住在 `videorender.tsx` 的 ⑯ 里。抽出来的同时，`Videos.tsx` 一个字的口径都没变
 *   （读的仍是同一个参数名、删的仍是同一个 `tpage`）。
 *
 * ⚠️★ 这里**绝对不许**碰 `platform` / `page`：那两个是上面那面墙的状态，
 *    顺手删掉的表现是"在追踪那一栏点一下 B站，上面那面墙的筛选和页码一起没了" ——
 *    而这件事**只有在两栏都用过时才看得见**（spec §8.2 就是为它写的）。
 */
import { TRACK_PLATFORMS, type TrackPlatform } from '@mcsr/shared/tracking';

/** 这一栏的分区参数名。⚠️ 带 `t` 前缀：`platform` 已经被上面那面墙占了（spec §8.2）。 */
export const TRACKED_PLATFORM_PARAM = 'tplatform';

/** 这一栏的页码参数名。换分区时要把它删掉（= 回到第 1 页）。 */
export const TRACKED_PAGE_PARAM = 'tpage';

/**
 * 读参数需要的**最小**形状（`URLSearchParams.get` 那一格）。
 * ⚠️ 收窄成这一格而不是直接要 `URLSearchParams`：断言与调用都只需要它，
 *    而 `Map` / 一个对象字面量也能满足（自检里就是这么喂的）。
 */
export interface ReadableParams {
  get: (name: string) => string | null;
}

/**
 * 地址栏里的 `tplatform` → 分区（**先校验再用**）。
 *
 * - 缺参数 / 空串 / 认不出的值（手打 `?tplatform=foo`）⇒ 一律回 `undefined`（= 「全部」）。
 *   ⚠️★ **不许**把认不出的值原样发给服务端：那一头是**封闭枚举**
 *   （spec §5.1：`?platform=foo` ⇒ 400 `invalid_query`），于是"地址被改坏了"会变成
 *   一整块错误界面，而正确的行为是**退化成"全部"**（那面墙的注释里写着同一条）。
 * - 判据是 `TRACK_PLATFORMS`（与 `packages/shared` 那份唯一的平台清单对齐）：
 *   在这里手抄三个平台名就是第二份口径。
 */
export function readTrackedPlatform(params: ReadableParams): TrackPlatform | undefined {
  const raw = params.get(TRACKED_PLATFORM_PARAM);
  return (TRACK_PLATFORMS as readonly string[]).includes(raw ?? '')
    ? (raw as TrackPlatform)
    : undefined;
}

/**
 * 换分区之后的**下一份**查询串。
 *
 * - `next === undefined`（点「全部」）⇒ **删掉** `tplatform`，不是留一个空值
 *   （`?tplatform=` 读出来是空串，而空串在服务端那一头是 400 的取值 —— 见上）。
 * - 无论换成哪一个分区都**删掉 `tpage`**：停在第三页而新分区只剩一页的话，
 *   用户看到的是一片空白，他会以为"这个分区没有视频"（与那面墙"换筛选回第一页"同一条）。
 * - ★ 其余的键**原样带过去**：上面那面墙的 `platform` / `page`、以及将来的任何参数，
 *   都不归这一栏管（spec §8.2）。
 */
export function nextParamsForTrackedPlatform(
  prev: URLSearchParams,
  next: TrackPlatform | undefined,
): URLSearchParams {
  const params = new URLSearchParams(prev);
  if (next === undefined) params.delete(TRACKED_PLATFORM_PARAM);
  else params.set(TRACKED_PLATFORM_PARAM, next);
  params.delete(TRACKED_PAGE_PARAM);
  return params;
}
