/**
 * 三个平台的**时长解析** + 标签推导 —— 纯函数，一行 I/O 都没有。
 *
 * ===========================================================================
 * 为什么这三个东西值得单独一个文件、单独的测试
 * ===========================================================================
 * 三家给的是同一样东西（一支视频有多长），形状却毫无共同点：
 *   · bilibili  `length`      `"01:51"`（`MM:SS`）或 `"1:02:33"`（`HH:MM:SS`）
 *   · Twitch    `duration`    `"1h2m3s"`（**不是秒数**，spec §2.3）
 *   · YouTube   `contentDetails.duration`  `"PT1H2M3S"`（ISO 8601）
 *
 * 而这三者解析错了**都不会抛异常**：入库的只是另一个数字，界面上那一格照显示，
 * `short` / `long` 标签照打 —— 只是全错，而且没有任何下游步骤会回头核对它
 * （spec §5.6 原话："它们错了不会抛异常"）。⇒ 这一层是这个功能里**唯一没有下游检查**
 * 的地方，所以它被单独拆出来，好让测试逐值钉住。
 *
 * ===========================================================================
 * ★ 为什么不合成一个函数（两个先例已经写过这条理由，这里是第三次）
 * ===========================================================================
 * 本仓已经有两份"冒号分段时间码"解析：`parseTimecode`（`packages/shared/src/videos.ts:66`，
 * 用户填的起播偏移）与 `parseCompletionInput`（`packages/shared/src/seedPicker.ts:582`，
 * 种子页的完赛时间）。两处都写着同一条纪律 —— `videos.ts:76`：
 * 「冒号后面的段必须是 0–59，否则 `1:99` 会被静默当成 159 秒」；
 * `seedPicker.ts:556-580` 那段注释把"这份重复是**刻意的**、以及它的代价"写得很清楚。
 *
 * 这里是第三次刻意不合并，理由比前两次更硬：
 *   · **"段"的含义不同**：那两个是"分:秒 → 秒/毫秒"，这里还有一个根本没有冒号的
 *     `1h2m3s`，以及一个"T **之前**的 M 是月、T 之后的 M 才是分钟"的 ISO 形式；
 *   · **段数不同**：bilibili 两段或三段、Twitch 三段固定顺序可缺、ISO 有天段；
 *   · **失败方式不同**：`1:99` 是"该进位没进位"、`P1M` 是"单位读错"、
 *     `1d2h` 是"格式不在文档里"。合成一个函数就是让一个函数同时记住三套规则，
 *     而某个分支写错时红的会是**共用**的那个测试文件。
 *
 * ⚠️ 代价（明知而认下）："冒号后面的段 ≤ 59"这条规则现在住在**三**个地方
 *    （`videos.ts:77`、`seedPicker.ts:596`、本文件），改一处必须同时改另外两处。
 *    不搬进 shared 的理由也很具体：`parseTimecode` 在 shared 是因为**浏览器里的表单**
 *    要用它，而这三个解析器只有服务端那三个适配器用（spec §5.6 把位置写死成
 *    「能被 `services/api` 测试跑到的位置」），搬过去只是把它们塞进前端的包里。
 *
 * ===========================================================================
 * ★ 裁决：`MM:SS` 里的 MM 可以超过 59（只有冒号**后面**的段受 0–59 约束）
 * ===========================================================================
 * 两个先例的规则都只约束"冒号后面的段"，不是"任何一段"：
 *   · `parseTimecode` 的循环是 `for (let i = 1; …)`（`videos.ts:77`）⇒ 首段不受约束，
 *     `90` 与 `90:00` 都合法；
 *   · `parseCompletionInput` 给"分"的上限是**四位**（`seedPicker.ts:591`），
 *     `1441:00` 是它算得出来的值 —— 之后拒掉它的是那个 24 小时上限，
 *     **不是** 59 那条规则。
 * ⇒ 这里照抄同一读法：`99:00` = 5940、`100:00:00` = 360000 都**接受**；
 *    `1:99` / `1:99:00` / `12:99` 一律**拒绝**（这三条是纪律本身）。
 *
 * ⚠️ 被否掉的另一种读法（"任何一段都必须 ≤ 59"）：它对三段式立刻自相矛盾 ——
 *    `HH:MM:SS` 里的 HH 本来就该能超过 59（100 小时的直播回放），于是它只能退化成
 *    "两段式的**分**受约束、三段式的**时**不受" —— 同一个数字，段数不同就换一套规则，
 *    下一个读代码的人记不住，而记不住的那天不会有任何报错。
 * ⚠️ 认下的代价：真出现 `99:00` 这种非规范输出（bilibili 对 99 分钟的视频写的是
 *    `1:39:00`），我们读成 99 分钟 —— 那是**这个格式的字面意思**，不是猜的；
 *    反过来"一律拒绝"的代价是把一个真实的时长变成 `null` ⇒ 按 spec §4.3 会少一个
 *    `long` 标签。两种代价都比"把 `1:99` 静默算成 159 秒"轻。
 *    这条裁决钉在 `tracking-parse.test.ts` 里那两条断言上（`'99:00'` / `'100:00:00'`），
 *    所以改主意是一件会红的事，而不是一次静默的偏移。
 *
 * ===========================================================================
 * ★ 为什么 `deriveTags` 也在这个文件里
 * ===========================================================================
 * 标签判据是**跨平台同一条**（spec §4.3：`≤60` / `≥1200`），三个适配器必须得到同样的结果。
 * 写在适配器里就是三份同样的规则，而它们**不会一起坏** —— 那种"只错一个平台"的坏法
 * 在界面上看不出来：同一份列表里一半视频带 `short`、另一半不带。
 *
 * ===========================================================================
 * `null` 的含义：**没量到**，不是 0
 * ===========================================================================
 * 非法或缺失一律返回 `null` —— 一律不返回 `0`、也不返回 `NaN`。`NaN` 要单独点名：
 * 它能静默通过所有比较，落进 `duration_sec` 那一列之后看起来像"没有值"，
 * 而 `NULL` 与 `NaN` 在 SQL 里是两件不同的事。
 *
 * ⚠️ 反过来，**能解析出 0 就要给 0**：`0:00` / `0s` / `PT0S` 都解析成 `0`。
 *    0 是这些格式**如实**表达的值，把它并进 `null` 是替上游做判断；
 *    调用方要按 spec §4.3 拿到真实值再决定打不打标签（0 ⇒ `short`）。
 *    这条与本仓"拿不到的字段一律 NULL，绝不许填 0"是同一条纪律的两面
 *    （`packages/shared/src/tracking.ts:38-47`）。
 * ⇒ 三个适配器拿到的就是 `number | null`，直接入库，**不要**再退化：
 *   `duration_sec = NULL` ⇒ spec §4.3 明说一个时长标签都不打。
 */

// ---------------------------------------------------------------------------
// 常量与形状（照两个先例的排法放在函数之前：先看见规则，再看见用它的人）
// ---------------------------------------------------------------------------

/**
 * 一个数字段最多几位。**理智边界**，不是业务规则。
 *
 * 照抄 `parseTimecode`（`videos.ts:73`）的四位。为什么需要一条上限：`\d+` 配 `Number()`
 * 在 16 位以上会**静默失真**（`Number('99999999999999999999')` 给的是 `1e20`），
 * 而那正是本文件最想避免的"看起来正常的错数"。四位也顺手挡掉了 `'99999:00'` 这种
 * 一眼是脏数据的输入；代价是时长超过 9999 小时的值会被判成 `null`（现实中不存在）。
 */
const MAX_SEGMENT_DIGITS = 4;

/**
 * 一个"段"的正则片段：**捕获**的 1–4 位半角数字（`\d` 不匹配全角 `１`，这是想要的）。
 *
 * ⚠️ 取值用的那对圆括号在**这里**，不在各条正则里 —— 各条正则外面那层 `(?:…)` 只负责
 * "这一段可有可无"。两者写反（`DIGITS` 里没有捕获括号、取值时却按分组号去读）的后果
 * 不是报错：分组全是 `undefined` ⇒ "至少一段命中"那条检查对**所有输入**都返回 null，
 * 也就是说本文件初版的 `parseTwitchDuration` / `parseYouTubeDuration` 是"永远给 null"的，
 * 而它们照样能通过类型检查与 lint。抓住它的是 `tracking-parse.test.ts` 里 ★ 那两条
 * （`'1h2m3s'` → 3723、`'PT1H2M3S'` → 3723）—— 这就是"逐值断言"存在的全部理由。
 *
 * ⚠️ 三个正则都由它拼出来（`new RegExp`），而不是各写一遍 `\d{1,4}` 字面量：
 * 写成三份字面量就等于把同一个边界抄了三遍，而改其中一处不会有任何东西报错。
 * 代价是少掉了编辑器对正则字面量的高亮 —— 换的是一处改、三处生效。
 */
const DIGITS = `(\\d{1,${MAX_SEGMENT_DIGITS}})`;

/** 单独一个段（bilibili 是**按段**校验的，所以它自己要一个正则；那个分组在 `test()` 里用不上）。 */
const SEGMENT = new RegExp(`^${DIGITS}$`);
/** Twitch：`1h2m3s` —— 三段各自可选、顺序固定；分组 1/2/3 = 时/分/秒。 */
const TWITCH_DURATION = new RegExp(`^(?:${DIGITS}h)?(?:${DIGITS}m)?(?:${DIGITS}s)?$`);
/** YouTube：ISO 8601 的 `P[nD]T[nH][nM][nS]`；分组 1/2/3/4 = 天/时/分/秒。 */
const ISO_DURATION = new RegExp(
  `^P(?:${DIGITS}D)?(?:T(?:${DIGITS}H)?(?:${DIGITS}M)?(?:${DIGITS}S)?)?$`,
);

/** `short` 的上界（含）。spec §4.3 逐字：`duration_sec <= 60`。 */
const SHORT_MAX_SEC = 60;
/** `long` 的下界（含）。spec §4.3 逐字：`duration_sec >= 1200`。 */
const LONG_MIN_SEC = 1200;

export function parseBilibiliLength(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(':');
  // 只认两种形状，两段或三段。⚠️ 一段（`'90'`）**不收**：bilibili 从不这么写，
  // 而"90 是 90 秒还是 90 分"在这个字段里没有答案 —— 猜一个正是本文件要防的事。
  // （`parseTimecode` 收它是另一回事：那是给人填的输入框，`90` 有明确含义。）
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (parts.some((part) => !SEGMENT.test(part))) return null;

  // ★ 冒号**后面**的每一段都必须在 0–59 —— 与 `videos.ts:76` 是同一条纪律：
  // `'1:99'` 若被静默算成 159 秒，界面上只是多显示一个"看起来正常"的时长，
  // 谁也不会发现。首段不受这条约束（裁决见文件头）。
  for (const part of parts.slice(1)) {
    if (Number(part) > 59) return null;
  }

  // 从右往左补位：最后一段是秒、倒数第二段是分、最前面是时。
  // 这么写而不是解构，理由照抄 `videos.ts:81-84`：tsconfig 开了 noUncheckedIndexedAccess，
  // `parts[i]` 的类型是 `string | undefined` —— 它是对的，数组长度只有运行时才知道；
  // 上面那两条检查已经排除掉了它真是 undefined 的可能。
  const sec = Number(parts[parts.length - 1] ?? '0');
  const min = Number(parts[parts.length - 2] ?? '0');
  const hour = parts.length === 3 ? Number(parts[0] ?? '0') : 0;

  return hour * 3600 + min * 60 + sec;
}

/**
 * Twitch 的 `duration` → 秒。形状见 spec §2.3：`"1h2m3s"`，**不是秒数**。
 *
 * 三段各自可选、顺序固定是 h → m → s。`'1m2h'` 必须拒：那是格式坏了，
 * 不是"顺序无所谓" —— 靠"见过 h 没有"去修正顺序的写法，遇到真坏掉的输入
 * 会算出一个没人要过的数。
 *
 * ⚠️ 不接受 `d`（天）：文档写的形状只有 h/m/s，这里窄读文档。
 *    代价写清楚：真出现 24 小时以上的 VOD 时这一格是 `null`（**丢掉**一个时长），
 *    而不是一个猜出来的数 —— `NULL` 是允许的状态，spec §4.3 因此不打时长标签。
 */
export function parseTwitchDuration(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();

  const m = TWITCH_DURATION.exec(trimmed);
  // ⚠️ 三段全是可选的 ⇒ 这个正则**能匹配空串**（`''` / `'   '` 在 trim 之后就是它）。
  //    "至少一段命中"于是不是可选的：它是这个正则唯一缺的那半条规则。
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return null;

  const hours = m[1] === undefined ? 0 : Number(m[1]);
  const minutes = m[2] === undefined ? 0 : Number(m[2]);
  const seconds = m[3] === undefined ? 0 : Number(m[3]);
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * YouTube 的 `contentDetails.duration` → 秒。ISO 8601 的 `P[nD]T[nH][nM][nS]`。
 *
 * ★ `P1DT2H`（一天两小时）是**合法**的，必须解析成 93600：ISO 8601 允许 D 段，
 *   而"只处理 `PT…`"的写法会把它整条丢掉（丢掉的是时长，不是报错）。
 *   `P1D`（没有 T 段）同样合法。
 *
 * ⚠️ `T` **之前**的 `M` 是**月**、`Y` 是年、`W` 是周 —— 三者都没有固定秒数，
 *    所以一律拒绝，**不许折算**。这一处是三个解析器里最容易写错的：
 *    `'P1M'` 读起来"显然"是一分钟，而它实际是"一个月"；
 *    折算出来的数（30 天？31 天？）看起来完全正常，这才是要命的地方。
 *    一分钟是 `PT1M`。
 * ⚠️ 写在 `T` 段外面的 H/M/S（`'P1D2H'`）与空 T 段（`'PT'` / `'P1DT'`）也要拒：
 *    ISO 8601 不认这两种写法，而它们都是"少写了一段"的典型手滑。
 */
export function parseYouTubeDuration(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();

  const m = ISO_DURATION.exec(trimmed);
  if (!m) return null;
  const [, d, h, min, s] = m;

  // ⚠️ T 段里的三段也都是可选的 ⇒ `'PT'` / `'P1DT'` 会被上面那个正则匹配上。
  //    空的 T 段不是合法时长，这里拒掉。
  if (trimmed.includes('T') && h === undefined && min === undefined && s === undefined) return null;
  // 同理，`'P'` 自己也能被匹配上（两组都可选）—— "至少要有一段"这条规则进不了正则，
  // 只能在这里说。少了它，`'P'` 会被算成 0 秒，而 0 是一个**看起来正常**的测量值。
  if (d === undefined && h === undefined && min === undefined && s === undefined) return null;

  const days = d === undefined ? 0 : Number(d);
  const hours = h === undefined ? 0 : Number(h);
  const minutes = min === undefined ? 0 : Number(min);
  const seconds = s === undefined ? 0 : Number(s);
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

/**
 * 由数据判定标签（spec §4.3 的三条判据，v1 的词表**只有**这三个）。
 *
 * 顺序是**契约**：`liveReplay` 恒在时长标签之前。库里的 `tags` 是 JSON **文本**，
 * 顺序不稳的话同一支视频会存出两种字符串（`["short","liveReplay"]` 与反过来），
 * 之后任何按文本比较或去重的地方都会把它们当成两个不同的东西。
 */
export function deriveTags(input: { durationSec: number | null; isLiveReplay: boolean }): string[] {
  const tags: string[] = [];
  if (input.isLiveReplay) tags.push('liveReplay');

  const sec = input.durationSec;
  // ★ `null` ⇒ 直接返回，**一个时长标签都不打**（spec §4.3："打一个猜的标签比不打更坏"）。
  //   把它当 0 的话，每一支时长未知的视频都会拿到 `short`，而那条错标签
  //   **看起来完全正常**（存进去就是一个 `["short"]`，没有任何异常可抓）。
  // ⚠️ `undefined` 不需要单独写一行：它两个比较都为 false，结果同样是"不打时长标签"，
  //    也就是这条规则想要的结局（类型上它不该出现，`string | null` 才是契约）。
  if (sec === null) return tags;

  // 两档互斥（`≤60` 与 `≥1200` 不可能同时成立），写成 else-if 是为了把互斥写进代码：
  // 中间档（61…1199）**故意一个标签都不打** —— v1 的词表只有这三个（spec §10）。
  if (sec <= SHORT_MAX_SEC) tags.push('short');
  else if (sec >= LONG_MIN_SEC) tags.push('long');

  return tags;
}
