import { CALENDAR_TAGS } from '@mcsr/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { CalendarCard } from '@/components/CalendarCard';
import { CalendarIcsSubscribe } from '@/components/CalendarIcsSubscribe';
import { fetchCalendarEvents } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CALENDAR_PAGE_SIZE } from '@/lib/calendarFormat';
import { useAsync } from '@/lib/useAsync';

/**
 * 日历列表 —— `/calendar`。
 *
 * ---------------------------------------------------------------------------
 * 筛选状态放在 URL 里（和资源库一致）
 * ---------------------------------------------------------------------------
 * `?tags=&past=&page=` 刷新不丢、能分享、浏览器后退键符合直觉。
 *
 * ⚠️ 但 **`tags` 的默认值不是"空"，是"全上"**。
 *    Q1 要的是"三个标签都做、并且用户可以自行选择显示哪些"，
 *    所以一进来三条都亮着。缺省（URL 里没有 tags）和显式写了三条
 *    在服务端是同一个查询，但界面上的状态不同 —— 所以只在用户**动过**
 *    之后才往 URL 里写，这样"刚打开这一页"和"我自己把三个都打开"
 *    不会看起来毫无区别。
 *
 * ⚠️ 而"一个标签都不选"是**不允许**的状态，见 toggleTag。
 */
export function CalendarList() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const auth = useAuth();
  const [lockedHint, setLockedHint] = useState(false);

  const tagsParam = params.get('tags');
  /*
   * URL 里有 tags 就只认它，没有就全上。
   * ⚠️ 只保留 CALENDAR_TAGS 里真实存在的值 —— URL 是用户可以手打的，
   *    而 `?tags=FOO` 会被服务端当成一个合法的筛选值（它会原样拼进查询），
   *    结果是"筛了但什么都没筛到"，看起来像日历坏了。
   */
  const parsedTags =
    tagsParam === null ? [] : CALENDAR_TAGS.filter((tag) => tagsParam.split(',').includes(tag));
  /*
   * ⚠️ `?tags=`（空串）和 `?tags=FOO` 都会解析出**空集合**，而空集合在服务端
   *    等同于"不加标签条件"，也就是**全部返回**。界面上没有任何一个状态能诚实地
   *    表示"一个标签都不选"，所以这种输入一律当作"全上"，而不是真的把三条都关掉
   *    —— 后者会让页面显示着"什么都没选"却列出全部内容，而那个谎没有任何报错。
   */
  const activeTags: string[] = parsedTags.length > 0 ? parsedTags : [...CALENDAR_TAGS];

  const showPast = params.get('past') === '1';
  const page = Math.max(Number(params.get('page') ?? '1') || 1, 1);

  const query = {
    /*
     * ⚠️ `from` 是**三态**（见 fetchCalendarEvents 的 JSDoc）：
     *    · undefined → 服务端按"现在"过滤，也就是默认只看还没结束的（Q5）
     *    · 0         → 等价于"连已结束的也一起给我"
     *    所以这里传的是 `undefined` 或 `0`，不是"现在的时间戳"。
     *    传时间戳的话，"显示已结束"打开后仍然会漏掉刚刚结束的那一场。
     */
    from: showPast ? 0 : undefined,
    tags: activeTags,
    page,
    pageSize: CALENDAR_PAGE_SIZE,
  };

  const list = useAsync((signal) => fetchCalendarEvents(query, signal), [JSON.stringify(query)]);

  /*
   * ⚠️ 「已结束」是按**这一次渲染的时刻**算的，取一次传下去。
   *    每张卡片各自 Date.now() 的话，列表在跨过某个结束时刻的瞬间会
   *    出现"两张卡片对同一时刻给出不同答案"的画面。
   */
  const now = Date.now();

  function toggleTag(tag: string) {
    const on = activeTags.includes(tag);
    /*
     * ★ 最后一个标签**关不掉**。
     *
     * 服务端表达不了"一个标签都不选"：`tags` 空数组和不传是同一个查询
     * （都不加标签条件），也就是"全都给我"。允许关到零的话，用户看到的是
     * 全部内容，而他以为自己在看"什么都不看" —— 界面在撒谎，而且这个谎
     * 没有任何报错。所以这里直接不让它发生，并说清楚为什么。
     */
    if (on && activeTags.length === 1) {
      setLockedHint(true);
      return;
    }
    const next = CALENDAR_TAGS.filter((x) =>
      on ? activeTags.includes(x) && x !== tag : activeTags.includes(x) || x === tag,
    );
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next.length === CALENDAR_TAGS.length) p.delete('tags');
        else p.set('tags', next.join(','));
        p.delete('page'); // 换筛选条件要回到第一页
        return p;
      },
      { replace: true },
    );
    setLockedHint(false);
  }

  function setParam(key: string, value: string | undefined) {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === undefined) next.delete(key);
      else next.set(key, value);
      if (key !== 'page') next.delete('page');
      return next;
    });
  }

  const totalPages =
    list.status === 'ok' ? Math.max(1, Math.ceil(list.data.total / CALENDAR_PAGE_SIZE)) : 1;

  return (
    <>
      <header className="pagehead">
        <div className="pagehead__row">
          <h1 className="pagehead__title">{t('nav.calendar')}</h1>
          {/*
            和资源库同一个约定：「提交」是**这个版块的动作**，所以它长在这一页的
            标题右边，而不是侧边栏里多一个全局条目（见 components/Layout.tsx 的注释）。
            仅登录后可见：没登录的人点进去只会被弹回来，而"看得见、点不动"
            比"看不见"更让人困惑。
          */}
          {auth.user ? (
            <Link className="cta pagehead__action" to="/calendar/submit">
              + {t('calendar.submitAction')}
            </Link>
          ) : null}
        </div>
        <p className="pagehead__sub">{t('calendar.listSubtitle')}</p>
      </header>

      {/*
        ★ 订阅入口排在内容**前面**。
        M4 的验收标准里有一条就是"订阅的 ICS 能在手机自带日历里看到"，
        而它是一次性动作（做过一次就不再需要）—— 埋在列表下面的话，
        只有滚到底的人才找得到。
      */}
      <CalendarIcsSubscribe />

      <div className="filters calendar-filters">
        <span className="tagcloud__label">{t('calendar.filterTagsLabel')}</span>
        {CALENDAR_TAGS.map((tag) => {
          const on = activeTags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              className={`tagchip${on ? ' tagchip--on' : ''}`}
              onClick={() => toggleTag(tag)}
              aria-pressed={on}
            >
              {t(`calendar.tag.${tag}`)}
            </button>
          );
        })}

        <label className="listfilter">
          <input
            type="checkbox"
            checked={showPast}
            onChange={(e) => setParam('past', e.target.checked ? '1' : undefined)}
          />
          {t('calendar.showPast')}
        </label>
      </div>

      {lockedHint ? (
        <p className="calendar-filters__hint">{t('calendar.filterTagsLocked')}</p>
      ) : (
        <p className="calendar-filters__hint">{t('calendar.filterTagsHint')}</p>
      )}

      {list.status === 'loading' ? <CalendarSkeleton /> : null}

      {list.status === 'error' ? (
        <div className="state state--error">
          <p>
            {t('calendar.loadFailed')}：{list.error}
          </p>
        </div>
      ) : null}

      {list.status === 'ok' ? (
        <>
          <p className="resultcount">{t('calendar.resultCount', { count: list.data.total })}</p>

          {list.data.items.length === 0 ? (
            <div className="state state--empty">
              <p className="state__title">{t('calendar.empty')}</p>
              <p className="state__hint">{t('calendar.emptyHint')}</p>
            </div>
          ) : (
            <ul className="calendar-list">
              {list.data.items.map((event) => (
                <CalendarCard key={event.id} event={event} now={now} />
              ))}
            </ul>
          )}

          {totalPages > 1 ? (
            <nav className="pager" aria-label="pagination">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setParam('page', String(page - 1))}
              >
                ← {t('resources.prevPage')}
              </button>
              <span className="pager__pos">{t('resources.page', { page, total: totalPages })}</span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setParam('page', String(page + 1))}
              >
                {t('resources.nextPage')} →
              </button>
            </nav>
          ) : null}
        </>
      ) : null}
    </>
  );
}

/**
 * 骨架屏。
 *
 * 结构和真实卡片一致（左边时间块 + 右边正文），所以数据到达时不会跳版 ——
 * 那是"页面显得丝滑"里体感最强、也最容易被忽略的一项。
 */
function CalendarSkeleton({ count = 4 }: { count?: number }) {
  return (
    <ul className="calendar-list" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={`cal-skel-${String(i)}`}>
          <div className="calendar-card">
            <div className="calendar-card__when">
              <span className="skel skel--line" style={{ width: 56 }} />
              <span className="skel skel--line" style={{ width: 84, height: 10 }} />
            </div>
            <div className="calendar-card__body">
              <span className="skel skel--line" style={{ width: '55%' }} />
              <span className="skel skel--line" style={{ width: '30%', height: 10 }} />
              <span className="skel skel--line" style={{ width: '90%' }} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
