/**
 * 侧栏分区的**用户顺序**（2026-09-17）。
 *
 * ---------------------------------------------------------------------------
 * 为什么存的是"一串路由"，而不是分区对象
 * ---------------------------------------------------------------------------
 * 用户原话：「左侧栏目自行调整顺序」（同一次要求里还有「去掉顶部的『分区』这些字」）。
 * 分区表在 `lib/nav.ts`（`NAV_SECTIONS`，全站只有那一份），而**顺序是用户的偏好**，
 * 不是那张表的一部分 ⇒ 这里只存路由的先后，套用时再去表里取分区对象。
 * 这一点是这个模块存在的全部理由：
 *   · 表里**新增**一个分区时，旧偏好里没有它 ⇒ `orderNavSections` 把它追加在最后。
 *     它不会因为"没人记得改默认顺序"而从侧栏消失 —— 而"侧栏少了一栏"这种事
 *     **不会有任何报错**（本仓为同一族形状吃过好几次亏，见 `lib/nav.ts` 文件头）。
 *   · 表里**删掉**一个分区时，旧偏好里那一项被当作过期数据忽略，列表照样出得来。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 顺序存在 localStorage 里 —— 代价必须说清楚
 * ---------------------------------------------------------------------------
 * 键是 `NAV_ORDER_KEY`，写法沿用 `Layout.tsx` 里折叠状态那条 `mcsr.sidebar.collapsed`。
 * ⚠️ 代价：它**不跨设备、也不跨浏览器** —— 换一台机器、换一个浏览器、
 *    或者清一次站点数据，顺序就回到默认。
 *    要跨设备就得做"每账号的偏好存储"（服务端一张表 + 一条读写接口 + 登录态里的
 *    一份），它会牵动服务端与账号模型 —— 那是**另一件事**，不在这一版里。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 全是纯函数：本仓没有 web 测试运行器
 * ---------------------------------------------------------------------------
 * 渲染自检脚本（`apps/web/scripts/*`）是 web 侧唯一的自动化手段，而它只渲染静态
 * 标记、**跑不了事件**。所以"排序到底对不对"必须能不经浏览器就验：下面每个函数
 * 都只吃参数、只吐结果（读写 localStorage 的那两个把 storage 收成参数，并各自
 * 吞掉异常），断言写在 `scripts/homerender.tsx` 里。
 *
 * ⚠️ 它们验不到的（别高估）：**拖动手势、方向键、以及真浏览器里的 localStorage
 *    往返**。前两者是 DOM 事件，第三个需要真的浏览器 —— 三样都在脚本末尾的
 *    "未覆盖"清单里列着。
 */
import { NAV_SECTIONS, type NavSection } from '@/lib/nav';

/** localStorage 的键。命名法与 `Layout.tsx` 的 `mcsr.sidebar.collapsed` 一致。 */
export const NAV_ORDER_KEY = 'mcsr.sidebar.order';

/**
 * 读写顺序真正用到的那个 localStorage 形状。
 *
 * ⚠️ 刻意收成一个**窄接口**而不是 `Storage`：自检脚本要能塞一个**一读写就抛错**
 *    的假实现（隐私模式），来验"存不了/读不了也不能把侧栏弄坏"。
 *    按 `Storage` 收的话，假实现得凑二十来个成员，而其中十九个和这件事无关。
 */
export interface NavOrderStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * 默认顺序 = 分区表自己的顺序。
 *
 * ⚠️ **不要把 `NAV_SECTIONS` 本身重排**：首页渲染的是同一张表
 *    （`homerender.tsx` 断言"首页 == 那张表的顺序"），而用户要的是
 *    "我自己调整左侧的顺序"，不是"你替我选一个新默认顺序"。
 */
export function defaultNavOrder(): string[] {
  return NAV_SECTIONS.map((s) => s.to);
}

/**
 * 解析存下来的顺序；**只要有一点可疑就返回 `null`**（= 用默认顺序）。
 *
 * 判据（每一条都是"存坏了"的形态，而不是"读的时候多写点代码去救"）：
 *   · 不是 JSON、不是数组、里面有非字符串 —— 手工改坏了，或者键被别的东西占了；
 *   · **有重复** —— 同一个分区出现两次，渲染出来就是两行一模一样的导航；
 *   · **有不存在的路由** —— 分区表删过东西（见文件头）。
 *
 * ⚠️ 最后一条的**代价**：表里删掉任何一个分区，所有人存的顺序都会**整条作废**、
 *    回到默认。这是刻意选的：另一种做法是"只忽略那一项、其余照用"，
 *    但那要在一个已经过期的数组上猜"哪一半还算数"—— 而它猜错的形状
 *    （顺序变成谁也没选过的样子）**不会有任何报错**。
 *    ⇒ 宁可回默认：列表一定是对的，只是偏好丢了。
 *   ⚠️ 无论走哪一支，**列表都不会坏** —— 见 `orderNavSections` 的第二半。
 */
export function readNavOrder(raw: string | null | undefined): string[] | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const known = new Set(defaultNavOrder());
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of parsed) {
    if (typeof item !== 'string') return null;
    if (seen.has(item)) return null;
    if (!known.has(item)) return null;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * 把存下来的顺序套到分区表上。
 *
 * ⚠️★ 两半缺一不可：
 *   ① 存过的**按存的顺序**排在前面；
 *   ② 存过里**没提到的**（新加的分区，或者压根没存过任何东西）按**表里的顺序
 *      追加在后面**。
 *   少掉 ② 就是"侧栏少一栏而没有任何报错"—— 正是这个模块要防的那件事。
 *   （自检脚本里有一条断言专门钉着 ②，见 `homerender.tsx`。）
 *
 * @param stored   存下来的顺序（`readNavOrder` 的结果，可能是 null）
 * @param sections 要排的分区表（默认就是 `NAV_SECTIONS`；参数是给自检喂假表用的，
 *                 否则"表里新增了一栏"这件事只能靠人去读实现）
 */
export function orderNavSections(
  stored: readonly string[] | null | undefined,
  sections: readonly NavSection[] = NAV_SECTIONS,
): NavSection[] {
  const byRoute = new Map<string, NavSection>();
  for (const s of sections) byRoute.set(s.to, s);

  const out: NavSection[] = [];
  const used = new Set<string>();
  for (const route of stored ?? []) {
    const s = byRoute.get(route);
    // 表里没有的、重复了的：跳过。
    // ⚠️ `readNavOrder` 不会给出这两种，但这里是**纯函数**，自己也要防 ——
    //    否则将来有人直接喂一个手写的数组过来，会出现"同一栏渲染两次"。
    if (!s || used.has(s.to)) continue;
    used.add(s.to);
    out.push(s);
  }
  for (const s of sections) {
    if (!used.has(s.to)) out.push(s);
  }
  return out;
}

/**
 * 把第 `from` 项挪到第 `to` 个位置上（其余项顺延），**返回新数组**。
 *
 * ⚠️ 越界、非整数、原地不动 ⇒ **原样返回一份拷贝**，不抛错：
 *    在**最上面一行按 ↑**、最下面一行按 ↓ 是正常操作（拖动也能拖到自己身上），
 *    把正常操作变成异常只会让调用点到处写边界判断。
 * ⚠️ 不改传入的数组（纯函数）—— 调用点直接把它交给 `setState` 与 `saveNavOrder`。
 */
export function moveNavOrder(order: readonly string[], from: number, to: number): string[] {
  const next = [...order];
  if (!Number.isInteger(from) || !Number.isInteger(to)) return next;
  if (from === to) return next;
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next;

  const item = next[from];
  if (item === undefined) return next; // `noUncheckedIndexedAccess`：上面已经挡过，这里只是让类型收窄
  next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * 读 + 解析，**任何异常都当作"没存过"**。
 *
 * ⚠️ try 必须同时包住"读"与"解析"：隐私模式（或站点数据被禁）下 localStorage 的
 *    读取本身就会抛错 —— 只包 JSON.parse 的话，那种浏览器里侧栏直接白屏。
 */
export function loadNavOrder(
  storage: NavOrderStorage | undefined = globalThis.localStorage,
): string[] | null {
  try {
    return readNavOrder(storage?.getItem(NAV_ORDER_KEY));
  } catch {
    return null;
  }
}

/**
 * 写，**失败必须被吞掉**。
 *
 * 与 `Layout.tsx` 里折叠状态那一条（`setItem` 外面套 try、catch 里什么都不做）同一个理由：
 * 存不上最多是"下次打开回到默认顺序"，而抛出去会让整条侧栏（连带这一整屏）炸掉。
 * 隐私模式下 `setItem` 抛错是**常态**，不是异常情况。
 */
export function saveNavOrder(
  order: readonly string[],
  storage: NavOrderStorage | undefined = globalThis.localStorage,
): void {
  try {
    storage?.setItem(NAV_ORDER_KEY, JSON.stringify(order));
  } catch {
    /* 忽略：存不了只是偏好丢了，不该影响这一屏 */
  }
}
