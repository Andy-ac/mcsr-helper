import type { ReviewDetail } from '@mcsr/shared/review';
import { useTranslation } from 'react-i18next';
import { Markdown } from '@/components/Markdown';

/**
 * 资源库条目的审核视图 —— **类型相关的那一半**。
 *
 * 队列、权限、批准/驳回的接口全是通用的（见 services/api/src/review/registry.ts）；
 * 只有"这个类型的内容长什么样、哪几个字段值得审核员看"是类型自己的事。
 * 这个文件就是资源库对那个问题的回答。
 *
 * ---------------------------------------------------------------------------
 * 为什么审核员必须看到旧版
 * ---------------------------------------------------------------------------
 * 审核一次**修改**和审核一个新条目是两件不同的事：
 *   · 新条目：要不要收（从零判断）
 *   · 修改  ：能不能接受这处改动（判断增量）
 *
 * 只显示新内容的话，第二种情况审核员只能靠记忆对照 —— 而正文动辄几千字，
 * 结果就是他要么全信，要么因为看不出来而驳回。所以线上版本必须并排摆出来。
 */

type Translate = (key: string) => string;

/**
 * 一个字段在该类型下怎么展示。
 *
 * `format` 是给**枚举**用的：`kind` 和 `lang` 在库里存的是 `tool` / `zh-CN`
 * 这种值，直接把原始值摆给审核员看是偷懒 —— 他会看到一行
 * 「类型 tool、语言 zh-CN」，而界面上其它地方明明写的是"工具 / 中文"。
 * 同一个东西在同一屏里出现两种写法，读的人要额外对一次号。
 */
const FIELDS: {
  key: string;
  labelKey: string;
  format?: (value: unknown, t: Translate) => string;
}[] = [
  { key: 'title', labelKey: 'submit.title' },
  { key: 'titleEn', labelKey: 'submit.titleEn' },
  { key: 'url', labelKey: 'submit.url' },
  {
    key: 'kind',
    labelKey: 'submit.kind',
    format: (v, t) => (v === 'website' ? t('resources.kindWebsite') : t('resources.kindTool')),
  },
  {
    key: 'lang',
    labelKey: 'submit.lang',
    format: (v, t) => (v === 'en' ? t('resources.langEn') : t('resources.langZh')),
  },
  { key: 'imageUrl', labelKey: 'submit.imageUrl' },
  { key: 'summary', labelKey: 'submit.summary' },
  { key: 'tags', labelKey: 'submit.tags' },
];

/** 任意值 → 可显示的字符串。数组（标签）用逗号连起来。 */
function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  return String(value);
}

/** 字段值 → 展示文本：先走类型自己的格式化，再退回通用规则。 */
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
 */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function ResourceReviewView({ detail }: { detail: ReviewDetail }) {
  const { t } = useTranslation();
  const { pending, live } = detail;
  const isEdit = live !== null;

  const bodyChanged = isEdit && !same(live.body, pending.body);

  return (
    <div className="reviewview">
      {/*
        提交者给审核员的话 —— **放在内容前面**。
        它是"这个人为什么提这一版"，是审核员读内容之前最需要的上下文
        （这是改了什么？上次那处改了没有？）。放在最下面的话，
        审核员会在读完几千字之后才发现它。
      */}
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
            <div
              key={field.key}
              className={`reviewview__row${changed ? ' is-changed' : ''}`}
              // 只标"改动"还不够 —— 审核员要一眼看出改成了什么，
              // 所以旧值和新值都摆出来，旧值划掉。
            >
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

      <section className="reviewview__body">
        <h3 className="reviewview__subtitle">
          {t('submit.body')}
          {bodyChanged ? <span className="reviewview__flag">{t('review.changed')}</span> : null}
        </h3>
        <div className="reviewview__pane">
          <Markdown>{String(pending.body ?? '')}</Markdown>
        </div>

        {bodyChanged ? (
          /*
           * 旧版正文默认折叠。
           *
           * 不折叠的话，一次只改了一个错字的修改会变成两大段正文摆在一起，
           * 审核员要自己找不同 —— 那正是"看起来并列了，其实没用"。
           * 折叠起来时它是"需要时能查的对照"，而不是"每次都要读一遍的噪音"。
           */
          <details className="reviewview__old">
            <summary>{t('review.showOldBody')}</summary>
            <div className="reviewview__pane reviewview__pane--old">
              <Markdown>{String(live.body ?? '')}</Markdown>
            </div>
          </details>
        ) : null}
      </section>
    </div>
  );
}
