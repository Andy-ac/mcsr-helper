/**
 * 站内分区表（**只有这一份**）。
 *
 * ---------------------------------------------------------------------------
 * 为什么它不在 `Layout.tsx` 里了（2026-09-14）
 * ---------------------------------------------------------------------------
 * 这张表原来住在 `Layout.tsx`，是**私有的**。2026-09-14 改主页时，用户要求
 * 「改成和左侧一样的几个栏目的说明文本」—— 于是首页也需要同一张表。
 * 当时的第一版是**首页手抄一份**（连注释都写着"两份必须一起改"），
 * 紧接着并行任务的评审又指出：渲染自检里还抄了**第三份**。
 *
 * ⚠️ 三份手抄的"同一件事"是本仓反复记录过的那种形状：
 *    **它们不会报错**，只会在某天变成"首页列出 5 个栏目、侧栏 6 个"，
 *    或者两者的顺序不一样 —— 而两种都看不出来是 bug（首页凭什么是错的？）。
 * ⇒ 所以提出来放在 `lib/` 下，`Layout` 与首页**都从这里 import**。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 字段的职责（加字段前先看这一段）
 * ---------------------------------------------------------------------------
 *   · `to`       —— 路由。首页的每一行也要用它，所以它属于这里。
 *   · `labelKey` —— 栏目**名字**（`nav.*`）。⚠️ 名字只有这一份：
 *                   本仓刚为一节两个名字花掉一轮（「娱乐视频」/「视频」），
 *                   首页**不要**再写一遍名字。
 *   · `block`    —— 左侧那个小方块的 CSS 后缀（`.sidebar__block--<block>`），
 *                   同时也是**这一栏的短名**（`resources` / `calendar` / …）。
 *                   首页按它取自己的一句话说明：`home.desc.<block>`。
 *                   ⚠️ 短名与路由**恰好**一一对应，但它们是两件事：
 *                      改路由不会自动改短名（短名连着颜色与说明词条）。
 *   · `milestone`—— 非空 = 尚未实现，渲染成不可点击。
 *                   **放一个点了没反应的链接比不放更糟**。
 *
 * ⚠️ 「提交」和「审核」**不在这里**：它们是有权限才存在的入口，
 *    按账号能力决定显不显示（见 `Layout.tsx` 顶部那段注释）。
 */
export const NAV_SECTIONS = [
  { to: '/resources', labelKey: 'nav.resources', block: 'resources', milestone: '' },
  { to: '/calendar', labelKey: 'nav.calendar', block: 'calendar', milestone: '' },
  /*
   * 原「视频」拆成两个板块（用户要求）：
   *   · `/videos` = **视频**：用户贴的 B站/YouTube 链接，即贴即可见、rolling
   *   · `/live`   = **直播**：一份**编辑维护**的 MCSR streamer 名单，变动很慢
   *
   * ⚠️ 两者的权限形状**相反**（谁都能贴 vs 只有 live.manage），
   *    所以它们是两个板块而不是一个板块下的两个标签 —— 导航分开，
   *    用户才知道"这里的东西不是我贴的"。
   */
  { to: '/videos', labelKey: 'nav.videos', block: 'videos', milestone: '' },
  { to: '/live', labelKey: 'nav.live', block: 'live', milestone: '' },
  /*
   * ★ 「实时分享」（2026-09-15）—— 夹在「直播」与「排位赛种子」之间：
   *   紧挨着的都是"看现在正在发生什么"这一类栏目。
   *
   * ⚠️ `block` 这个短名同时连着**三样东西**，改它等于同时改三处：
   *    · 侧栏小方块的 CSS（`.sidebar__block--shares`，styles.css）
   *    · 首页那一句说明（`home.desc.shares` —— 少了首页会印裸 key，check:home 会红）
   *    · 本栏目的词条命名空间（`shares.*`）
   *
   * ⚠️★ 这一行落地时 `/shares` 路由**还不存在**（介绍页与路由是后面的任务才建的），
   *   所以 `check:home` 里那条"可点的栏目必须在 App.tsx 里有真路由"会**红**，
   *   直到那条路由落地为止。⚠️ **这不需要在这一行上做手脚**（比如先挂一个
   *   `milestone` 把它变成灰的、点不动）：那条断言守的正是"点进去是 404"，
   *   而 `milestone` 那条路会留下一个**没有任何门禁会提醒摘掉**的灰栏目。
   *   路由一落地它自己就绿了。
   */
  { to: '/shares', labelKey: 'nav.shares', block: 'shares', milestone: '' },
  /*
   * ★★ 「竞技项目」（2026-10-12，**骨架任务**：用户要求"尽快加上界面骨架、不需要内容，
   *    前端即将重构" ⇒ 只立入口与空面板，别往这里长功能 ✗）。
   *
   * ⚠️★ 它**取代**了原来那两行 ——「排位赛种子」（`/seeds`）与「Ranked 实时信息」（`/ranked`）：
   *    那两页的**内容**现在住在本栏的「MCSR Ranked」子标签里（`routes/Competitive.tsx`）。
   * ⚠️★ **两条旧路由一个字节都没删**：`/seeds` 与 `/ranked/*` 仍然可达 ✓ ——
   *    撤的只是**侧栏入口**，老链接 / 老书签 / 分享出去的 URL 照旧能用 ✓
   *    （用户给的两条路"保留重定向或保留可达"里，这里选了**保留可达**：
   *     最小破坏，而且 `/ranked` 本来就有一条指向 `/ranked/status` 的重定向）。
   * ⚠️ 加这一行要**同批**加三样（`homerender.tsx` 各有一条守卫）：
   *    ① `home.desc.competitive`（`home.desc.*` 与导航 block **两个方向都查**）；
   *    ② `App.tsx` 里的真路由（"可点的栏目点进去不能是 404"）；
   *    ③ `.sidebar__block--competitive` 那条 CSS（`block` 同时是短名与 CSS 后缀）。
   * ⚠️ 撤掉 `seeds` / `ranked` 那两行时，**它们的 `home.desc.*` 词条也必须一起撤** ✗
   *    （只撤导航行会红 —— 见上面那条"两个方向都查"）；
   *    而 `nav.seeds` / `nav.ranked` 这两个**名字**保留（后者还被 `RankedPanels.tsx` 用着 ✓）。
   */
  { to: '/competitive', labelKey: 'nav.competitive', block: 'competitive', milestone: '' },
  /*
   * ★★ 另两个新栏目（同一批骨架）：社区信息推送 / 插件市场 —— 各自只有一张空页面。
   * ⚠️ 加栏目那四处（字典 / 本表 / `home.desc.*` / `App.tsx` 路由）与上一条相同，
   *    别忘了 CSS 方块那一步 ✓。
   */
  { to: '/community', labelKey: 'nav.community', block: 'community', milestone: '' },
  { to: '/plugins', labelKey: 'nav.plugins', block: 'plugins', milestone: '' },
  /*
   * 「文件更新」（2026-09-24）—— 放在「我的」之前：它是**工具**，不属于社区内容。
   *
   * ⚠️ `block: 'files'` 这个短名同时连着四样东西（改它等于同时改四处）：
   *    侧栏小方块的 CSS（`.sidebar__block--files`）、首页那一句说明（`home.desc.files`）、
   *    词条命名空间（`files.*`）、以及 `/files` 路由（App.tsx 里必须真有，homerender 有守卫）。
   * ⚠️ 真正的本地文件能力**只在桌面版里**：浏览器里这一页是"看目录 + 引导装桌面版"。
   */
  { to: '/files', labelKey: 'nav.files', block: 'files', milestone: '' },
  // 「我的」在 M2 就启用了：账号页本身已经能用（看得清验证状态、能重发验证邮件、
  // 能退出登录）。M5 会往它上面叠个人主页、MC 绑定和关注列表。
  { to: '/me', labelKey: 'nav.profile', block: 'profile', milestone: '' },
] as const;

/** 一个分区在表里的形状（`block` 是联合类型，所以能当词条后缀用）。 */
export type NavSection = (typeof NAV_SECTIONS)[number];
