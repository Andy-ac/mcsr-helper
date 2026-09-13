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
import { can, canHardDelete, canSelfReview } from '@mcsr/shared/permissions';
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

/**
 * 当前用户能不能**跳过"先下架"、直接真删**一条内容（需求②）。
 *
 * ⚠️ 这是一条**谓词**而不是能力 —— shared/permissions.ts 里 `canHardDelete` 的
 *    长注释解释了为什么：能力**可以被后来的人一行编辑授予出去**（把
 *    `content.hardDelete` 加进 `admin` 那一行看起来完全合理，而"只有 owner"
 *    就此静默失效、测试依然全绿）；谓词的答案写死在函数体里，放宽它必须改函数，
 *    `git diff` 里一眼可见。
 *
 * ⚠️ 判据仍然**只有一处**（shared 的 `canHardDelete`），这里只是把它接到
 *    当前登录态上 —— 与 `useCanSelfReview` 完全同一个形状，页面里不写
 *    `role === 'owner'`。前端仍然只决定"按钮显不显示"，拦截在服务端。
 */
export function useCanHardDelete(): boolean {
  const auth = useAuth();
  return auth.user ? canHardDelete(auth.user.role) : false;
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
  live: 'auth.capTypeLive',
  seed: 'auth.capTypeSeed',
  user: 'auth.capTypeUser',
  audit: 'auth.capTypeAudit',
  /*
   * `content.*`（需求②）—— 跨类型的一个"类型"：`content.author` 管的是
   * "直接写线上行"这个动作，而不是某一种内容，所以它的类型名是 content 而不是
   * resource/calendar/video 里的任何一个。
   * ⚠️ 不加这一行不会报错，只会让「我的」页面把**类型**显示成英文 `content`
   *    （而旁边的项都是中文）—— 看起来像界面没做完。
   */
  content: 'auth.capTypeContent',
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

/** 动作名 → 词条 key。
 *
 * ⚠️ 这张表**必须覆盖权限矩阵里出现的每一个动作名**，漏一个的后果是
 *    那个能力在「我的」页面上以**原始英文动作名**出现（`editAny`），
 *    而它旁边的每一项都是翻译过的中文 —— 看起来像界面没做完，
 *    实际上只是这张表少了一行。
 *
 * ⚠️ 漏了**不会报错**：下面的兜底是"显示动作名本身"（那个兜底是对的，
 *    总比空白强），所以它只会安静地退化成一个英文词。
 *    `.cache/deadkeys.mjs` 会把"有词条但没人引用"的 key 报出来 ——
 *    `capActionEditAny` 就是这样被抓到的（2026-09-13）。
 */
const ACTION_KEYS: Record<string, string> = {
  submit: 'auth.capActionSubmit',
  editOwn: 'auth.capActionEditOwn',
  editAny: 'auth.capActionEditAny',
  editUnpublished: 'auth.capActionEditUnpublished',
  review: 'auth.capActionReview',
  moderate: 'auth.capActionModerate',
  feature: 'auth.capActionFeature',
  read: 'auth.capActionRead',
  /*
   * `live.manage` —— 直播清单是**编辑维护**的，所以它的动作叫 manage 而不是 submit。
   * 词汇上是有意的：`submit` 在这套矩阵里一律指"用户提交、需要审核"，
   * 而这份名单没有人会去审（它本来就是编辑自己写的）。
   */
  manage: 'auth.capActionManage',
  /*
   * `content.author`（需求②）—— "绕过审核直接写线上内容"。
   *
   * ⚠️ 这里**刻意没有** `hardDelete` 这一行：它**不是能力**，而是
   *    `permissions.ts` 里的谓词 `canHardDelete(role)`（理由：能力可以被一行编辑
   *    授予出去，而"只有 owner 能真删"必须不可授予 —— 否则那条承诺会静默失效、
   *    测试还全绿）。所以账号页的能力清单里本来就不会出现它，
   *    加一行映射只会变成一条**永远引用不到的词条**。
   */
  author: 'auth.capActionAuthor',
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
