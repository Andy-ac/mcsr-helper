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
  },
};

/**
 * **不加 `as const`** —— 加了它会把每个值推断成字面量类型（`'加载中…'`），
 * 于是 en.ts 里写 `'Loading…'` 就会变成类型错误。
 * 这里要的是"键必须一致、值必须是字符串"，所以保持放宽后的 string 类型。
 */
export type TranslationSchema = typeof zhCN;
