/**
 * 把 shared/permissions.ts 的能力名接到界面上。
 *
 * 能力名是 `<类型>.<动作>` 的形式，所以标签由两段拼接而成 ——
 * 这样 M4 新增能力（比如 calendar.review）时**不需要加任何词条**，
 * 界面自动就有了。给每个能力单写一条文案的话，
 * 加了能力忘了加词条，界面上就会出现一个空白标签，
 * 而且这种遗漏不会有任何东西提醒你。
 */
import type { Actor, Capability } from '@mcsr/shared/permissions';
import { can, canSelfReview } from '@mcsr/shared/permissions';
import { REVIEWABLE_TYPES, type ReviewableType } from '@mcsr/shared/review';
import { useAuth } from '@/lib/auth';

export interface CapabilityGroup {
  type: string;
  label: string;
  actions: { capability: Capability; label: string }[];
}

/**
 * 某类型的审核能力名。
 *
 * 返回类型写成 `Capability` 而不是 `string` 是**刻意的** ——
 * 它是编译器检查"能力名真的存在"的地方：M4 往 `REVIEWABLE_TYPES` 里加
 * 一个类型、却忘了在权限矩阵里给对应能力，这一行立刻报错。
 * 写成 string 的话，拼错的能力名会一路走到运行时，
 * 而 `can()` 对不认识的名字只会返回 false —— 表现是"审核入口莫名其妙消失了"。
 */
function reviewCapability(type: ReviewableType): Capability {
  return `${type}.review`;
}

/** 这个人能不能审**任何一类**内容。侧边栏的审核入口靠它决定显不显示。 */
export function canReviewAny(actor: Actor | null): boolean {
  if (!actor) return false;
  return REVIEWABLE_TYPES.some((type) => can(actor, reviewCapability(type)));
}

/**
 * 当前登录用户有没有某项能力。
 *
 * ⚠️ 它只决定**按钮显不显示**，不是安全边界 —— 真正的拦截在服务端
 *    （`requireCapability`）。界面骗不过去，也不再需要骗：
 *    手动发一个请求会得到 403，而不是"按钮不存在所以没辙"。
 */
/**
 * 当前用户能不能批准**自己提交**的内容。
 *
 * ⚠️ 规则来自 shared/permissions.ts 的 canSelfReview（和服务端同一份），
 *    不是这里另写一遍。界面据此把按钮提前禁掉并说明原因 ——
 *    而不是等用户点了才给 403。
 */
export function useCanSelfReview(): boolean {
  const auth = useAuth();
  return auth.user ? canSelfReview(auth.user.role) : false;
}

export function useCan(capability: Capability): boolean {
  const auth = useAuth();
  const actor: Actor | null = auth.user
    ? { role: auth.user.role, emailVerified: auth.user.emailVerified }
    : null;
  return can(actor, capability);
}

type Translate = (key: string) => string;

/** 类型名 → 词条 key。表里没有的走兜底，宁可显示英文名也不要显示空白。 */
const TYPE_KEYS: Record<string, string> = {
  resource: 'auth.capTypeResource',
  calendar: 'auth.capTypeCalendar',
  video: 'auth.capTypeVideo',
  seed: 'auth.capTypeSeed',
  user: 'auth.capTypeUser',
  audit: 'auth.capTypeAudit',
};

/**
 * 会**撞名**的能力：动作名相同但含义完全不同，必须按完整能力名区分。
 *
 * 目前的唯一一对是 `resource.moderate`（下架内容）和 `user.moderate`
 * （管理身份组）—— 都叫 moderate，但一个是内容治理、一个是账号治理。
 * 只按动作名映射的话，其中一个会被贴上另一个的标签，
 * 而"界面上的权限名写错了"是很难被发现的：它看起来只是文案不对。
 *
 * ⚠️ 为什么不去改能力名：能力名是权限矩阵里的**契约**（服务端判权、
 *    审计日志、测试都在用它），不该为了界面文案去动它。
 */
const CAP_OVERRIDES: Record<string, string> = {
  'resource.moderate': 'auth.capActionModerateContent',
  'user.moderate': 'auth.capActionModerate',
};

/** 动作名 → 词条 key。 */
const ACTION_KEYS: Record<string, string> = {
  submit: 'auth.capActionSubmit',
  editOwn: 'auth.capActionEditOwn',
  review: 'auth.capActionReview',
  moderate: 'auth.capActionModerate',
  read: 'auth.capActionRead',
};

export function describeCapabilities(
  grouped: Record<string, Capability[]>,
  t: Translate,
): CapabilityGroup[] {
  return Object.entries(grouped).map(([type, caps]) => ({
    type,
    // ⚠️ 兜底用类型名本身（英文），而不是空字符串或 '?'。
    //    空白标签会让人以为界面坏了，而英文名至少能读懂是什么。
    label: TYPE_KEYS[type] ? t(TYPE_KEYS[type]) : type,
    actions: caps.map((cap) => {
      const action = cap.split('.')[1] ?? cap;
      const key = CAP_OVERRIDES[cap] ?? ACTION_KEYS[action];
      return {
        capability: cap,
        // 兜底仍然是动作名本身（英文），而不是空字符串 —— 空白标签会让人
        // 以为界面坏了，而英文名至少能读懂是什么。
        label: key ? t(key) : action,
      };
    }),
  }));
}
