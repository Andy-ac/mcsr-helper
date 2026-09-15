/**
 * 实时分享（live shares）—— **前后端共用的一份契约**。
 *
 * 全站唯一一份"分享一条短暂记录"的定义：两种 kind、两套展示时长（房间四档分钟 /
 * 种子 1–30 天）、两种限额、说明的宽度预算、以及请求/响应两边的 zod schema。
 *
 * ===========================================================================
 * ⚠️ 为什么 payload 是 JSON 而不是平铺的列
 * ===========================================================================
 * 用户说「顶部**暂时**分成两个栏目」——「暂时」意味着以后会有第三个。
 * 两个 kind 的字段**零重叠**（一个是一个码，一个是四个种子），平铺成列的话
 * 每读一处都要先想"这一列在这个 kind 下有没有意义"，而且加第三个栏目要一次迁移。
 * ⇒ 信封（谁发的 / 说明 / 到期 / 状态）进列，内容进 payload。
 *
 * ⚠️ 代价写在这里，别让它变成惊喜：**数据库不知道 payload 的形状**。
 *    所以写入与读出**必须过同一份 schema**（见 `parseSharePayload`）——
 *    读的那一遍是给"手改过库 / 回滚过 / 将来某次迁移留下的坏行"兜底的。
 */
import { z } from 'zod';

/** 两个栏目。⚠️ 加第三个 kind 时：这里 + `SHARE_LIMITS` + `SHARE_NOTE_UNITS` + 一个 payload schema + 一段词条。 */
export const SHARE_KINDS = ['room', 'seed'] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

/**
 * **私人房**的展示时长四档。**服务端只接受这四个值**（不是 1–20 的区间）：
 * 用户要的是"5 分钟一档"，而区间校验会放进来 7 分钟这种界面上根本选不到的值 ——
 * 那种值只能来自脚本，而它会让"所有时长都是 5 的倍数"这条性质悄悄失效。
 */
export const SHARE_MINUTES = [5, 10, 15, 20] as const;
export type ShareMinutes = (typeof SHARE_MINUTES)[number];
export const DEFAULT_SHARE_MINUTES: ShareMinutes = 5;

/**
 * **种子**的展示时长：**天数，1–30，自己填**（2026-09-16 用户要求）。
 *
 * ===========================================================================
 * ⚠️★ 为什么两个 kind 的单位**不一样**，而且不是"顺手统一一下"能改的
 * ===========================================================================
 * 两边的约束**性质不同**，这是用户分别指定过的两件事：
 *   · 私人房的四档是**选项**（"5 分钟一档"）⇒ 枚举，界面上只有四个 radio；
 *   · 种子的天数是**自由填写**（"最多 30 天（自行填写）"）⇒ 区间。
 * 枚举换成区间会放进来界面上选不到的值（见上一条注释）；区间换成枚举则是把
 * "自己填"这件事直接砍掉。⇒ 两份 schema，各自带各自的界，**不要合并**。
 *
 * ⚠️ 为什么种子要按天：一种子局的信息本来就能用很久（私房号不一样 ——
 *    房散了那个号就作废了）。20 分钟的窗口对"暂时记录一下种子"来说太短。
 * ⚠️ 它**不写进 payload**：时长只落在信封的 `expires_at` 上
 *    （见文件头"payload 是 JSON"那一节）⇒ 这次把分钟改成天**没有存量数据问题**，
 *    库里已有的行照样读得出来，只是它们的 `expires_at` 是当时按分钟算的。
 */
export const SHARE_DAYS_MIN = 1;
export const SHARE_DAYS_MAX = 30;
export const DEFAULT_SHARE_DAYS = 7;
/** 一天的毫秒数。⚠️ 用它算 `expires_at`，别在别处再写一遍 `24 * 60 * 60 * 1000`。 */
export const SHARE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 每个 kind 同时能挂几条。
 *
 * ⚠️ 这两个数字**性质不同**，落在两个地方（spec §3.3）：
 *   · `room: 1` 是**语义不变量** ⇒ 数据库的部分唯一索引（`019_live_shares`）；
 *   · `seed: 20` 是**额度** ⇒ 数据层在写入事务里数一遍（把 20 写进 CHECK 的话，
 *     以后改成 30 就要重建表 —— 那正是选 JSON payload 想避免的代价）。
 */
export const SHARE_LIMITS: Record<ShareKind, number> = { room: 1, seed: 20 };

/**
 * 说明的**显示宽度**预算（用户在需求里写的是「＜20字/40字符」/「＜50字/100字符」）。
 * 一个汉字占两个半角位 ⇒ "20 字"与"40 字符"是同一个预算。
 * 算法与区间表见 `textWidth`。
 */
export const SHARE_NOTE_UNITS: Record<ShareKind, number> = { room: 40, seed: 100 };

/** 房间号：字母、数字、连字符、下划线。⚠️ `-` `_` 是特意加的 —— racetime 那类房间标识带连字符。 */
export const SHARE_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;
export const SHARE_CODE_MIN = 3;
export const SHARE_CODE_MAX = 20;

/** 单个种子的长度上限。 */
export const SHARE_SEED_MAX = 32;

/**
 * 宽字符区间表。**这是"20字/40字符"这个口径的唯一实现**，别在别处再写一份。
 *
 * ⚠️ 不能用 `String.length`：它数的是 UTF-16 单元 —— emoji 会被数成 2、
 *    而在代理对上拆开数还会数错。下面按**码点**（`[...str]`）走。
 *
 * ⚠️ 不用 `\p{East_Asian_Width=Wide}`：ECMAScript 的正则**不支持**这个属性
 *    （它只支持二元属性与 General_Category / Script）⇒ 只能列区间。
 *    区间取的是"实用上够用"的那一档：CJK、假名、谚文、全角形式、emoji。
 */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // 谚文字母
  [0x2e80, 0x303e], // 中日韩部首与符号
  [0x3041, 0x33ff], // 假名、注音、中日韩兼容
  [0x3400, 0x4dbf], // CJK 扩展 A
  [0x4e00, 0x9fff], // CJK 基本区
  [0xa000, 0xa4cf], // 彝文
  [0xac00, 0xd7a3], // 谚文音节
  [0xf900, 0xfaff], // 兼容表意文字
  [0xfe30, 0xfe4f], // 中日韩兼容形式
  [0xff00, 0xff60], // 全角形式
  [0xffe0, 0xffe6], // 全角符号
  [0x1f300, 0x1faff], // emoji
];

/** 一个码点的显示宽度（2 = 宽，1 = 其它）。 */
function codePointWidth(cp: number): number {
  for (const [lo, hi] of WIDE_RANGES) {
    if (cp >= lo && cp <= hi) return 2;
  }
  return 1;
}

/** 字符串的显示宽度（按码点算）。空串是 0。 */
export function textWidth(s: string): number {
  let total = 0;
  for (const ch of s) total += codePointWidth(ch.codePointAt(0) ?? 0);
  return total;
}

// ---------------------------------------------------------------------------
// payload（存进 JSON 列的那一部分）
// ---------------------------------------------------------------------------

export const RoomPayloadSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(SHARE_CODE_MIN, { message: `房间号至少 ${String(SHARE_CODE_MIN)} 个字符` })
      .max(SHARE_CODE_MAX, { message: `房间号最多 ${String(SHARE_CODE_MAX)} 个字符` })
      .regex(SHARE_CODE_PATTERN, { message: '房间号只能用字母、数字、- 和 _' }),
  })
  .strict();

/**
 * ⚠️ 选填的三格用 `.transform()` 把**空串变成 `undefined`**：
 *    "填了空"与"没填"在库里必须是同一件事，否则前端要判断两种空。
 *    `.strict()` 是为了让"多传了一个不认识的键"当场报错，而不是被静默丢掉。
 */
const optionalSeed = z
  .string()
  .trim()
  .refine((v) => !/\s/.test(v), { message: '种子里不能有空格' })
  .refine((v) => v.length <= SHARE_SEED_MAX, {
    message: `种子最多 ${String(SHARE_SEED_MAX)} 个字符`,
  })
  .transform((v) => (v === '' ? undefined : v))
  .optional();

export const SeedPayloadSchema = z
  .object({
    overworld: z
      .string()
      .trim()
      .min(1, { message: '主世界种子必填' })
      .refine((v) => !/\s/.test(v), { message: '种子里不能有空格' })
      .refine((v) => v.length <= SHARE_SEED_MAX, {
        message: `种子最多 ${String(SHARE_SEED_MAX)} 个字符`,
      }),
    nether: optionalSeed,
    end: optionalSeed,
    rng: optionalSeed,
  })
  .strict();

export type RoomPayload = z.infer<typeof RoomPayloadSchema>;
export type SeedPayload = z.infer<typeof SeedPayloadSchema>;
export type SharePayload = RoomPayload | SeedPayload;

/**
 * 按 kind 校验一份 payload —— **写入与读出都走它**。
 *
 * ⚠️ 读路径上**必须**用它（spec §3.2）：数据库不知道 payload 的形状，
 *    所以一次手改库、一次回滚、将来某次迁移都可能留下"形状对不上 kind"的行。
 *    透传给前端的话，界面上会渲染出破折号 —— 看起来像我们这个功能坏了。
 *    这里回 `null` 表示"这一行坏了"，调用方跳过它并记日志。
 */
export function parseSharePayload(kind: ShareKind, raw: unknown): SharePayload | null {
  const result =
    kind === 'room' ? RoomPayloadSchema.safeParse(raw) : SeedPayloadSchema.safeParse(raw);
  return result.success ? result.data : null;
}

// ---------------------------------------------------------------------------
// 请求 body（两条路的形状不同，所以按 kind 取 schema）
// ---------------------------------------------------------------------------

const minutesSchema = z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20)]);

/**
 * 种子那一栏的展示天数：**整数、1–30**。
 *
 * ⚠️ `.int()` 的缺省 message 是英文（本仓其它地方也一样，见 `live.ts` 的 `sortOrder`）——
 *    这一格的 400 只可能是"前端漏了一格规则"，而**界面上先拦过一次**
 *    （`shares.errDays`，中文）。所以不为止单独写一句中文 message。
 * ⚠️ 非数字（`'7'` / `null`）与小数（`7.5`）都拒：`'7'` 在 JSON 里是字符串，
 *    放行它等于认下两种"天数"，而分钟那一档同样是**只认数字**的。
 */
const daysSchema = z
  .number()
  .int()
  .min(SHARE_DAYS_MIN, { message: `展示天数至少 ${String(SHARE_DAYS_MIN)} 天` })
  .max(SHARE_DAYS_MAX, { message: `展示天数最多 ${String(SHARE_DAYS_MAX)} 天` });

/**
 * 把用户填进那一格的**原文**读成天数 —— `null` = 不合法。
 *
 * ⚠️★ 为什么它住在 shared，而不是 `ShareForm` 里那一段 `if`：
 *    · `apps/web` **没有测试运行器**（见 `lib/shareTime.ts` 的文件头），写在组件里
 *      这条规则就**只有人眼能验** —— 而它错了的表现是"填 30 被打回"，用户没有任何办法绕过；
 *    · 放在这里，`services/api` 那套测试能逐条钉它（本仓惯例，见
 *      `live-shares-schema.test.ts` 的文件头："共享模块的行为一律在这里被钉住"）。
 * ⚠️ 它与 `daysSchema` 是**同一条规则的两种入参形状**（那边收 JSON 数字、这边收输入框的
 *    字符串），界只有 `SHARE_DAYS_MIN` / `SHARE_DAYS_MAX` 一处。
 *    测试里有一条**逐值对照**这两条路的结论必须一致 —— 界漂了会当场红。
 * ⚠️ 用正则而不是 `Number(raw)` 一把梭：`Number('')` 是 0、`Number(' ')` 也是 0、
 *    `Number('7.9')` 是 7.9 —— 三个都不该被当成"填好了一个天数"。
 *    （手法照 `apps/web/src/components/SeedFilters.tsx` 的 `parseCompletionInput`。）
 */
export function parseShareDays(raw: string): number | null {
  const value = raw.trim();
  /* ⚠️ 只认 1–2 位纯数字：`+7` / `1e1` / `7.5` / `7 天` 在这里就出局了。 */
  if (!/^\d{1,2}$/.test(value)) return null;
  const days = Number(value);
  return days >= SHARE_DAYS_MIN && days <= SHARE_DAYS_MAX ? days : null;
}

const noteSchema = (kind: ShareKind) =>
  z
    .string()
    .max(400, { message: '说明太长了' }) // 粗上限，真正的判据是下面的宽度预算
    .optional()
    .default('')
    .refine((v) => textWidth(v) <= SHARE_NOTE_UNITS[kind], {
      message: `说明最多 ${String(SHARE_NOTE_UNITS[kind])} 个字位（一个汉字算 2）`,
    });

/**
 * 请求 body 的两种形状。
 *
 * ⚠️★ payload 那几格**直接复用 payload schema 的字段**（`.shape.*`），不是各写一遍 `z.string()`。
 *
 *    这里原来写的是裸 `z.string()`（规则只住在 `RoomPayloadSchema` / `optionalSeed` 里，
 *    要靠 `parseSharePost` 的第二遍才生效）—— 那让**同一个对象字面量里出现两套规矩**：
 *    紧挨着的 `note` 把自己的规则带在外层（`noteSchema('room')`），
 *    而 `code` 却把规则推给下一层。表现是"用 `sharePostSchema('room')` 校验一个 2 个字符的
 *    房间号会**通过**" —— 而那正是下面测试与 spec §11.1 都要求拒绝的形状。
 *
 *    ⇒ `.shape.*` 交出去的是**同一个 schema 实例**，所以每条规则仍然只有一份定义
 *      （长度、字符集、trim、空串→undefined 都只有一处）。规则会被跑两遍，那是幂等的。
 */
export const RoomPostSchema = z
  .object({
    code: RoomPayloadSchema.shape.code,
    note: noteSchema('room'),
    minutes: minutesSchema.default(DEFAULT_SHARE_MINUTES),
  })
  .strict();

export const SeedPostSchema = z
  .object({
    overworld: SeedPayloadSchema.shape.overworld,
    nether: optionalSeed,
    end: optionalSeed,
    rng: optionalSeed,
    note: noteSchema('seed'),
    /*
     * ⚠️★ 这一格叫 `days` 而**不叫** `minutes`：两个 kind 的时长单位不同
     *    （房间 = 四档分钟、种子 = 1–30 天，见上面 `SHARE_DAYS_MIN` 那段理由）。
     *    名字沿用 `minutes` 的话，库里那种"7 表示 7 分钟还是 7 天"的歧义会从
     *    body 一路带到审计文案里，而看的人没有任何办法分辨。
     */
    days: daysSchema.default(DEFAULT_SHARE_DAYS),
  })
  .strict();

/**
 * 取某个 kind 的 body schema。
 * ⚠️ 两个 schema 的**形状本来就不一样**，所以没有"一个带 kind 字段的联合"——
 *    kind 在 URL 里，不在 body 里。
 *
 * ⚠️ 返回类型写 `z.ZodType` 而不是那两个 schema 的联合：联合的 `.safeParse` 会得到一个
 *    输出类型的联合，调用方拿到的 `data` 是 `unknown` 级别的东西 ⇒
 *    想要**带类型**的断言就直接 import `RoomPostSchema` / `SeedPostSchema`（测试里就是这么做的）。
 */
export function sharePostSchema(kind: ShareKind): z.ZodType {
  return kind === 'room' ? RoomPostSchema : SeedPostSchema;
}

/**
 * body 的形状先过一遍，再把 payload 那几格**单独**过一遍 payload 的 schema。
 *
 * ⚠️★ **两遍都要留着，别以为第一遍已经把规则跑过了就删第二遍**（2026-09-15 明确）。
 *    两遍的**产出不同**：
 *      · 第一遍（外层）负责"这个请求合不合法" —— 它报出的 `issues` 直接变成 400 的响应体；
 *      · 第二遍（payload）负责"要**存进库里**的那个对象长什么样" ——
 *        它跑的是同一批 schema 实例，但返回的是**归一化之后**的值：
 *        房间号两端 trim 掉了、选填的种子格空串变成了 `undefined`。
 *    ⇒ 删掉第二遍的话，`payload` 就得从 `outer.data` 里手工拼一遍，
 *      而那种"手工拼一遍"正是下一处规则漂移的起点。
 *    ⚠️ 规则本身只有一份定义（外层那几格就是 `.shape.*` 交出来的同一个实例），
 *      所以这里的"跑两遍"是**幂等**的，不是重复实现。
 */
/**
 * 一次发布的展示时长 —— **带着单位**（room 是分钟、seed 是天）。
 *
 * ⚠️★ 为什么返回值不能只是"一个毫秒数"：审计那一句要写「展示 30 天」还是
 *    「展示 15 分钟」，而同一个数字在两种单位下差 1440 倍。只回毫秒的话，
 *    路由层得拿 `kind` 再反推一次单位 —— 那就是**第二处**知道"哪个 kind 用哪个
 *    单位"的地方，而它和这里迟早会漂移（加第三个 kind 时必然漏一处）。
 */
export type ShareDuration =
  | { unit: 'minutes'; value: ShareMinutes }
  | { unit: 'days'; value: number };

/**
 * 时长 → 毫秒（`expires_at = now + durationToMs(duration)`）。
 *
 * ⚠️ 它是"一分钟 / 一天各多少毫秒"的**唯一**一处实现：数据层的 `createShare`
 *    只收毫秒（它不需要知道单位），所以这里是唯一能把单位与库里那一列对上的地方。
 *    别在路由层再写一遍这段换算。
 */
export function durationToMs(duration: ShareDuration): number {
  return duration.unit === 'minutes' ? duration.value * 60_000 : duration.value * SHARE_DAY_MS;
}

export function parseSharePost(
  kind: ShareKind,
  body: unknown,
):
  | { ok: true; payload: SharePayload; note: string; duration: ShareDuration }
  | { ok: false; error: z.ZodError } {
  const outer = sharePostSchema(kind).safeParse(body);
  if (!outer.success) return { ok: false, error: outer.error };

  const raw =
    kind === 'room'
      ? { code: (outer.data as { code: string }).code }
      : {
          overworld: (outer.data as { overworld: string }).overworld,
          nether: (outer.data as { nether?: string }).nether,
          end: (outer.data as { end?: string }).end,
          rng: (outer.data as { rng?: string }).rng,
        };

  const inner =
    kind === 'room' ? RoomPayloadSchema.safeParse(raw) : SeedPayloadSchema.safeParse(raw);
  if (!inner.success) return { ok: false, error: inner.error };

  return {
    ok: true,
    payload: inner.data,
    /*
     * ⚠️★ 下面两处**必须**和上面那几处一样写显式类型断言 —— 因为 `sharePostSchema`
     *    的返回类型是 `z.ZodType`（见它自己的注释：两个 schema 形状不同，联合的
     *    `.safeParse` 产出不可用），而 `z.ZodType` 的 `data` 就是 `unknown`。
     *    ⇒ 判据：`outer.data` 的每一格都要**显式**写出它期望的形状，
     *      改了 `sharePostSchema` 的返回类型就回来把这一整段重读一遍。
     */
    note: (outer.data as { note: string }).note,
    /*
     * ⚠️ 单位由 **kind** 决定，所以这里**分叉**，而不是"哪个键有就用哪个"：
     *    room 的 body 里根本没有 `days`、seed 的没有 `minutes`（`.strict()` 会让多传的
     *    那个键当场报错）⇒ 写成"有哪个用哪个"的话，一次 kind 笔误会变成一条
     *    `value: undefined` 的时长，而它算出来的 `expires_at` 是 NaN。
     */
    duration:
      kind === 'room'
        ? { unit: 'minutes', value: (outer.data as { minutes: number }).minutes as ShareMinutes }
        : { unit: 'days', value: (outer.data as { days: number }).days },
  };
}

/** 下架 / 恢复的 body。 */
export const ShareVisibilitySchema = z.object({ visible: z.boolean() }).strict();
export type ShareVisibilityInput = z.infer<typeof ShareVisibilitySchema>;

// ---------------------------------------------------------------------------
// 对外形状（接口响应与前端共用）
// ---------------------------------------------------------------------------

export type ShareStatus = 'active' | 'hidden' | 'replaced';

/** 看板上 / 「我的那些」里的一条（**不含 user_id** —— 前端不需要它，`mine` 已经回答了"是不是我的"）。 */
export interface LiveShare {
  id: string;
  kind: ShareKind;
  payload: SharePayload;
  /** ⚠️ 空串 = 没写说明（选填）。前端据此决定那一行渲不渲染。 */
  note: string;
  /** 发布者的显示名。 */
  authorName: string;
  createdAt: number;
  expiresAt: number;
  status: ShareStatus;
  /** 是不是当前这个请求的人发的。 */
  mine: boolean;
}

export interface ShareListResponse {
  kind: ShareKind;
  items: LiveShare[];
  /** 我自己所有**未过期**的行（含已下架的）。 */
  mine: LiveShare[];
  limit: number;
  /** 额度用量 = 我自己的行里满足 `status='active' AND expires_at > now` 的条数。 */
  liveCount: number;
  /** ★ 客户端用它算偏移量 —— 剩余时间必须按服务端时间算。 */
  serverNow: number;
  /** 看板被 200 行上限截断时为 true。 */
  truncated: boolean;
}

export interface ShareSummary {
  room: { live: number; limit: number };
  seed: { live: number; limit: number };
  serverNow: number;
}

/** 看板一次最多回多少行（保险，不是功能）。 */
export const SHARE_BOARD_LIMIT = 200;

/** 回收：过期这么久的行被物理删除。 */
export const SHARE_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * kind → 界面上那个标签页的词条 key。
 * ⚠️ 用**穷尽 `Record`** 而不是三元链：加第三个 kind 时会**编译报错**，
 *    逼着人来补一行（三元链的兜底分支天然"合法"，会把新 kind 显示成错误的那个名字）。
 */
export const SHARE_KIND_LABEL_KEYS: Record<ShareKind, string> = {
  room: 'shares.tabRoom',
  seed: 'shares.tabSeed',
};
