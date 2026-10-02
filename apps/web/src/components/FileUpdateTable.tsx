/**
 * 「文件更新」的表格 —— `/files` 那一页唯一的一张表（2026-09-24，Task 6）。
 *
 * ===========================================================================
 * ⚠️★ 这里是**纯展示**：给一份现成的 `views` 就同步渲染完
 * ===========================================================================
 * 不取数、不订阅、不跑 effect、**自己不碰 `window.mcsr`** —— 这四件事都对 Task 7 的
 * 渲染自检（`apps/web/scripts/filesrender.tsx`）有直接影响：`renderToStaticMarkup`
 * **不点击、不跑 effect**（`docs/pending.md §5.73`；`components/ShareCard.tsx` 的文件头
 * 是同一个处置的先例），所以"某一行渲染成什么样"必须**只**由 props 决定。
 * 取数（`useFileUpdates`）与七个动作的包装住在 `components/FileUpdatesPanel.tsx`，
 * 动作以四个回调的形式传进来（见下面 `FileUpdateTableProps`）。
 *
 * ===========================================================================
 * ⚠️★ 为什么"这一行几时读的"必须画在**行里**（2026-09-24 评审判给 Task 6 的一条）
 * ===========================================================================
 * 面板上那行元信息印的是**列表级**的 `FileUpdatesState.lastCheckedAt`，它管不了
 * "**这一条**的读数是不是几小时前的"：`autoUpdate` 关掉的条目在启动检查里会被跳过
 * （`FileBinding.autoUpdate` 的注释 + T4 的 `startUp`）⇒ 在**同一个进程**里，
 * 列表级那个时钟可以比某一行自己的时钟新。两格逐条的读数就在这里印出来：
 *   · `FileItemView.lastCheckedAt` —— 这一条上次**检查**的时刻（`files.rowChecked`）；
 *   · `lastKnownLatest.fetchedAt` —— 上次**成功**读到上游版本的时刻，只有 `error` 那一支印
 *     （`files.lastKnownLatest` / `files.lastKnownNone`，见下面最新的那一格）。
 *
 * ⚠️★ 这里**没有**"把落盘的旧读数当成现值显示"这种危险 —— 别照直觉写一条防御
 * ===========================================================================
 * 那两格都是**进程内**的：`viewFor()` 取的是本次进程的读数与内存里的 `lastKnown`
 * （`apps/desktop/src/file-updates.ts` 的 `viewFor`），而**状态文件里那份逐条的
 * `localVersion` / `lastCheckedAt` 从来没有被读进视图** ⇒ 进程一重启，每一行都是
 * `unchecked` / `missing-file` / `unbound` 且 `lastCheckedAt: null`。
 * ⇒ 这一格是 `null` 时**什么都不印**（绝不印一个时间戳去填它）。
 *   真正的危险只有一条：**列表级的时钟不是这一行的时钟**（上面那一段）。
 *
 * ===========================================================================
 * ⚠️★ Task 7 从这里拿走三样具名的东西（别改名、别搬走）
 * ===========================================================================
 *   · `FileUpdateTable` 本身（props 形状见 `FileUpdateTableProps`）；
 *   · `RAW_KEY_RE` / `rawKeysIn()` —— 裸 key 泄漏扫描器。**Task 7 brief 第 9 条明写
 *     "用 Task 6 里同一个具名正则"**：`accountrender.tsx` 那一节的现场是"两处各写一个
 *     正则字面量、而且两个长得不一样 ⇒ 把扫描器改坏这件事不会有任何断言出声"。
 *     探针要断言**这个具名对象的产出**，不许另写一个字面量。
 *   · `formatClock()` —— 与面板那行元信息**同一个**时间写法（见那个函数的注释）。
 */

import { type FileItemState, type FileItemView, isDisabledPath } from '@mcsr/shared/fileUpdates';
import type { CatalogRowView, Channel, TargetSource } from '@mcsr/shared/modFolders';
import { useTranslation } from 'react-i18next';

/** 「没有值的那一格 —— 全仓的约定（`CalendarDetail` / `SeedResultCard` 都是它）」
 *  （那一句与 `components/TrackedVideos.tsx` 的 `DASH` 是同一个字符）。 */
const DASH = '—';

// ---------------------------------------------------------------------------
// 两个具名的导出：给 Task 7 用的（见文件头最后一段）
// ---------------------------------------------------------------------------

/*
 * ⚠️★ 扫描器与"算不算泄漏"必须共用**这一个**对象（`rawKeysIn` 只认它）：
 *    两处各写一份的话，坏掉的那一份不会有任何断言出声 —— 一条在撒谎的守卫
 *    （`accountrender.tsx` 里那两条探针就是为这件事写的，照它的形状来）。
 * ⚠️ 两个前缀是这一页真正会渲染的两本字典：`files.*`（这一页自己的词条）与
 *    `common.*`（`common.empty` 的空态、`common.loading`）。少一支，那一支上的
 *    裸 key 就等于空跑。
 * ⚠️ 它**不会**误伤正常文案：值里出现 `files.` / `common.` 开头的点子串才命中，
 *    而今天两本字典里没有任何一条值长这样（只有 key 长这样）。
 */
export const RAW_KEY_RE = /(?:files|common)\.[A-Za-z]+/g;

/**
 * 一段渲染产物里所有的裸 key（去重）。
 *
 * ⚠️ 这个 `/g` 对象被反复使用：`String.prototype.match` 每次都会先把 `lastIndex`
 *    归零，所以调用之间不互相影响（`accountrender.tsx` 那一处写着同一条）。
 */
export function rawKeysIn(markup: string): string[] {
  return [...new Set(markup.match(RAW_KEY_RE) ?? [])];
}

/**
 * 把毫秒时间戳写成 `14:03`。
 *
 * ⚠️ 自己拼而不是 `toLocaleTimeString()`：那个在 `en-US` 下会给出 `02:03 PM`，
 *    而词条里只有 `{{time}}` 一个占位符、没有 AM/PM 的位置 ⇒ 24 小时制是唯一
 *    在两种语言下都成立、且不需要第二条词条的写法。
 * ⚠️ 不带日期是**有意的**：它印的两格都是**这一次进程里**的读数（上面文件头那段）
 *    —— 一个从不落盘的时间戳配上日期反而会让人以为那是历史记录。
 *    代价：跨零点之后那一刻钟显示的还是昨天的时间。
 * ⚠️★ 这个函数**从面板搬到这里**（Task 6）：面板要渲染这张表，表格再反过来
 *    import 面板就是**循环依赖**（今天跑得动 —— 函数声明会被提升 —— 但它是个
 *    只会咬人的形状）。搬过来之后依赖只有一个方向：面板 → 表格。
 */
export function formatClock(at: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ---------------------------------------------------------------------------
// 状态 → 画什么（三张**穷尽**的表：以后加一支状态，这里会当场编译失败）
// ---------------------------------------------------------------------------

/**
 * 状态徽章。★ **文字**承载语义，颜色只是加强 —— 这一条是硬要求：
 * `outdated`（可更新）与 `disabled`（已禁用）的差别必须读得出来，色盲用户
 * 拿到的是同一句话（`.badge--live` 那一节为本仓的同一条纪律写过一次）。
 * ⚠️ 做成 `Record<FileItemState['kind'], …>` 而不是 `switch` + `default`：
 *    后者在契约加一支新状态时静默落进 `default`（界面上那一行会少一个徽章，
 *    而那正是"这一行是什么"唯一的说法）。
 */
const STATE_BADGES: Record<FileItemState['kind'], { label: string; className: string }> = {
  /*
   * 「未绑定」：brief 的渲染规则里只写了"两格印 `—` + 一颗「选择文件」"，
   * 徽章是**多加**的一格 —— 浏览器态**每一行**都是它（那一页整张表都是"未绑定"），
   * 而 `files.unbound` 这条词条在界面上没有别的消费者（不加就只活在字典里）。
   */
  unbound: { label: 'files.unbound', className: 'badge' },
  /*
   * 「还没检查过」（T4 的 `unchecked`：已绑定、文件也在，但这一次进程里还没有读数）。
   * ⚠️★ 它**绝不能**借用 `files.error`：那不是"读失败"，是"还没读" ——
   *    说成失败就是对用户说假话（T1 单开这一支要治的正是这件事）。
   */
  unchecked: { label: 'files.notChecked', className: 'badge' },
  current: { label: 'files.upToDate', className: 'badge' },
  'missing-file': { label: 'files.missing', className: 'badge badge--problem' },
  /** ⚠️ 这一支的 `message` 要**原样**印出来（brief 明写"不要吞掉"），见下面那一格。 */
  error: { label: 'files.error', className: 'badge badge--problem' },
  outdated: { label: 'files.outdated', className: 'badge badge--update' },
  /** ⚠️ 与 `outdated` 是**两句不同的话**（本地这版上游根本不存在 ⇒ 可能被换成上游原版）。 */
  'unknown-local': { label: 'files.unknownLocal', className: 'badge badge--update' },
};

/**
 * 操作列的主操作 —— **只有**下面这四支有（brief 的渲染规则表）。
 *
 * ⚠️ `current` / `unchecked` / `error` 三支**没有**主操作：
 *   · `current`：没有要更新的东西（T7 第 5 条就断言这一行里没有「更新」按钮）；
 *   · `unchecked`：`needsUpdate` 对它为 false（没有上游期望值就说"要更新"是编出来的结论）；
 *   · `error`：连"要不要更新"都还不知道。⚠️ 代价（已记进报告）：本地文件读不出来的
 *     那一支（`读不出这个文件：…`）在主操作这一列没有出路，用户要走「解除绑定」→
 *     「选择文件」两步 —— brief 的规则表里 `error` 只列了徽章与 `message`，
 *     给不给一颗「重新选择」由控制器裁决。
 */
const PRIMARY_ACTIONS: Record<
  FileItemState['kind'],
  { action: 'bind' | 'update'; label: string } | null
> = {
  unbound: { action: 'bind', label: 'files.bind' },
  'missing-file': { action: 'bind', label: 'files.rebind' },
  outdated: { action: 'update', label: 'files.update' },
  'unknown-local': { action: 'update', label: 'files.update' },
  unchecked: null,
  current: null,
  error: null,
};

// ---------------------------------------------------------------------------
// 那一行里的几格读数（都是纯函数：T7 的静态夹具一喂就有答案）
// ---------------------------------------------------------------------------

/**
 * 最新版本那一格。
 *
 * ⚠️ 只有 `current` / `outdated` / `unknown-local` 三支的 `FileItemState` 带
 *    `latestVersion`（契约的形状如此）。别的状态印 `—` —— **不许**从 `lastKnownLatest`
 *    借一个版本号顶上这一格：那是"上次读到的"，而这一格问的是"现在的最新版是多少"。
 */
function latestVersionOf(view: FileItemView): string | null {
  const s = view.state;
  return s.kind === 'current' || s.kind === 'outdated' || s.kind === 'unknown-local'
    ? s.latestVersion
    : null;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export interface FileUpdateTableProps {
  /**
   * 表格唯一的**数据**来源（面板从 `FileUpdatesState.items` 原样拿来）。
   * 一条都没有 ⇒ 空态（`common.empty`），不是一张空壳表。
   */
  views: readonly FileItemView[];
  /** 哪一条正在写盘（`FileUpdatesState.busyItemId`）。缺省 = 没有在跑的更新。 */
  busyItemId?: string | null;
  /** 正在下载的那一条的进度（`FileUpdatesState.progress`）；`percent` 为 `null` = 上游没给总长。 */
  progress?: { itemId: string; percent: number | null } | null;
  /**
   * ★ 四个动作的回调 —— 与 `FileUpdatesHandlers` 一一对应，但**不接受整个 handlers
   *   对象**：表格只该看见它真会画出来的那四颗按钮（其余三颗是面板的）。
   * ⚠️ 缺省 = 那个动作没有动作层 ⇒ **那一颗按钮不渲染**（不画一颗点不动的按钮，
   *    与 `components/FileUpdatesPanel.tsx` 里"浏览器态不渲染按钮行"同一条纪律）。
   */
  onBind?: (itemId: string) => void;
  onUnbind?: (itemId: string) => void;
  onToggleAuto?: (itemId: string, on: boolean) => void;
  onUpdate?: (itemId: string) => void;
  /**
   * 是不是桌面壳（有动作层）。**缺省当作 true**，显式 `false` 才是浏览器态。
   *
   * ⚠️ 为什么缺省是"有"而不是"没有"：Task 7 的静态夹具是**手写**一份状态喂进来的
   *    （`renderToStaticMarkup`），它要看到「重新选择」/「更新」那几颗按钮就必须配上
   *    回调；把缺省定成 false 的话，"喂了回调却没有按钮"会变成一个**看不出原因**的空列。
   * ⚠️ 但它不是一个多余的开关：判据是**两件事同时成立**才画按钮 ——
   *    `desktop !== false`（这一页有没有动作层）**且**那个动作的回调真的在手。
   */
  desktop?: boolean;
}

export function FileUpdateTable({
  views,
  busyItemId = null,
  progress = null,
  onBind,
  onUnbind,
  onToggleAuto,
  onUpdate,
  desktop,
}: FileUpdateTableProps) {
  const { t } = useTranslation();

  /** 有没有动作层（见 `desktop` 那一段）。 */
  const withActions = desktop !== false;
  /**
   * ★ 只要有**任何**一条在写盘，主进程就不接受第二条更新
   *   （`runUpdate` 那句「正在更新中：…（一次只写一个文件）」会把它变成一句红字），
   *   而 `bind` / `unbind` 在同一段时间里也在改**同一份**状态文件。
   *   ⇒ 这一行的按钮一起禁用：与其让用户点了吃一句报错，不如把"现在不能点"写在脸上
   *   （面板那颗「选择 mods 目录」用的就是这同一条理由）。
   */
  const anyBusy = busyItemId !== null;

  return (
    /*
     * ⚠️ `data-views` 是**从 T5 手里接过来的**：它原来在面板那个空挂载点上，
     *    留给 Task 7 当读数用（"面板真的把 N 条视图交给了表格"）。挂载点已经换成
     *    这张表，但这个读数没有第二个消费者，所以跟着搬到这里、值仍然是同一个
     *    `views.length`（空态时是 0）。
     */
    <div className="filetable" data-views={views.length}>
      {views.length === 0 ? (
        /*
         * ⚠️★ 零条**必须**有话说：原来这里是一个**空 div**，用户看到的是"这一页什么都没有"
         *    而分不出"目录是空的"与"这一块没渲染出来"。
         * ⚠️ 这句话只说"这张表现在没有行"：目录**没拉到**由面板上面那张 `Notice`
         *    说（`state.catalogError`）。两条同时出现时不矛盾 —— 一条说一行都没有，
         *    一条说为什么没有（**不清空** `catalog` 是 spec §8 的要求，缓存里那几条
         *    会照常渲染成行，这一支只在真的一条都没有时出现）。
         */
        <div className="state state--empty">
          <p>{t('common.empty')}</p>
        </div>
      ) : (
        /*
         * ⚠️ 类名与样式之间的那条接口在 `styles.css` 里写着：这里的每一个 `filetable*`
         *    类名在那一段里都必须有规则（本仓的样式是全局的，没有 CSS Modules 兜着，
         *    而"渲染了一个不存在的类名"全仓没有门禁发现得了 —— `docs/pending.md §5.70`）。
         */
        <table className="filetable__table">
          <thead className="filetable__head">
            <tr>
              <th>{t('files.colFile')}</th>
              <th>{t('files.colLocal')}</th>
              <th>{t('files.colLatest')}</th>
              <th>{t('files.colAuto')}</th>
              <th>{t('files.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {views.map((view) => {
              const s = view.state;
              const badge = STATE_BADGES[s.kind];
              const primary = PRIMARY_ACTIONS[s.kind];
              const latestVersion = latestVersionOf(view);
              /** 这一行正在写盘 ⇒ 操作列换成进度文本（brief 的渲染规则）。 */
              const busyThisRow = busyItemId === view.item.id;
              /*
               * ⚠️ `progress` 只在**它说的就是这一行**时才算数：主进程那一格是
               *    全局唯一的一份（`{ itemId, percent }`），照搬别人的百分比到这一行
               *    就是编出来的读数。
               */
              const percent =
                progress !== null && progress !== undefined && progress.itemId === view.item.id
                  ? progress.percent
                  : null;
              /*
               * ★★ 「已禁用」徽章按**文件名**判定（fix round 2 改的；先前那一版读契约字段
               *    `state.disabled`，而主进程只在 `outdated` / `unknown-local` 两支里设它
               *    —— `viewFor` 的 `current` 那一支从不设 ⇒ 一个"已是最新"的 `.jar.disabled`
               *    文件会显示「已是最新」，页面上**没有任何东西**告诉用户"游戏不会加载它"。
               *    那是日常可达的情形，不是边角）。
               *
               * ⚠️★ 这两者**不是同一件事的两个来源**，而是**同一个谓词作用在同一个路径上**：
               *    主进程设 `state.disabled` 时用的也是 `isDisabledPath(localPath)`
               *    （`apps/desktop/src/file-updates.ts` 的 `viewFor` 里那一格），
               *    所以两者**不可能互相打架**（同一个函数的同一次调用结果）。
               *    分工只有一条：**徽章按路径算**（这样契约里没有 `disabled` 那一格的
               *    `current` / `unchecked` / `missing-file` / `error` 也能显出来），
               *    而 `state.disabled` 继续管**更新流程**的语义（单条更新要不要先问、
               *    一键更新要不要跳过 —— 那是主进程的事，界面只管画）。
               *    ⇒ 别把徽章改回读 `state.disabled`：那会让最该看见它的那一行看不见。
               * ⚠️ `unbound` 那一行 `binding === null`（没有路径可判）⇒ 没有徽章，
               *    那是对的：一个没绑定的行谈不上"禁用了本机哪个文件"。
               */
              const disabled = view.binding !== null && isDisabledPath(view.binding.localPath);
              /** 主操作那颗按钮要调的**那一个**回调（没有它就不画这颗按钮，见 props 的说明）。 */
              const primaryCallback = primary?.action === 'update' ? onUpdate : onBind;
              const showPrimary = withActions && primary !== null && primaryCallback !== undefined;
              const showUnbind = withActions && onUnbind !== undefined && view.binding !== null;

              return (
                <tr className="filetable__row" data-state={s.kind} key={view.item.id}>
                  <td>
                    <div className="filetable__filebox">
                      {/*
                        ⚠️ `item.name` 是**产品名，不翻译**（契约里写着）—— 直接印。
                        ⚠️ `item.note` **不印**：它是目录里的**内容**（中文），
                        而 Task 7 的英文那一遍断言整页零汉字 ⇒ 印它会把一条正常的产品
                        行为变成一条自检红点。代价：目录给的备注在这一页看不到
                        （要显示它得先解决"内容在英文界面里的语言"这件事）。
                      */}
                      <span>{view.item.name}</span>
                      <span className="badges">
                        {/* 状态徽章：**文字**是主通道（见 `STATE_BADGES` 那一段）。 */}
                        <span className={badge.className}>{t(badge.label)}</span>
                        {/*
                          ★ 「已禁用」与「可更新」的差别**靠文字**：两个徽章的字不同，
                            颜色只是加强（`--update` 是金、`--disabled` 是灰+虚线）。
                            一个只看得见形状/灰度的用户读到的仍然是两句话。
                          ⚠️ T4 对 `.jar.disabled` 的单条更新**会问一次**（那一下会把它换成
                            启用状态的文件）⇒ 这颗徽章也是那颗按钮的前情提要。
                        */}
                        {disabled ? (
                          <span className="badge badge--disabled">{t('files.disabled')}</span>
                        ) : null}
                      </span>
                      {/*
                        逐条读数时间（见文件头那两段）。`null` ⇒ **一个字都不印**：
                        `unchecked` 的徽章已经说了"还没检查过"，再印一个时间戳就是编的。
                      */}
                      {view.lastCheckedAt === null ? null : (
                        <span className="filetable__readat">
                          {t('files.rowChecked', { time: formatClock(view.lastCheckedAt) })}
                        </span>
                      )}
                      {/*
                        `error` 的原因**原样显示**（brief 明写"不要吞掉"）：它是主进程
                        写好的整句（本地读不出 / 上游拉不到 / 上游那一版没有可下载的主文件），
                        换成一句"出错了"就等于把用户唯一能行动的线索删掉。
                        ⚠️ 代价：那句话是主进程写死的**中文**，英文界面上会夹中文
                        —— 与面板 `catalogError` / `files.actionFailed` 是同一条已接受的代价。
                      */}
                      {s.kind === 'error' ? (
                        <span className="filetable__err">{s.message}</span>
                      ) : null}
                    </div>
                  </td>
                  {/*
                    ⚠️★ 两格版本读数：`null` ⇒ `—`（本地那一格是 `view.localVersion`，
                    契约里 `null` 就是"这一次进程里没有读数"）。**不许填 0、不许写"未知"
                    当数据**（brief 的渲染规则对 `unbound` 明写，其余状态同一条道理：
                    一个假的版本号会让这一页看起来像"我读到了一个文件"）。
                  */}
                  <td className="filetable__version">{view.localVersion ?? DASH}</td>
                  <td className="filetable__version">
                    {latestVersion ?? DASH}
                    {/*
                      ★ `error` 那一支还欠一句"那我们**上次**看到的是哪一版、几时看到的"
                      （spec §8）：`lastKnownLatest` 有值就印版本 + 时间，是 `null` 就照实说
                      "本次还没成功读到过"。**不许**从别处借一个版本号顶上。
                    */}
                    {s.kind !== 'error' ? null : view.lastKnownLatest === null ? (
                      <span className="filetable__latestknown">{t('files.lastKnownNone')}</span>
                    ) : (
                      <span className="filetable__latestknown">
                        {t('files.lastKnownLatest', {
                          version: view.lastKnownLatest.version,
                          time: formatClock(view.lastKnownLatest.fetchedAt),
                        })}
                      </span>
                    )}
                  </td>
                  <td>
                    {/*
                      brief 的形态：`checked={binding?.autoUpdate ?? false}`（未绑定 ⇒ 未勾选）。
                      ⚠️ 禁用有四条理由，各自不同，别把它们并成一条：
                        ① 未绑定 —— 主进程会直接拒绝（`setAutoUpdate` 的「这一条还没绑定文件」）；
                        ② 没有动作层（浏览器态、或夹具没给回调）—— 一个点不动的勾选框比不画更糟；
                        ③ 有**任何**一条在写盘 —— `runUpdate` 在下载**之前**就把状态文件里
                           那一条抓成局部 `binding`，换完文件之后又用 `{...binding}` 整条写回去
                           ⇒ 这期间用户改的 `autoUpdate` 会被**静默覆盖**回旧值、界面跟着弹回去。
                           那是主进程那一侧的缺陷（`apps/desktop/**` 不在 Task 6 的范围里，
                           已记进报告）；这里能做的是别让用户在那一瞬间按得到它。
                        ④ `aria-label` 带上条目名（`files.autoLabel`）：不然读屏念到的是一排
                           一模一样的"自动更新"（`nav.reorder` 那条词条为同一件事写过完整一段）。
                    */}
                    <input
                      type="checkbox"
                      aria-label={t('files.autoLabel', { name: view.item.name })}
                      checked={view.binding?.autoUpdate ?? false}
                      disabled={
                        view.binding === null ||
                        !withActions ||
                        anyBusy ||
                        onToggleAuto === undefined
                      }
                      onChange={(e) => onToggleAuto?.(view.item.id, e.target.checked)}
                    />
                  </td>
                  <td>
                    {busyThisRow ? (
                      /*
                        ★ 正在写盘的那一行：操作列换成进度文本（brief 的渲染规则）。
                        ⚠️ `percent` 为 `null` 是**正常**的（上游没给总长 ⇒ 主进程也拿不到
                        百分比，`downloadTo` 那一句 `total > 0 ? … : null`）⇒ 那时只印"正在更新"，
                        不许编一个 0%。
                      */
                      <span className="filetable__busy">
                        {percent === null
                          ? t('files.busy', { name: view.item.name })
                          : t('files.busyPercent', {
                              name: view.item.name,
                              /*
                               * ⚠️ 直接把这个数字交给插值：`percent` 是主进程算好的
                               *    （`Math.round(x * 1000) / 10` ⇒ 最多一位小数），
                               *    这里**不**替它做四舍五入 —— 那是第二份口径。
                               *    `%` 不在这一层加，它属于词条（两种语言都得有它的位置）。
                               */
                              percent,
                            })}
                      </span>
                    ) : (
                      <div className="filetable__actionbox">
                        {showPrimary ? (
                          <button
                            type="button"
                            className="ghostbtn"
                            disabled={anyBusy}
                            onClick={() => primaryCallback?.(view.item.id)}
                          >
                            {t(primary.label)}
                          </button>
                        ) : null}
                        {showUnbind ? (
                          /*
                            ⚠️★ 这一颗**不在 brief 的渲染规则里**，是 Task 6 判断后加上的，
                            理由写在这里、也写进了报告（偏离点由控制器裁决）：
                              · brief 的 `Produces` 那一行把 `onUnbind` 列进了这张表的接口，
                                而"哪一支画它、画在哪一列"没有任何一条规则说了 —— 不画的话
                                这个 prop 就是死的，`unbind()` 在**全仓界面上**没有第二个
                                消费者（现读：`apps/web/src` 里除了面板那七个动作的包装，
                                没有任何地方调它）。
                              · 渲染规则第 3 条说 `current` 那一行"操作列没有按钮"，那条规则的
                                **要害**是"已是最新的一行不给「更新」"（Task 7 第 5 条断言的就是
                                这一句）。这里保留那个要害：`current` 行**没有**「更新」，
                                只有一颗安静的「解除绑定」。
                              · 它顺带补上 `error` 那一支的出路：读不出的文件在主操作那一列
                                没有按钮（brief 如此），解开绑定之后那一行变成 `unbound`，
                                就有「选择文件」了。
                            若控制器要求严格照字面（`current` 行一个按钮都不许有），删掉这一颗
                            与 `showUnbind` 两处即可。代价写明：`unbind()` 会重新变成界面上
                            点不到的能力。
                          */
                          <button
                            type="button"
                            className="ghostbtn"
                            disabled={anyBusy}
                            onClick={() => onUnbind?.(view.item.id)}
                          >
                            {t('files.unbind')}
                          </button>
                        ) : null}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ===========================================================================
// 第一部分：目录行那一张表（2026-10-03，Task 7）
// ===========================================================================
/*
 * ⚠️★ 为什么它住在**这个文件**：计划的任务表把"第一部分：两个筛选器、双通道按钮、
 *    只升不降的提示、`manual` 行只给「打开原网页」"判给了
 *    `FileUpdatesPanel.tsx` + `FileUpdateTable.tsx` 两个文件（它们是这一页的
 *    "数据层"与"表"）⇒ 目录行这一族与 v1 那一族同住一张表，人只有一处要找。
 * ⚠️ v1 那个 `FileUpdateTable`（上面）**一个字节都没动**：它继续按
 *    `FileItemView[]` 渲染，老客户端 0.0.4 看到的东西与今天逐字相同
 *    （`apps/web/scripts/filesrender.tsx` 的 20 组断言盯着它）。
 */

/**
 * ★★ 镜像 id —— **这是 Web 这一侧唯一一份"目录配置"的副本**（写在这里是有代价的）。
 *
 * ⚠️★ 为什么必须写死：镜像按钮的通道入参只能是 `{ mirrorId }`（`Channel` 的定义：
 *    **是 id，不是 URL**），而 `ModFoldersState` / `CatalogRowView` **都没有**目录的
 *    镜像表（现读 T1 的 `packages/shared/src/modFolders.ts`：`mirrors` 只活在
 *    `ModCatalog` 里，而目录在**主进程**手上）。⇒ 渲染进程想知道"这条 release 有什么
 *    镜像、id 叫什么"，今天**没有**任何一格可以读。
 * ⚠️★ 代价（明摆着，且**必须**让下一次的人看见）：目录里那条镜像的 `id`/`hosts`
 *    改了、或者加了第二条镜像，**这一页不会跟着变**（`isGitHubRelease` 那份 host 判据
 *    同理）—— 而失败形态是"点了镜像按钮，主进程拒"（`requireChannel` 的
 *    "目录里没有这条镜像"）或"镜像按钮根本不出现"。
 * ⚠️ 本仓的规矩是**配置即代码**（`content/mod-catalog.json`），所以这里算一处已知的
 *    重复；正确的修法是**给状态加一格镜像表**（`mirrors: ModMirror[]`），那是
 *    `packages/shared/src/modFolders.ts` + `apps/desktop/src/mod-folders.ts` 的改动
 *    （不在 Task 7 的文件边界里）⇒ 已记进 Task 7 报告，等控制器裁决。
 * ⚠️ 今天的现读读数：目录里**只有一条**镜像（`content/mod-catalog.json` 的
 *    `mirrors[0].id = 'gh-proxy'`，`hosts: ['github.com']`）。
 */
export const ROW_MIRROR_ID = 'gh-proxy';

/**
 * 这条 release 的地址是不是 GitHub 的（D5：**只有** GitHub 来源才有镜像按钮）。
 *
 * ⚠️★ 判据与上面那条 id 是同一处代价的两半：目录里记的是 `mirrors[].hosts`，
 *    而渲染进程读不到它 ⇒ 这里只能按**主机名**判（`hosts: ['github.com']` 的对应物）。
 *    ⚠️ 主进程那一侧才是权威（`channelUrl` ⇒ `mirrorsFor` 会真的查 `hosts`）：
 *    这里判错方向是"多给一颗按钮"，那时主进程会拒（"这个通道下拿不到下载地址"）。
 */
export function isGitHubRelease(url: string): boolean {
  try {
    return new URL(url).host === 'github.com';
  } catch {
    return false;
  }
}

/**
 * 「打开原网页」要打开的地址。
 *
 * ⚠️ 优先 `official.url`（那是**目标**那一条）；`official` 为 `null`（多候选）时退回
 *    第一个候选的地址 —— 那仍然是目录里的一条真实地址，**不是**编出来的。
 *    ⚠️ 多候选那一行会把**每一个**候选各自列一条链接（见下），所以调用方对
 *    `ambiguous` 那一支**不画**这颗通用的链接（否则同一行三个"打开原网页"）。
 */
export function originPageOf(row: CatalogRowView): string | null {
  return row.official?.url ?? row.candidates[0]?.url ?? null;
}

/**
 * 状态徽章（判定的四支 + 两处"没有目标/没有绑定"）。
 *
 * ⚠️ 做成 `Record<…, …>` 而不是 `switch` + `default`：`ReleaseVerdict` 加一支时这里
 *    会当场编译失败（与上面 v1 那张 `STATE_BADGES` 同一条纪律）。
 * ⚠️★ `'missing-release'` **到不了**（`rowsForGameVersion` 只返回"这个游戏版本下有
 *    release"的 mod ⇒ 候选至少一条，spec §7.2 的那一支在第一部分不可达）
 *    ⇒ 它是 `null`：**不画**徽章，也不给它词条（那会是"为一条到不了的路径写文案"）。
 */
const VERDICT_BADGES: Record<
  CatalogRowView['verdict']['kind'],
  { label: string; className: string } | null
> = {
  same: { label: 'files.upToDate', className: 'badge' },
  older: { label: 'files.outdated', className: 'badge badge--update' },
  newer: { label: 'files.verdictNewer', className: 'badge' },
  'different-build': { label: 'files.verdictDifferentBuild', className: 'badge' },
  unknown: { label: 'files.verdictUnknown', className: 'badge' },
  ambiguous: { label: 'files.verdictAmbiguous', className: 'badge' },
  'missing-release': null,
};

/**
 * 各支欠的那句**解释**（为什么这一行不给更新按钮）。
 *
 * ⚠️★ 三支必须各有各的说法（spec §8）：`newer` / `different-build` / `unknown` 的
 *    **后果**都是"不更新"，但**原因**不同，而原因是用户唯一能行动的线索。
 * ⚠️ `ambiguous` 与 `manual` 的解释在下面按各自的判据取（它们与本地读数无关）。
 */
const VERDICT_HINTS: Partial<Record<CatalogRowView['verdict']['kind'], string>> = {
  newer: 'files.hintNewer',
  'different-build': 'files.hintDifferentBuild',
  unknown: 'files.hintUnknown',
  ambiguous: 'files.hintAmbiguous',
};

/** 未绑定那一行借 `files.unbound`（v1 那张表的第一颗徽章就是它，同一个意思）。 */
const UNBOUND_BADGE = { label: 'files.unbound', className: 'badge' };

/**
 * 目标来源 → 词条（Ruling 13）。
 *
 * ⚠️ 写成显式映射而不是 `` t(`files.targetSource.${row.targetSource}`) ``：后者是**动态
 *    key**，字典少一条时类型检查看不见，而 `targetSource` 是联合类型 ⇒ 这里少一支会
 *    当场编译失败。
 */
const TARGET_SOURCE_LABELS: Record<TargetSource, string> = {
  catalog: 'files.targetSource.catalog',
  upstream: 'files.targetSource.upstream',
};

export interface ModCatalogTableProps {
  /** 第一部分的**唯一**数据来源（`ModFoldersState.catalogRows`）。 */
  rows: readonly CatalogRowView[];
  /**
   * 是不是桌面壳（有动作层）。**缺省当作 true**，显式 `false` 才是只读（浏览器态 /
   * 老客户端 / 自检里没喂回调的那一次）。
   *
   * ⚠️ 与 v1 那张表同一条纪律：判据是 `desktop !== false` **且**那个动作的回调真的在手
   *    —— 不画一颗点不动的按钮。
   */
  desktop?: boolean;
  /**
   * 正在写盘（`ModFoldersState.busy`）⇒ 每一行的按钮都**禁用**（不是消失）。
   *
   * ⚠️ 主进程一次只写一个文件（`busy` 那句"正在更新中（一次只写一个文件）"）⇒
   *    与其让用户点了吃一句红字，不如把"现在不能点"写在脸上。
   */
  busy?: boolean;
  /** 「绑定本地文件」⇒ `bindCatalogRow(rowId)`（唯一入口，路径由主进程的对话框产生）。 */
  onBindLocal?: (rowId: string) => void;
  /** 「更新（原始）」「更新（镜像）」⇒ `updateCatalogRow(rowId, rowId, channel)`。 */
  onUpdate?: (rowId: string, channel: Channel) => void;
}

/**
 * 目录行那张表 —— **纯展示**（给 `rows` 就同步渲染完：不取数、不订阅、不跑 effect）。
 *
 * ⚠️★ 每行给**几颗**按钮是按 §6.8 的"每行操作"表和 Ruling 47/48 算的，
 *    而且判据都写在下面那三行 `showUpdate` / `showBind` / `mirror` 上：
 *      · `manual` ⇒ **一颗都不给**（主进程必拒），只有「打开原网页」；
 *      · 已绑定 + `batchable` ⇒ 「更新（原始）」+（GitHub 来源时）「更新（镜像）」；
 *      · 未绑定 ⇒ 「绑定本地文件」（`updateCatalogRow` 对没绑定的行会拒）；
 *      · 其余（`newer` / `different-build` / `unknown` / `same` / `ambiguous`）
 *        ⇒ 只解释，不画更新按钮。
 */
export function ModCatalogTable({
  rows,
  desktop,
  busy = false,
  onBindLocal,
  onUpdate,
}: ModCatalogTableProps) {
  const { t } = useTranslation();
  /** 有没有动作层（与 v1 那张表同一个名字、同一条理由）。 */
  const withActions = desktop !== false;

  return (
    /*
     * ⚠️ `data-catalog-rows` 是"面板真的把 N 行交给了表"唯一的读数（v1 那张表的
     *    `data-views` 是同一个东西）；它**值不变**（仍是 `rows.length`）。
     */
    <div className="filetable" data-catalog-rows={rows.length}>
      <table className="filetable__table">
        <thead className="filetable__head">
          <tr>
            <th>{t('files.colMod')}</th>
            <th>{t('files.colLocal')}</th>
            <th>{t('files.colLatest')}</th>
            <th>{t('files.colStatus')}</th>
            <th>{t('files.colActions')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            /** 未绑定 ⇒ 那一格是「未绑定」；否则按判定给徽章（见 `VERDICT_BADGES`）。 */
            const badge = row.binding === null ? UNBOUND_BADGE : VERDICT_BADGES[row.verdict.kind];
            /*
             * ⚠️★ `manual` 的**解释优先**：一个 manual 的行完全可能同时是 `older`
             *    （本地旧了、但只能手动下）⇒ 那时"为什么没有按钮"的答案是"它只能手动下"，
             *    而不是"比不出来"。
             */
            const hintKey = row.manual ? 'files.hintManual' : VERDICT_HINTS[row.verdict.kind];
            /*
             * ⚠️★ 多候选那一行**不画**通用的「打开原网页」：它会把每一个候选各自列一条
             *    链接（见状态那一格），再多一颗就是同一行三个同样的链接。
             */
            const page = row.verdict.kind === 'ambiguous' ? null : originPageOf(row);
            /*
             * ★★ 下面这三行就是"给不给按钮"的**全部**判据（Ruling 47/48 的落点）：
             *   主进程会拒的一律不画。
             */
            const mirror = row.official !== null && isGitHubRelease(row.official.url);
            const showUpdate =
              withActions && onUpdate !== undefined && row.batchable && !row.manual;
            const showBind =
              withActions && onBindLocal !== undefined && row.binding === null && !row.manual;

            return (
              <tr
                className="filetable__row"
                data-verdict={row.verdict.kind}
                data-row-id={row.rowId}
                key={row.rowId}
              >
                <td>
                  <div className="filetable__filebox">
                    {/* ⚠️ `row.name` 是产品名，不翻译（与 v1 那一行同一条）。 */}
                    <span>{row.name}</span>
                    <span className="badges">
                      {/*
                        ⚠️ 标签显示名来自目录（`tagLabels`，与 `tags` **逐位对应**）——
                        原样印出来：目录里没有它的名字时它是 key 本身，那正是"看得见的缺陷"
                        （`tagLabelOf` 的注释）。**不**在这里另做一份映射表。
                        ⚠️ 用 `.tagchip--static`（纯展示的标签片，`pointer-events: none`）：
                        `.tagchip` 本来是**交互式**的（标签筛选那一行用它），这里只是显示。
                      */}
                      {row.tagLabels.map((label, index) => (
                        <span className="tagchip tagchip--static" key={row.tags[index] ?? label}>
                          {label}
                        </span>
                      ))}
                    </span>
                  </div>
                </td>
                {/*
                  ⚠️ 两格读数：本地那一格是绑定的 `localVersion`（没有绑定 ⇒ `—`），
                  目标那一格是 `official.version`（多候选 ⇒ `—`）。
                  **不许**填 0、也不许拿候选的版本号顶上"官方版本"。
                */}
                <td className="filetable__version">{row.binding?.localVersion ?? DASH}</td>
                <td className="filetable__version">
                  {row.official?.version ?? DASH}
                  {/*
                    ★ Ruling 13：来源必须标出来 —— 有上游目标时 `official` **不在**
                    `candidates` 里，所以用户不能靠"它是不是候选之一"去猜。
                  */}
                  <span className="filetable__latestknown">
                    {t(TARGET_SOURCE_LABELS[row.targetSource])}
                  </span>
                </td>
                <td>
                  {badge === null ? null : (
                    <span className={badge.className}>{t(badge.label)}</span>
                  )}
                  {hintKey === undefined ? null : <span>{t(hintKey)}</span>}
                  {/*
                    ★ 多候选：把**每一个**候选都列出来（版本号 + 它自己的原网页）。
                    这里**没有**"选一个"的控件，理由写在 `files.hintAmbiguous` 那一段注释里
                    （契约收不了这个选择 ⇒ 画一个点了没用的控件就是 Ruling 47/48 反对的东西）。
                  */}
                  {row.verdict.kind !== 'ambiguous' ? null : (
                    <ul>
                      {row.candidates.map((candidate) => (
                        <li key={candidate.url}>
                          {t('files.candidate', { version: candidate.version })}
                          <a
                            className="ghostbtn"
                            href={candidate.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t('files.openPage')}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td>
                  <div className="filetable__actionbox">
                    {showUpdate ? (
                      <button
                        type="button"
                        className="ghostbtn"
                        disabled={busy}
                        /* ★ 原始通道（`'origin'` = release 自己的地址）。 */
                        onClick={() => onUpdate?.(row.rowId, 'origin')}
                      >
                        {t('files.updateOrigin')}
                      </button>
                    ) : null}
                    {showUpdate && mirror ? (
                      <button
                        type="button"
                        className="ghostbtn"
                        disabled={busy}
                        /*
                         * ★ 镜像通道：**只送 id**（`Channel` 是 id，不是 URL ——
                         * 地址由主进程按目录里的 `prefix` 拼）。`ROW_MIRROR_ID` 那一份
                         * 重复的代价写在它的注释里。
                         */
                        onClick={() => onUpdate?.(row.rowId, { mirrorId: ROW_MIRROR_ID })}
                      >
                        {t('files.updateMirror')}
                      </button>
                    ) : null}
                    {showBind ? (
                      <button
                        type="button"
                        className="ghostbtn"
                        disabled={busy}
                        /* ⚠️ 入参只有 rowId：`.jar` 的路径由主进程自己的对话框产生。 */
                        onClick={() => onBindLocal?.(row.rowId)}
                      >
                        {t('files.bindLocal')}
                      </button>
                    ) : null}
                    {page === null ? null : (
                      /*
                       * ★ 「打开原网页」是**链接**、不是按钮：它不写盘、也不经过主进程
                       * （`manual` 的行只有它 —— Ruling 47）。
                       */
                      <a className="ghostbtn" href={page} target="_blank" rel="noopener noreferrer">
                        {t('files.openPage')}
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
