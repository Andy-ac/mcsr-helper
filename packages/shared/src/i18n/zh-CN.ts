/**
 * 中文（简体）词条 —— **参考语言**。
 *
 * 规则（见 docs/v1-plan.md 第 1 节）：
 *   - UI 字符串从第一天就做 i18n
 *   - **内容**（资源库条目、日历事件、种子说明）永远不翻译，只按 `lang` 打标签
 *
 * 新增词条时先加在 zh-CN 里，`TranslationKey` 类型会自动要求 en 补齐。
 */
export const zhCN = {
  common: {
    appName: 'MCSR Helper',
    loading: '加载中…',
    retry: '重试',
    cancel: '取消',
    confirm: '确定',
    save: '保存',
    submit: '提交',
    search: '搜索',
    empty: '这里还什么都没有',
    error: '出错了',
    backHome: '返回首页',
  },
  nav: {
    sections: '分区',
    collapse: '收起',
    expand: '展开',
    resources: '资源库',
    calendar: '日历',
    seeds: '种子分享',
    /*
     * ⚠️ 这个 key 指的是 `/videos` 那个板块，而它现在叫「娱乐视频」——
     *    和新的「直播」板块并列（用户要求把原「视频」拆成两个）。
     *    保留 `videos` 这个名字是因为路径还是 `/videos`；
     *    改 value 而不改 key，比全局改名少一次会漏东西的重命名。
     */
    videos: '娱乐视频',
    live: '直播',
    profile: '我的',
    admin: '管理',
    submit: '提交',
    review: '审核',
    login: '登录',
    register: '注册',
    logout: '退出登录',
    language: '语言',
  },
  home: {
    tagline: 'MCSR 社区的资源库与日历',
    subtitle: '网站、工具、赛事、种子 —— 一个地方找齐。',
    comingSoon: '当前处于 M0 骨架阶段，功能正在建设中。',
  },
  status: {
    draft: '草稿',
    pending: '待审核',
    published: '已发布',
    rejected: '已驳回',
    hidden: '已下架',
  },
  seed: {
    label: '世界种子',
    placeholder: '例如 306404093549845300',
    invalid: '这不是一个合法的 Minecraft 种子（需要 64 位整数，可以是负数）',
    hint: '种子会被原样保存为字符串，不会丢失精度。',
  },
  resources: {
    submitAction: '提交一条',
    title: '资源库',
    subtitle: '社区整理的网站、工具与参考资料 —— 不需要登录就能看。',
    searchPlaceholder: '搜索标题、简介或标签…',
    searchLabel: '搜索',
    tabAll: '全部',
    tabWebsite: '网站',
    tabTool: '工具',
    /*
     * ① 视频子 tab。
     *
     * ⚠️ 它和 `kindVideo`（"视频资料"）**刻意不同**，这不是重复而是两个位面：
     *   · 这个（tabVideo = "视频"）是**列表页顶部的子 tab**，要和
     *     "网站" / "工具" 并排 —— 它们都是**短标签**；
     *   · `kindVideo`（"视频资料"）是**卡片上的类型徽章**，是类型名，
     *     它要负责和 `/videos`（娱乐视频）区分开，所以必须更长更明确。
     * 两者都由同一个 kind 值（`RESOURCE_KINDS` 里的 `video`）驱动，
     * 所以不存在"两份会漂移的真相"—— 见 apps/web 的 resourceKindLabel。
     *
     * ⚠️ 别因为"网站/工具这两个 tab 的文案和同名徽章一模一样"就把这条删掉去复用
     *    `kindVideo`：那会打破 TABS 现有模式（另外三个 tab 都有独立的 `tab*` 词条），
     *    下一个人加第四个 tab 时会不知道自己该照哪一份写。
     */
    tabVideo: '视频',
    allKinds: '全部类型',
    allLangs: '全部语言',
    kindWebsite: '网站',
    kindTool: '工具',
    /*
     * 「视频资料」——资源库里的一个条目类型。
     *
     * ⚠️ 它和「娱乐视频」板块**不是一回事**，文案上要能看出区别：
     *   · 视频资料 = 资源库条目，走提交 → 审核 → 标签（"这个视频值得收录"）
     *   · 娱乐视频 = 顶层板块，贴了就可见、rolling（"这个视频挺好看"）
     * 两者都是视频，但一个是**资料**、一个是**内容**。
     */
    kindVideo: '视频资料',
    langZh: '中文',
    langEn: '英文',
    resultCount: '共 {{count}} 条',
    resultCountFiltered: '筛选出 {{count}} 条',
    noResults: '没有匹配的条目',
    noResultsHint: '换个关键词，或者清除筛选条件。',
    clearFilters: '清除筛选',
    featured: '精选',
    official: '官方',
    visit: '打开链接',
    backToList: '返回资源库',
    lastUpdated: '最后更新于 {{date}}',
    tagsLabel: '标签',
    subTagsLabel: '分类标签',
    tagFilterHint: '按标签筛选：',
    loading: '加载中…',
    loadFailed: '加载失败',
    retry: '重试',
    notFound: '找不到这个条目',
    notFoundHint: '它可能已经被移除，或者链接有误。',
    page: '第 {{page}} / {{total}} 页',
    prevPage: '上一页',
    nextPage: '下一页',
    allTags: '全部标签',
    infoTitle: '详细信息',
    infoSite: '网站',
    infoKind: '类型',
    infoLang: '语言',
    infoTags: '分类标签',
    infoAdded: '收录时间',
    infoUpdated: '最后更新',
    infoId: '条目 ID',
    infoImage: '图标来源',
    imageFromSite: '站点图标',
    imageCustom: '自定义配图',
    imageGenerated: '自动生成',
    related: '同标签的其它条目',
    openSite: '访问站点',
  },
  /**
   * 账号相关。
   *
   * 文案里有一条贯穿始终的原则：**浏览不需要登录，登录只是为了提交**。
   * 所以这里没有"请先登录才能继续"这类说法 —— 用户没登录也能看完整站，
   * 提示语必须让这一点看起来是有意的，而不是他漏掉了什么。
   */
  auth: {
    // 登录
    loginTitle: '登录',
    loginSubtitle: '登录之后才能提交内容。浏览全站不需要登录。',
    loggingIn: '登录中…',
    loginAction: '登录',
    forgotPassword: '忘记密码？',
    noAccount: '还没有账号？',
    // 注册
    registerTitle: '注册',
    registerSubtitle: '注册后要去邮箱点验证链接，验证通过才算注册完成。',
    registering: '注册中…',
    registerAction: '注册',
    hasAccount: '已经有账号了？',
    displayName: '昵称',
    displayNamePlaceholder: '别人看到的名字',
    email: '邮箱',
    emailPlaceholder: 'you@example.com',
    password: '密码',
    passwordPlaceholder: '至少 8 位',
    newPassword: '新密码',
    // 注册结果（刻意不透露邮箱是否已注册）
    registerDone:
      '如果这个邮箱还没有注册，我们已经发送了一封验证邮件 —— 点开邮件里的链接才算注册完成。',
    registerDoneHint:
      '如果已经注册过，可以直接登录；如果一直收不到验证邮件，用「忘记密码」重设一次密码也可以完成验证。',
    // 验证邮箱
    verifyTitle: '验证邮箱',
    verifyWorking: '正在验证…',
    verifyOk: '邮箱已验证',
    verifyOkHint: '现在可以登录了。',
    verifyFailed: '这个链接无效或已过期',
    verifyFailedHint:
      '验证链接 24 小时内有效，而且只能用一次。想再要一封的话，去登录页填好邮箱 —— 那里有「重发验证邮件」，不需要先登录。',
    verifyResend: '重新发送验证邮件',
    verifyResending: '发送中…',
    verifyResent: '已重新发送。之前那封邮件里的链接已经失效了。',
    verifyNeeded: '邮箱验证通过之后才能登录。',
    verifyNoToken: '这个链接不完整，缺少验证参数。',
    /**
     * 登录被"邮箱未验证"挡下时，登录页上那块自救面板。
     *
     * ⚠️ 这块面板是**必需**的，不是装饰：未验证的账号登不进来，
     *    所以"去账号页点重发"那条路对这些人根本不存在（那个按钮要登录），
     *    必须在这里就地给一个能用的重发入口 —— 否则他唯一的出路是重设密码，
     *    而那要求他能收到同一封信。
     */
    verifyBlockTitle: '这个邮箱还没验证',
    verifyBlockHint:
      '验证通过才算注册完成。去邮箱点我们发的那封验证邮件里的链接就行 —— 信找不到了的话，在下面重发一封。',
    verifyBlockResend: '重发验证邮件',
    verifyBlockSent: '如果这个邮箱注册过且还没验证，我们已经重新发了一封。',
    verifyBlockNeedEmail: '请先在上面填好邮箱地址。',
    // 找回密码
    resetRequestTitle: '找回密码',
    resetRequestSubtitle: '输入注册时用的邮箱，我们会发一封重置邮件。',
    resetRequestAction: '发送重置邮件',
    resetRequesting: '发送中…',
    resetRequestDone: '如果这个邮箱对应一个账号，我们已经发送了一封重置密码的邮件。',
    resetRequestDoneHint: '链接 1 小时内有效。没收到的话，检查一下垃圾箱。',
    resetTitle: '设置新密码',
    resetSubtitle: '设置之后，你在其它设备上的登录状态会全部失效。',
    resetAction: '设置新密码',
    resetWorking: '正在设置…',
    resetOk: '密码已更新',
    resetOkHint: '请用新密码登录。',
    // 账号页
    accountTitle: '我的账号',
    accountEmail: '邮箱',
    accountVerified: '邮箱已验证',
    accountUnverified: '邮箱未验证',
    accountRole: '角色',
    accountJoined: '注册于',
    roleUser: '普通用户',
    roleReviewer: '审核员',
    roleEditor: '内容编辑',
    roleOwner: '所有者',
    roleAdmin: '管理员',
    roleGuideTitle: '五种身份分别能做什么',
    roleGuideIntro:
      '下面是每一级身份拥有的权限。**能做什么从权限矩阵直接读出来**，所以这张表不会和实际行为不一致。',
    roleGuest: '游客（未登录）',
    guestCan1: '浏览资源库、搜索、筛选、看详情页 —— 整站内容都不需要登录',
    guestCan2: '不能提交、不能修改、不能审核（登录只是为了参与，不是为了看）',
    rankNoteOwner:
      '最高一级。**能力上比管理员多一条**：只有 owner 能不做两步（先下架）直接真删内容；除此之外多出来的是**等级**：只有 owner 能设置/取消管理员，而 owner 自己的角色在网页上谁也改不了 —— 要改只能在服务器上跑 admin.js。',
    rankNoteAdmin:
      '管理账号与角色：能把普通用户提升为审核员或内容编辑。但**管理员之间平级** —— 不能改其他管理员，不能把自己降级，也不能把别人提升为管理员。',
    rankNoteEditor:
      '站点的内容负责人：自己写的内容可以自己批准，还能决定内容以什么姿态出现在站上（精选、下架）。',
    rankNoteReviewer:
      '流水线审核：能批准或驳回别人的提交，但**不能批准自己提交的内容** —— 那要由另一位审核员来做（自己提交的东西可以自己驳回，等于撤回）。',
    rankNoteUser:
      '社区成员。可以提交内容、修改自己提交的东西，也可以对任何已上架的条目提出修改（改动同样要过审核）。',
    // ⚠️ t10 的静态键守卫在 2026-09-13 查出的第 7 处：`RoleGuide.tsx:115` 引用它、但它从未存在。
    rankNoteGuest:
      '你还没有登录。登录之后可以提交内容、修改自己提交的东西，也可以对任何已上架的条目提出修改。',
    canSubmitYes: '可以提交内容',
    canSubmitNo: '验证邮箱之后才能提交内容',
    /**
     * 身份组与权限。
     *
     * 文案按「内容类型 + 动作」两段拼，而不是给 10 个能力各写一句 ——
     * 能力名本身就是 `<类型>.<动作>` 的形式（见 shared/permissions.ts），
     * 拆开翻译让 6 个类型 + 5 个动作覆盖全部组合，
     * 而且 M4 新增能力时（比如 calendar.review）**不用加任何词条**。
     */
    capTitle: '我的权限',
    capTypeResource: '资源库',
    capTypeCalendar: '日历',
    capTypeVideo: '视频',
    capTypeLive: '直播清单',
    capTypeSeed: '种子分享',
    capTypeUser: '账号管理',
    capTypeAudit: '审计日志',
    /**
     * ⚠️ `content.*` 的"类型"那一半**不是一个内容类型**，而是"内容"本身：
     *    它是跨资料/视频/赛事的一条策略（② 的直编与 owner 的硬删除）。
     *    没有这条词条的话，账号页会直接显示原始英文的 `content`。
     */
    capTypeContent: '内容',
    capActionSubmit: '提交',
    capActionEditOwn: '修改自己提交的',
    capActionEditAny: '改已上架的条目',
    capActionEditUnpublished: '改未上架的条目',
    capActionFeature: '设置精选 / 官方',
    capActionModerateContent: '下架 / 恢复内容',
    capActionReview: '审核',
    // ⚠️ user.moderate（账号治理）。和 resource.moderate（内容治理）动作名相同，
    //    靠 capabilities.ts 里的 CAP_OVERRIDES 按完整能力名区分。
    capActionModerate: '管理身份组',
    capActionRead: '查看',
    capActionManage: '维护',
    capActionAuthor: '直接编辑内容',
    /**
     * ★ 每条能力的**完整说明**（角色说明页用），与上面 `capAction*` 的短标签不是一回事。
     *
     * 为什么要按**完整能力名**（`resource.submit`）而不是动作名（`submit`）：
     * 同一个动作在不同类型下说的话不一样 —— `calendar.submit` 是"提交赛事与活动"、
     * `seed.submit` 是"分享世界种子"，共用一个键就会有一个说错。
     *
     * ⚠️ 这批词条原本**硬编码在 `RoleGuide.tsx` 的 `CAP_TEXT` 里、只有中文**
     *   （英文界面会夹中文）。2026-09-13 迁到这里，中英各一份。
     * ⚠️ 其中三条自带 `**…**` 强调（editAny / editUnpublished / moderate），
     *   组件侧**必须走 `em()`**，否则用户看到的是字面的星号。
     */
    capDescResourceSubmit: '提交新的资源条目（推荐网站或工具）',
    capDescResourceEditOwn: '修改自己提交的条目',
    capDescResourceEditAny: '修改任何**已上架**的条目（wiki 式，改动一样要过审核）',
    capDescResourceEditUnpublished: '修改别人**还没上架**的草稿',
    capDescResourceFeature: '设置或取消「精选」「官方」',
    capDescResourceModerate: '把已上架的内容**下架**，以及恢复',
    capDescResourceReview: '审核资源库的提交（批准 / 驳回）',
    capDescCalendarSubmit: '提交赛事与活动',
    capDescCalendarReview: '审核日历内容',
    capDescVideoSubmit: '提交视频链接',
    capDescSeedSubmit: '分享世界种子',
    capDescSeedReview: '审核种子分享',
    capDescUserModerate: '管理账号与角色',
    capDescAuditRead: '查看审计日志',
    logoutAction: '退出登录',
    loggingOut: '退出中…',
    // 错误
    invalidCredentials: '邮箱或密码不对',
    emailNotVerified: '这个邮箱还没验证。验证通过才算注册完成，请去邮箱点验证链接。',
    videoExists: '这个视频已经在站上了 —— 换一个，或者去娱乐视频里找找它。',
    /*
     * ⚠️ 「已经记过了」和「这个视频已经在站上了」是两件事：
     *    前者是**编辑维护的名单**里的重复（同一个主播被两个人加），
     *    后者是用户贴的视频。文案要能看出这一点 ——
     *    说"去视频墙找找它"会让编辑去找一个不存在于视频墙上的东西。
     */
    liveExists: '这个频道已经在直播清单里了 —— 同一个平台下的同一个频道只能记一条。',
    // Ranked Seeds（上游只覆盖约 80%，所以"查不到"是常态而不是异常）
    seedNotFound:
      '这条比赛 ID 不在种子里库里 —— 上游只收录了约 80% 的历史比赛，这条可能是另外那 20%。',
    seedExists: '这条比赛 ID 已经录过了，不用再录一遍。',
    seedServiceUnavailable: '种子服务暂时不可用，请稍后再试。',
    seedWriteDisabled: '种子录入暂时关闭了，这不是你的问题 —— 请稍后再试或告诉我们。',
    rateLimited: '尝试太频繁了，请等 {{seconds}} 秒后再试',
    accountSuspended: '这个账号已被停用。',
    sendFailed: '邮件发送失败，请稍后再试。',
    invalidToken: '这个链接无效或已过期。',
    genericError: '出错了，请稍后再试。',
    /**
     * 字段级校验文案。
     *
     * ⚠️ 这些是**客户端**按 `(字段, Zod 错误码)` 映射出来的，不是服务端返回的原文。
     *    服务端的校验消息是中文写死的，直接显示会让英文界面突然冒出一句中文 ——
     *    而且只在出错时出现，正常路径的测试永远看不到。
     *    映射逻辑见 apps/web/src/lib/auth.tsx 的 fieldIssueText。
     *    新增校验规则时要同步加一条，否则会退回显示服务端原文。
     */
    err: {
      emailFormat: '邮箱格式不正确',
      passwordMin: '密码至少 {{min}} 位',
      passwordMax: '密码不能超过 {{max}} 位',
      nameMin: '昵称至少 {{min}} 个字符',
      nameMax: '昵称不能超过 {{max}} 个字符',
      required: '这一项不能为空',
      tooLong: '内容太长了',
      invalid: '填写的内容不合法',
    },
  },
  /**
   * 桌面端自动更新的提示文案。
   *
   * ⚠️ 这些文案住在**网页**里，不在安装包里 —— 所以改一个错别字不需要发版。
   *    这是刻意的方案，理由见 apps/web/src/components/UpdateBanner.tsx 的文件头。
   *    （如果提示由主进程的原生对话框显示，这些字就会固化在用户已经装好的 exe 里，
   *      想改就得发版，而用户还得先更新才能看到改好的更新提示。）
   */
  /**
   * 桌面客户端下载入口。
   *
   * ⚠️ smartScreen* 两条不是客套话，是必需品：我们没有代码签名证书
   *    （计划 §8 明确接受这个代价），Windows 一定会拦。
   *    不提前说明的话，用户的反应是关掉不装 —— 那是合理的反应，
   *    因为我们确实看起来像个可疑程序。
   */
  download: {
    title: '桌面客户端',
    desc: '把资源库、日历和种子分享装进一个窗口，可以一直开着。Windows 10 / 11，64 位。',
    action: '下载',
    smartScreenSummary: '安装时 Windows 提示「未知发布者」怎么办？',
    smartScreenBody:
      '这是正常的 —— 我们没有购买代码签名证书。点提示里的「更多信息」，再点「仍要运行」即可。这个提示每次新版本安装时都会出现。',
  },
  update: {
    checking: '正在检查更新…',
    available: '发现新版本 {{version}}',
    download: '下载',
    downloading: '正在下载新版本 {{version}}… {{percent}}%',
    downloadingNoPercent: '正在下载新版本 {{version}}…',
    ready: '新版本 {{version}} 已就绪',
    restart: '重启并安装',
    none: '已经是最新版本',
    error: '更新出错：{{message}}',
    retry: '重试',
    dismiss: '关闭提示',
  },
  /**
   * 提交内容（M2 的 UGC 入口）。
   *
   * 一条贯穿始终的原则：**不要让人填完才被拒**。
   * 没登录、邮箱没验证、权限不够，都要在打开表单**之前**说清楚，
   * 而且每个"不行"都要给出下一步（去登录 / 去验证 / 去看已有的那一条）。
   * 表单本身可以很长（正文可能几千字），填完才被拦下来是最伤人的体验。
   */
  submit: {
    tagAdd: '添加',
    tagRemove: '点击移除这个标签',
    tagExistingHint: '已被用过的标签（推荐直接用，方便别人筛选）：',
    imageUpload: '本地上传',
    imageUploading: '上传中…',
    imageClear: '清除配图',
    errImageTooLarge: '图片超过 {{mb}} MB，请压缩之后再传。',
    errImageType: '这不是支持的图片格式。支持 PNG / JPG / WebP / GIF。',
    errImageFailed: '上传失败，请重试。',
    note: '给审核员的话（可选）',
    notePlaceholder: '例如：这是社区修正；或者上一轮驳回的那处已经改好了。',
    pageTitle: '提交资源',
    subtitle: '推荐一个 MCSR 相关的网站或工具。提交后需要审核，通过后才会出现在资源库里。',
    flowNote:
      '提交不会立刻上线：内容先进入待审队列，由审核员看过之后才会出现在资源库里。审核结果会出现在「我的」页面里。',

    title: '标题',
    titlePlaceholder: '例如：MCSR Ranked 排行榜',
    hintTitle: '用条目主要语言写。120 字以内。',
    titleEn: '英文标题',
    titleEnPlaceholder: '可选，例如：MCSR Ranked Leaderboard',
    hintTitleEn: '另一种语言的标题，方便两边的人搜到。内容本身不需要翻译。',

    url: '链接',
    urlPlaceholder: 'https://example.com',
    hintUrl: '必须是完整的 http:// 或 https:// 地址。',

    imageUrl: '配图',
    imagePlaceholder: '留空则自动取站点图标',
    hintImage: '可以本地上传（不超过 {{mb}} MB），也可以填一个链接。留空则自动取站点图标。',

    summary: '一句话简介',
    summaryPlaceholder: '留空则从正文自动提取',
    hintSummary: '列表页上显示的那句话。',

    body: '正文',
    bodyPlaceholder: '支持 Markdown。写清楚这是什么、怎么用、有什么坑。',
    writeTab: '编辑',
    previewTab: '预览',
    previewEmpty: '还没有内容。',

    tags: '标签',
    tagsPlaceholder: '例如：ranked, 排行榜, 1.16.1',
    hintTags: '逗号或空格分隔，最多 12 个。版本号（如 1.16.1）也是常用标签。',

    kind: '类型',
    hintKind: '网站 = 打开就能用的站点；工具 = 需要下载或安装的程序。',
    lang: '语言',
    hintLang: '条目主要内容的语言。',

    action: '提交审核',
    submitting: '提交中…',
    reviewNote: '提交后进入待审队列，通过后自动上线。',

    needLogin: '提交内容需要先登录。浏览是不需要登录的 —— 只有提交需要。',
    needVerify:
      '提交前需要先验证邮箱。这是唯一挡住提交的东西：我们要确保每条内容背后都有一个能收到回复的人。',
    gotoVerify: '去验证邮箱',

    doneTitle: '已提交',
    doneSub: '内容已进入待审队列，审核结果会出现在「我的」页面里。',
    doneRevision: '这是第 {{revision}} 版。审核员会看到它，通过后自动上线。',
    submitAnother: '再提交一条',
    viewMine: '查看我的提交',

    errDuplicate: '这个链接已经收录过了。',
    openExisting: '去看已有条目',
    /**
     * ⚠️ 与 `openExisting` 配对的那个动作文案。
     *
     * 📌 它比上面那批**晚一轮才被发现**，原因值得记：它是**作为数据**被引用的
     *    （`submissionErrors.ts:76` 的 `action.labelKey = 'submit.goEditMine'`），
     *    **不是** `t('…')` 的直接实参 ⇒ t10 那条"扫 `t('字面量')`"的守卫**扫不到它**。
     *    后果一模一样：界面上那颗按钮会显示 `submit.goEditMine` 这串原始 key。
     *    ⇒ 这是**已知的守卫盲区**（见 `services/api/src/i18n-keys.test.ts` 的说明），
     *      补它靠的是"把 labelKey 字面量也核一遍"，不是那条静态守卫。
     */
    goEditMine: '去改我那一条',
    errAlreadyPending: '这个条目已经有一份修改在等待审核了。等审核结果出来之后再改。',
    errNotAuthor: '这个条目不是你提交的，所以你不能修改它。',
    errNeedVerify: '邮箱还没验证，验证之后就能提交了。',
    errForbidden: '当前账号没有提交内容的权限。',
    /*
     * ⚠️ 以下 6 条由 **t10 的静态字面量键守卫**在 2026-09-13 查出：它们**被活跃代码引用、却从未存在过**
     *    （`submissionErrors.ts:73/:83/:88/:173/:182`、`ResourceForm.tsx:567`）。
     *    `t()` 对未知键**原样返回**，所以用户在**提交出错时**看到的是
     *    `submit.errUrlExistsMine` 这种字符串 —— 出错时才暴露，最糟的位置。
     *    📌 **归因：既有缺口**（不是本轮新增键落进盲区），补于 t10。
     *    判据留在代码侧：`services/api/src/i18n-keys.test.ts` 的"守卫三：字面量键必须真实存在"。
     */
    errUrlExistsMine:
      '这个链接你已经提交过了，但它还没上架（可能还在待审，或者被驳回过）。去把它改好就行，不用重新提交。',
    errUrlExistsLive: '这个链接已经在站上了。去看看那一条，不用重复提交。',
    errUrlExistsOther: '这个链接已经被别人提交过了，而那条还没上架。等它上架之后再来看。',
    errSessionExpired: '登录状态已过期（或者你还没登录）。重新登录之后就能继续。',
    errCrossOrigin:
      '这次请求被安全策略拒绝了：前端与接口的地址对不上。本地开发时最典型的原因是代理配错了。',
    hintNote: '{{used}} / {{max}} 字。这段话只有审核员看得到，不会出现在资源页面上。',
  },
  /**
   * 审核（**通用**，M4 的日历/视频/种子会复用同一套界面）。
   *
   * 文案里特别注意两处，它们是审核界面最容易做错的地方：
   *   · 驳回 vs 批准必须说清楚"线上发生了什么"（已发布条目的修改被驳回时，
   *     老内容仍然在线上 —— 不说的话审核员会以为自己把条目撤掉了）；
   *   · 401 和 403 的提示完全不同（去登录 / 你确实没权限），
   *     混成一句"出错了"会让有权限的人怀疑自己掉线了。
   */
  review: {
    mineBadge: '你提的',
    selfReviewBlocked:
      '这是你自己提交的内容，需要**另一位审核员**来批准。你可以驳回它（等于撤回）。',
    noteFromSubmitter: '提交者给审核员的话',
    queueTitle: '待审队列',
    queueCount: '共 {{count}} 项待审',
    queueEmpty: '当前没有待审内容',
    tabAll: '全部',
    nothingPending: '队列是空的',
    nothingPendingHint: '没有待审内容 —— 有新提交时会出现在这里。',
    refresh: '刷新',

    isEdit: '修改',
    isNew: '新条目',
    unknownAuthor: '未知作者',
    unknownTypeWarning:
      '队列里有当前界面还不支持的类型。请刷新页面；如果仍然出现，说明前端版本落后于服务端。',

    detailTitle: '审核',
    unknownType: '这个内容类型不存在（或者打错了地址）。',
    prevRejections: '该作者之前被驳回过 {{count}} 次。仅供参考。',
    editExplain: '这是对已发布条目的修改 —— 线上的内容**一个字都没变**，只有批准之后才会替换。',
    changed: '已改动',
    showOldBody: '展开线上版本的正文',

    decide: '审核决定',
    approve: '批准并上线',
    approving: '批准中…',
    reject: '驳回',
    rejecting: '驳回中…',
    rejectReason: '驳回理由（必填）',
    rejectPlaceholder: '写清楚需要改什么 —— 作者会原样看到这段话。',
    rejectHint: '{{used}} / {{max}} 字。没有理由的驳回等于让作者瞎猜，他会原样再提交一次。',

    approvedNotice: '已批准 r{{revision}}，内容已经上线。',
    rejectedNotice: '已驳回 r{{revision}}。',
    liveKept: '这个条目原本已经发布，所以线上的旧版本保留不变。',
    alreadyHandled: '这个条目刚刚已经被另一位审核员处理了 —— 这是并发审核的正常结果，不是出错。',
    actionFailed: '操作失败，请重试。',

    needLogin: '审核需要先登录。',
    forbidden: '你没有审核这类内容的权限。',
    forbiddenHint: '{{name}}，你的账号当前没有审核权限。需要的话请联系管理员调整角色。',
    forbiddenHintAnon: '这个页面需要审核权限。',
    gone: '这个条目已经没有待审内容了 —— 可能刚刚被处理掉。',
    backToQueue: '返回待审队列',
    openItem: '查看条目页',
    loadFailed: '加载失败，请稍后重试。',
  },
  /**
   * 「我的提交」。
   *
   * 整个审核管线的闭环就在这里：审核员被强制填写的驳回理由，
   * 唯一的读者是作者。这个页面不存在的话，那句理由写进数据库就再没有人看过。
   */
  mine: {
    edit: '修改',
    resubmit: '修改并重新提交',
    pendingHint: '已经有另一份修改在等待审核了。等这一份出结果之后可以再改。',
    reviewedAt: '审核于 {{date}}',
    title: '我的提交',
    subtitle: '你提交过的内容，以及它们现在处于哪一步。',
    empty: '还没有提交过内容',
    emptyHint: '看到值得收录的网站或工具，可以推荐到资源库里。',
    loadFailed: '加载失败，请稍后重试。',
    submitNew: '提交新内容',
    liveRevision: '线上 r{{revision}}',
    pendingRevision: '待审 r{{revision}}',
    openItem: '查看条目页',
    rejectReasonTitle: '被驳回的原因',
  },
  /**
   * 编辑已有条目（M2 第二轮）。
   *
   * 两种进入方式，文案要能同时兼容：
   *   · 从条目详情页点「建议修改」—— wiki 式，改的是别人的或导入的条目
   *   · 从「我的提交」点「修改并重新提交」—— 自己被驳回的条目
   */
  edit: {
    title: '修改条目',
    subtitle: '改完之后会重新进入审核队列 —— 审核通过之前，线上仍然是现在这一版。',
    suggestAction: '建议修改',
    liveUnchanged:
      '提交这个修改**不会**立刻改变页面上的内容：它会进入待审队列，审核通过之后才会替换现在的版本。',
    /** 表单底部的提交按钮 */
    action: '提交修改',
    /** 详情页上的入口按钮（内容编辑 / 管理员看到的是这个词） */
    modifyAction: '修改',
    editorHint: '你改完可以直接在审核队列里批准这一版。',
    busyNotice:
      '现在有一份修改（r{{revision}}）正在等审核 —— 一条内容同时只允许一份待审修改，所以暂时不能提交新的改动。等那份出结果之后再改，或者先去审核队列看看它改了什么。',
    busyGoReview: '去审核队列看那一份',
    submitting: '提交中…',
    doneTitle: '修改已提交',
    doneSub: '这一版已经进入待审队列。审核通过后，页面上的内容才会换成它。',
    notFound: '找不到这个条目，或者它还不是你的（未上架的条目只有作者能打开）。',
    loadFailed: '加载失败，请稍后重试。',
  },
  /**
   * 内容治理：精选 / 官方 / 下架。
   *
   * 这些是**编辑决定**，不是审核决定：
   * 审核回答"这一版能不能上线"，治理回答"已经在线的这一条要不要
   * 继续以这个姿态出现"。所以文案也要能看出这个区别 ——
   * "下架"不是"驳回"，它不针对某一版，而是针对线上这一条。
   */
  moderate: {
    title: '内容治理',
    hide: '下架',
    restore: '恢复上架',
    failed: '操作失败，请重试。',
    hiddenNote: '这条内容已经**下架**，资源库里不再显示它。要重新上架，就在这一页点「恢复上架」。',
    showHidden: '显示已下架',
    hiddenBadge: '已下架',
  },
  /**
   * 账号管理（只有 admin）。
   *
   * 文案里贯穿的一件事：**每个禁用的控件都要说明为什么**。
   * "其他管理员改不了"是一个策略决定，不是界面故障 ——
   * 用户看到灰色选择框时必须有地方能读到这句话。
   */
  admin: {
    title: '账号管理',
    subtitle: '共 {{count}} 个账号。改角色必须填写理由，理由会进审计日志。',
    colAccount: '账号',
    colVerified: '邮箱已验证',
    colCreated: '注册时间',
    colRole: '权限组',
    selfBadge: '我',
    yes: '是',
    no: '否',
    save: '保存',
    saving: '保存中…',
    roleChanged: '已改为「{{role}}」',
    reasonPlaceholder: '改角色的理由（必填）',
    peerLocked: '其他管理员的角色不能改 —— 管理员之间是平级的。',
    lockedOwner: '涉及 owner 的角色只能在服务器上改（admin.js role）。',
    lockedSelf: '不能降级自己 —— 那样会把自己关在管理界面外面。',
    lockedPromote: '不能把别人提升为管理员。',
    lockedPeer: '其他管理员的角色不能改 —— 管理员之间是平级的。',
    lockedGeneric: '这一行的角色不能改。',
    lastAdminNote:
      '如果你是自己账号上的最后一个管理员，把自己降级会被拒绝：那样就没有人能再改角色了。真要那样做，用服务器上的 admin.js role 命令。',
    forbidden: '你没有管理账号的权限。',
    loadFailed: '加载失败，请稍后重试。',
    errPeer: '不能修改其他管理员的角色。',
    errLastAdmin: '不能降级最后一个管理员，否则没人能再改角色了。',
    errReason: '必须填写改角色的理由。',
    errFailed: '操作失败，请重试。',
  },
  /**
   * 个人标记：收藏 / 备注 / 评分。
   *
   * ⚠️ 文案里必须说清**备注是私有的** —— 不说的话用户会以为那是公开评论，
   *    于是要么不敢写，要么把它当公共内容写，两种都不对。
   */
  marks: {
    favorite: '收藏',
    favorited: '已收藏',
    myRating: '我的评分',
    rateN: '打 {{n}} 分',
    clearRating: '取消评分',
    noRating: '暂无评分',
    ratingCount: '{{count}} 人评分',
    ratingTitle: '平均 {{avg}} 分，共 {{count}} 人评分',
    note: '我的备注（只有你自己看得到）',
    notePlaceholder: '例如：这个工具在 1.16.1 上要注意什么、我为什么收藏它。',
    noteHint: '{{used}} 字。这段文字**不会**出现在条目页上，也不会被别人看到。',
    noteLabel: '我的备注',
    saveNote: '保存备注',
    noteSaved: '备注已保存',
    saving: '保存中…',
    saved: '已保存',
    saveFailed: '保存失败，请重试。',
    needLogin: '登录之后可以收藏、评分，并写下只有自己看得到的备注。',
    favoritesTitle: '我的收藏',
    favoritesSubtitle: '你收藏过的条目，以及你写下的备注和评分。',
    noFavorites: '还没有收藏任何条目',
    noFavoritesHint: '在条目页上点「收藏」，之后就能在这里回看 —— 顺便记一句为什么收它。',
    gone: '这条内容当前不在站上',
    loadFailed: '加载失败，请稍后重试。',

    /*
     * ⑤ 收藏数。
     *
     * ⚠️ 这一条是**计数**，不是动作 —— 动作那几条在上面（`favorite` / `favorited`）。
     *    分开写而不是拼一句"已收藏"，因为卡片上要的是一个数字（`★ 3`），
     *    而"已收藏"是**我自己**的状态，两者含义相反。
     *
     * ⚠️ 插值必须写**双**花括号 `{{count}}` —— 本文件与 en.ts 的**全体计数词条**
     *    都必须遵守这一条，而这不是风格问题：i18next 对单花括号的 `{count}`
     *    **不报错、不替换、原样显示**，用户会直接看到字面的 `收藏 {count}`。
     *    （实测：`t('收藏 {count}', { count: 3 })` → `"收藏 {count}"`。）
     *
     * ⚠️ **这一条没有任何自动检查守着**：`i18n-keys.test.ts` 比的是**键**、
     *    不比**值**，所以"中英键完全对齐、而某一侧的值写成了单花括号"可以全绿通过。
     *    本仓库真的发生过一次（en.ts 的 favoriteCount 曾写成 `'{count} saved'`）。
     *    守它的办法只有两条：改词条时照抄邻近词条的写法，以及人眼过一遍 ——
     *    若要机械化，需要一个按 key 比对两侧占位符集合的断言（目前没有）。
     *
     * ⚠️ 也**不要**写成 i18next 的复数后缀键（`favoriteCount_one` /
     *    `favoriteCount_other`）：本仓两份词条里**一个复数后缀键都没有**，
     *    现有同类文案都是单键 + 插值（见 `resultCount` / `seriesCount`）。
     *    写了后缀键会让"中英逐条对齐"那条测试报"en 多一条"。
     */
    favoriteCount: '收藏 {{count}}',
    noFavoriteYet: '还没有人收藏',
  },
  /**
   * 日历（M4）。
   *
   * 三条约束贯穿整个版块的文案：
   *
   *   1. **时间必须和时区名一起出现**（Q2：存"当地时间 + 时区名"，显示时转本地）。
   *      单独一个 `20:00` 是没有意义的信息 —— 那是哪个 20:00？
   *      补上时区名之后，不在那个时区的用户也能自己换算。
   *
   *   2. **「已结束」是算出来的，不是状态**（见 shared/calendar.ts 的 isEventPast）。
   *      所以它长在事件上，而不是一个可以被审批改变的状态值 ——
   *      文案不能把它写得像是谁把它设成这样的。
   *
   *   3. **过去的事件仍然进审核队列**（Q4c）。见 pastBadge / pastExplain：
   *      审核员必须被告知"这不是填错了"。
   */
  calendar: {
    // ---- 枚举。界面上永远显示这些，不显示 RANKED_MILESTONE / QUARTERFINAL 这种原始值 ----
    tag: {
      TOURNAMENT: '赛事',
      COMMUNITY: '社区活动',
      RANKED_MILESTONE: '排位节点',
    },
    stage: {
      QUALIFIER: '资格赛',
      ROUND: '正赛轮次',
      QUARTERFINAL: '四分之一决赛',
      SEMIFINAL: '半决赛',
      THIRD_PLACE: '季军赛',
      FINAL: '决赛',
    },
    /*
     * 专业程度 / 参与范围（011 新增的两维）。
     *
     * ⚠️ 和上面 tag / stage 那两组的**唯一**区别：这两组从一开始就走词条，
     *    没有写死在 shared 的映射里。上面那两组是历史遗留（见
     *    shared/calendar.ts 末尾那条注释）—— 新的不要学它们。
     *
     * ⚠️ 取值都是**可空**的（排位节点没有这两维），所以界面上每组都要有一个
     *    明确的「不限」选项 —— 否则"没填"和"不限"在界面上分不开：
     *    前者是数据的状态，后者是筛选的状态，它们看起来一样但含义相反。
     */
    level: {
      PRO: '职业',
      SEMI_PRO: '半职业',
      AMATEUR: '业余',
      CASUAL: '休闲',
    },
    scope: {
      GLOBAL: '全球',
      CONTINENT: '大洲',
      COUNTRY: '国家',
      REGION: '地区',
    },
    /** 三个单选筛选维度共用的"不过滤"选项。 */
    filterAny: '不限',

    yes: '是',
    no: '否',

    /**
     * ★ Q4c：过去的事件也进审核队列，所以审核员会**真的遇到**已经结束的条目。
     *
     * 这两句话要同时说清两件事：这是正常的（不是填错了），以及
     * 「时间在过去」本身不构成收录或不收录的理由 —— 否则审核员会
     * 默认驳回一切历史条目，而历史赛事条目恰恰是有价值的那一类。
     */
    pastBadge: '已结束',
    pastExplain:
      '这个事件的时间已经过去了。它仍然进入审核队列，因为「时间在过去」本身不是收录或不收录的理由 —— 历史赛事条目同样有价值。请就内容本身判断。',

    /** 审核详情里的字段标签。 */
    fields: {
      title: '标题',
      titleEn: '英文标题',
      startsAt: '开始时间（当地时间）',
      timezone: '时区',
      endsAt: '结束时间（当地时间）',
      endsTz: '结束时区',
      allDay: '整天事件',
      tags: '标签',
      stage: '轮次',
      level: '专业程度',
      scope: '参与范围',
      location: '地点',
      url: '相关链接',
      lang: '语言',
      description: '事件说明',
    },

    // -------------------------------------------------------------------------
    // 列表页
    // -------------------------------------------------------------------------
    submitAction: '提交活动',
    listSubtitle:
      '赛事、社区活动和排位赛季节点。时间按主办方公布的那个时区保存 —— 所以每一条都会带出它的时区名。',
    filterTagsLabel: '想看哪几类',
    /*
     * ⚠️ 这里原来还有两条（`filterTagsHint` / `filterTagsLocked`），已删。
     *
     * 它们服务的是"最后一个标签关不掉"那条规则 —— 而那条规则的**唯一**
     * 理由是服务端表达不了"一个标签都不选"（空数组和不传参数是同一个查询），
     * 所以界面既不能真的关到零，也不能骗用户说关掉了。
     *
     * 改成客户端筛选之后，那条理由消失了：一个都不选就是**什么都不显示**，
     * 完全诚实。于是这两条文案变成了孤儿。
     * （孤儿词条不报错，只会让下一个人以为那条分支还在。）
     */
    showPast: '显示已结束',
    resultCount: '共 {{count}} 个活动',
    empty: '当前筛选条件下没有活动',
    emptyHint: '把「显示已结束」打开，或者重新选上刚才关掉的标签。',
    loadFailed: '加载失败，请稍后重试。',
    backToList: '返回日历',
    until: '至 {{time}}',
    allDayBadge: '整天',
    yourTime: '你那边是 {{time}}（{{tz}}）',

    // -------------------------------------------------------------------------
    // ICS 订阅
    //
    // ⚠️ M4 的验收标准里有一条就是它：「订阅的 ICS 能在手机自带日历里看到」。
    //    所以这里的每一句都在回答"我该在哪一步把这个链接粘进去"，
    //    而不是"这个文件可以下载"。
    // -------------------------------------------------------------------------
    icsTitle: '订阅日历',
    icsWhy:
      '订阅之后日历会跟着自动更新。下载下来的 .ics 只是一份一次性快照 —— 存进手机那一刻是什么样，以后就一直是那样，新批准的赛事不会自己出现。',
    icsUrlLabel: '订阅地址（复制它，粘到手机的日历里）',
    icsCopy: '复制链接',
    icsCopied: '已复制',
    icsCopiedHint: '已经复制好了。接下来把它粘进日历客户端的「订阅」或「通过网址添加」里。',
    icsCopyManual: '没能自动复制。链接已经选中了，按 Ctrl+C（手机上长按）把它复制走。',
    icsWebcal: '直接交给系统日历',
    icsWebcalHint: 'iOS / macOS 上有效，其它系统请用上面的复制方式。',
    icsNoOrigin: '当前环境拿不到站点地址，所以生成不出能粘贴的订阅链接。请在正式站点上打开这一页。',
    icsIosTitle: 'iPhone / iPad',
    icsIos: '设置 → 日历 → 账户 → 添加账户 → 其他 → 添加已订阅的日历 → 把链接粘进「服务器」→ 存储',
    icsAndroidTitle: 'Android',
    icsAndroid:
      '系统自带的日历没有订阅入口，要用网页版 Google 日历：其他日历 → 通过网址添加 → 粘贴链接',
    icsDesktopTitle: '电脑',
    icsDesktop:
      'macOS 日历：文件 → 新建日历订阅。Outlook 或 Google 日历网页版：添加日历 → 通过网址订阅。',
    icsRefresh: '日历客户端通常隔几小时到一天才拉一次，所以刚批准的活动不会马上出现在手机上。',
    icsPublishedOnly: '只有已发布的活动会进订阅。待审和被驳回的不会 —— 审核通过之后它会自动出现。',

    /**
     * ③ 订阅块下移到页面底部之后，顶部那个**锚点**的文字。
     *
     * ⚠️ 这个链接是下移的**配套件，不是可选项**：M4 把"找得到订阅入口"当成
     *    验收标准，所以当年才把它放在筛选栏之后。下移不能以弄丢它为代价 ——
     *    一次点击的成本换回"别让一次性动作用掉首屏"。
     * ⚠️ 它**不是第二个订阅入口**：复制链接与分步说明仍然只有底部那一处。
     */
    icsJump: '订阅日历 ↓',

    // -------------------------------------------------------------------------
    // 系列活动（③）
    //
    // 栏目的作用是"归类同一活动的不同赛季/届次"：同一个系列名下面的场次归到一起。
    // 系列是**实体**（`calendar_series` 表），表单从已有系列里选、或新建一个。
    //
    // ⚠️ 这几条**不进筛选栏**：系列的取值集合是开放的（可能有几十个），
    //    和筛选栏那四个封闭枚举维度形态不同（见 calendar.ts 的 seriesId 说明）。
    //    系列筛选走 `?seriesId=` 并在内容区顶部显示一条状态条。
    //
    // ⚠️ **系列对匿名访客开放**（§9-5 的裁决）：列表与搜索都不要求登录，
    //    所以这里**没有**"登录后才能搜索"那句话 —— 那句会让匿名用户以为
    //    自己被挡在门外，而实际上他能看也能搜。
    // -------------------------------------------------------------------------
    seriesSectionTitle: '系列活动',
    seriesSectionHint: '同一赛事的不同赛季/届次填同一个系列名，就会自动归到一起。',
    seriesSearch: '搜索系列活动',
    /**
     * ⚠️ 这一条和 `seriesEmpty` 是两句不同的话，**不要合成一句**：
     *    这一句是"搜了，但没匹配上"，`seriesEmpty` 是"这里还没有任何系列"。
     *    合成一句会让用户以为系列数据没了，而不是自己的关键词没命中。
     */
    seriesNoMatch: '没有匹配的系列',
    seriesEmpty: '还没有系列活动',
    /** ⚠️ `{{count}}` 是 i18next 的插值语法（单花括号会原样显示，见 marks.favoriteCount 的说明）。 */
    seriesCount: '{{count}} 场未结束',
    seriesNoneUpcoming: '暂无未结束的场次',
    /** 系列筛选激活时内容区顶部那条状态条。 */
    seriesFilterActive: '正在看：{{name}}',
    seriesFilterClear: '清除系列筛选',
    /** 表单里的系列字段（选已有系列，或新建一个）。 */
    seriesField: '系列活动',
    seriesFieldHint:
      '可选。同一赛事的不同届次填同一个名字（例如 MCSR Ranked Season）；日历页底部会把它们归到一起。',
    /** 表单里"新建系列"那个入口。 */
    seriesCreate: '新建系列',
    /** `POST /api/calendar/series` 撞上 `COLLATE NOCASE UNIQUE` 时（`reason: 'series_name_taken'`）。 */
    seriesNameTaken: '这个名字已经有系列在用了。',

    // -------------------------------------------------------------------------
    // 详情页
    // -------------------------------------------------------------------------
    openLink: '打开相关链接',
    infoTitle: '活动信息',
    author: '提交者',
    updatedAt: '最后更新',
    infoId: '编号',
    pastNotice: '这个活动已经结束了。下面是它当时的信息，保留下来是因为它仍然有参考价值。',
    pendingNotice:
      '这条有一版改动（r{{revision}}）正在等审核。审核通过之前，页面上仍然是现在这一版。',
    notPublished: '这个活动还没上架',
    notPublishedHint:
      '可能是还在等审核、被驳回了，也可能这个地址根本不对（这两种情况对访客都显示成「不存在」）。如果是你提交的，可以从编辑页打开它。',
    openEditor: '打开编辑页',
    openItem: '查看活动页',

    // -------------------------------------------------------------------------
    // 提交 / 修改
    // -------------------------------------------------------------------------
    submitTitle: '提交活动',
    submitSubtitle: '填主办方公布的那个时间，连同它的时区一起填 —— 别人才能正确换算到自己那边。',
    submitFlowNote:
      '提交后会进入审核队列。审核通过之前，这个活动不会出现在日历里，也不会出现在 ICS 订阅里。',
    doneTitle: '已提交，等待审核',
    doneSub: '审核通过之后，它会出现在日历列表和 ICS 订阅里。',
    submitAnother: '再提交一个',
    editTitle: '修改活动',
    editSubtitle: '改完之后会重新进入审核队列 —— 审核通过之前，线上仍然是现在这一版。',
    editAction: '提交修改',
    editLiveUnchanged:
      '提交这个修改不会立刻改变线上内容：它会进入待审队列，审核通过之后才会替换现在的版本。',
    editDoneTitle: '修改已提交',
    editDoneSub:
      '这一版已经进入待审队列。审核通过之前线上仍然是旧版 —— 页面上不会立刻看到你的改动。',
    editBusyNotice:
      '现在有一份修改（r{{revision}}）正在等审核 —— 一条活动同时只允许一份待审修改，所以暂时不能提交新的改动。等那份出结果之后再改。',
    editBusyWhat: '待审的那一版',
    editNotFound: '找不到这个活动，或者它还不是你的（未上架的活动只有作者能打开）。',
    reviewNote: '提交后进入待审队列，通过后自动上线。',

    // ---- 表单字段的提示 ----
    hintTitle: '照抄赛事公告上的名字，中文或原文都可以。',
    titlePlaceholder: '例如：MCSR Ranked 第 5 赛季 季后赛',
    hintTitleEn: '可选。不会自动翻译 —— 留空时英文界面会直接显示上面那个标题。',
    titleEnPlaceholder: '例如：MCSR Ranked Season 5 Playoffs',
    hintAllDay: '整天事件只需要选日期 —— 时间固定为 00:00，日期选择器里也填不了钟点。',
    hintStartsAt: '填主办方公布的那个时间，「不是你所在时区的时间」。',
    hintTimezone:
      'IANA 时区名，例如 Asia/Shanghai。填错会让整场赛事偏移几个小时，而且看起来完全正常。',
    hintEndsTz: '和开始用的时区不同才需要改。',
    hintEndsAt: '很多赛事只公布开始时间，所以可以留空。留空时它在订阅里是一个时间点。',
    hintEndsAtAllDay:
      '结束日期指的是最后一天。只占一天的活动请留空 —— 填成和开始同一天会被判成时间反了。',
    hintLocation: '线下赛的场馆，或者线上赛的平台。',
    locationPlaceholder: '例如：线上 / 上海',
    hintUrl: '赛事公告、报名页或者直播间的链接。',
    hintTags: '至少选一个。一个标签都没有的活动，在按标签筛选的界面上等于不可见。',
    hintStage: '可选。它只是一个标签，不做对阵层级 —— 横跨一周的连续赛事可以直接不填。',
    stageNone: '不填',
    /*
     * 011 新增的两维。
     *
     * ⚠️ 空选项的文案刻意和 stage 那条**不同**（"不适用" vs "不填"）：
     *    stage 是"这场赛事还没到那个轮次，所以不填"；
     *    而这两维对排位节点这类事件是**根本不存在**的 —— 说"不填"会让
     *    录入者觉得自己漏了一项，然后随便选一个，把数据污染掉。
     */
    hintLevel: '可选。这项赛事有多正式 —— 排位节点这类没有专业程度的活动可以直接留空。',
    hintScope: '可选。谁能参加（不是"在哪打"，地点填"线上"时这一项照样有意义）。',
    dimNone: '不适用 / 不限',
    descriptionPlaceholder: '支持 Markdown。写清楚这是什么比赛、怎么参加、有什么要注意的。',
    hintDescription: '{{used}} / {{max}} 字。',
    notePlaceholder: '例如：时间取自主办方公告；这是社区自己办的比赛。',
    hintNote: '{{used}} / {{max}} 字。这段话只有审核员看得到，不会出现在活动页面上。',
    tzOffsetHint: '这个时区现在是 {{offset}}。',

    // ---- 表单校验 ----
    //
    // ⚠️ 这些话**不来自 schema**。schema 的消息是中文写死的，
    //    直接显示它会在英文界面上冒出一句中文，而那只在出错时才看得到。
    //    映射见 components/CalendarForm.tsx 的 issueText。
    errTitleRequired: '标题不能为空。',
    errTitleTooLong: '标题最多 {{max}} 字。',
    errDescTooLong: '说明最多 {{max}} 字。',
    errLocationTooLong: '地点最多 {{max}} 字。',
    errUrlTooLong: '链接太长了。',
    errNoteTooLong: '给审核员的话最多 {{max}} 字。',
    errTagsMin: '至少选一个标签。',
    errTzTooLong: '时区名太长了。',
    errTzRequired: '请填写时区名（例如 Asia/Shanghai）。',
    errStartRequired: '请填写开始时间。',
    errInvalidTz: '这个时区名无效 —— 检查一下拼写（例如 Asia/Shanghai）。',
    errEndNeedsBoth: '结束时间需要同时给出时间和时区。',
    errWallClock: '时间格式应为 2026-08-30T20:00。',
    errAllDayTime: '整天事件的时间必须是 00:00。',
    errEndBeforeStart:
      '结束时间必须晚于开始时间。判据是换算成 UTC 之后的时刻 —— 跨时区时钟点会看反。',
    errAllDayEndOrder:
      '整天事件的结束日期要晚于开始日期，而且它指的是最后一天。只占一天的话请把结束日期留空。',
    errGeneric: '有字段没通过校验，检查一下上面标出来的地方。',
    errAlreadyPending: '已经有一份修改在等审核了 —— 一条活动同时只允许一份待审修改。',
  },
  /**
   * 月历表与顶部筛选栏（日历改版）。
   *
   * 单独一节而不是塞进 `calendar`：那一节已经有 99 条（表单、卡片、详情页），
   * 再加三十条会和它们混在一起；而这两块是**一个整体的界面** ——
   * 改的时候一起改、读的时候一起读。
   */
  calendarGrid: {
    // ---- 两个视图 ----
    viewMonth: '月历',
    viewList: '列表',
    viewSwitchLabel: '显示方式',

    // ---- 年月切换 ----
    prevMonth: '上个月',
    nextMonth: '下个月',
    prevYear: '上一年',
    nextYear: '下一年',
    today: '今天',
    pickMonth: '选择月份',

    // ---- 网格 ----
    /**
     * 每个格子的无障碍名字。
     *
     * ⚠️ 必须带上"有什么"，不能只念日期数字：屏幕阅读器用户走一遍网格
     *    会听到 42 个日期，那等于没有信息。带上第一条的标题之后，
     *    他至少能决定"这一天要不要进去看"。
     */
    dayLabel: '{{date}}，{{count}} 个活动，第一个是「{{first}}」',
    dayLabelEmpty: '{{date}}，没有活动',
    /** 格子里超过三条时收成这个。里面已经带 `+`，所以不需要额外的图标。 */
    moreCount: '+{{count}}',
    rangeCount: '当前视图共 {{count}} 个活动',

    // ---- 当天详情面板 ----
    dayPanelLabel: '选中日期的安排',
    pickDayHint: '点一个日期，看那天的安排。',
    noEventsOnDay: '这一天还没有安排。',
    addOnDay: '在这天加活动',

    // ---- 筛选栏 ----
    filterLevel: '专业程度',
    filterScope: '参与范围',
    filterStage: '轮次',
    /**
     * ⚠️ 这一句是在说清"标签和另外三个不是一回事"。
     *    不写的话，用户选了"职业"却发现列表里混着业余的（其实是标签那一维
     *    命中了别的），很难自己推出来。
     */
    filterHint: '标签可以多选，命中任意一个就显示；专业程度、参与范围、轮次是单选。',
    filterReset: '清空筛选',
    noTagsSelected: '一个标签都没选。',
    noTagsHint: '打开至少一个标签，才会有活动显示出来。',
  },
  /**
   * 视频墙（M4）。
   *
   * Q6：**贴了就可见，不审核** —— 这一点在文案里要看得出来。
   * 用户不该担心"我贴的东西要不要等审核"，也不该在贴完之后去找"待审核"状态。
   *
   * ⚠️ Q21 的另一个要点：这是**内容型视频**（教程/集锦/比赛录像），
   *    不是直播 VOD。文案不要出现"直播""回放"这类词 —— 那会把用户引导去贴
   *    一场 Twitch 直播链接，而 v1 要的是 B站/YouTube 的固定视频。
   */
  videos: {
    // ---- 页面骨架 ----
    /*
     * ⚠️ 板块**改名**了：原来的「视频」→「娱乐视频」（见 docs/calendar-video-rework.md）。
     *
     * 为什么这一块的几个字符串要一起改：它们都是**引用板块名字**的句子。
     * 只改标题的话，页面上会同时出现「娱乐视频」和「视频墙」两种叫法 ——
     * 而用户会以为它们是两个不同的地方（这正是改名的目的要避免的事）。
     * 所以凡是**指名道姓**提到这一块的地方都跟着改；
     * 而「墙」这个**比喻**（"墙上还没有视频"）可以留着，它描述的是版式不是名字。
     */
    title: '娱乐视频',
    subtitle:
      '社区贴的 B站 / YouTube 视频 —— 教程、集锦、比赛录像，随时在变。不需要登录就能看。想看直播请去「直播」板块。',
    pasteAction: '贴个视频',
    viewAll: '娱乐视频',
    viewMine: '我贴的',

    // ---- 筛选 ----
    allPlatforms: '全部平台',
    platformBilibili: 'B站',
    platformYoutube: 'YouTube',
    platformTwitch: 'Twitch',
    authorFilter: '只看 {{name}}',
    clearAuthor: '取消作者筛选',
    clearFilters: '清除筛选',
    resultCount: '共 {{count}} 条',
    resultCountFiltered: '筛选出 {{count}} 条',

    // ---- 列表状态 ----
    noResults: '墙上还没有视频',
    noResultsHint: '换个筛选条件，或者贴一个上去 —— 贴完立刻可见。',
    loadFailed: '加载失败',
    page: '第 {{page}} / {{total}} 页',
    prevPage: '上一页',
    nextPage: '下一页',

    // ---- 嵌入 ----
    play: '播放',
    playHint: '点一下才加载第三方播放器',
    embedUnavailable: '拿不到页面域名，这个平台没法嵌入播放。',
    openOriginal: '去原站看',
    startFrom: '从 {{time}} 开始',
    startIgnoredShort: '该平台不支持跳转，会从 0 开始',

    // ---- 表单 ----
    formTitle: '贴一个视频',
    url: '视频链接',
    urlPlaceholder: '粘贴某一个视频的播放页链接',
    hintUrl: 'B站 / YouTube / Twitch 的**单个视频**链接。频道、播放列表、合集首页都读不出视频 ID。',
    recognized: '已识别 {{platform}} · {{id}}',
    notRecognized: '还读不出视频 ID',
    titleLabel: '标题',
    titlePlaceholder: '这条视频讲什么',
    hintTitle: '标题自己填 —— 我们不去抓平台上的元数据，所以链接不会自动带出标题。',
    startOffset: '起始时间（可选）',
    startOffsetPlaceholder: '90 / 1:30 / 1:02:33',
    hintStartOffset: '从这个时间点开始播放。填 90、1:30、1:02:33 都可以。',
    hintStartOffsetUnsupported: '该平台不支持跳转，这个值会被保存但播放时不会生效。',
    errStartOffset: '时间格式不对：可以填 90、1:30 或 1:02:33，冒号后面的数字不能超过 59。',
    errUrlRequired: '请粘贴视频链接。',
    errTitleRequired: '标题不能为空。',
    action: '贴到墙上',
    submitting: '正在贴…',
    noReview: '贴完立刻可见：视频不审核，没有待审这一档。',
    doneTitle: '已经贴在墙上了',
    doneNote: '没有审核这一步，它现在就在娱乐视频里。',
    doneStartIgnored: '起始时间存下来了，但这个平台播放时不会跳转。',
    submitAnother: '再贴一个',
    viewWall: '去看娱乐视频',

    // ---- 错误 ----
    errExistsVisible: '这个视频已经在墙上了。',
    errExistsHidden: '这个视频被隐藏过，墙上现在看不到它。',
    errExistsMine: '这是你自己之前贴的那一条。',
    mineNeedLogin: '看「我贴的」需要先登录。看娱乐视频不需要。',
    gotoMine: '去我贴的看看',

    // ---- 卡片与事后手段 ----
    postedAt: '贴于 {{date}}',
    mineBadge: '我贴的',
    hiddenBadge: '已隐藏',
    delete: '删除',
    hide: '隐藏',
    restore: '恢复',
    busyDeleting: '正在删除…',
    busyHiding: '正在隐藏…',
    busyRestoring: '正在恢复…',
    confirmDelete: '删掉之后这条记录就没了，不能撤销。确定吗？',
    okDeleted: '已删除。',
    okDeleteNoop: '它已经不在了 —— 你要的结果已经达成。',
    okHidden: '已隐藏。墙上不再显示它，作者自己还看得到。',
    okHideNoop: '它本来就是隐藏的。',
    okRestored: '已恢复。',
    okRestoreNoop: '它本来就是可见的。',
    actionFailed: '操作失败',

    // ---- 「我贴的」 ----
    mineEmpty: '你还没贴过视频。',
    mineEmptyHint: '贴一个上去 —— 贴完立刻可见。',
    mineHiddenNote: '被隐藏的视频只有你自己在这里看得见，墙上没有它们。',
  },
  /**
   * Ranked Seeds 检索页（M4）。
   *
   * ⚠️ 这个版块的文案里有两个数字必须一直是**真的**：
   *   · 「上游只覆盖约 80% 的历史比赛」—— 所以"查不到"是常态，不是错误
   *   · 「当前条件命中 N 条」—— 来自 availableCounts，**不要**用别的数去替代
   *     （尤其不要用"结果条数"，因为我们一次只返回一条随机结果）
   */
  seedsPage: {
    /*
     * ---------------------------------------------------------------------------
     * 为什么这一节里**没有**「数据可能有延迟」这类提示
     * ---------------------------------------------------------------------------
     * 上游文档的 v2.html 写着 `/seedinfo`「数据可能有数天的延迟」，但用户
     * 2026-09-12 明确更正：两个端点实际都是实时的，是文档没跟上
     * （见 docs/m4-decisions.md Q18 与 docs/ranked-seeds-api.md §3）。
     *
     * 假提示比没有提示更糟：用户会因此不去信任一个其实准确的数字，
     * 而那句话还得有人一直维护。**不要再加回来。**
     */
    title: '排位种子检索',
    subtitle:
      '按结构、变种和完赛时间从上游的排位种子库里随机抽一条，或者按比赛 ID 查某一场的种子值。',

    /**
     * ⚠️ 「约 80%」这个数字必须一直是真的（上游自述）。它存在的意义是：
     *    按比赛 ID 查不到时，用户要能立刻明白那是**常态**而不是我们坏了。
     */
    coverage: '上游只收录约 80% 的历史比赛，所以「查不到某一场」是常态，不是故障。',

    // ---- 检索 ----
    searchTitle: '按条件随机抽一条',
    searchHint: '条件只用来挑种子，不会改变种子本身。想要完全随机，就一条条件都别选。',
    randomAction: '随机一条',
    searchAction: '按条件随机一条',
    searching: '查询中…',
    /*
     * 这句是**行为说明**，不是装饰：界面在替用户选端点
     * （无条件 → /random，有条件 → /search），用户至少该知道这件事发生过。
     */
    filterNote: '没有选任何条件时走上游的「随机一条」，选了条件之后自动改用检索接口。',

    filterOverworld: '主世界结构',
    filterNether: '下界堡垒遗迹',
    filterAny: '不限',

    variations: '结构变种',
    variationsHint: '先选一组，再在里面勾具体词条。多选表示「同时满足」。',
    variationsExpand: '展开',
    variationsCollapse: '收起',
    variationsClear: '清空变种',
    variationsSelected: '已选 {{count}} 条',
    /**
     * ⚠️ 词条表的**来源**要对用户说实话。
     *
     * 上游没有「列出全部词条」的接口，所以这份表 = 上游文档里那棵树
     * + 我们真的在结果里见过的词条。两句话都要说，否则用户会以为
     * 这个列表是完整的（它不是，上游随时会加新的）。
     */
    variationsSource: '词条来自上游文档的分类树，并会自动补上我们在结果里实际见过的词条。',

    completion: '完赛时间上限',
    completionPlaceholder: '分:秒，例如 2:35',
    completionHint: '只返回排位模式、且完赛时间不超过它的种子。留空表示不限。',

    hits: '当前条件命中 {{count}} 条',
    /**
     * `availableCounts` 是 number | null。**取不到时不能显示 0** ——
     * 0 的意思是「一条都没有」，而这时我们手里明明拿着一条种子。
     */
    hitsUnknown: '上游没有给出命中数',

    // ---- 结果 ----
    resultTitle: '结果',
    resultEmpty: '还没有结果。点上面的按钮抽一条。',
    /**
     * ⚠️ 条件改过之后，卡片上那条种子**不再对应**当前的条件。
     *
     * 不说的话，用户会以为它满足现在的筛选 —— 界面上没有任何东西是错的，
     * 错的是"这条结果属于哪一次查询"没有被记下来。他拿着一条不符合预期的
     * 种子去开世界，然后几乎不可能查出真因。
     */
    resultStale: '上面这条是**上一次**的条件抽出来的。条件改过了，再点一次按钮才会按新条件重抽。',
    matchIdLabel: '比赛 ID',
    matchDateLabel: '比赛时间',
    matchDateUnknown: '上游没有给出这场比赛的时间',
    overworldSeed: '主世界',
    netherSeed: '下界',
    theEndSeed: '末地',
    theEndMissing: '上游没有给出末地种子',
    /**
     * ⚠️ 复制按钮不是锦上添花：种子是 19 位数字（`7304888896886165976`），
     *    手抄进 Minecraft 不现实，而抄错一位就会生成一个完全不同的世界。
     */
    copy: '复制',
    copied: '已复制',
    copyFailed: '复制失败，请手动选中数字再复制',
    viewInfo: '看这条的结构与变种',
    loading: '读取中…',

    infoTitle: '结构与变种',
    infoOverworld: '主世界结构',
    infoNether: '下界堡垒遗迹',
    infoEndTowers: '末地塔',
    infoVariations: '变种词条',
    infoNone: '无',
    infoNoVariations: '这条没有变种词条',
    endTowersHint: '末地塔的 Y 坐标（可能有多座）',
    /**
     * ⚠️ 变种词条按**原文**显示，不做任何大写转换。
     *
     * 它们是命名空间 id（`biome:structure:plains`），大写之后就和上游
     * 对不上了 —— 而界面上看起来完全正常，只是搜不到东西。
     * 见 packages/shared/src/seed.ts 里 SeedInfo.variations 的说明。
     */
    variationsRawNote: '下面的词条按上游原文显示，大小写是有意义的。',

    // ---- 按比赛 ID 查 ----
    lookupTitle: '按比赛 ID 查',
    lookupHint: '查这场比赛实际生成的那三个种子值。同一个 ID 用同样的值，永远不会变。',
    lookupAction: '查询',
    lookupBusy: '查询中…',
    matchIdPlaceholder: '例如 3650001',
    matchIdRange: '种子数据的比赛 ID 从 {{min}} 起。',

    /**
     * ★ 404 是**常态**，不是错误（上游只覆盖约 80%）。
     *
     * 所以这一组文案的任务是：说清「不是你的错、也不是我们坏了」，
     * 并且给出**下一步**（补录）—— 这正是 Q15 允许暴露写接口的理由。
     */
    notFoundTitle: '这条不在上游的种子库里',
    notFoundBody: '上游只收录约 80% 的历史比赛，这一条正好在那 20% 里。',
    notFoundInfoHint: '「结构与变种」的下界比种子值低（从 {{min}} 起），可以先试试那个。',
    infoOnlyAction: '只查结构与变种',

    // ---- 检索失败 ----
    /*
     * ⚠️ `seed_not_found` 和 `no_match` 共用同一个错误码，靠 `reason` 区分，
     *    而这两种情况的**下一步完全不同**：
     *      · seed_not_found（没有 reason）→ 这场比赛不在库里 → 去补录
     *      · no_match                    → 条件太窄了        → 放宽条件
     *    两句文案写反的话，用户会拿着一场比赛去补录一条只是条件太窄的查询。
     */
    errNoMatch: '没有一条种子同时满足这些条件',
    errNoMatchHint: '放宽几个条件再试：去掉一两个变种，或者取消完赛时间上限。',
    errUnavailable: '种子服务暂时不可用',
    /**
     * ⚠️ 502 说的是「我们的上游坏了」，不是「我们在维护」，所以**不承诺恢复时间** ——
     *    编一个时间等于承诺一件我们做不到的事（服务端注释里也是这个理由）。
     */
    errUnavailableHint: '这是上游那边的问题，不是你的操作有误。过一会儿再试。',
    errRate: '请求太频繁，请 {{seconds}} 秒后再试',
    errGeneric: '查询失败了',
    /**
     * 这一条理论上**不可能**出现：它是「界面把筛选条件发到了 /random」的信号。
     * 单独给它一句话，是因为它一旦出现就说明是我们接错了端点，
     * 而兜底文案会把一个真 bug 说成「服务出错了」，让它多活很久。
     */
    errUseSearchEndpoint: '界面把筛选条件发到了错误的接口（这是我们的问题），请反馈。',

    errMatchIdFormat: '比赛 ID 只能是数字',
    errMatchIdTooSmall: '种子数据的比赛 ID 从 {{min}} 起，比它更早的比赛没有种子值。',

    errBadOverworld: '主世界结构的取值不对',
    errBadNether: '下界结构的取值不对',
    errFilterTooLong: '变种条件太长了（超过 512 个字符）',
    errFilterBadChars: '变种条件里有非法字符',
    /**
     * `end_spawn:*` 上游有 bug（Q17），所以它**不出现在词条里**。
     * 这句话是给「有人手动构造了 URL」准备的 —— 它同时要说清后半句：
     * 这个变种**存在**，只是不能拿来筛。
     */
    errEndSpawnUnsupported: 'end_spawn 这一组上游有 bug，不能用来筛选（它会照常出现在结果里）。',
    errCompletionFormat: '格式要是「分:秒」，例如 2:35',
    errCompletionSeconds: '秒只能是 00–59。超过 59 请进位到分钟（1:75 应写成 2:15）。',
    errCompletionTooLong: '最长 24 小时。',
    errBadCompletion: '完赛时间上限不是一个合法的毫秒值',

    // ---- 补录（写接口，Q15）----
    saveTitle: '补录一条',
    saveIntro: '把一场比赛的种子值录进上游的数据库。这是补上那 20% 覆盖的唯一办法。',
    /**
     * ★ 这句话必须显眼，而且必须在**按钮上面**。
     *
     * 这是全站唯一一处「用户的点击会改到别人的生产数据」的地方。
     * 用户有权在按下去之前知道这件事 —— 而不是事后从别处听说。
     */
    saveWarning:
      '注意：这个按钮会**直接写进上游运营者的数据库**，不是写进我们的站。全站只有这一处会改到别人的生产数据，所以它需要登录、需要验证邮箱，并且有每小时 10 次的配额。',

    saveNeedLogin: '补录要写进上游的数据库，所以需要先登录。',
    saveNeedVerify: '补录需要先验证邮箱，否则谁都能往上游写记录。',
    saveNeedCapability: '你的账号目前没有补录权限。',
    saveNeedLoginAction: '去登录',
    saveNeedVerifyAction: '去验证邮箱',

    saveMatchId: '比赛 ID',
    saveOverworldSeed: '主世界种子',
    saveNetherSeed: '下界种子',
    saveTheEndSeed: '末地种子',
    saveTheEndHint: '可选。留空就等于不提供这个字段。',
    saveMatchDate: '比赛时间',
    saveMatchDateHint: '可选。ISO-8601 或毫秒时间戳都行（上游 schema 收字符串）。',
    /**
     * ⚠️ 种子输入框必须是**文本框**（inputMode="text"），不是数字框。
     *
     * `type="number"` 在大整数上会出问题，而且它的失败形式是**静默**的：
     * `Number('7304888896886165976')` 不报错，只是给你一个末尾变成 000 的种子。
     * 见 packages/shared/src/seed.ts 的文件头。
     */
    saveSeedHint: '64 位整数，可以是负数。粘贴时带空格没关系，我们会去掉。',

    saveAction: '写入上游数据库',
    saveBusy: '写入中…',
    saveCancel: '取消',
    saveDone: '已写入：比赛 {{matchId}}',
    /**
     * ⚠️ 配额记的是**成功写入**，不是尝试次数。
     *
     * 这条不寻常到值得写进界面：否则用户填错几次之后被锁一小时，
     * 会以为是自己填错才被锁的 —— 而真相恰好相反。
     */
    saveQuotaNote:
      '配额是每位用户每小时 10 次**成功写入**。填错字段不会消耗配额，所以校验没过的提交不会让你被限流。',

    saveErrExists: '这条已经录过了',
    saveErrExistsHint: '上游里已经有这个比赛 ID 了，不用再录一遍。直接去查它就行。',
    saveErrDisabled: '我们这边暂时关掉了补录',
    /**
     * ⚠️ 503 是运维开关（`MCSR_SEED_WRITE_DISABLED`），**不是**用户的权限问题。
     *    服务端特意不给 Retry-After —— 我们不知道什么时候会重开。
     */
    saveErrDisabledHint:
      '这是运维开关，不是你的账号问题。我们也不知道什么时候会重开，所以不给恢复时间。',
    saveErrBody: '请求体格式不对（这是我们的问题），请反馈。',
    saveErrMatchId: '需要 {{min}} 及以上的比赛 ID',
    saveErrOverworldSeed: '不是合法的种子：需要 64 位整数',
    saveErrNetherSeed: '不是合法的种子：需要 64 位整数',
    saveErrTheEndSeed: '不是合法的种子：需要 64 位整数，或者留空',
    saveErrMatchDate: '时间格式不对：ISO-8601 或毫秒时间戳',
    /**
     * ⚠️ 兜底要说清「我们**没拿到**是哪个字段」，而不是假装知道。
     *
     * 服务端的 400 会带一个机器可读的 `reason`（见 routes/seeds.ts 的 invalidInput），
     * 但前端目前拿不到它 —— 见 lib/api.ts 的 ApiError（构造器里没有 reason）。
     * 在那条路打通之前，这句话是**如实**的描述，而不是一句含糊的通用错误。
     */
    saveErrUnknownField: '服务端说有一个字段不合法，但我们没拿到是哪一个。请检查上面填的几个值。',

    // ---- 社区种子分享（Q7/Q8：先留空）----
    /**
     * ★ 这块要读起来像「还没做」，不是「坏了」。
     *
     * 三句话各干一件事：说明要做什么、说明为什么现在没有、明确说它不是故障。
     * **不放任何按钮** —— 一个点不动的按钮比一块说明文字更让人困惑。
     */
    communityTitle: '社区种子分享 · 即将开放',
    communityBody: 'RSG / SSG 这类由社区自己提交、固定模板的种子，按计划放在后面做。',
    communityWhy:
      '这一版先把「按条件检索上游已有的排位种子」做扎实 —— 它背后是约 300 万条真实数据。社区分享是另一套东西：要自己存内容、自己审、自己负责长期有效。',
    communityNote: '这里不是坏了，是还没做。上线时这块会出现浏览与提交入口。',

    // ---- 分组名与结构名 ----
    /**
     * ⚠️ 分组名是一张**映射表**，不是一份分组清单。
     *
     * 真清单来自 `groupVariations()` 对实际词条的分组（见 shared/seed.ts）——
     * 上游加了新分组，它会自己冒出来，只是没有中文名，于是回退显示原始
     * 分组名。**不要**在这里补一个「全部合法分组」的数组：
     * 那样上游加分组时，它会静默地从界面上消失。
     */
    group: {
      biome: '生物群系',
      chest: '箱子战利品',
      type: '结构形态',
      bastion: '堡垒',
      end_tower: '末地塔',
    },
    /**
     * 结构名 —— 取值是**大写**的（自有库与上游 `seedinfo` 都是大写，
     * 只有发往上游的筛选参数是小写，那个转换在服务端做）。
     * 表里没有的取值回退显示原始英文名，不显示空白。
     */
    structure: {
      VILLAGE: '村庄',
      DESERT_TEMPLE: '沙漠神殿',
      RUINED_PORTAL: '废弃传送门',
      SHIPWRECK: '沉船',
      BURIED_TREASURE: '埋藏的宝藏',
      JUNGLE_TEMPLE: '丛林神庙',
      BRIDGE: '桥',
      HOUSING: '居住区',
      STABLES: '疣猪兽棚',
      TREASURE: '藏宝室',
    },
  },
  /**
   * 「娱乐视频」板块（原来的「视频」改名，见 docs/calendar-video-rework.md）。
   *
   * ⚠️ 只改了**板块的名字**，`videos.*` 那一节里的内容基本没动 ——
   *    因为改的只是它叫什么，不是它怎么工作（Q6：贴了就可见、rolling）。
   *    这里只放"名字"和"和直播的分工"这两件事的文案。
   */
  enterVideo: {
    /**
     * 娱乐视频页上指向「直播」的一句话。
     *
     * ⚠️ 两个板块都是"视频"，所以必须有一句话说明**为什么有两个**，
     *    否则用户点进任何一个都会觉得"另一个是重复的"。
     *    分工是真实的、而且是我方设计里的：那边 rolling（随手贴、一直在变），
     *    这边是一份少数人维护、变动很慢的名单。
     */
    pointingToLive: '想看直播？去「直播」板块 —— 那里是一份编辑维护的主播名单。',
    gotoLive: '去直播',
    /**
     * ⚠️ 这一条严格说属于「提交资源」那一节（`submit.*`），放在这里只是
     *    因为本轮能动的词条只有三节，而它是**关于视频**的界面文案。
     *    下次整理词条时把它挪到 `submit.hintKindVideo` 更合适。
     */
    resourceKindHint:
      '贴一个 B站 / YouTube 的单集视频链接，详情页会直接嵌出播放器。贴别的链接就是一条普通资料（只有外链）。',
  },
  /**
   * 「直播」板块 —— 一份编辑维护的 MCSR streamer 名单。
   *
   * ⚠️ 这一节的文案里有两条**必须一直是真话**：
   *   1. **记的是频道，不是某一场直播** —— 用户看到的每一行都指向一个频道，
   *      而不是"现在正在播的这一场"。写含水的话，过一周他自己就会发现不对。
   *   2. **只有 YouTube 会嵌出来**（Twitch / B站 只记录不嵌）。这是有意的：
   *      Twitch 还没测过，B站 直播嵌入没有官方支持的证据，而嵌错了是**一个黑框**。
   *      界面上必须说清"这一行点了就是去频道看"，而不是让人以为播放器坏了。
   */
  live: {
    // ---- 页面骨架 ----
    title: '直播',
    subtitle: '一些值得关注的 MCSR 主播频道。',
    /**
     * ★ 这一句是整节里最要紧的。
     *
     * 我们**不检测直播状态**（没有 API key，也不轮询 —— 那是有意排除的），
     * 所以这里没有"直播中"标记。如果文案暗示有，用户一周之内就会发现
     * 它在撒谎（某个频道明明没开播，我们却没有任何反应）。
     * 说清"记的是频道"，那句话就永远是真的。
     */
    recordsChannels:
      '这里记录的是**频道**，不是「现在谁在播」—— 我们不检测直播状态，所以没有「直播中」标记。',
    relationToVideos:
      '和「娱乐视频」的分工：那边是大家随手贴的录像（一直在变），这边是一份变动很慢的名单。',

    gotoChannel: '去频道看',

    /**
     * 三种"嵌不出来"的理由，**必须分开说**。
     *
     * ⚠️ 合成一句"这里不支持嵌入"会让第三种变成一个**设置了却没反应的开关**：
     *    编辑明明打开了「用频道嵌入」，界面上什么都不显示，
     *    他只会以为界面坏了 —— 而真正的原因是那个标识不是 `UC...` 频道 ID。
     *
     * ⚠️ `noEmbedPlatform` 的原文是「这个平台的直播嵌入**还没验证过**」—— 那句是**假话**，
     *    已改掉：三个平台**全都实测过了**，"本机连不上"不等于"没验证过"
     *    （换香港网络就测到了 Twitch）。它现在服务的是**通用**那一档
     *    `'no_origin'`：`liveEmbedDecision()` 拿不到 `origin` 时，Twitch 拼不出 `parent`，
     *    于是"这里嵌不出来"成立，但"平台不允许"不成立。
     *
     * ★ 所以 B站 那一档**另给一句**（`noEmbedBilibili`）：它是**确定态** ——
     *    `x-frame-options: SAMEORIGIN` 明令禁止嵌入。**两档不能合成一句**：
     *    合成会重新制造这次要消灭的那种假话。键名不改，只改值，是为了让
     *    `LiveCard` 的穷尽映射与 `liverender` 的断言在同一次改动里保持可用。
     */
    noEmbedPlatform: '这个平台在这里不能嵌入播放，点这里去原站看。',
    noEmbedBilibili: 'B 站不允许把直播间嵌进别的网站（它自己禁止了），点这里去直播间看。',
    noEmbedNoId: '这一行还没有记录直播视频 ID，所以没有播放器。',
    noEmbedNotChannelId:
      '这一行开了频道嵌入，但标识不是 UC 开头的频道 ID，所以嵌不出来（频道嵌入只认那种 ID）。',

    empty: '还没有记录任何频道',
    emptyHint: '这一份名单由内容编辑维护，变动很慢。',
    loadFailed: '加载失败，请稍后重试。',
  },
  /**
   * ④=B「我的直播」—— **登录用户自己的**那一组链接。
   *
   * 为什么单独一节而不是并进 `live`：那一节的读者是**访客**（看公开名单），
   * 这一节的读者是**用户自己**（管自己的私人链接）。两者有一处致命差别 ——
   * 这一节里的每一行**只有他自己看得见**，所以文案里**绝不能**出现
   * 「名单里马上就能看到」「已提交待审」这类话：它们在个人化模型下**是假话**
   * （那批 `liveSubmit.*` 共 15 条已随 ④=B 整组作废，**不要复活**）。
   */
  myLive: {
    title: '我的链接',
    addHint: '粘频道页面的链接就行。',
    addAction: '添加',
    saveAction: '保存',
    deleteAction: '删除',
    /**
     * 「改」—— 行内编辑的入口（t37：`updateMyLiveLink` 此前**零调用者**）。
     *
     * ⚠️ 与 `saveAction` **刻意不同**：那个是**表单里**的提交键（改完点它存），
     *    这个是**行上**的展开键（把这一行变成表单）。两者可能同时出现在视野里，
     *    同名会让人分不清该点哪一个。
     */
    editAction: '改',
    deleteConfirm: '删掉这一条？',
    empty: '还没有添加过。',
    needLogin: '登录之后可以在这里保存自己的直播间链接。',
    gotoLogin: '去登录',
    /**
     * 三种链接结局，**必须分开说**。
     * 说错任何一种，用户都会去点一个不该点的东西（或以为页面坏了）。
     */
    embedOk: '这一条可以直接在这里看。',
    linkOnly: '这个链接我们认不出是哪个平台，所以只能给你原站入口。',
    notSupported: '这个平台不支持站内播放，点这里去原站看。',
  },
  /**
   * 直播清单的**编辑**界面（只有 editor 及以上看得到）。
   *
   * 单独一节而不是并进 `live`：那一节的读者是访客（看谁在播），
   * 这一节的读者是编辑（维护名单）。两者的信息需求完全不同，
   * 混在一起会让"给访客的一句话"和"给编辑的一句话"互相干扰。
   */
  liveManage: {
    title: '维护直播名单',
    subtitle: '这一份名单只有内容编辑看得到这个界面。访客看到的是它的公开版本（不含已隐藏的行）。',
    addTitle: '加一个频道',
    editTitle: '修改这一条',
    addAction: '添加',
    saveAction: '保存',
    saving: '保存中…',
    cancel: '取消',
    close: '收起',

    // ---- 字段 ----
    fieldPlatform: '平台',
    fieldHandle: '频道标识',
    fieldName: '显示名',
    fieldNote: '一句话说明',
    fieldLiveVideoId: '当前直播的视频 ID',
    fieldEmbedChannel: '用频道嵌入',
    fieldSortOrder: '排序',

    /**
     * ⚠️ 标识这一栏的提示必须点名"不是链接"。
     *    这是最容易填错的一栏：用户手里拿到的就是一个链接，
     *    而服务端的 schema 会拒它（"链接由我们按平台拼出来"）。
     */
    hintHandle:
      '填频道标识本身（例如 @Someone 或 UC 开头的那串），不要填链接 —— 链接我们按平台拼。',
    hintName: '给人看的名字，可以带空格。',
    hintNote: '可选。一句话说清这个人播什么 —— 访客就是靠它决定要不要点。',
    hintLiveVideoId:
      '可选。**只有填了它才会有播放器**；它会随每场直播变化，所以是"给现在这场用的"，不是频道的属性。',
    /**
     * ⚠️ 这一栏的提示要同时说清三件事：只对 YouTube 有效、只认 UC 开头的 ID、
     *    而且它是**实验性**的。少说一件，编辑就会开一个不生效的开关。
     */
    hintEmbedChannel:
      '实验性，默认关着。只对 YouTube 且标识是 UC 开头频道 ID 的行可能生效；不生效时播放器的位置是一个黑框，看起来像我们坏了。',
    hintSortOrder: '数字小的排前面。',

    // ---- 行内操作 ----
    hiddenBadge: '已隐藏',
    hide: '隐藏',
    show: '显示',
    delete: '删除',
    confirmDelete: '删除之后不能恢复，确定吗？',
    confirmYes: '确定删除',
    confirmNo: '先不删',

    // ---- 结果 ----
    added: '已添加',
    saved: '已保存',
    hidden: '已隐藏',
    shown: '已显示',
    deleted: '已删除',
    /** ⚠️ 空操作是**成功**，不是错误（本来就是那个状态）。 */
    changedNothing: '本来就是那个状态，没有改动。',
    exists: '这个频道已经记过了',
    existsHint: '同一平台 + 同一个标识只能有一条。下面标出来的就是它 —— 去改那一条，别再加一条。',

    /*
     * ⚠️ 这里**没有** needLogin / forbidden / gotoExisting，是有意的：
     *    · needLogin / forbidden：这个面板只在 `useCan('live.manage')` 为真时渲染，
     *      所以看得到界面的人一定有权限 —— 那两句话在本设计里**不可达**。
     *      会话过期那种情况由 `apiErrorText` 的 401 分支管（它说"去登录"），
     *      不需要在这里再写一份。
     *    · gotoExisting：`live_exists` 的处理是**高亮那一行**，不是跳走 ——
     *      那一行本来就在同一页上，给一个"去看那一条"的链接是多余的。
     */
    loadFailed: '加载失败，请稍后重试。',

    /**
     * 字段级错误。`LiveChannelInputSchema` 在客户端先跑一遍，
     * 所以这些文案是**本地**的（服务端那句是中文写死的，直接显示会在英文界面冒中文）。
     */
    errHandleRequired: '需要频道标识。',
    errHandleIsUrl: '这里填频道标识，不是链接 —— 链接由我们按平台拼出来。',
    errHandleSpace: '频道标识里不能有空格。',
    errNameRequired: '需要名字。',
    errSortOrder: '排序要填 0 到 9999 之间的整数（数字小的排前面）。',
    errGeneric: '有字段没通过校验，检查一下标出来的地方。',
  },
  /**
   * ② 直编（内容编辑绕过审核队列的那条路）。
   *
   * 单独一节而不是并进 `resources` / `calendar` / `videos`：那些节的读者是
   * **提交者**，这一节的读者是**编辑** —— 而且他看到的每一句话都要说明
   * "这次改动会立刻生效"。混在一起会让本节最要紧的那个区别被稀释掉：
   * 直编立刻生效，提交不。
   *
   * ⚠️ 凡是说了"不审核"的地方都**必须留着**这句。这个功能的全部风险就是
   *    编辑以为自己是在提交审核，实际上是在直接发布。
   */
  authoring: {
    directPublish: '直接发布（不审核）',
    directSave: '直接保存（不审核）',
    directHint: '你是内容编辑：这次改动**直接生效**（不进审核队列），并会写进审计日志。',
    published: '已直接发布，线上已可见。',
    saved: '已直接保存，线上已更新。',
    /**
     * ⚠️ 这一条必须说清**后果**，而不只是拒绝。
     *    编辑来直编、拿到 409，如果只被告知"有一份待审改动"，他会重试、
     *    或者找别的入口 —— 而不是去做那件真正能解开阻塞的事（先驳回或批准）。
     */
    alreadyPending:
      '这一条有一份待审改动。先把它**驳回或批准**，再来直接改 —— 否则你的改动会在它被批准的那一刻被悄悄回滚。',
    deleteTitle: '删除这一条',
    deleteAction: '删除',
    /** ⚠️ 这句话是删除的**知情同意**，不是装饰：它要让人看清连带销毁的是什么（别人的数据）。 */
    deleteImpact:
      '删除会连带删掉这一条的**版本历史**；资源库条目还会删掉**所有人的收藏、备注与评分**。这个动作不可撤销。',
    mustHideFirst: '已上架的内容要先**下架**再删除 —— 删除不可撤销，而下架可以恢复。',
    deleted: '已删除。',
    deleteConfirmYes: '确定删除',
    deleteConfirmNo: '先不删',
  },
};

/**
 * **不加 `as const`** —— 加了它会把每个值推断成字面量类型（`'加载中…'`），
 * 于是 en.ts 里写 `'Loading…'` 就会变成类型错误。
 * 这里要的是"键必须一致、值必须是字符串"，所以保持放宽后的 string 类型。
 */
export type TranslationSchema = typeof zhCN;
