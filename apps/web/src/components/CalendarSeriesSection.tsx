import type { CalendarEvent, CalendarSeries } from '@mcsr/shared/calendar';
import { useTranslation } from 'react-i18next';
import { CalendarCard } from '@/components/CalendarCard';
import { VIEWER_TZ } from '@/lib/calendarFormat';

/**
 * 「系列活动」栏目（需求③）—— 日历页**底部**的一块。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 这是一个**纯展示组件**：数据、搜索词、选中项全部来自 props
 * ---------------------------------------------------------------------------
 * 取数住在容器（`routes/CalendarList.tsx`）里。这个拆分不是为了好看，而是为了
 * **能被真的断言**：服务端渲染（`renderToStaticMarkup`）**不跑 `useEffect`**，
 * 所以一个自取数的组件在 SSR 下永远停在"加载中"那一屏 —— 搜索框、结果条数、
 * 空态一句都断言不到，断言会退化成恒真。
 *
 * 本仓四个日历组件（`CalendarGrid` / `CalendarFilters` / `CalendarDayPanel` /
 * `CalendarMonthNav`）早就是这个形状，这里只是跟着走，不是新架构。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 搜索是**客户端过滤**，而且是**服务端不知道**的一件事（spec D3.9）
 * ---------------------------------------------------------------------------
 * 系列是人眼能扫完的量级（几十个），所以列表一次取回、在这里按名字子串过滤。
 * 服务端不提供 `q` —— 再写一份匹配规则就是第二份会漂移的真相
 * （比如服务端按前缀匹配、这里按子串，用户会看到"搜同一个词结果不一样"）。
 *
 * ⚠️ **对匿名访客开放**（spec §9-5 裁决）：这里**没有**"登录后才能搜索"那条分支，
 *    `calendar.seriesNeedLogin` 也已随裁决删除。加一条登录门槛会把本来能看的访客挡在外面。
 */
export interface CalendarSeriesSectionProps {
  /** 服务端已经排好序，**这里不重排**（见 `fetchCalendarSeries` 的注释）。 */
  items: CalendarSeries[];
  query: string;
  onQueryChange: (next: string) => void;
  /** 当前筛选中的系列 id；null = 没筛。 */
  selectedId: string | null;
  onSelect: (seriesId: string) => void;
  status: 'loading' | 'ok' | 'error';
  errorText?: string | null;
  /**
   * 点「删除」——**不传 = 这个观看者看不到删除入口**。
   *
   * ⚠️ 判据（owner 专属，共享谓词 `canHardDelete`）由**容器**算好再决定传不传，
   *    组件里**不判断角色**：在组件里再判一次就是第二份会漂移的权限真相
   *    （与 `VideoCard` 的 `canEdit`、`MyLiveList` 的 `loggedIn` 同一个做法）。
   */
  onAskDelete?: (seriesId: string) => void;
  /**
   * 正在确认删除的那一行：**带 id 也带数量**。
   *
   * ⚠️ 数量必须由容器**现取**（`fetchCalendarSeriesImpact`）后传进来，不能拿
   *    `series.count` 顶替 —— 那是"未结束且已发布"的场次，而删除带走的是所有赛场，
   *    两者在最需要正确的那种系列（历届赛事，count 恒为 0）上恰好相反。
   *    ⚠️ 刻意**不在这里取数**：这个组件是纯展示的，自取数会让它在纯 node SSR 下
   *       永远停在"加载中"，确认框那句话就一条也断言不到（见组件头注释）。
   */
  deleteConfirm?: { id: string; count: number } | null;
  /** 删除请求进行中（容器持有异步状态）。 */
  deleteBusy?: boolean;
  /**
   * 删除相关的错误（取 impact 失败、或删除本身失败）。
   *
   * ⚠️ 与上面那个 `errorText` **是两件事**，刻意分开：那个是"系列列表没拿到"，
   *    这个是"你要删的那一条没成"。混在一起会让用户以为整块数据坏了
   *    （`Live.tsx` 里对同一个区分写过注释：取数失败与提交失败不并进同一个 error）。
   */
  deleteErrorText?: string | null;
  onConfirmDelete?: () => void;
  onCancelDelete?: () => void;
  /**
   * ★ 展开某个系列时要显示的那一批卡片（2026-09-13，用户要求
   *   「点击合集时应当在下方展开所有在其范围内的赛事信息卡片」）。
   *
   * ⚠️ 打成**一个可选对象**而不是三个 prop（`expandedEvents` / `expandedLoading` /
   *    `now`）：它们只在"正在展开"这一种情况下同时有意义，拆成三个 prop 会出现
   *    "传了 events 忘了传 loading"这种半截状态，而那种状态画出来像加载失败。
   * ⚠️ 传 `null`（或不传）= 这一页不支持展开（**不是**"这个系列是空的"）。
   */
  expanded?: { events: CalendarEvent[]; loading: boolean; now: number } | null;
}

export function CalendarSeriesSection({
  items,
  query,
  onQueryChange,
  selectedId,
  onSelect,
  status,
  errorText,
  onAskDelete,
  deleteConfirm,
  deleteBusy,
  deleteErrorText,
  onConfirmDelete,
  onCancelDelete,
  expanded,
}: CalendarSeriesSectionProps) {
  const { t } = useTranslation();

  /*
   * 过滤放在组件内部：它是**展示的派生量**（同一份 props 永远得到同一份结果），
   * 而不是业务规则。放进容器会让容器同时管取数、管 URL、管过滤三件事。
   *
   * ⚠️ 用 `toLowerCase` 做**大小写不敏感**的子串匹配：系列名是自由文本，
   *    用户不会记得自己当初打的是 `MCSR Ranked` 还是 `mcsr ranked`。
   *    （这与"系列名本身不折叠大小写"不冲突 —— 那边管的是**存储的显示名**，
   *     这边管的是**这一次搜索匹配得宽不宽**。）
   */
  const needle = query.trim().toLowerCase();
  const filtered = needle ? items.filter((s) => s.name.toLowerCase().includes(needle)) : items;

  return (
    <section className="series" aria-labelledby="series-title">
      <h2 className="series__title" id="series-title">
        {t('calendar.seriesSectionTitle')}
      </h2>
      <p className="series__hint">{t('calendar.seriesSectionHint')}</p>

      {/*
        搜索框**永远渲染**，包括匿名访客（§9-5：列表与搜索对所有人开放）。
        label 用 sr-only 而不是可见文字：下面那句 hint 已经把这一块说清了，
        再挂一行可见的"搜索"会让这一块看起来像两个标题。
      */}
      <div className="series__search">
        <label className="sr-only" htmlFor="series-q">
          {t('calendar.seriesSearch')}
        </label>
        <input
          id="series-q"
          type="search"
          value={query}
          placeholder={t('calendar.seriesSearch')}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </div>

      {status === 'loading' ? <p className="state">{t('common.loading')}</p> : null}

      {/*
        删除相关的错误放在**列表上方**，而不是整块的最下面：用户刚点的是列表里的某一行，
        系列一多，页面底部的提示就滚出视野了 —— 那时用户只会觉得"点了没反应"。
        ⚠️ 分隔符仍沿用上面那段注释里的做法（`aria-hidden` 的 `·`），不把 errorText 拼进句子。
      */}
      {deleteErrorText ? (
        <div className="state state--error">
          <p>
            {t('calendar.seriesDeleteFailed')}
            <span aria-hidden="true"> · </span>
            {deleteErrorText}
          </p>
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="state state--error">
          {/*
            ⚠️ 这里原来是**模板串里的全角冒号**（`` `：${errorText}` ``），有两个问题：
            全角冒号在**英文**界面下是错的字形；而它是全文件孤例，
            下次统一改文案格式时一定会被漏掉。

            现在的做法是**用一个独立元素做分隔符**（`aria-hidden` 的 `·`），
            于是 `errorText` 不再被拼进任何句子里：
              · **不需要新词条** —— 这正是"两句独立元素"那条既有做法的形状
                （t15 验收也把它列为可接受的两种做法之一）；
              · **不再是标点问题** —— `·` 是同一个字形，中英两侧都成立，
                不像全角/半角冒号那样必须二选一；
              · `aria-hidden` 是刻意的：纯视觉分隔，读屏软件念"加载失败 · 详情"
                没有信息增益。
            ⚠️ 保留 `errorText ? … : ''` 的条件 —— 没有错误详情时**不留一个孤立的
               分隔符**（那看起来像一句话被截断了）。
          */}
          <p>
            {t('calendar.loadFailed')}
            {errorText ? (
              <>
                <span aria-hidden="true"> · </span>
                {errorText}
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      {status === 'ok' ? (
        items.length === 0 ? (
          /*
           * ⚠️ 这两句话**不一样**，别合成一句（i18n 的注释专门写过）：
           *    这里是"一个系列都还没有"，下面是"搜了但没匹配上"。
           *    合成一句会让用户以为系列数据没了，而不是自己的关键词没命中。
           */
          <div className="state state--empty">
            <p className="state__title">{t('calendar.seriesEmpty')}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="state state--empty">
            <p className="state__title">{t('calendar.seriesNoMatch')}</p>
          </div>
        ) : (
          <ul className="series__list">
            {filtered.map((s) => {
              /*
               * ⚠️ 在这里算一次、用一个局部量，而不是在 JSX 里写两遍 `nextLabel(...)`：
               *    写两遍会让"有没有时间"的判据与"显示什么"各调一次，
               *    两次都可能拿到不同的结果（Intl 极端情况下会抛），于是出现
               *    "判断说有、渲染出来是空"这种只在个别机器上出现的空白格子。
               */
              const next = nextLabel(s.nextStartsAtUtc);
              const confirming = deleteConfirm?.id === s.id;
              return (
                /*
                 * ⚠️ 删除入口是选择按钮的**兄弟**，不是它的子节点。
                 *    整行本身就是一个 `<button>`（点哪都能选中系列），而
                 *    `<button>` 里再放 `<button>` 是**非法 HTML** —— 浏览器会
                 *    把里面那个挪出去，于是"删除"跑到行外面、样式全乱，
                 *    而且 **React 会报 validateDOMNesting 警告**（生产构建里看不见）。
                 */
                <li key={s.id} className="series__row">
                  <button
                    type="button"
                    className={`series__item${selectedId === s.id ? ' series__item--on' : ''}`}
                    aria-pressed={selectedId === s.id}
                    onClick={() => onSelect(s.id)}
                  >
                    <span className="series__name">{s.name}</span>
                    <span className="series__meta">
                      {s.count > 0
                        ? t('calendar.seriesCount', { count: s.count })
                        : t('calendar.seriesNoneUpcoming')}
                    </span>
                    {/*
                      下一场时间。拿不到时为 null ⇒ **不渲染这一格** ——
                      一个空的"下一场："比没有更让人困惑。
                    */}
                    {next ? <span className="series__next">{next}</span> : null}
                  </button>

                  {onAskDelete && !confirming ? (
                    <button
                      type="button"
                      className="ghostbtn series__delete"
                      onClick={() => onAskDelete(s.id)}
                    >
                      {t('calendar.seriesDelete')}
                    </button>
                  ) : null}

                  {confirming /*
                   * ★ 二次确认。两句话**必须真的不同**（`calendarrender.tsx` 钉着这一条）：
                   *   · 下面没有赛事 ⇒ 说清"不会影响任何内容"（让人敢按）；
                   *   · 下面有 N 场   ⇒ 说清 N、版本历史、不可恢复（让人不敢乱按）。
                   *
                   * ⚠️ 这里的 `count` 是**真正会被删掉的行数**（容器现取的 impact），
                   *    不是列表行上那个 `s.count`（那是"未结束"）。用错的话，
                   *    历史系列会拿到"不会影响任何内容"，而它正要删掉十几场。
                   */ ? (
                    <div className="series__confirm">
                      <span className="series__confirm-text">
                        {deleteConfirm.count > 0
                          ? t('calendar.seriesDeleteSome', { count: deleteConfirm.count })
                          : t('calendar.seriesDeleteNone')}
                      </span>
                      <button
                        type="button"
                        className="dangerbtn"
                        onClick={() => onConfirmDelete?.()}
                        disabled={deleteBusy === true}
                      >
                        {deleteBusy ? t('calendar.seriesDeleteBusy') : t('common.confirm')}
                      </button>
                      <button
                        type="button"
                        className="ghostbtn"
                        onClick={() => onCancelDelete?.()}
                        disabled={deleteBusy === true}
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  ) : null}

                  {/*
                    ★ 展开：这个系列下的**全部**赛事卡片（2026-09-13，用户要求
                      「点击合集时应当在下方展开所有在其范围内的赛事信息卡片」）。

                    ⚠️ 判据是**当前选中的那个系列**（`selectedId === s.id`），不是"被点过" ——
                       于是"点第二个系列"天然收起了第一个，不需要额外记一个展开态。
                    ⚠️ 数据是容器单独取的（`from: 0`，含已结束的）：见 `CalendarList`
                       里 `seriesEvents` 的注释 —— 复用主列表那一份会让历届系列点开是空的。
                    ⚠️ 卡片复用 `CalendarCard`（日历列表里那个）而不是另画一种：
                       同一场赛事在列表页与展开区里长得不一样，是"两处真相"的经典开头。
                  */}
                  {expanded && selectedId === s.id ? (
                    <div className="series__expanded">
                      {expanded.loading ? (
                        <p className="state">{t('common.loading')}</p>
                      ) : expanded.events.length === 0 ? (
                        /*
                         * ⚠️ 这一句与上面两个空态**都不同**：这里是"系列存在，但它名下
                         *    一场赛事都没有"。说成"还没有系列活动"会让人以为系列没了。
                         */
                        <p className="state state--empty">{t('calendar.seriesExpandedEmpty')}</p>
                      ) : (
                        <ul className="calendar-list">
                          {expanded.events.map((event) => (
                            <CalendarCard key={event.id} event={event} now={expanded.now} />
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </section>
  );
}

/**
 * 下一场时间，显示在**观察者自己的时区**里。
 *
 * ⚠️ 这里不调用 `viewerWallClock`：那个函数的契约是"当观察者时区与事件时区
 *    **不同**时，额外把观察者时区那版也显示出来"，所以两边相同时它返回 null ——
 *    用在系列上会得到"有些系列有时间、有些没有"的假象。
 * ⚠️ 只给到分钟：栏目里这是**次要信息**（名字与场次数才是主信息），
 *    再长的格式会把每一行撑成两行。
 * ⚠️ 拿不到 `Intl` / 传 null 时返回 null，由调用方决定不渲染 —— **不编一个时间**。
 */
function nextLabel(utcMs: number | null): string | null {
  if (utcMs === null || !Number.isFinite(utcMs)) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: VIEWER_TZ,
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(utcMs));
  } catch {
    return null;
  }
}
