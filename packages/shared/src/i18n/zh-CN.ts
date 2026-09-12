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
    videos: '视频',
    profile: '我的',
    admin: '管理',
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
    title: '资源库',
    subtitle: '社区整理的网站、工具与参考资料 —— 不需要登录就能看。',
    searchPlaceholder: '搜索标题、简介或标签…',
    searchLabel: '搜索',
    tabAll: '全部',
    tabWebsite: '网站',
    tabTool: '工具',
    allKinds: '全部类型',
    allLangs: '全部语言',
    kindWebsite: '网站',
    kindTool: '工具',
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
    registerSubtitle: '注册后需要验证邮箱才能提交内容。',
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
    registerDone: '如果这个邮箱还没有注册，我们已经发送了一封验证邮件。',
    registerDoneHint: '如果已经注册过，请直接登录，或用「忘记密码」重置。',
    // 验证邮箱
    verifyTitle: '验证邮箱',
    verifyWorking: '正在验证…',
    verifyOk: '邮箱已验证',
    verifyOkHint: '现在可以提交内容了。',
    verifyFailed: '这个链接无效或已过期',
    verifyFailedHint: '验证链接 24 小时内有效，而且只能用一次。登录之后可以重新发一封。',
    verifyResend: '重新发送验证邮件',
    verifyResending: '发送中…',
    verifyResent: '已重新发送。之前那封邮件里的链接已经失效了。',
    verifyNeeded: '验证邮箱之后才能提交内容。',
    verifyNoToken: '这个链接不完整，缺少验证参数。',
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
    roleAdmin: '管理员',
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
    capTypeSeed: '种子分享',
    capTypeUser: '账号管理',
    capTypeAudit: '审计日志',
    capActionSubmit: '提交',
    capActionEditOwn: '修改自己提交的',
    capActionReview: '审核',
    capActionModerate: '管理身份组',
    capActionRead: '查看',
    logoutAction: '退出登录',
    loggingOut: '退出中…',
    // 错误
    invalidCredentials: '邮箱或密码不对',
    emailNotVerified: '邮箱还没验证，验证之后才能提交内容。',
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
};

/**
 * **不加 `as const`** —— 加了它会把每个值推断成字面量类型（`'加载中…'`），
 * 于是 en.ts 里写 `'Loading…'` 就会变成类型错误。
 * 这里要的是"键必须一致、值必须是字符串"，所以保持放宽后的 string 类型。
 */
export type TranslationSchema = typeof zhCN;
