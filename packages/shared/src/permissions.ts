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
  /** 改**自己**提交的条目 */
  'resource.editOwn',
  /**
   * 改**任何人**已上架的条目（社区 wiki 式，改动一样走审核）。
   *
   * 和 editOwn 分成两个能力，虽然当前两个角色的矩阵里是一样的 ——
   * 分开是为了留一个**可以单独收回的开关**：哪天想关掉 wiki 行为，
   * 只要把 editAny 从 user 的能力里去掉，作者的 editOwn 不受影响。
   * 合成一个的话，"关掉"就意味着连作者都不能改自己的东西了。
   */
  'resource.editAny',
  /**
   * 改**别人还没上架**的条目（待审 / 被驳回的草稿）。
   *
   * ⚠️ 和 editAny 分开，是因为两者泄漏的东西不一样：
   *    editAny 动的是"已经在站上、所有人都看得见"的内容，
   *    而这个动的是"作者还没打算公开"的草稿。
   *    后者对编辑者开放是合理的（他能帮作者改好），
   *    但绝不该是所有登录用户的默认能力。
   */
  'resource.editUnpublished',
  'resource.review',
  /**
   * 决定一条内容**能不能被推荐**：设置/取消「精选」「官方」。
   *
   * schema 里 featured/official 的注释早就写着"这是编辑决定，
   * 不是作者填写的内容，用户可以自己标就失去意义了" ——
   * 但在这个能力出现之前，只有导入脚本能写它们，
   * 也就是说这个决定**没有一个真人能行使**。
   */
  'resource.feature',
  /**
   * 把已经上架的内容**下架**（以及恢复）。
   *
   * 注意它和 review 是两件事：审核决定"能不能上线"，
   * 下架决定"已经在线的要不要先撤下来"。后者是事后处置
   * （链接失效、站点跑路、内容不当），不能靠"驳回"来做 ——
   * 驳回是针对**待审版本**的，而线上那一版早就批准过了。
   */
  'resource.moderate',

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
  'resource.editAny',
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

/**
 * 内容编辑：审核员的全部能力，加上"内容以什么姿态出现在站上"的那几项。
 *
 * ---------------------------------------------------------------------------
 * 为什么它必须是一个**单独的角色**，而不是把这几项直接给 reviewer
 * ---------------------------------------------------------------------------
 * 审核和编辑是两种判断，而且它们的**扩张方向是相反的**：
 *
 *   · 审核是流水线劳动 —— 人越多越快越好，一个条目卡三天就是体验问题；
 *   · 精选是品味判断 —— 人越多越不一致。一个资源库的「精选」栏
 *     如果由五个人各自定义，那一栏就没有意义了。
 *
 * 把两者塞进同一个角色，等于默认"能审的人就能精选"。而你要的是
 * 审核员可以有很多、拿主意的人少而固定。
 *
 * ⚠️ editor **没有** user.moderate（改别人角色、封禁）。
 *    内容治理和账号治理是两条线：能撤下一篇内容的人，
 *    不应该顺带能封掉一个人。
 */
const EDITOR_CAPS: readonly Capability[] = [
  ...REVIEWER_CAPS,
  'resource.feature',
  'resource.moderate',
  'resource.editUnpublished',
];

const MATRIX: Record<UserRole, readonly Capability[]> = {
  user: USER_CAPS,
  reviewer: REVIEWER_CAPS,
  editor: EDITOR_CAPS,
  // 管理员在**编辑**的全部能力之外，另外拥有账号治理权限。
  // 这里刻意把 REVIEWER 展开写进去，而不是写一个通配符 '*" ——
  // 通配符会让"新增一个能力"默认就对所有管理员开放，
  // 而那意味着每次加能力都要重新想一遍"该不该给管理员"。展开写，
  // 新增能力时会**编译报错**，逼你显式决定。
  admin: [...EDITOR_CAPS, 'user.moderate'],

  /*
   * owner 的**能力**和管理员完全一样 —— 多出来的那一份是**等级**，不是能力。
   *
   * ⚠️ 这是一个刻意的设计选择：能力回答"你能不能调用这个接口"，
   *    而"你能动谁"是另一回事（谁能改管理员的角色、谁不能）。
   *    把后者也塞进能力矩阵的话，矩阵里就会出现 'user.moderateAdmin'
   *    这种"能力"—— 而它描述的其实是**对象**，不是动作。
   *    矩阵只有"角色 × 动作"两维，表达不了"对谁"。
   *
   *    所以等级规则单独写在 checkRoleChange 里，和矩阵放在同一个文件、
   *    同样有测试守着，但它是一个**函数**而不是矩阵的一行。
   */
  owner: [...EDITOR_CAPS, 'user.moderate'],
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
  'resource.editAny',
  // 改别人的草稿算"创造公开内容"（改完就要进审核队列），所以要求验证
  'resource.editUnpublished',
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
/**
 * 谁可以**批准自己提交/修改的内容**。
 *
 * ---------------------------------------------------------------------------
 * 这条规则为什么单独写出来，而不是塞进能力矩阵
 * ---------------------------------------------------------------------------
 * 能力矩阵回答的是"你能不能审核"（reviewer / editor / admin 都能）。
 * 而"能不能审自己那一条"取决于**被审的东西是谁提交的** ——
 * 那是矩阵表达不了的维度（矩阵里没有"对象"这一维）。
 *
 * 规则本身：
 *   · **reviewer 不行** —— 审核的全部意义是"有第二个人看过"。
 *     如果提改动的人自己就能批，那审核就退化成了一个人的两步操作，
 *     而外部完全看不出来（审计里只有两条记录，看不出是同一个人）。
 *   · **editor / admin 可以** —— 他们是站点的固定内容负责人，
 *     自己写、自己批是正常工作流；要求"第二个 editor"在只有一两个
 *     编辑者时会把事情卡死。
 *
 * ⚠️ 注意它只挡**批准**。驳回自己提交的东西是允许的（那等于撤回），
 *    而撤回不该需要别人的许可 —— 见 routes/review.ts 里的用法。
 */
/**
 * 角色 → 界面词条 key。
 *
 * ⚠️ **不要再用三元链（`role === 'admin' ? ... : role === 'reviewer' ? ... : ...`）**。
 *    Account 页原先就是这么写的，于是加了 `editor` 之后它一路掉到最后的
 *    兜底分支 —— 内容编辑在自己的账号页上显示成「普通用户」，
 *    而且**不会有任何报错**：三元链的兜底天然是"合法"的。
 *
 *    写成穷尽的 Record<UserRole, string> 之后，再加角色就会**编译报错**，
 *    逼着人来这里补一行。
 */
export const ROLE_LABEL_KEYS: Record<UserRole, string> = {
  user: 'auth.roleUser',
  reviewer: 'auth.roleReviewer',
  editor: 'auth.roleEditor',
  admin: 'auth.roleAdmin',
  owner: 'auth.roleOwner',
};

export function canSelfReview(role: UserRole): boolean {
  return role === 'editor' || role === 'admin' || role === 'owner';
}

/** 改角色被拒绝的原因。每一种在界面上对应一句不同的话。 */
export type RoleChangeDenial =
  | 'admin_self'
  | 'admin_promote'
  | 'admin_peer'
  | 'owner_immutable'
  | 'forbidden';

/**
 * 谁能把谁改成什么 —— **管理员等级规则的唯一一份定义**。
 *
 * 服务端用它拦请求，界面用它决定下拉框禁不禁用。写成共享函数而不是
 * 两边各写一遍，是因为这类"谁管谁"的规则最容易两边不一致：
 * 界面放行、服务端拒绝（用户白填一遍），或者更糟 ——
 * 界面禁用了、服务端其实没拦（那就是一条越权通道）。
 *
 * ---------------------------------------------------------------------------
 * 规则（按优先级）
 * ---------------------------------------------------------------------------
 *   1. **涉及 owner 的一律不许动** —— 任何人（包括 owner 自己）都不能
 *      把别人改成 owner，也不能改任何 owner 的角色。
 *      owner 只能在服务器上用 `admin.js role` 设置，门槛是"能登录服务器"。
 *   2. owner 可以改**其他所有角色**（含把管理员升/降）。
 *   3. admin：
 *      · 不能降级**自己**（"我不干了"要走 CLI —— 否则一次手滑就没了管理入口）；
 *      · 不能把别人**升成管理员**（管理员不能自己扩编）；
 *      · 不能改**其他管理员**的角色（管理员之间平级）。
 *   4. 其余角色没有 user.moderate，压根到不了这一步（返回 forbidden 兜底）。
 */
export function checkRoleChange(input: {
  actorRole: UserRole;
  targetRole: UserRole;
  targetIsSelf: boolean;
  nextRole: UserRole;
}): { ok: true } | { ok: false; reason: RoleChangeDenial } {
  const { actorRole, targetRole, targetIsSelf, nextRole } = input;

  // 1. owner 不可触碰（两个方向都算"涉及 owner"）
  if (targetRole === 'owner' || nextRole === 'owner') {
    return { ok: false, reason: 'owner_immutable' };
  }

  // 2. owner 对其他角色畅通无阻
  if (actorRole === 'owner') return { ok: true };

  // 3. 管理员的三种限制
  if (actorRole === 'admin') {
    if (targetIsSelf && nextRole !== 'admin') return { ok: false, reason: 'admin_self' };
    if (nextRole === 'admin') return { ok: false, reason: 'admin_promote' };
    if (targetRole === 'admin') return { ok: false, reason: 'admin_peer' };
    return { ok: true };
  }

  return { ok: false, reason: 'forbidden' };
}

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
  /*
   * ⚠️ **不含 owner**：owner 只能在服务器上用 admin.js role 设置。
   *    界面上的角色下拉框就是用它填充的 —— 如果这里返回全部角色，
   *    管理员就能在页面上把谁改成 owner（虽然服务端还会拦，
   *    但"下拉框里有一个点了必然失败的选项"本身就是个坑）。
   */
  return USER_ROLES.filter((r) => r !== 'owner');
}
