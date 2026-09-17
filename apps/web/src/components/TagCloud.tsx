import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Notice } from '@/components/Form';
import { deleteResourceTag, type TagCount } from '@/lib/api';
import { useApiErrorText } from '@/lib/auth';
import { useCan } from '@/lib/capabilities';

/**
 * 资源库的标签筛选行 —— 以及**编辑者删标签**那件事的界面（2026-09-17，用户要求）。
 *
 * ===========================================================================
 * 用户原话，以及这个文件逐条对应了什么
 * ===========================================================================
 * 「允许编辑者删除资源库标签，被删除的标签对应的资源保留，只是去掉其标签」
 *
 *   · **允许编辑者** → 那个「✕」只在 `useCan('resource.moderate')` 为真时渲染
 *     （editor / admin / owner），非编辑者**一个字都看不到**（连一个空壳都不渲染）；
 *     ⚠️ 它画出来的字符是 `×`（U+00D7）而不是 `✕`（U+2715）—— 后者不在自托管
 *     像素字体的子集里（`check-font-coverage.mjs` 会拦住它）。见 styles.css。
 *   · **删除资源库标签** → 调 `DELETE /api/resources/tags/:tag`（一条全局动作，
 *     不是逐个资源 PATCH —— 理由写在 `routes/resources.ts` 那条路由上）；
 *   · **资源保留，只是去掉其标签** → 确认那一步必须把这句话说给用户听，
 *     而且**删完之后的提示里要有真的数字**（服务端回的 `resources` / `revisions`）。
 *
 * ===========================================================================
 * ★★ 为什么拆成"容器 + 纯视图"两个组件
 * ===========================================================================
 * 与那个**贡献者名单面板**（`components/` 里唯一的名单编辑器）是同一个理由，
 * 也是同一类问题：这一块最该被渲染自检钉住的两件事**恰好都在交互状态里** ——
 *   · 非编辑者（`canDelete: false`）**不该看到那个 ✕**；
 *   · `canDelete: true` 时它必须在，而且点开确认之后那两句话要在。
 * 而 `renderToStaticMarkup` **不跑 effect、不派发事件** ⇒ 直接渲容器永远拍不到
 * "确认中"那一屏。所以真正的渲染入口是**只吃 props** 的 `TagCloudView`
 * （`apps/web/scripts/resourcerender.tsx` 的 ⑨ 那一节）。
 *
 * ⚠️ 但**授权判据不能只靠自检传一个布尔量**：给 `TagCloudView` 喂 `canDelete: true`
 *    只能证明"给了 true 就会渲染 ✕"，而"编辑者真的会拿到 true、审核员拿到 false"
 *    它一个字都验不到 —— 那正是最容易写错的地方（把 `resource.moderate` 写成
 *    `user.moderate` 或某个兜底，两种写法都能让那条断言保持绿色）。
 *    所以自检渲染的是**真容器**，登录态用 `AuthProvider initialUser` 注入真角色：
 *    编辑者 / 审核员 / 访客 / 未登录各一遍。
 *
 * ===========================================================================
 * ⚠️ 判据是 `resource.moderate`（**不是** `user.moderate`、也不是 `content.author`）
 * ===========================================================================
 * 理由写在 `routes/resources.ts` 那条路由上（能力选择只有一处定义）：它是
 * `EDITOR_CAPS` 里"内容治理"那一档 —— editor / admin / owner，而 reviewer 没有。
 * 前端这里重复一次不是为了第二份真相，是因为**按钮显不显示**这件事本来就要在
 * 前端判一次（服务端会再拦一次，见 `requireCapability`）。
 *
 * ===========================================================================
 * ⚠️ 删完必须**回读**（两个数都要拿到），而且这一屏的缓存必须绕开
 * ===========================================================================
 * `GET /api/resources/tags` 带 `public, max-age=60`。删完标签直接重拉的话，
 * 命中的是 60 秒内那份旧响应 —— **那个标签还在**，于是用户以为"没删掉"，
 * 再点一次（还是旧的）。所以 `ResourceList` 回读时传 `fresh`（见 `fetchTags`），
 * 这与本仓已经记过两次的坑是同一条（`fetchResources` 的 `includeHidden`、
 * `fetchLiveChannelsFresh`）。
 *
 * ===========================================================================
 * 覆盖边界（写清楚，免得下一个人高估它）
 * ===========================================================================
 * `resourcerender.tsx` 验的是**把 props 给对了渲染成什么样**。它**不验**：
 *   · **点击**（选标签、点 ✕、确认、取消都不在这里跑 —— `renderToStaticMarkup`
 *     不跑 effect、不派发事件）；
 *   · **真的发出了什么请求**、**服务端到底改了什么**（那些在
 *     `services/api/src/resource-tags.test.ts`：行数、其它字段、待审版本、403、400、审计）；
 *   · **缓存**（`fresh` 那一半只能靠真的浏览器，服务端那一条 `no-store` 头由
 *     路由自己带）。
 * 渲染自检与那几份证据是互补的，不是替代关系。
 */

/** 确认行里要显示的那个数字：**这一枚 chip 自己数出来的条数**（= 标签云上的那个数）。 */
export function tagCountOf(tags: readonly TagCount[], tag: string): number {
  return tags.find((entry) => entry.tag === tag)?.count ?? 0;
}

export interface TagCloudViewProps {
  /** 标签云的内容（`GET /api/resources/tags` 的 `tags`）。空数组 = 一个标签都没有。 */
  tags: TagCount[];
  /** 当前选中的标签（`?tag=`）；`undefined` = 没选。 */
  activeTag: string | undefined;
  onSelect: (tag: string) => void;
  /**
   * 能不能删标签（`useCan('resource.moderate')`）。
   * ⚠️ `false` 时**一个 ✕ 都不渲染** —— 不是"渲染成灰色"、也不是"渲染一个空壳"：
   *    用户要求的是只有编辑者能删，而一个灰掉的 ✕ 等于把"这里有人能删"告诉所有人。
   */
  canDelete: boolean;
  /** 正在等二次确认的那一个标签；`null` = 没有在确认。 */
  confirming: string | null;
  /** 删除请求进行中（确认键与取消键都禁用，不让人重复点）。 */
  busy: boolean;
  /** 上一次删除的结果（成功/失败都要看得见，本仓一贯"不许静默"）；`null` = 还没删过。 */
  notice: { ok: boolean; text: string } | null;
  onRequestDelete: (tag: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

/**
 * 标签筛选行的**纯视图**（渲染自检的唯一入口）。
 *
 * ⚠️ 两步确认是**内联**的（不是 `window.confirm`）：
 *   · 原生弹窗在测试里没法断言，样式也不受控，而且它是**同步阻塞**的 ——
 *     与"按钮要进入 busy 状态"这条要求天然打架；
 *   · 内联确认还能把"删的是**哪一个**标签"写在句子最前面（那一排 ✕ 长得一模一样，
 *     确认行里不写出标签名，用户就没法确认自己点的是哪一个）。
 */
export function TagCloudView(props: TagCloudViewProps) {
  const { t } = useTranslation();
  const { tags, activeTag, canDelete, confirming, busy, notice } = props;

  return (
    <>
      {/*
        ⚠️ 标签一个都没有时**整行都不渲染**（连「按标签筛选：」那句也不渲染）：
           本仓的取向是"没有内容就别留一行空的"，而删掉最后一个标签之后
           正是这个状态 —— 用户看到的是"这一行自己消失了"，而不是"一行空标签"。
      */}
      {tags.length > 0 ? (
        <div className="tagcloud">
          <span className="tagcloud__label">{t('resources.tagFilterHint')}</span>

          {tags.map(({ tag, count }) => {
            const active = activeTag === tag;
            return (
              /*
               * ⚠️ chip 与 ✕ 是**兄弟**、包在一个 `<span>` 里，而不是把 ✕ 放进 chip 里：
               *    button 套 button 是非法 HTML（浏览器会把它拆开，React 也会警告），
               *    而两者确实绑着**两个不同的动作**（筛选 / 删除）。
               */
              <span className="tagitem" key={tag}>
                <button
                  type="button"
                  className={`tagchip${active ? ' tagchip--on' : ''}`}
                  onClick={() => props.onSelect(tag)}
                >
                  {tag}
                  <span className="tagchip__count">{count}</span>
                </button>

                {canDelete ? (
                  <button
                    type="button"
                    className="tagitem__del"
                    disabled={busy}
                    /*
                     * ⚠️★ 无障碍：一排光秃秃的「✕」对读屏软件毫无信息（它们长得一模一样的
                     *    按钮，而要点的是**某一个**标签）。所以 aria-label 里带上标签名，
                     *    与贡献者名单里「移除: 某人的名字」那条 `aria-label` 是同一条规矩。
                     */
                    aria-label={t('resources.tagDeleteAction', { tag })}
                    title={t('resources.tagDeleteAction', { tag })}
                    onClick={() => props.onRequestDelete(tag)}
                  >
                    ×
                  </button>
                ) : null}
              </span>
            );
          })}

          {/*
            ★ 二次确认。**只说这一件事**：这一下会影响几条资源、以及**资源本身保留**。
            ⚠️ 删标签是**破坏性**的（它一次改动很多行），所以必须让用户**知情**才能按下去 ——
               而且"资源保留"这四个字是用户明确要求说清的（他关心的正是这个：
               删标签不等于删条目）。
          */}
          {canDelete && confirming !== null ? (
            <span className="tagitem__confirm">
              <span className="tagitem__ask">
                {t('resources.tagDeleteConfirm', {
                  tag: confirming,
                  count: tagCountOf(props.tags, confirming),
                })}
              </span>
              <button
                type="button"
                className="dangerbtn"
                disabled={busy}
                onClick={props.onConfirmDelete}
              >
                {busy ? t('resources.tagDeleteWorking') : t('resources.tagDeleteConfirmAction')}
              </button>
              <button
                type="button"
                className="ghostbtn"
                disabled={busy}
                onClick={props.onCancelDelete}
              >
                {t('common.cancel')}
              </button>
            </span>
          ) : null}
        </div>
      ) : null}

      {/*
        ⚠️ 提示放在标签行**外面**：它是"刚才那一下的结果"，不是"这一排标签"的一部分。
           放在里面的话，最后一条标签被删掉时它会跟着整行一起消失 —— 而那正是
           唯一需要它的时候（`tags` 变成空数组之后这次删除就"没有下文"了）。
      */}
      {notice ? <Notice kind={notice.ok ? 'ok' : 'bad'}>{notice.text}</Notice> : null}
    </>
  );
}

export interface TagCloudProps {
  tags: TagCount[];
  activeTag: string | undefined;
  /** 选中/取消选中一个标签（页面把它写进 URL）。 */
  onSelect: (tag: string) => void;
  /**
   * 删成功了。
   * ⚠️ 页面**必须**做两件事，而它们各自都有"不做就看起来像坏了"的后果：
   *   ① 重拉标签云**与列表**（而且要 `fresh`，见 `fetchTags` 的注释）——
   *      否则那个标签还挂在那里，用户以为没删掉；
   *   ② 如果删的正是**当前筛选的那一个**，把 `?tag=` 摘掉 ——
   *      否则列表会停在"按一个已经不存在的标签筛选"上，结果是"一条都没有"，
   *      看起来像整个资源库空了。
   */
  onDeleted: (tag: string) => void;
}

/**
 * 标签筛选行（容器）：判权限、管确认状态、发删除请求、回读标签云。
 *
 * ⚠️ 它**不管**"标签从哪来"（`tags` 由页面用 `useAsync` 取好传进来）——
 *    页面那一层已经有一次取数了，这里再取一次就会出现"屏幕上这两块数据来自
 *    两个时刻"的经典问题。
 */
export function TagCloud(props: TagCloudProps) {
  const { t } = useTranslation();
  const errorText = useApiErrorText();
  const canDelete = useCan('resource.moderate');

  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  async function confirmDelete() {
    if (confirming === null) return;
    const target = confirming;
    setBusy(true);
    setNotice(null);
    try {
      const res = await deleteResourceTag(target);
      /*
       * ★ 成功的话术用**服务端回的三个值**（`tag` 是规范化之后的那个）：
       *   两个数字是"真的改了几行"，不是前端按 chip 上的计数猜的 ——
       *   未上架的草稿与已下架的内容同样会被清掉，它们在标签云里本来就不出现，
       *   所以那两个数字**可能大于**用户看得见的条数。说的必须是改了什么。
       */
      setNotice({
        ok: true,
        text: t('resources.tagDeleteDone', {
          tag: res.tag,
          resources: res.resources,
          revisions: res.revisions,
        }),
      });
      setConfirming(null);
      props.onDeleted(res.tag);
    } catch (err) {
      // ⚠️ 失败**必须**看得见，并且带上服务端/网络那一层的原因（403？连不上？）
      setNotice({ ok: false, text: `${t('resources.tagDeleteFailed')} ${errorText(err)}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <TagCloudView
      tags={props.tags}
      activeTag={props.activeTag}
      onSelect={props.onSelect}
      canDelete={canDelete}
      confirming={confirming}
      busy={busy}
      notice={notice}
      /*
       * 点 ✕ 只**进入确认**，什么都不发 —— 一次手滑不该删掉全站的标签。
       * 同时清掉上一次的提示：那一条说的是上一次动作，留在这里会被读成
       * "这一次也出错了"。
       */
      onRequestDelete={(tag) => {
        setNotice(null);
        setConfirming(tag);
      }}
      onCancelDelete={() => setConfirming(null)}
      onConfirmDelete={() => void confirmDelete()}
    />
  );
}
