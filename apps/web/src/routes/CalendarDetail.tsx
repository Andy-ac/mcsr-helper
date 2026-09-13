import { CONTINENTS } from '@mcsr/shared';
import type { CalendarEvent } from '@mcsr/shared/calendar';
import { isEventPast } from '@mcsr/shared/calendar';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { Notice } from '@/components/Form';
import { Markdown } from '@/components/Markdown';
import { ApiError, fetchCalendarEvent, fetchCalendarForEdit } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { eventTitles, eventWhenAll, VIEWER_TZ, viewerWallClock } from '@/lib/calendarFormat';
import { useCan } from '@/lib/capabilities';
import { useAsync } from '@/lib/useAsync';

/**
 * 日历事件详情 —— `/calendar/:id`。
 *
 * ---------------------------------------------------------------------------
 * 两个接口，先试"可编辑的"那一个
 * ---------------------------------------------------------------------------
 *   · `GET /api/calendar/mine/:id` —— 登录后可用。含**未发布**的条目和
 *     **正在等审核的那一版**（`pendingRevision` / `pendingPayload`）。
 *   · `GET /api/calendar/:id` —— 公开。未发布的一律 404。
 *
 * 顺序不能反：自己的草稿只有前者拿得到。而**登录了的话就一定要走前者**，
 * 否则"这条有一版改动在等审核"这件事在详情页上永远显示不出来 ——
 * 公开接口根本不知道有这回事。
 *
 * ⚠️ 和 EditResource 不同的是，这里的 404 要**分两种**处理：
 *    · 公开接口 404 → "这条还没上架"，不是错误，要给编辑入口
 *    · 其它失败（500 / 断网）→ 真的报错
 *    把 500 也显示成"还没上架"是在替服务端撒谎，用户会去反复刷新一个
 *    其实已经坏掉的页面。
 *    而 `useAsync` 只保留 `error.message`（拿不到状态码），所以这里在
 *    loader 里就把两种结果分开返回 —— 用 `ApiError.status` 判，不靠匹配 message 文本。
 */

type DetailResult =
  | { kind: 'ok'; event: CalendarEvent; pendingRevision: number | null }
  /** 公开接口明确回了 404：没上架，或者根本不存在 */
  | { kind: 'missing' };

/** abort 是我方主动取消，必须原样抛出去（useAsync 会忽略它，不当错误显示）。 */
function abortable(error: unknown): void {
  if (error instanceof DOMException && error.name === 'AbortError') throw error;
}

export function CalendarDetailPage() {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams();
  const auth = useAuth();
  // 审过内容的人看到的是「修改」，其它人看到的是「建议修改」—— 和资源库同一套用词
  const isContentEditor = useCan('calendar.review');

  const state = useAsync<DetailResult>(
    async (signal) => {
      if (auth.user) {
        const editable = await fetchCalendarForEdit(id, signal).catch((error: unknown) => {
          abortable(error);
          // 拿不到就不用它 —— 但**不报错**，公开接口还有一次机会
          return null;
        });
        if (editable) {
          return { kind: 'ok', event: editable.event, pendingRevision: editable.pendingRevision };
        }
      }
      try {
        const pub = await fetchCalendarEvent(id, signal);
        return { kind: 'ok', event: pub.event, pendingRevision: null };
      } catch (error) {
        abortable(error);
        if (error instanceof ApiError && error.status === 404) return { kind: 'missing' };
        throw error;
      }
    },
    [id, auth.loading, auth.user?.id],
  );

  if (auth.loading || state.status === 'loading') {
    return <p className="state">{t('common.loading')}</p>;
  }

  if (state.status === 'error') {
    return (
      <div className="state state--empty">
        <p className="state__title">{t('calendar.loadFailed')}</p>
        <p>{state.error}</p>
        <Link className="cta" to="/calendar">
          ← {t('calendar.backToList')}
        </Link>
      </div>
    );
  }

  if (state.data.kind === 'missing') {
    return <NotPublished id={id} />;
  }

  const { event, pendingRevision } = state.data;
  /*
   * ★ 「比赛时间」那一行的值（需求⑦）：**所有段**用词条里的分隔符拼起来。
   * ⚠️ 用 `eventWhenAll` 而不是 `eventWhen`（只给第一段）：这一页有整行的空间，
   *    而"分三个周末打"和"连着打三周"是两件完全不同的事 —— 只显示第一段的话，
   *    后者在前者眼里长得一模一样（见 `eventWhen` 的注释里那段论证）。
   * ⚠️ 算不出来时是空串（`slots` 坏掉/为空），由下面的 `||` 退回单一的开始时间。
   */
  const slotsText = eventWhenAll(event, t('calendar.slotSeparator'));
  const { primary, secondary } = eventTitles(event, i18n.language);
  const past = isEventPast(event, Date.now());
  const mine = viewerWallClock(event.startsAtUtc, event.startsAtTz, event.allDay);

  /*
   * 「建议修改」按**服务端 PATCH 的同一条规则**决定显不显示：
   *   · 已发布的 → 任何登录且验证过邮箱的人都能改（wiki 式，改动一样要过审核）
   *   · 未发布的 → 只有作者本人
   * 界面先把不该出现的入口收起来，是为了让"点进去被拦住"不发生；
   * 真正的拦截仍然在服务端。
   */
  const isAuthor = auth.user !== null && event.authorId !== null && auth.user.id === event.authorId;
  const canEdit = auth.user?.emailVerified === true && (event.status === 'published' || isAuthor);

  return (
    <article className="detail">
      <Link className="detail__back" to="/calendar">
        ← {t('calendar.backToList')}
      </Link>

      <header className="detail__head">
        <div className="detail__heading">
          <h1 className="detail__title">{primary}</h1>
          {/* Q19：没有英文标题时这里显示的是中文原文，而不是一个空白 */}
          {secondary ? <p className="detail__alt">{secondary}</p> : null}

          <div className="detail__meta">
            {/*
              状态用一个 badge（词条来自共用的 status.*，和「我的提交」一致）——
              同一个状态在两个页面上有同一种叫法，用户不用先猜它们是不是一回事。
            */}
            <span className={`badge badge--status-${event.status}`}>
              {t(`status.${event.status}`)}
            </span>
            {/* 「已结束」是算出来的，不是状态 —— 所以它是一个并列的标记，不是状态值 */}
            {past ? <span className="badge badge--past">{t('calendar.pastBadge')}</span> : null}
            {event.allDay ? (
              <span className="badge badge--kind">{t('calendar.allDayBadge')}</span>
            ) : null}
            {event.tags.map((tag) => (
              <span key={tag} className="badge badge--kind">
                {t(`calendar.tag.${tag}`)}
              </span>
            ))}
            {/*
              ⚠️ 这里原来还有一枚**轮次**徽章（`calendar.stage.*`），2026-09-13 随
                 需求⑦一起去掉：`stage` 这一维已经不是"这次要填的东西"了，
                 而一个只在旧数据上出现的徽章会让"这一条为什么和别人不一样"变成
                 一个没人答得上来的问题。类型上那一格还在（兼容旧快照），界面不再读它。
            */}
            <span className="badge badge--kind">
              {event.lang === 'en' ? t('resources.langEn') : t('resources.langZh')}
            </span>
          </div>

          {event.url ? (
            <a className="cta" href={event.url} target="_blank" rel="noopener noreferrer nofollow">
              {t('calendar.openLink')} ↗
            </a>
          ) : null}

          {canEdit ? (
            <div className="detail__actions">
              <Link className="ghostbtn" to={`/calendar/${encodeURIComponent(event.id)}/edit`}>
                {isContentEditor ? t('edit.modifyAction') : t('edit.suggestAction')}
              </Link>
              {isContentEditor ? (
                <span className="detail__actions-hint">{t('edit.editorHint')}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      {/*
        待审提示放在内容**之前**：这条正在等审核（或者你正在看的那一版和线上不同），
        是读这篇内容之前就该知道的前提，不是读完之后的一个补充说明。
      */}
      {pendingRevision !== null ? (
        <Notice kind="info">
          {t('calendar.pendingNotice', { revision: pendingRevision })}
          {isContentEditor ? (
            <>
              {' '}
              <Link to={`/review/calendar/${encodeURIComponent(event.id)}`}>
                {t('edit.busyGoReview')}
              </Link>
            </>
          ) : null}
        </Notice>
      ) : null}

      {past ? <Notice kind="info">{t('calendar.pastNotice')}</Notice> : null}

      {/*
        时间块。**时间永远和时区名一起出现**（Q2）——
        单独一个 `20:00` 是没有意义的信息。
        这里显示的是**用户填进去的那一行**（当地墙钟 + IANA 名），
        因为那才是可以和赛事公告逐字核对的东西；换算结果附在下面。
      */}
      <h2 className="related__title">{t('calendar.infoTitle')}</h2>
      <dl className="infotable">
        {/*
          ★ 需求⑦（2026-09-13）：原来「开始时间」「结束时间」是**两行**，现在并成
          一行「比赛时间」，值是把**每一段**都写出来的 `eventWhenAll(...)`
          （段与段之间用 `calendar.slotSeparator` 拼 —— 中文是「，」、英文是「, 」
          —— 标点属于文案，见那个词条的注释）。

          ⚠️⚠️ 并成一行之后，**时区名不能跟着丢**：Q2 那条硬规矩是"时间必须和时区名
            一起出现"，而一旦这一行只剩一个值，`20:00` 就会重新变成一个不知道指哪里
            的数字。所以时区仍然是行尾那一格 `.calendar-time__zone`。
            它现在**比原来更要紧**：原来两行各带一次（漏一处还有另一处），
            现在只有这一处，漏掉就真的没有了。

          ⚠️ 多段时**不要**再补一句"跨几天"的包络（第一段 ~ 最后一段）：用户明确
            不喜欢那个展示，而包络本身是可以从段列表算出来的冗余量 ——
            它还会把"分三个周末打"说成"连着打二十天"，那正是最容易被误读的一种写法。
        */}
        <dt>{t('calendar.fields.slots')}</dt>
        <dd>
          {/*
            ⚠️ `||` 的右半边是**老数据的兜底**：`slots` 为空或坏掉时 `eventWhenAll`
               回空串，这时退回单一的开始时间 —— **不编一个日期出来**。
               时区那一格两种情况都在，因为 `startsAtTz` 是必填字段。
          */}
          <span className="calendar-time__value">{slotsText || event.startsAtLocal}</span>
          <span className="calendar-time__zone">{event.startsAtTz}</span>
          {mine ? (
            <>
              <br />
              <span className="calendar-time__mine">
                {t('calendar.yourTime', { time: mine, tz: VIEWER_TZ })}
              </span>
            </>
          ) : null}
        </dd>

        <dt>{t('calendar.fields.location')}</dt>
        <dd>{event.location ?? '—'}</dd>

        {/*
          ★ 「参赛门槛」与「参与范围明细」（需求⑦把这两维摆到活动信息页上）。
          ⚠️ 两行**有值才显示**（下面的系列名同理）：这两维都可以为空
             （排位节点那类活动没有门槛可言，见 shared/calendar.ts），
             而一屏 `—` 会让这一块看起来"没填完"。
          ⚠️ 与上面几行**刻意不同**：地点 / 链接 / 标签是每一个活动都有的字段，
             空缺本身是信息（"没填地点"）；这两维是"大部分活动都没有"的，
             占位行只会变成噪音。
        */}
        {event.access ? (
          <>
            <dt>{t('calendar.fields.access')}</dt>
            <dd>{t(`calendar.access.${event.access}`)}</dd>
          </>
        ) : null}

        {event.scopeDetail.length > 0 ? (
          <>
            <dt>{t('calendar.fields.scopeDetail')}</dt>
            <dd>{scopeDetailLabels(event.scopeDetail, event.scope, t)}</dd>
          </>
        ) : null}

        {/*
          ★ 系列名（需求③ / spec D3.10「详情页显示 + 链到筛选 URL」）。

          ⚠️ 这一页原来**没有**它，而且当时是对的：详情端点的 `getEventRow`
             这一轮才修好 `calendar_series` 的 JOIN（以前 `seriesName` 恒为 null）。
             现在名字真的有了 —— 而"填了系列却在详情页看不到"正是 D3.10 点名的那种漏：
             某个写死的字段清单漏掉一项，**不会报错**，只会让人以为这个字段不存在。

          ⚠️ 只在**有值**时渲染：绝大多数活动不属于任何系列，而那不是"还没填"
             （见 shared/calendar.ts 的 `seriesId` 注释）。一行恒为 `—` 的
             「系列活动」会让读者以为这块坏了。

          ⚠️ `seriesName` 与 `seriesId` 在服务端是一起 JOIN 出来的（同生同灭），
             但类型上各自可空、编译器认不出这个相关性 —— 所以这里按可空处理，
             而不是用一个断言把话说死。
        */}
        {event.seriesName ? (
          <>
            <dt>{t('calendar.seriesField')}</dt>
            <dd>
              {event.seriesId ? (
                /* 点它就去看这一串的全部场次（`?seriesId=` 是列表页那一处的同一个参数） */
                <Link to={`/calendar?seriesId=${encodeURIComponent(event.seriesId)}`}>
                  {event.seriesName}
                </Link>
              ) : (
                event.seriesName
              )}
            </dd>
          </>
        ) : null}

        <dt>{t('calendar.fields.url')}</dt>
        <dd>
          {event.url ? (
            <a href={event.url} target="_blank" rel="noopener noreferrer nofollow">
              {event.url}
            </a>
          ) : (
            '—'
          )}
        </dd>

        <dt>{t('calendar.fields.tags')}</dt>
        <dd>{event.tags.map((tag) => t(`calendar.tag.${tag}`)).join('、')}</dd>

        <dt>{t('calendar.fields.titleEn')}</dt>
        <dd>{event.titleEn ?? '—'}</dd>

        {/*
          ⚠️ 这里原来是两行：「轮次」和「提交者」，需求⑦把它们一起去掉了。
             两行的理由不同，但都成立：
               · 轮次（`stage`）这一维已经不再填写（见 `CalendarCard` 的同一条注释），
                 留着它只会在旧数据上冒出一格别人都没有的值；
               · 提交者（`calendar.author`）是**审核视角**的信息，而审核页
                 （`CalendarReviewView` + 队列）本来就显示作者 ——
                 详情页是给访客看的，作者是谁对"这场什么时候打"没有帮助。
        */}

        <dt>{t('calendar.updatedAt')}</dt>
        <dd>{new Date(event.updatedAt).toLocaleString()}</dd>

        <dt>{t('calendar.infoId')}</dt>
        <dd className="calendar-info__id">{event.id}</dd>
      </dl>

      {/*
        ⚠️ 这里原来是「具体时间」（015 的 `scheduleText` 自由文本框）。
            那个字段**已经整个从模型里去掉了**（`CalendarEvent` 上不再有它），
            取而代之的正是上面那一行「比赛时间」：真实的**多段**时间，每段有
            自己的开始 / 结束。所以这一块连同 `.calendar-schedule` 的样式一起退休。
            （⚠️ `.calendar-schedule` 的三条 CSS 规则因此变成了孤儿样式，
              但它们不在本次写入范围内 —— 记在报告里。）
      */}

      {/*
        ⚠️ Markdown 走 components/Markdown.tsx，那是全站唯一的渲染入口 ——
        rehype-sanitize 必须生效，否则用户提交的 <img onerror=...>
        会在每个访客的浏览器里执行脚本。
      */}
      <Markdown>{event.descriptionMd}</Markdown>
    </article>
  );
}

type Translate = (key: string) => string;

/**
 * 大洲代码的集合。
 *
 * ⚠️ 用 `Set` 而不是 `CONTINENTS.includes(code)`：后者要先把那个 `as const` 的元组
 *    放宽成 `readonly string[]`（一次断言），而集合连断言都不需要，
 *    也顺手把 O(n) 变成 O(1)。
 */
const CONTINENT_SET: ReadonlySet<string> = new Set<string>(CONTINENTS);

/**
 * 「参与范围明细」→ 人话（`calendar.continent.*` / `calendar.country.*`）。
 *
 * ⚠️⚠️ 词条前缀**不能写死一个**。明细里存的是大洲代码（`ASIA`）或国家代码
 *    （`BR`），选哪一套由 `scope` 说；而 schema 刻意**不强制**两者联动
 *    （见 shared/calendar.ts 的 `scopeDetail` 注释：选 GLOBAL 却填了明细不会报错），
 *    所以这里让 `scope` 只做**首选**，认不出时按代码本身属于哪一份名单来判 ——
 *    两份名单没有交集（`ASIA` 不会出现在国家里），这个判断是确定的。
 *    写死 `country` 的后果是显示成 `calendar.country.ASIA` 那个不存在的 key，
 *    而 i18next 会把它**原样**印在页面上，且只出现在选了大洲的那几条活动上。
 *
 * ⚠️ 这段与 `components/CalendarReviewView.tsx` 里的同名一段是**刻意重复**的：
 *    两个页面拿到的数据形状不同（那边是从快照 payload 里"先判断类型再取"的
 *    `unknown`，这边是类型齐全的 `CalendarEvent`）。真正该共享的那一天，它应该落在
 *    `lib/calendarFormat.ts` —— 那个文件由另一个人拥有，本轮不动它。
 *    （改这里时**同时**看那一边，两边必须给出同一个词条。）
 */
function scopeDetailLabels(codes: readonly string[], scope: string | null, t: Translate): string {
  const group = scope === 'CONTINENT' ? 'continent' : scope === 'COUNTRY' ? 'country' : null;
  return codes
    .map((code) => {
      const prefix = group ?? (CONTINENT_SET.has(code) ? 'continent' : 'country');
      return t(`calendar.${prefix}.${code}`);
    })
    .join('、');
}

/**
 * 「这条还没上架」。
 *
 * ⚠️ 公开接口对**待审**和**不存在**都返回 404（服务端刻意的：403 等于承认
 *    "这个 id 存在但你没权限"，那本身就是一条信息）。所以这里的话必须同时
 *    覆盖两种可能，不能写成"这条还在等审核" —— 那对打错地址的人来说
 *    是一个凭空造出来的事实。
 *
 * 但仍然要给编辑入口：这条 404 最可能的读者是**作者本人**（他刚提交完，
 * 想看看长什么样），而他没有别的地方能打开它。
 */
function NotPublished({ id }: { id: string }) {
  const { t } = useTranslation();
  const auth = useAuth();

  return (
    <div className="state state--empty">
      <p className="state__title">{t('calendar.notPublished')}</p>
      <p className="state__hint">{t('calendar.notPublishedHint')}</p>
      {auth.user ? (
        <Link className="cta" to={`/calendar/${encodeURIComponent(id)}/edit`}>
          {t('calendar.openEditor')}
        </Link>
      ) : null}
      <p className="submitgate">
        <Link className="authform__link" to="/calendar">
          ← {t('calendar.backToList')}
        </Link>
      </p>
    </div>
  );
}
