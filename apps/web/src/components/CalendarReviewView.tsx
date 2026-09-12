import { wallClockToUtc } from '@mcsr/shared/calendar-time';
import type { ReviewDetail } from '@mcsr/shared/review';
import { useTranslation } from 'react-i18next';
import { Markdown } from '@/components/Markdown';

/**
 * 日历事件的审核视图 —— 日历对"这类内容长什么样、哪几个字段值得看"的回答。
 *
 * 和 ResourceReviewView 是同一套结构的第二份实现，但有三处**日历特有**的东西，
 * 而且三处都不是装饰：
 *
 *   1. **已结束的事件要显著标出来**（Q4c）。
 *      用户明确要求"过去的事件仍然进审核队列"（而不是自动过期不进队列），
 *      所以队列里**真的会有**三个月前那场比赛。不标出来的话，审核员会把注意力
 *      花在"这时间是不是填错了"上面 —— 而对一个已经结束的活动，"该不该收"
 *      这个判断根本没法做，答案也无关紧要。
 *
 *   2. **时间要按用户填的时区原样显示**，不做本地化转换。
 *      审核员核对的是"和赛事公告上写的一样不一样"，而公告上写的是当地时间。
 *      转成审核员自己的时区反而让他没法核对 —— 他得先在心里做一次换算，
 *      而那正是最容易出错的一步。
 *
 *   3. **标签和轮次要显示成人话**，不能把 `RANKED_MILESTONE` / `QUARTERFINAL`
 *      这种原始枚举值摆出来。同一个东西在同一屏里出现两种写法
 *      （"排位节点" vs `RANKED_MILESTONE`），读的人要额外对一次号。
 *
 * ⚠️ 标签与轮次的文案走 `calendar.tag.*` / `calendar.stage.*` 词条，
 *    **不用** `shared/calendar.ts` 里的 `CALENDAR_TAG_LABELS` ——
 *    那两个映射里写死的是中文，英文界面下会冒出一句中文，
 *    而这类问题只在切语言时才出现，正常路径的测试永远看不到。
 *    （词条的对齐由 services/api/src/i18n-keys.test.ts 守着。）
 */

type Translate = (key: string) => string;

/** 快照 payload 在界面上的字段清单。顺序 = 审核员判断时的实际阅读顺序。 */
const FIELDS: {
  key: string;
  labelKey: string;
  format?: (value: unknown, t: Translate) => string;
}[] = [
  { key: 'title', labelKey: 'calendar.fields.title' },
  { key: 'titleEn', labelKey: 'calendar.fields.titleEn' },
  // 时间与时间区紧挨着：它们共同描述一个时刻，分开显示会让人以为可以单独改其中一个
  { key: 'startsAtLocal', labelKey: 'calendar.fields.startsAt' },
  { key: 'startsAtTz', labelKey: 'calendar.fields.timezone' },
  { key: 'endsAtLocal', labelKey: 'calendar.fields.endsAt' },
  { key: 'endsAtTz', labelKey: 'calendar.fields.endsTz' },
  {
    key: 'allDay',
    labelKey: 'calendar.fields.allDay',
    format: (v, t) => (v === true ? t('calendar.yes') : t('calendar.no')),
  },
  {
    key: 'tags',
    labelKey: 'calendar.fields.tags',
    // 标签是枚举，要翻成人话（见文件头第 3 条）
    format: (v, t) =>
      Array.isArray(v) ? v.map((x) => t(`calendar.tag.${String(x)}`)).join('、') : '—',
  },
  {
    key: 'stage',
    labelKey: 'calendar.fields.stage',
    format: (v, t) => t(`calendar.stage.${String(v)}`),
  },
  /*
   * 011 新增的两维。
   *
   * ⚠️ 顺序是有意的：标签 → 轮次 → 专业程度 → 参与范围，和 ICS 的 CATEGORIES
   *    用的是同一个顺序。同一份内容在两个地方按不同顺序排列，
   *    读的人会以为它们是不同的东西。
   *
   * ⚠️ 两维**都可能为空**（排位节点没有这两维），而 `display()` 对空值
   *    直接显示 `—`、不会调到 format —— 所以这里不需要再兜一次空值，
   *    但要知道"显示成 — 是正确的"而不是漏了渲染。
   */
  {
    key: 'level',
    labelKey: 'calendar.fields.level',
    format: (v, t) => t(`calendar.level.${String(v)}`),
  },
  {
    key: 'scope',
    labelKey: 'calendar.fields.scope',
    format: (v, t) => t(`calendar.scope.${String(v)}`),
  },
  { key: 'location', labelKey: 'calendar.fields.location' },
  { key: 'url', labelKey: 'calendar.fields.url' },
  {
    key: 'lang',
    labelKey: 'calendar.fields.lang',
    format: (v, t) => (v === 'en' ? t('resources.langEn') : t('resources.langZh')),
  },
];

/** 任意值 → 可显示的字符串。数组用顿号连起来（中文习惯）。 */
function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.join('、') : '—';
  return String(value);
}

function display(value: unknown, field: (typeof FIELDS)[number], t: Translate): string {
  if (field.format && value !== null && value !== undefined && value !== '') {
    return field.format(value, t);
  }
  return text(value);
}

/**
 * 两个值是否算"一样"。
 *
 * ⚠️ 用 JSON 比较而不是 `===`：`tags` 是数组，`===` 永远为假，
 *    于是每一次修改都会被标成"标签变了"，包括那些根本没动标签的修改。
 *    一个永远亮着的"已改动"标记等于没有标记。
 *    （这条和 ResourceReviewView 里是同一个坑，同一个解法。）
 */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * 这一版的事件**描述的时刻**是否已经过去。
 *
 * ⚠️ 从快照现算，而不是读 `detail.item.expired`：
 *    `item.expired` 是**服务端在响应那一刻**算的，用的是服务器时钟；
 *    而审核员可能在这个页面上坐了很久（页面不自动刷新）。两者通常一致，
 *    但"已结束"必须显示**现在**的判断 —— 开着页面过了两小时、期间比赛结束了，
 *    那一行应该立刻是对的，而不是停在打开页面时的那一刻。
 *
 * 判据与 shared 的 `isEventPast` 一致：有结束时间按结束时间算，否则按开始时间算。
 * 算不出来（时区名非法）时返回 false，也就是宁可漏标一个，也不要把正常事件标成历史。
 */
function isPast(pending: Record<string, unknown>): boolean {
  const startsAtLocal = pending.startsAtLocal;
  const startsAtTz = pending.startsAtTz;
  if (typeof startsAtLocal !== 'string' || typeof startsAtTz !== 'string') return false;

  const start = wallClockToUtc(startsAtLocal, startsAtTz);
  if (start === null) return false;

  const endsAtLocal = pending.endsAtLocal;
  const endsAtTz = pending.endsAtTz;
  const end =
    typeof endsAtLocal === 'string' && typeof endsAtTz === 'string'
      ? wallClockToUtc(endsAtLocal, endsAtTz)
      : null;

  return (end ?? start) < Date.now();
}

export function CalendarReviewView({ detail }: { detail: ReviewDetail }) {
  const { t } = useTranslation();
  const { pending, live } = detail;
  const isEdit = live !== null;
  const past = isPast(pending);

  const descriptionMd = typeof pending.descriptionMd === 'string' ? pending.descriptionMd : '';
  const liveDescription = typeof live?.descriptionMd === 'string' ? live.descriptionMd : '';
  const bodyChanged = isEdit && !same(liveDescription, descriptionMd);

  return (
    <div className="reviewview">
      {/*
        ★ Q4c：已结束的条目必须在这里、而且**在内容之前**标出来。
        放在内容之后的话，审核员已经把几千字读完、判断也做完了才看到它。
      */}
      {past ? (
        <div className="reviewview__past">
          <span className="reviewview__pastlabel">{t('calendar.pastBadge')}</span>
          <p className="reviewview__pasttext">{t('calendar.pastExplain')}</p>
        </div>
      ) : null}

      {/* 提交者给审核员的话 —— 和资源库一样放在内容前面 */}
      {detail.note ? (
        <div className="reviewview__note">
          <span className="reviewview__notelabel">{t('review.noteFromSubmitter')}</span>
          <p className="reviewview__notetext">{detail.note}</p>
        </div>
      ) : null}

      <dl className="reviewview__grid">
        {FIELDS.map((field) => {
          const before = live?.[field.key];
          const after = pending[field.key];
          const changed = isEdit && !same(before, after);
          return (
            <div key={field.key} className={`reviewview__row${changed ? ' is-changed' : ''}`}>
              <dt>{t(field.labelKey)}</dt>
              <dd>
                {changed ? (
                  <span className="reviewview__before">{display(before, field, t)}</span>
                ) : null}
                <span className="reviewview__after">{display(after, field, t)}</span>
              </dd>
            </div>
          );
        })}
      </dl>

      {/*
        ⚠️ 快照里这个字段叫 `descriptionMd`，而资源库那份叫 `body`。它们不是
           同一个东西、也不该被合并：日历的事件简介是"这场比赛是什么"的几句话，
           资源库的正文是几千字的说明。共用一个 key 名会让人以为两个视图可以
           合并成一个 —— 而合并之后就得为两种长度完全不同的内容挑一种排版。
      */}
      <section className="reviewview__body">
        <h3 className="reviewview__subtitle">
          {t('calendar.fields.description')}
          {bodyChanged ? <span className="reviewview__flag">{t('review.changed')}</span> : null}
        </h3>
        <div className="reviewview__pane">
          {descriptionMd ? <Markdown>{descriptionMd}</Markdown> : <p className="muted">—</p>}
        </div>

        {/*
          旧版简介默认折叠 —— 理由与资源库那份相同：不折叠的话，一次只改了一个
          错字的修改会变成两大段文字摆在一起，审核员要自己找不同。
        */}
        {bodyChanged && liveDescription ? (
          <details className="reviewview__old">
            <summary>{t('review.showOldBody')}</summary>
            <div className="reviewview__pane reviewview__pane--old">
              <Markdown>{liveDescription}</Markdown>
            </div>
          </details>
        ) : null}
      </section>
    </div>
  );
}
