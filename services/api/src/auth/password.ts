/**
 * 密码哈希。
 *
 * ---------------------------------------------------------------------------
 * 为什么是 scrypt，而不是计划里写的 argon2id
 * ---------------------------------------------------------------------------
 * docs/v1-plan.md §10 的清单写的是 "密码 argon2id + 每个用户独立 salt"。
 * 实现时发现 argon2id 和**已经定下的部署模型**直接冲突：
 *
 *   argon2 在 Node 上没有内置实现，要装 `argon2` 或 `@node-rs/argon2`，
 *   两者都是原生模块（.node 二进制）。而本项目的部署模型是
 *   **esbuild 打包成单个 server.js、不传 node_modules**
 *   （见 db/index.ts 里同一个理由把 better-sqlite3 换成了 node:sqlite）。
 *   esbuild 无法把一个 .node 二进制内联进 JS bundle。
 *
 * 所以这里用 Node 内置的 `crypto.scrypt`。
 *
 * 这是**取舍，不是等价替换**，把话说清楚：
 *   · argon2id 是当前的第一推荐（抗 GPU、抗侧信道都比 scrypt 好）
 *   · scrypt 是 OWASP 明确列出的可接受选项，排在 argon2id 之后、bcrypt 之前
 *   · 换来的是：零依赖、无原生插件、单文件打包、不会因为平台/Node 版本
 *     对不上而装不上
 *
 * 对"1 核小机器 + 社区站点"这个场景，这个取舍是划算的。
 * 如果哪天部署模型变了（比如允许传 node_modules），换回 argon2id 只需要改这个文件。
 *
 * ---------------------------------------------------------------------------
 * 参数是怎么定的（实测，不是抄的）
 * ---------------------------------------------------------------------------
 * scrypt 的开销是 `128 · N · r` 字节内存 + 与 N·r·p 成正比的 CPU。
 *
 * 本机实测（i5-1135G7）：
 *   N=2^14  16MB   56ms      N=2^16, p=2  64MB   403ms
 *   N=2^15  32MB  117ms      N=2^17       128MB  483ms
 *
 * 选了 **N=2^16, r=8, p=2** —— 正是 OWASP 推荐的强度之一
 * （它列的几组等价配置 2^17/1、2^16/2、2^15/3、2^14/5 的工作量都约等于 2^20）。
 * 选 2^16 而不是 2^17 是因为**内存**：2^17 每次要 128MB。
 *
 * 然后实测了并发下的真实内存上限（.cache/scryptconc.mjs）：
 * 同时发起 16 次哈希，RSS 峰值只涨 **258 MB**，也就是 4 × 64MB ——
 * 因为 node:crypto 的异步 scrypt 跑在 libuv 线程池上，而**线程池默认上限是 4**。
 * 结论：无论收到多少并发登录，内存都有 256 MB 的硬上界，
 * 不会把 1.9 GB 的机器打到 swap。这个是实测出来的，不是推断的。
 *
 * ---------------------------------------------------------------------------
 * 存储格式
 * ---------------------------------------------------------------------------
 * 一行字符串，字段用 `$` 分隔，第一个字段是算法标识：
 *
 *     scrypt$N$r$p$<salt-base64url>$<hash-base64url>
 *
 * 参数写进哈希里是必须的：以后调参数时，**老密码仍能用老参数验证**，
 * 不需要强制所有人改密码，也不需要额外一列。
 * 验证成功后如果发现参数过时，可以顺手用新参数重新哈希（迁移式升级）。
 */
import { randomBytes, type ScryptOptions, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * ⚠️ 必须显式标注类型，不能只写 `promisify(scrypt)`。
 *
 * `promisify` 的类型定义只认最后一个重载（3 个参数、不带 options），
 * 于是要么报 "Expected 3 arguments, but got 4"，要么把 options 悄悄丢掉。
 * 丢掉 options 的后果特别隐蔽：maxmem 没传，N=2^16 需要 64MB 而 Node 默认只给 32MB，
 * 运行时直接抛 ERR_CRYPTO_INVALID_SCRYPT_PARAMS —— 而类型检查是过的。
 */
const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * 生产参数。**不要为了让测试跑得快而改这里。**
 *
 * 有一条测试专门钉住它的值（防回退）：把 N 从 2^16 降到 2^14
 * 能让整套测试快 4 倍，看起来像"优化"，实际是把密码强度砍掉四分之三。
 */
export const PASSWORD_PARAMS = { N: 2 ** 16, r: 8, p: 2 } as const;

type ScryptParams = { N: number; r: number; p: number };

/**
 * 实际使用的参数。
 *
 * 为什么需要这样一个函数：一整套认证测试要跑几十次注册和登录，
 * 每次都真花 400ms，整个测试套件要 70 秒 —— 长到会让人不想跑测试。
 *
 * ⚠️ 这个降级**只在 NODE_ENV === 'test' 时生效**，而且：
 *   · 只能调**低**不能调高（下面有显式判断）
 *   · 格式不对就静默退回生产参数
 *   · 有一条测试直接验证"NODE_ENV=production 时它一定被忽略" ——
 *     一个只在测试里打开的开关，必须有测试证明它在生产里打不开
 *
 * 之所以敢做这件事：哈希的**算法路径**（格式解析、salt 生成、timingSafeEqual 比较、
 * 格式损坏时的处理）与强度无关，那些才是测试真正要覆盖的。
 * 强度本身由上面那个常量钉住，不靠"跑得慢"来证明。
 */
export function activeParams(): ScryptParams {
  if (process.env.NODE_ENV !== 'test') return PASSWORD_PARAMS;

  const raw = process.env.MCSR_SCRYPT_TEST_PARAMS;
  if (!raw) return PASSWORD_PARAMS;

  const match = /^N=(\d+),r=(\d+),p=(\d+)$/.exec(raw);
  if (!match) return PASSWORD_PARAMS;

  const N = Number(match[1]);
  const r = Number(match[2]);
  const p = Number(match[3]);
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p)) {
    return PASSWORD_PARAMS;
  }
  // 只能更低。写反了会变成"测试环境比生产更强"，那种 bug 没人会发现。
  if (N > PASSWORD_PARAMS.N || r > PASSWORD_PARAMS.r || p > PASSWORD_PARAMS.p) {
    return PASSWORD_PARAMS;
  }
  return { N, r, p };
}

const KEY_LEN = 32;
const SALT_LEN = 16;

/**
 * Node 默认只允许 scrypt 使用 32MB 内存，超过就直接抛
 * ERR_CRYPTO_INVALID_SCRYPT_PARAMS —— 它**不会**自动放宽。
 * 生产参数 N=2^16/r=8 需要 64MB，所以必须显式给 maxmem。
 * 乘 2 是留余量（实现内部还有少量额外分配）。
 */
function maxmemFor(params: ScryptParams): number {
  return 128 * params.N * params.r * 2;
}

const ALGO = 'scrypt';

function toBase64Url(buf: Buffer): string {
  return buf.toString('base64url');
}

/**
 * 生成密码哈希。**每次调用都用新的随机 salt**，同一个密码两次结果不同。
 */
export async function hashPassword(password: string): Promise<string> {
  const params = activeParams();
  const salt = randomBytes(SALT_LEN);
  const derived = await scryptAsync(password.normalize('NFKC'), salt, KEY_LEN, {
    ...params,
    maxmem: maxmemFor(params),
  });

  return [ALGO, params.N, params.r, params.p, toBase64Url(salt), toBase64Url(derived)].join('$');
}

/**
 * 校验密码。
 *
 * 三个必须做对的地方：
 *
 * 1. **用 timingSafeEqual 比较，不用 `===`。**
 *    字符串比较会在第一个不同的字节处提前返回，理论上能被计时侧信道利用。
 *    实际可利用性在我们这个场景很低，但 timingSafeEqual 是零成本的正确做法。
 *
 * 2. **长度不等时不能直接比较** —— timingSafeEqual 对长度不同的输入会**抛异常**，
 *    而不是返回 false。所以先比长度。（这本身会泄漏长度，但哈希长度是固定的，
 *    不泄漏任何秘密。）
 *
 * 3. **存储格式解析失败时返回 false，不抛异常。**
 *    数据库里可能有历史遗留的、格式不对的行；这不该让登录接口 500。
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6) return false;

  // 长度已经确认过是 6，所以这里的解构不会拿到 undefined。
  // TS 在 noUncheckedIndexedAccess 下仍认为元素可能是 undefined，
  // 用一个显式元组断言把"上面那行检查"传达给它 ——
  // 比在下面每一处都写 `?? ''` 更能表达真实意图。
  const [algo, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (algo !== ALGO) return false;

  const N = Number.parseInt(nRaw, 10);
  const r = Number.parseInt(rRaw, 10);
  const p = Number.parseInt(pRaw, 10);
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p)) {
    return false;
  }
  // 防拒绝服务：数据库里的参数是可信的，但一旦被改成一个天文数字，
  // 一次登录就能吃掉几 GB 内存。加个上限比事后排查划算。
  if (N > 2 ** 20 || r > 32 || p > 16) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltRaw, 'base64url');
    expected = Buffer.from(hashRaw, 'base64url');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const derived = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
    N,
    r,
    p,
    maxmem: 128 * N * r * 2,
  });

  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * 哈希参数是否已经过时（需要在该用户下次成功登录时静默升级）。
 *
 * 有了这个，将来把 N 调大时**不需要**强制所有人改密码：
 * 用户在正常登录中不知不觉就被升级了。
 * 代价是要多一次哈希 —— 所以只在真有必要时才做（见下面 shouldRehash）。
 */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6) return true;
  const [algo, nRaw, rRaw, pRaw] = parts as [string, string, string, string];
  const params = activeParams();
  return (
    algo !== ALGO ||
    Number.parseInt(nRaw, 10) !== params.N ||
    Number.parseInt(rRaw, 10) !== params.r ||
    Number.parseInt(pRaw, 10) !== params.p
  );
}

/** 导出给测试用，避免测试里硬编码一遍参数。 */
