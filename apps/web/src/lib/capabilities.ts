/**
 * 把 shared/permissions.ts 的能力名接到界面上。
 *
 * 能力名是 `<类型>.<动作>` 的形式，所以标签由两段拼接而成 ——
 * 这样 M4 新增能力（比如 calendar.review）时**不需要加任何词条**，
 * 界面自动就有了。给每个能力单写一条文案的话，
 * 加了能力忘了加词条，界面上就会出现一个空白标签，
 * 而且这种遗漏不会有任何东西提醒你。
 *
 * ★ 2026-09-15：上面最后半句**不再成立了** —— `apps/web/scripts/roleguide.tsx`
 *   现在会遍历 `CAPABILITIES`，断言每一个能力的类型 key 与动作 key 都非空
 *   （走下面导出的 `capabilityLabelKeys`，与 `describeCapabilities` **同一条路**）。
 *   ⚠️ 这条守卫是被一件真实的事逼出来的：加 `share.moderate` 时，
 *   它没有自己的动作词条 ⇒ 安静地继承了 `ACTION_KEYS.moderate` 的
 *   「管理身份组」，界面上于是写着一条他并没有的权限，而**所有门禁都是绿的**。
 */
import type { Actor, Capability } from '@mcsr/shared/permissions';
import { CAPABILITIES, can, canHardDelete, canSelfReview } from '@mcsr/shared/permissions';
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
   * ⚠️ 漏了这一行**会红**（`apps/web/scripts/roleguide.tsx` 逐个能力断言类型 key 非空，
   *    而旧的那句"不会报错、只会显示成英文"在 2026-09-15 起就不成立了 —— 见下面 `ACTION_KEYS` 那段。
   * ⚠️ 显示名那一半仍然是真的：真漏了它，界面上会印英文 `content`（但那时门禁已经先红了）。
   */
  content: 'auth.capTypeContent',
  /*
   * `share.*`（实时分享的治理，2026-09-15）—— 这里要说清它**不是** `shares.*`
   * 那一节的文案：`shares.*` 是页面上给用户看的句子（房间号、种子、看板），
   * 而这一行只是账号页能力清单里**类型那一半**的名字。
   * ⚠️ 不加这一行的后果与上面 `content` 完全一样：**门禁先红**
   *    （`roleguide.tsx` 逐个能力断言类型 key 非空）。
   */
  share: 'auth.capTypeShare',
  /*
   * `catalog.*`（B1：mod 目录的标签）—— 与 `content` 那一行同一个道理：
   * 它管的是"目录这份数据"上的动作，不是某一种内容。
   * ⚠️ 漏了这一行**会红**（`apps/web/scripts/roleguide.tsx` 逐个能力断言类型 key 非空，
   2026-09-15 起如此；B1 的 T1 就是被它拦下的），不是"只会显示成英文"。
   */
  catalog: 'auth.capTypeCatalog',
  /*
   * `pack.*`（B2：整合包）—— 与 `content` / `catalog` 那两行同一个道理：
   * 它管的是"整合包这份数据"上的动作，不是某一种内容。
   * ⚠️ 漏了这一行**会红**（`apps/web/scripts/roleguide.tsx` 逐个能力断言类型 key 非空），
   * 不是"只会显示成英文"。
   * ★ 动作那一半**不用加**：`pack.manage` 落到既有的 `ACTION_KEYS.manage`、
   *   `pack.feature` 落到既有的 `ACTION_KEYS.feature`（两个动作名都不是新的，
   *   也都没有被 `CAP_OVERRIDES` 消歧 ⇒ 不构成"撞名"）。
   *   ⚠️ 往那两张表里各加一条**同名的**键只会是 TS 的重复键错误（TS1117）。
   */
  pack: 'auth.capTypePack',
};

/**
 * 会**撞名**的能力：动作名相同但含义完全不同，必须按完整能力名区分。
 *
 * 到今天为止有**三个** moderate：`resource.moderate`（下架内容）、
 * `user.moderate`（管理身份组）、`share.moderate`（下架别人的分享）——
 * 内容治理与账号治理是两条线，分享治理又是第三条。
 * 只按动作名映射的话，后加的那一个会被贴上别的标签，
 * 而"界面上的权限名写错了"是很难被发现的：它看起来只是文案不对。
 *
 * ⚠️ 2026-09-15：`share.moderate` 就是这么被漏掉的 —— 它一加进权限矩阵，
 *    `ACTION_KEYS.moderate`（=「管理身份组」）就接管了它的标签，
 *    而 `check:roleguide` 那时只验"字典里的词条渲染得出来"，
 *    所以**没有任何门禁变红**。现在那条守卫会点名。
 *
 * ⚠️ 为什么不去改能力名：能力名是权限矩阵里的**契约**（服务端判权、
 *    审计日志、测试都在用它），不该为了界面文案去动它。
 */
const CAP_OVERRIDES: Record<string, string> = {
  'resource.moderate': 'auth.capActionModerateContent',
  'user.moderate': 'auth.capActionModerate',
  'share.moderate': 'auth.capActionModerateShare',
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
 * ★ 2026-09-15：漏了**现在会红**了 —— `check:roleguide` 拿
 *    `capabilityLabelKeys()` 逐个能力断言这张表覆盖到了（见文件头那段说明）。
 */
const ACTION_KEYS: Record<string, string> = {
  submit: 'auth.capActionSubmit',
  editOwn: 'auth.capActionEditOwn',
  editAny: 'auth.capActionEditAny',
  editUnpublished: 'auth.capActionEditUnpublished',
  /*
   * `catalog.editTags`（B1：mod 目录的标签）—— `editTags` 是**新动作名**，
   * 与既有的 `editOwn` / `editAny` / `editUnpublished` 都不同名
   * ⇒ 走这张表就够了，**不用** `CAP_OVERRIDES`（那张表只处理动作名撞车）。
   */
  editTags: 'auth.capActionEditTags',
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

/**
 * 一个能力在界面上用到的两个词条 key（类型、动作）。
 *
 * ⚠️ `null` = 那张表里没有 ⇒ 界面上会退化成英文原文
 *    （类型名或动作名本身，见下面 `describeCapabilities` 的兜底）。
 *
 * ★ 抽出来是为了**能被渲染自检断言**：`describeCapabilities` 与守卫走同一条路，
 *   守卫才不是一份平行的抄写（平行的抄写会漂移，而漂移的守卫是假守卫）。
 *   ⚠️ 这一点是有来历的：`share.moderate` 那个能力就是这样在界面上被显示成
 *   「管理身份组」的 —— 表里的兜底**看起来很正常**，所以没人发现。
 */
export function capabilityLabelKeys(cap: Capability): {
  typeKey: string | null;
  actionKey: string | null;
} {
  const [type = '', action = ''] = cap.split('.');
  return {
    typeKey: TYPE_KEYS[type] ?? null,
    actionKey: CAP_OVERRIDES[cap] ?? ACTION_KEYS[action] ?? null,
  };
}

/**
 * ★ 撞名检查：哪些能力**该有自己的动作词条、却还在用兜底**。
 *
 * 规则：同一个动作名（比如 `moderate`）只要**有一个**能力在 `CAP_OVERRIDES` 里
 * 有自己的条目，那么用同一个动作名的**每一个**能力都必须有自己的条目。
 *
 * ⚠️ 为什么必须是"成组"的：兜底 `ACTION_KEYS[action]` 是**按动作名**取的 ——
 *    一个组里只要有人被消歧，就说明这个动作名在矩阵里**是有歧义的**，
 *    此时还在靠兜底的那个能力会显示成**别人的权限名**，而那一行看起来完全正常。
 *    `share.moderate` 就是这样显示成「管理身份组」的（2026-09-15）。
 *
 * ⚠️ 为什么不能改成"不同能力不许共用同一个动作词条"：`submit` / `review`
 *    本来就是**同一个动作跨类型共用**的（「资源库 · 提交」「日历 · 提交」）——
 *    那正是"两张表拼标签"的初衷。⇒ 判据只能是"这个动作名被消歧了没有"。
 *
 * @param caps      要检查的能力（默认就是权限矩阵；**参数是给探针用的**）
 * @param overrides 消歧表（默认就是上面那张；同样是为了让自检能喂一份**假的**表 ——
 *                  否则"这个检查能不能发现问题"只能靠人去读实现）
 * @returns 没有被消歧的能力名（空数组 = 通过）
 */
export function capabilitiesWithInheritedActionLabel(
  caps: readonly Capability[] = CAPABILITIES,
  overrides: Readonly<Record<string, string>> = CAP_OVERRIDES,
): Capability[] {
  const byAction = new Map<string, Capability[]>();
  for (const cap of caps) {
    const action = cap.split('.')[1] ?? cap;
    byAction.set(action, [...(byAction.get(action) ?? []), cap]);
  }
  const out: Capability[] = [];
  for (const group of byAction.values()) {
    // 这一组没有任何人被消歧 ⇒ 通用标签对全组都成立，不算撞名
    if (!group.some((cap) => overrides[cap])) continue;
    out.push(...group.filter((cap) => !overrides[cap]));
  }
  return out;
}

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
      // ★ key 的来源与守卫完全同一处：`capabilityLabelKeys`。
      const { actionKey } = capabilityLabelKeys(cap);
      return {
        capability: cap,
        // 兜底仍然是动作名本身（英文），而不是空字符串 —— 空白标签会让人
        // 以为界面坏了，而英文名至少能读懂是什么。
        label: actionKey ? t(actionKey) : action,
      };
    }),
  }));
}
