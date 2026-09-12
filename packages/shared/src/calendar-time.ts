/**
 * 墙钟时间 ↔ UTC 换算（**服务端和前端共用**）。
 *
 * 放在 shared 而不是服务端，是因为两边都要用：
 *   · 服务端：写入时把 `starts_at_local` + `starts_at_tz` 算成 `starts_at_utc`
 *   · 前端：表单要**立刻**校验"时区名对不对""结束时间晚于开始时间"，
 *     不能等提交到服务端才发现 —— 那时用户已经填完整张表了
 *
 * ---------------------------------------------------------------------------
 * 为什么需要这个（Q2 的决定带来的）
 * ---------------------------------------------------------------------------
 * 用户要的是**存"当地时间 + 时区名"，显示时转本地**。
 * 于是数据库里存三段：`starts_at_local`（'2026-08-30T20:00'）、
 * `starts_at_tz`（'Asia/Shanghai'）、`starts_at_utc`（派生）。
 *
 * 第三段必须在**写入时**由前两段算出来，所以需要一个**不依赖任何库**的换算 ——
 * 这个项目全程零运行时依赖（`node:sqlite` 都是内置的），
 * 为了一个函数引入 date-fns-tz 不划算，而 `Intl` 已经把这件事做对了。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 这里在防的是什么
 * ---------------------------------------------------------------------------
 * "把本地时间当成 UTC" 是最常见的写法，也是最危险的：
 * 它**不会报错**，只会让每个事件偏移几个小时 —— 而偏移几个小时的赛事时间
 * 看起来完全正常（谁记得清那场比赛到底几点开的？）。
 * 唯一的防线是**测试里写死几个已知答案**
 * （见 services/api/src/calendar-time.test.ts）。
 *
 * ⚠️ 而且时区名必须真的存在。'Asia/Shangai'（少一个 h）不是合法时区，
 * 但它也没长成一眼假的错误 —— `Intl` 会抛 RangeError。我们把它转成 null，
 * 让调用方在 Zod 层给出"时区名无效"这种能看懂的话。
 */

/** 'YYYY-MM-DDTHH:mm'（可选带 :ss）。这就是 `starts_at_local` 的格式。 */
const WALL_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * 判断时区名是否合法（IANA 名，例如 'Asia/Shanghai' / 'UTC'）。
 *
 * 判据是 `Intl` 认不认它 —— 这是运行时里唯一权威的时区数据库。
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * 解析墙钟字符串。返回各字段的数字，或 null（格式不对）。
 *
 * ⚠️ 这里**不用 `new Date(local)`**。`Date` 对 'YYYY-MM-DDTHH:mm' 的解析
 * 在有无时区后缀时行为不同（前者按本地时区、后者按 UTC），
 * 而"按本地时区"意味着**同一份代码在开发机和生产服务器上得到不同结果** ——
 * 开发机在 UTC+8、服务器在 UTC，于是本地测试全绿、线上全错。
 * 手工拆字段就完全避开了这个类。
 */
function parseWallClock(local: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} | null {
  const m = WALL_CLOCK_RE.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h),
    minute: Number(mi),
    second: s ? Number(s) : 0,
  };
}

/**
 * 某个**绝对时刻**在指定时区的偏移量（毫秒，东为正）。
 *
 * 做法：把该时刻按目标时区"渲染"出来，再把渲染结果当成 UTC 读回去，两者之差就是偏移。
 * 这就是 `Intl` 给我们的能力 —— 它知道每个时区在每个历史时刻的真实偏移，
 * 包括夏令时的切换点。
 */
function offsetAt(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));

  const get = (type: string): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
  };

  // ⚠️ hour12:false 在某些实现下会把午夜给成 24 而不是 0，`% 24` 把两种都收进来
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );

  // formatToParts 只到秒，丢掉毫秒会让偏移带上抖动 —— 取整到秒
  return asIfUtc - (utcMs - (utcMs % 1000));
}

/**
 * 墙钟时间 + 时区 → UTC 毫秒。格式或时区非法时返回 null。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 为什么要算两遍
 * ---------------------------------------------------------------------------
 * 第一遍：先把墙钟当成 UTC，按这个（可能错的）时刻查偏移量。
 * 第二遍：用第一遍得到的候选时刻再查一次偏移量。
 *
 * 在夏令时切换的那一两个小时里，两次结果会不同 —— 因为"这个墙钟时刻"在
 * 切换前后对应的是两个不同的偏移。两遍之后收敛到的就是正确的那个。
 *
 * 只在切换窗口附近才需要第二遍，但它很便宜，无条件跑两遍比
 * "先判断是否在切换窗口"要少一整类边界 bug。
 */
export function wallClockToUtc(local: string, timeZone: string): number | null {
  const p = parseWallClock(local);
  if (!p) return null;
  if (!isValidTimeZone(timeZone)) return null;

  const naive = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);

  let utc = naive - offsetAt(naive, timeZone);
  utc = naive - offsetAt(utc, timeZone);
  return utc;
}

/**
 * UTC 毫秒 → 指定时区的墙钟字符串（'YYYY-MM-DDTHH:mm'）。
 *
 * 用在"审核界面把用户填的时间原样显示回来"这类地方 ——
 * 也就是说，它应该与用户当初填进去的字符串**逐字符相同**，
 * 否则用户会看到自己没填过的时间（见测试里的往返断言）。
 */
export function utcToWallClock(utcMs: number, timeZone: string): string | null {
  if (!isValidTimeZone(timeZone)) return null;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(utcMs));

  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';
  const hour = String(Number(get('hour')) % 24).padStart(2, '0');

  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}
