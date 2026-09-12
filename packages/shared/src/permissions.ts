/**
 * 身份组与权限矩阵 —— **前后端共用同一份定义**。
 *
 * ---------------------------------------------------------------------------
 * 为什么要有这个文件（而不是在每个路由里写 requireRole('reviewer','admin')）
 * ---------------------------------------------------------------------------
 * 之前角色的定义散在四个地方：数据库的 CHECK 约束、shared 里的 Zod 枚举、
 * constants.ts 的 USER_ROLES、以及路由里各写一遍的 requireRole 参数。
 * 四处各写一遍的必然结果是**漂移**：加了新角色而漏改其中一处，
 * 或者某条路由的角色列表和别处不一致 —— 而后者就是一条权限漏洞。
 *
 * 现在只有这里定义"谁能在什么上做什么"。服务端用它来拦截，
 * **前端也用它来决定按钮显不显示** —— 这是关键：
 * 两边读同一份数据，就不可能出现"界面上有按钮、点下去 403"，
 * 或者更糟的"界面上没按钮、但接口其实是敞开的"。
 *
 * ---------------------------------------------------------------------------
 * 为什么能力名带着内容类型（resource.review、calendar.submit）
 * ---------------------------------------------------------------------------
 * §3 的三条设计约束之一是"权限只做**角色 × 资源类型**二维矩阵，不做 per-item ACL"。
 * 把类型写进能力名，这个二维关系就变成显式的了 ——
 * 以后要加一个"只能审种子的人"，加一个角色、在矩阵里给它 `seed.review`
 * 就够了，不需要改动任何路由代码。
 *
 * ⚠️ 但**加新角色需要一次数据库迁移**：users.role 上有
 *    `CHECK (role IN ('user','reviewer','admin'))`。而且那次迁移比看上去麻烦 ——
 *    SQLite 改 CHECK 必须重建表，而 DROP TABLE users 在
 *    `PRAGMA foreign_keys=ON` 时会连带触发 sessions / email_tokens 的
 *    ON DELETE CASCADE，把所有人的登录态删光。
 *    真要加角色时，迁移必须在关闭外键的窗口里做，见 004_auth.ts 的注释。
 *    在那之前，三个角色够用：类型维度已经由能力名表达了。
 */
import { z } from 'zod';
import { USER_ROLES, type UserRole } from './constants';

export type { UserRole };
export { USER_ROLES };

// ---------------------------------------------------------------------------
// 角色变更的入参
// ---------------------------------------------------------------------------

/**
 * 改别人的角色。
 *
 * ⚠️ `reason` 是**必填**的。
 *
 * 授予管理员权限是这个系统里权限最高的操作，没有之一 ——
 * 它能把一个普通账号变成能读全部审计、能改任何人角色的人。
 * 而 audit_log 里只记"谁在什么时候把谁改成了什么"的话，
 * 半年后回看会完全没有上下文：为什么要给他？
 *
 * 强制填一句话的成本很低，而它恰好是事后审计时最想知道的东西。
 * 相比之下"驳回必须给理由"那条约束更重要，但这条更少见 ——
 * 正因为少见，忘记记录的概率更高。
 */
export const RoleChangeInputSchema = z.object({
  role: z.enum(USER_ROLES),
  reason: z.string().trim().min(1, { message: '必须填写改角色的原因' }).max(300),
});
export type RoleChangeInput = z.infer<typeof RoleChangeInputSchema>;

// ---------------------------------------------------------------------------
// 能力
// ---------------------------------------------------------------------------

/**
 * 全部能力。命名规则：`<内容类型>.<动作>`。
 *
 * 用 `as const` 数组而不是 TS 联合类型，是为了让它在**运行时**也能枚举 ——
 * 测试要遍历它来检查矩阵的完整性，而不只是编译期有类型。
 */
export const CAPABILITIES = [
  // ---- 资源库 ----
  'resource.submit',
  'resource.editOwn',
  'resource.review',

  // ---- 日历（M4）----
  'calendar.submit',
  'calendar.review',

  // ---- 视频（M4，用户自贴链接）----
  'video.submit',

  // ---- 种子分享（M4）----
  'seed.submit',
  'seed.review',

  // ---- 账号与治理 ----
  /** 改别人的角色、封禁账号 */
  'user.moderate',
  /** 读审计日志 */
  'audit.read',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * 每个角色拥有的能力。
 *
 * ⚠️ 用**显式列举**而不是"reviewer 包含 user 的全部能力"这种继承写法。
 *    继承在只有三个角色时更省字，但读代码的人必须去追一层才知道
 *    reviewer 到底能不能提交日历 —— 而权限矩阵最需要的性质就是**一眼看完**。
 *    多打几个字换来的可读性，在安全相关的代码里是划算的。
 */
const USER_CAPS: readonly Capability[] = [
  'resource.submit',
  'resource.editOwn',
  'calendar.submit',
  'video.submit',
  'seed.submit',
];

const REVIEWER_CAPS: readonly Capability[] = [
  ...USER_CAPS,
  'resource.review',
  'calendar.review',
  'seed.review',
  'audit.read',
];

const MATRIX: Record<UserRole, readonly Capability[]> = {
  user: USER_CAPS,
  reviewer: REVIEWER_CAPS,
  // 管理员在上面全部能力之外，另外拥有账号治理权限。
  // 这里刻意把 REVIEWER 展开写进去，而不是写一个通配符 '*" ——
  // 通配符会让"新增一个能力"默认就对所有管理员开放，
  // 而那意味着每次加能力都要重新想一遍"该不该给管理员"。展开写，
  // 新增能力时会**编译报错**，逼你显式决定。
  admin: [...REVIEWER_CAPS, 'user.moderate'],
};

/**
 * 哪些能力要求邮箱已验证。
 *
 * 规则：**创造公开内容的能力要求验证；治理类的不要求。**
 *
 * 为什么 review 不要求：邮箱验证的目的是"证明你拥有一个可达的信箱、
 * 顺便让刷账号有成本"。而审核员的身份是管理员**已经核实过**才授予的 ——
 * 再要求一次邮箱验证不会增加任何保证，反而会在换邮箱、邮件投递出问题时
 * 把一个能干活的审核员挡在门外。
 *
 * 为什么 submit 要求：那是普通用户能触达的唯一入口，也是唯一需要设门槛的地方。
 * 注意这条门槛**只在提交处**，不在登录处 —— 邮件发不出去时，
 * 用户最坏是"能看不能发"，而不是被完全挡在门外（§0.1 的访问模型）。
 */
const REQUIRES_VERIFIED = new Set<Capability>([
  'resource.submit',
  'resource.editOwn',
  'calendar.submit',
  'video.submit',
  'seed.submit',
]);

// ---------------------------------------------------------------------------
// 判定
// ---------------------------------------------------------------------------

/** 被拒绝的原因。三种情况要给出**不同的响应**，所以必须能区分。 */
export type DenialReason = 'unauthenticated' | 'forbidden' | 'email_not_verified';

export type PermissionResult = { ok: true } | { ok: false; reason: DenialReason };

/** 访问者：未登录时传 null。 */
export interface Actor {
  role: UserRole;
  emailVerified: boolean;
}

/** 这个角色有没有这个能力（不看邮箱验证）。 */
export function roleHas(role: UserRole, capability: Capability): boolean {
  return MATRIX[role].includes(capability);
}

/** 判定能否执行。返回原因而不只是布尔，好让接口给出准确的错误码。 */
export function checkPermission(actor: Actor | null, capability: Capability): PermissionResult {
  if (!actor) return { ok: false, reason: 'unauthenticated' };
  if (!roleHas(actor.role, capability)) return { ok: false, reason: 'forbidden' };
  if (REQUIRES_VERIFIED.has(capability) && !actor.emailVerified) {
    return { ok: false, reason: 'email_not_verified' };
  }
  return { ok: true };
}

/** 便捷形式，给前端用：`can(user, 'resource.submit') ? <按钮/> : null`。 */
export function can(actor: Actor | null, capability: Capability): boolean {
  return checkPermission(actor, capability).ok;
}

/** 某个角色拥有的全部能力，按内容类型分好组 —— 账号页要展示"我能做什么"。 */
export function capabilitiesByType(role: UserRole): Record<string, Capability[]> {
  const out: Record<string, Capability[]> = {};
  for (const cap of MATRIX[role]) {
    const [type = 'other'] = cap.split('.');
    const bucket = out[type] ?? [];
    bucket.push(cap);
    out[type] = bucket;
  }
  return out;
}

/**
 * 可用角色列表。
 *
 * 排序是**从低到高**，不是按字母。界面上展示角色时（比如后台的角色选择器）
 * 顺序应该是"权限递增"，而不是 admin / reviewer / user 这种字母序 ——
 * 后者读起来像随机排列，让人要多想一步才能确定哪个权限大。
 */
export function assignableRoles(): readonly UserRole[] {
  return ['user', 'reviewer', 'admin'];
}
