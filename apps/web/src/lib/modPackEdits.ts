/**
 * `/admin/mods` 下半「整合包」容器那几个派生值的**纯函数**（B2 / Task 7）。
 *
 * ⚠️★ 它们必须住在容器外面，理由是**可验证性**（与 B1 的 `modTagEdits.ts` 逐字同一条）：
 *    · 渲染自检（`apps/web/scripts/modtagsrender.tsx`）走 `renderToStaticMarkup`
 *      —— **effect 一行都不跑** ⇒ 容器在自检里只渲出"加载中…"，它自己的派生逻辑
 *      **永远到不了**（本仓 §5.32 第 ④ 类：读数看着有、其实什么都没测）。
 *    · 而"表单里该显示哪几个值"是这一页里**会静默覆盖数据**的那一格：改包时的
 *      `PATCH` 是**全量替换** ⇒ 表单少带一格，就会把那一格**清掉**（`description`
 *      尤其隐蔽：省略它会被服务端的 `.default('')` 变成空简介，而且**不报错**）。
 *    ⇒ 抽成纯函数之后，自检**直接断言这三个函数**（那一组就是它们唯一的判据）。
 *
 * ⚠️ 这三个函数**不做 I/O、不读时钟、不读全局**：T8 拿夹具直接调它们。
 */
import { buildIndex, type ModCatalog } from '@mcsr/shared/modCatalog';

/** 表单的形状 = 一个包的**四个可写字段**（与 `packInputSchema` 的入参一一对应）。 */
export interface PackForm {
  title: string;
  description: string;
  gameVersion: string;
  modids: string[];
}

/** 表单要的那四格（服务端对象上多出来的 `hot` / `modCount` / `createdAt` / `updatedAt` **不进来**）。 */
export interface PackFormSource {
  title: string;
  description: string;
  gameVersion: string;
  modids: readonly string[];
}

/**
 * 服务端那一条包 ⇒ 表单初值。
 *
 * ★ 只取**那四个可写字段**，而且是**逐格拷贝**（`modids` 也复制成新数组）：
 *    · 直接 `{ ...server }` 会把 `hot` / `modCount` / 时间戳一起带进表单，而保存时
 *      它们会被 `PATCH` 一起发回去 —— 服务端的 `packInputSchema` 是 strip 模式
 *      （会忽略多余键），所以**今天**不出错，但那是"靠服务端兜住"的巧合，
 *      不是这一层该有的形状；
 *    · 不复制数组的话，表单里改 `modids` 会**就地改到**服务端那份对象上
 *      （同一页里另有两处读它）⇒ "取消编辑"取消不掉。
 */
export function packFormFrom(server: PackFormSource): PackForm {
  return {
    title: server.title,
    description: server.description,
    gameVersion: server.gameVersion,
    modids: [...server.modids],
  };
}

/**
 * "这一份表单改过没有"：四格**逐格**比，`modids` 比**集合**（顺序不算改动）。
 *
 * ⚠️★ 判据是"表单与服务器上那一条**不同**"，**不是**"点过没有"（同 `isDirty` 那条注释）：
 *    改一个字再改回来 ⇒ 没改过（保存键该禁用）。写成"点过没有"的话，保存键会在
 *    一个没有改动可保存的表单上亮着，点下去发的是一次**全量替换**
 *    （这一页没有乐观锁，后写的赢 ⇒ 会把别人刚改的覆盖掉）。
 * ⚠️ `modids` 先排序再比：顺序不是改动（服务端那一侧也会去重保序，页面不该因为
 *    "勾选的先后"就认为表单脏了）。
 * ⚠️ 三个字符串格用**严格相等**：`description` 的 `''` 与 `undefined` 在服务端
 *    会被 `default('')` 归一，但表单里永远是字符串 ⇒ 这一层不做归一，避免第三种真相。
 */
export function packFormDirty(form: PackForm, server: PackFormSource): boolean {
  if (form.title !== server.title) return true;
  if (form.description !== server.description) return true;
  if (form.gameVersion !== server.gameVersion) return true;

  const a = [...form.modids].sort();
  const b = [...server.modids].sort();
  return a.length !== b.length || a.some((modid, index) => modid !== b[index]);
}

/**
 * 版本下拉的候选 = 目录里现读出来的版本列表（已排序、已去重）。
 *
 * ★ 用 `buildIndex(catalog).gameVersions`，**不自己收集**：
 *    那份列表就是"目录里真的出现过哪些游戏版本"的唯一真相（`modCatalog.ts` 里
 *    `[...versions].sort()` 那一句），自己再遍历一遍 mods 就是**第二份真相**，
 *    两份漂开的症状是"下拉里有一个选中之后一个 mod 都搜不到的版本"。
 *
 * ⚠️ 它**只**回答"目录里有什么"：某条包当前挂着的版本若已不在目录里，
 *    由调用方（管理页）决定要不要把它补进候选 —— 那是产品判断，不是这一层的。
 */
export function packVersionOptions(catalog: ModCatalog): string[] {
  return [...buildIndex(catalog).gameVersions];
}
