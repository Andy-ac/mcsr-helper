import type { ResourceListItem } from '@mcsr/shared/resources';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ResourceIcon } from '@/components/ResourceIcon';
import { resourceKindLabel } from '@/lib/resourceKind';

/**
 * 资源卡片 —— 列表页和详情页的"相关条目"共用同一个组件。
 *
 * 抽出来的理由不是省代码，是**防止两处走偏**：之前详情页自己写了一份精简版，
 * 结果是那一份只有标题可点、而且没有徽章。共用一个组件之后，
 * "点卡片任何位置都能跳转"这条对两个地方同时成立。
 */
/**
 * `hidden` 只由资源列表页在「显示已下架」模式下传进来（仅 editor / admin 能看到）。
 * 它**不改数据**，只是让卡片看起来"不在站上"：降饱和 + 一个划掉的标记。
 */
export function ResourceCard({
  item,
  hidden = false,
}: {
  item: ResourceListItem;
  hidden?: boolean;
}) {
  const { t } = useTranslation();
  const titleId = `restitle-${item.id}`;
  /*
   * 收藏数（需求⑤）。`?? 0` 的理由见脚部那段注释 —— 服务端字段就位之前这里是
   * `undefined`，兜成 0 会让这一格静默不显示，而不是渲染出 "undefined"。
   */
  const favoriteCount = item.favoriteCount ?? 0;

  return (
    <li>
      {/*
        ⚠️ 整张卡片就是一个 <a>（需求：点卡片任何位置都能跳转）。

        为什么不用"标题是链接 + 伪元素盖住整卡"那种常见写法：
          · 伪元素会挡住其它文字的选中（拖选会变成拖拽链接）
          · 焦点框只会框住标题，看不出整张卡是可点的
          · 它是为了绕过"链接里不能放块级元素"的旧限制，而 HTML5 早就没这条了

        aria-labelledby 指向标题：读屏软件在"链接列表"模式下只念标题，
        而不是把类型、官方、简介、标签一口气全念出来。
        链接里的可见文字仍然是完整的，浏览模式下没有任何损失。
      */}
      <Link
        className={`rescard${hidden ? ' rescard--hidden' : ''}`}
        to={`/resources/${encodeURIComponent(item.id)}`}
        aria-labelledby={titleId}
        viewTransition
      >
        {/* 物品栏格子：图片 / favicon / 首字母方块 */}
        <div className="rescard__icon">
          <ResourceIcon id={item.id} title={item.title} url={item.url} imageUrl={item.imageUrl} />
        </div>

        <div className="rescard__body">
          <div className="rescard__head">
            {/*
              标题**不再是链接** —— 整张卡已经是链接，而链接不能嵌套链接
              （嵌套的 <a> 是非法 HTML，浏览器会把它们拆开，
              结果是同一张卡上出现两种不同的点击行为）。
              它保留 id，供上面那个 aria-labelledby 引用。
            */}
            <span className="rescard__title" id={titleId}>
              {item.title}
            </span>
          </div>

          {item.titleEn && item.titleEn !== item.title ? (
            <p className="rescard__alt">{item.titleEn}</p>
          ) : null}

          {/* 主要标签：精选（金）、官方（钻石青）、类型（中性） */}
          <div className="badges">
            {item.featured ? (
              <span className="badge badge--featured">{t('resources.featured')}</span>
            ) : null}
            {item.official ? (
              <span className="badge badge--official">{t('resources.official')}</span>
            ) : null}
            {/* 已下架：只有列表页在「显示已下架」模式下才会传 hidden=true */}
            {hidden ? (
              <span className="badge badge--hidden">{t('moderate.hiddenBadge')}</span>
            ) : null}
            <span className="badge badge--kind">{resourceKindLabel(item.kind, t)}</span>
          </div>

          {item.summary ? <p className="rescard__summary">{item.summary}</p> : null}

          <div className="rescard__foot">
            <span className="rescard__host">{hostOf(item.url)}</span>
            {item.tags.slice(0, 4).map((tag) => (
              <span key={tag} className="tagchip tagchip--sm">
                {tag}
              </span>
            ))}
            {/*
              ★ 收藏数（需求⑤）。

              ⚠️ **只在 `> 0` 时渲染**（spec D5.5）：每张卡都挂一个「收藏 0」
                 既是噪音，也和评分在卡片上的处理不一致 —— 评分在卡片上
                 **不显示**、只在详情页显示"暂无评分"。

              ⚠️ `?? 0` 是刻意的兜底，不是多余的：服务端把字段加回来之前
                 （t3 并行在做）这里会拿到 `undefined`，而 `undefined > 0`
                 是 false ⇒ 这一格**静默不显示**，页面不会崩。它不改变契约
                 （类型仍是必填 number）；真正的值是服务端给的。

              ⚠️ 显示成 `★ N` 而不是 `t('marks.favoriteCount')`（"收藏 N"）：
                 卡片脚部那一行是**窄栏**（host + 标签），完整文案在那里会挤爆；
                 完整的话留给 `title`（悬停可见），而且**不是**丢掉可读性 ——
                 屏幕阅读器读到的就是这句（星级符号是 aria-hidden）。
                 这里刻意复用**同一个词条**：数字的措辞只有一处定义。
            */}
            {favoriteCount > 0 ? (
              <span
                className="rescard__favorites"
                title={t('marks.favoriteCount', { count: favoriteCount })}
              >
                <span aria-hidden="true">★</span> {favoriteCount}
                <span className="sr-only">
                  {t('marks.favoriteCount', { count: favoriteCount })}
                </span>
              </span>
            ) : null}
          </div>
        </div>
      </Link>
    </li>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
