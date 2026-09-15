import type { Contributor } from '@mcsr/shared';
import { CONTRIBUTORS_MAX } from '@mcsr/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { em } from '@/components/Emphasis';
import { Notice } from '@/components/Form';
import {
  type AdminUser,
  fetchAdminUsers,
  fetchResourceContributors,
  replaceResourceContributors,
} from '@/lib/api';
import { useApiErrorText, useAuth } from '@/lib/auth';

/**
 * 贡献者 —— 这条功能的前端（2026-09-14，用户要求）。
 *
 * ===========================================================================
 * 用户原话，以及这个文件逐条对应了什么
 * ===========================================================================
 * 「对于资源库，在后台记录贡献者（**不直接展示在资源库中**），贡献者可以**不经过
 *   审核直接修改/下架**其拥有的资源（**不实际删除**），**管理者可以在资源库中看到
 *   贡献者**，并且能在每个资源里面**随意修改（添加/删除）贡献者**。资源可以没有
 *   贡献者。贡献者不单独作为一个身份组。这套逻辑之后在其他板块还要用到。」
 *
 * 这个文件里有三块，都是这条功能的可见部分：
 *
 *   ① `ContributorPanel` —— **管理员的名单编辑器**（只有 `user.moderate`，
 *      即 admin / owner —— ⚠️ **不是** `resource.moderate`，理由见下面的
 *      `ContributorPanelProps.canManage`）。挂载点在编辑页
 *      （`routes/EditResource.tsx`）—— "管理者在资源库中看到贡献者"那句话的
 *      落地就是这里。
 *      ⚠️ **公开面（资源库列表 / 详情页）一个字都没有**：用户明确要求"不直接展示
 *         在资源库里"。那条边界由 `scripts/resourcerender.tsx` 守着。
 *   ② `ContributorPanelView` —— ① 的**纯视图**：只吃 props，不取数、不判权限。
 *      ⚠️ 它是 ① 能被渲染自检覆盖的**唯一**原因（见下面"为什么拆成两个组件"）。
 *   ③ `ContributorDirectNote` / `ContributorVisibilityBar` —— 贡献者（或管理员）
 *      在编辑页看到的两个动作：「你是这一条的贡献者」那句直编提示，
 *      以及「下架 / 恢复上架」。
 *
 * ===========================================================================
 * ⚠️ ③ 为什么住在这个文件里（而不是留在 EditResource.tsx 里）
 * ===========================================================================
 * 不是因为它们长得像名单编辑器，而是因为它们**也**必须能被
 * `scripts/resourcerender.tsx` 渲染到：`routes/EditResource.tsx` 自己取数，
 * 而 `renderToStaticMarkup` **不跑 effect** ⇒ 它永远停在"加载中"，
 * 里面任何一块都断言不到（`routes/CalendarDetail.tsx` 是同一个坑，
 * `calendarrender.tsx` 的文件头写过一次）。
 *
 * 而这一轮最不该没人守的两件事恰好就在那一块里：
 *   · 贡献者**看不到删除入口**（用户明确说"不实际删除"）；
 *   · 下架按钮的判据是**服务端给的 `canHide`**，不是前端自己算的。
 * 留在页面里 ⇒ 一个字都验不到；搬到这里 ⇒ 两条都有断言（见脚本 ⑥ 那一节）。
 *
 * ===========================================================================
 * ★★ 为什么拆成"容器 + 纯视图"两个组件
 * ===========================================================================
 * 名单是**打开面板时现取**的（不是页面打开时缓存的那一份）：
 *   · 用户要求"在后台记录"、公开面不出现 ⇒ 它只能按需取；
 *   · 保存是**整份替换**（`PUT` 语义，见 shared/contributors.ts 里
 *     `ContributorsInputSchema` 的注释）⇒ **后写的赢**，所以界面上那张名单
 *     必须是**当前值**，拿一份旧的出来等于把一个别人刚做的改动静默盖掉。
 * ⇒ 取数只能发生在 effect 里，而 SSR **不跑 effect**：容器在渲染自检里
 *   只会渲染出"加载中"。要让"名单长什么样"变成可断言的东西，就必须有一个
 *   **只吃 props** 的渲染入口，那就是 `ContributorPanelView`。
 *
 * ⚠️ 覆盖边界（写清楚，免得下一个人高估它）：脚本验的是
 *   `ContributorPanelView` / `ContributorActions` **把 props 给对了**渲染成什么样。
 *   取数、点「移除」、点「保存」、保存之后服务端到底存了什么 —— **不在那里**
 *   （脚本末尾有一段边界说明）。
 *
 * ===========================================================================
 * ⚠️ 组件自己不判权限（本仓约定）
 * ===========================================================================
 * 能力判断在页面一层（`useCan`），这里只吃一个 `canManage` 布尔量，
 * 而它**只决定渲染不渲染**：非管理员打开编辑页时，这个组件在**取任何数之前**
 * 就返回 `null`。判据写在页面里、守卫写在组件里，两边都不重复推一遍规则。
 */

// ---------------------------------------------------------------------------
// 数据类型与纯判据 —— 这一节全是纯函数，判据只有一份
// ---------------------------------------------------------------------------

/**
 * 名单里的一行 —— **界面需要的字段**。
 *
 * ⚠️ 比 `Contributor` 少了 `createdAt`：那个字段服务端拿来做排序
 *   （`listContributors` 的 `ORDER BY created_at, user_id`），界面不显示时间。
 */
export interface ContributorRow {
  userId: string;
  /**
   * ⚠️ **可空**，但只因为服务端那条 `LEFT JOIN`（`contributors.ts` 里写明：
   *    宁可显示一个没有名字的人，也不要因为一行 JOIN 不上就从名单上凭空少一个人）
   *    —— 不是"账号可以没有显示名"（`users.display_name` 是 `NOT NULL`，
   *    而且写入路径要求非空）。⇒ 显示必须回退，见 `contributorName`。
   */
  displayName: string | null;
  /** ⚠️ 这是"把他加进来那个人"的 **id**，不是名字（`added_by`）；`null` = 那个人注销了。 */
  addedBy: string | null;
}

/** `Contributor[]` → 界面行。 */
export function contributorRows(items: readonly Contributor[]): ContributorRow[] {
  return items.map((c) => ({
    userId: c.userId,
    displayName: c.displayName,
    addedBy: c.addedBy,
  }));
}

/**
 * 界面上的名字。
 *
 * ⚠️ **绝不留空**：一行没有名字的名单看起来像界面坏了，而它真正想说的是
 *    "这个账号没有显示名"。回退文案由调用方给（`resourceContrib.unknownUser`），
 *    因为"未知账号"在英文界面里是另一句话。
 * ⚠️ 全是空白字符的名字也按"没有名字"处理 —— 那是同一件事的另一种写法。
 */
export function contributorName(displayName: string | null, unknown: string): string {
  const name = displayName?.trim();
  return name ? name : unknown;
}

/**
 * 名单有没有**变**（判「保存名单」按不按得动）。
 *
 * ⚠️ 比的是**集合**，不是顺序。服务端存的是"一组人"（一张表里的几行），
 *    顺序只由 `created_at` 决定，对用户没有含义。按顺序比的话，
 *    "移除一个人、再把他加回来"会让保存键一直亮着 —— 而那一趟保存
 *    **什么都没改变**，只是白白付一遍"整份替换 = 后写的赢"那次覆盖的风险。
 *
 * ⚠️ 用法只有一处（`ContributorPanelView` 的保存键）。抽成纯函数是为了
 *    **能被断言**：这个判断错了的表现是"保存键看起来正常，但它什么都没保存"
 *    或者"改完了却按不动" —— 两种都很难从界面上看出来。
 */
export function contributorsChanged(saved: readonly string[], draft: readonly string[]): boolean {
  if (saved.length !== draft.length) return true;
  const a = [...saved].sort();
  const b = [...draft].sort();
  return a.some((id, index) => id !== b[index]);
}

/**
 * 「现在可以加的人」= 全量账号 − 已在名单里的 − 不匹配搜索词的。
 *
 * ⚠️ 过滤放在前端是刻意的：`GET /api/admin/users` 本来就是全量列表，
 *    再为它开一个 `?q=` 只会多出第二份匹配规则，而它一漂移的表现是
 *    "搜不到这个人" —— 在管理界面上和"这个人不存在"一模一样。
 * ⚠️ 名字与邮箱**都**匹配：管理员手上可能只有其中一样（他可能是拿着邮箱来找人的）。
 */
export function contributorCandidates(
  users: readonly AdminUser[],
  rows: readonly ContributorRow[],
  query: string,
): AdminUser[] {
  const taken = new Set(rows.map((row) => row.userId));
  const q = query.trim().toLowerCase();
  return users.filter((u) => {
    if (taken.has(u.id)) return false;
    if (q === '') return true;
    const name = u.displayName ?? '';
    return name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });
}

/**
 * 账号的显示名（候选人列表 / 「由 X 添加」都用它）。
 *
 * ⚠️ 回退到 **id** 而不是空串：一个没有名字的按钮在界面上等于一个点不动的黑框。
 *
 * ⚠️ 这个回退**今天是到不了的** —— 写清楚，免得下一个人以为它在防一个真会发生的
 *    情况（我自己第一版就在这里写错过一次：`AdminUser.displayName` 的类型是
 *    `string`，而它是对的）：
 *      · `users.display_name` 在 008 那次重建里是 `TEXT NOT NULL`；
 *      · 唯一的写入路径 `DisplayNameSchema` 还要求 `trim()` 后至少 1 个字符。
 *    ⇒ 仍然留着它，是因为**这一列在 SQL 层没有 CHECK 约束** ——
 *      能绕开应用层写它的东西（`admin.js` 之外的脚本、以后某次迁移、手工改库）
 *      只剩 `NOT NULL` 兜着，而 `NOT NULL` 挡不住 `''` 和 `'   '`。
 */
function accountName(u: AdminUser): string {
  const name = u.displayName ?? '';
  return name.trim() ? name : u.id;
}

/**
 * 「由 **谁** 添加」里的那个名字。
 *
 * ⚠️ `addedBy` 是**用户 id**（`added_by` 外键，对方注销时置 null），
 *    所以要拿账号列表把它翻成人名。翻不到（那个人注销了、或者账号列表还没到）
 *    一律显示「未知账号」——**不要**把裸 id 摆在"由 X 添加"这个句子的位置上：
 *    那个位置读的是**人名**，一串 `u_ab12` 在那里只会让人以为界面没做完。
 */
export function addedByName(
  addedBy: string | null,
  users: readonly AdminUser[] | null,
  unknown: string,
): string {
  if (addedBy === null) return unknown;
  const u = users?.find((x) => x.id === addedBy);
  if (!u) return unknown;
  return accountName(u);
}

// ---------------------------------------------------------------------------
// ② 名单面板的纯视图（渲染自检的唯一入口）
// ---------------------------------------------------------------------------

export interface ContributorPanelViewProps {
  /**
   * 编辑中的那一份名单 —— **这就是「保存」会整份发出去的东西**。
   * ⚠️ `null` = 还没取到（取数中）。用 `null` 而不是空数组来区分：
   *    "还没拿到"和"这一条确实没有贡献者"在界面上是**两句不同的话**
   *    （后者是正常状态，用户原话「资源可以没有贡献者」）。
   */
  draft: ContributorRow[] | null;
  /** 取名单失败时的那句话；`null` = 没出错。 */
  loadError: string | null;
  /** 服务端当前存着的那一份的 id（判"有没有改动"）。 */
  savedIds: readonly string[];
  /** 全量账号（"加人"的选择器用它）；`null` = 还没取到。 */
  users: AdminUser[] | null;
  /** 取账号列表失败时的那句话；`null` = 没出错。 */
  usersError: string | null;
  /** 搜索词（按名字或邮箱过滤候选人）。 */
  query: string;
  onQueryChange: (next: string) => void;
  busy: boolean;
  notice: { ok: boolean; text: string } | null;
  onAdd: (userId: string) => void;
  onRemove: (userId: string) => void;
  onSave: () => void;
  onRetry: () => void;
}

export function ContributorPanelView(props: ContributorPanelViewProps) {
  const { t } = useTranslation();
  const { draft, loadError, savedIds, users, usersError, query, busy, notice } = props;

  const unknown = t('resourceContrib.unknownUser');
  const changed =
    draft !== null &&
    contributorsChanged(
      savedIds,
      draft.map((row) => row.userId),
    );
  const candidates =
    draft !== null && users !== null ? contributorCandidates(users, draft, query) : [];
  /** 到上限就**不给**加人的按钮 —— 上限的真相在 shared（`CONTRIBUTORS_MAX`），服务端还会再拦一次。 */
  const atMax = draft !== null && draft.length >= CONTRIBUTORS_MAX;

  return (
    <section className="contrib">
      <h2 className="contrib__title">{t('resourceContrib.title')}</h2>
      {/*
        ★ 两句话都要说：一句说这些人**多了什么权限**，一句说这份名单**谁看得见**。
        ⚠️ 它们是两件事，不能合成一句、也不能只留一句 ——
           "不经过审核"是权限（管理员必须知道自己在放什么权），
           "不公开"是隐私（用户特意要求"不直接展示在资源库中"）。
      */}
      <p className="contrib__hint">{t('resourceContrib.hint')}</p>
      <p className="contrib__nopublic">{t('resourceContrib.noPublic')}</p>

      {/* 取名单失败：说清是哪一步失败，并给一次重试 —— 面板整块不可用，不能只是空白。 */}
      {loadError ? (
        <>
          <Notice kind="bad">{loadError}</Notice>
          <p className="contrib__actions">
            <button type="button" className="ghostbtn" disabled={busy} onClick={props.onRetry}>
              {t('common.retry')}
            </button>
          </p>
        </>
      ) : null}

      {/* 取数中：说"加载中"，而不是渲染一个空名单 —— 空名单在界面上长得像"没有贡献者"。 */}
      {draft === null && !loadError ? <p className="state">{t('common.loading')}</p> : null}

      {draft !== null ? (
        draft.length === 0 ? (
          /*
           * ⚠️ 空名单是**正常状态**（用户原话「资源可以没有贡献者」），
           *    所以这句话的措辞与位置都**不能像出错**：不用 Notice、不用红色、
           *    也不用"还没有…"以外的任何暗示。也正因为它是常态，
           *    下面那排「保存名单」照样在（见保存键那一段）。
           */
          <p className="contrib__empty">{t('resourceContrib.empty')}</p>
        ) : (
          <ul className="contrib__list">
            {draft.map((row) => {
              const name = contributorName(row.displayName, unknown);
              return (
                <li key={row.userId} className="contrib__row">
                  <span className="contrib__name">{name}</span>
                  {/*
                    ⚠️ 没有显示名时把 **id** 摆在旁边：管理员面前可能是两行
                       「未知账号」，而他要做的事是"移除其中一个" —— 看不出区别
                       就没法做判断（这也是"宁可显示一个没有名字的人，
                       也不要凭空少一个人"的另一半）。
                  */}
                  {row.displayName?.trim() ? null : (
                    <span className="contrib__id">{row.userId}</span>
                  )}
                  <span className="contrib__by">
                    {t('resourceContrib.removedBy', {
                      name: addedByName(row.addedBy, users, unknown),
                    })}
                  </span>
                  <button
                    type="button"
                    className="ghostbtn contrib__remove"
                    disabled={busy}
                    /*
                     * ⚠️★ 无障碍：一排「移除」对屏幕阅读器毫无信息 —— 每一条
                     *    `aria-label` 都要带上是**谁**。
                     * ⚠️ 再带上 id：显示名**不是唯一的**（两个人可以都叫 Alex），
                     *    而这两个按钮在列表里长得一模一样。可见文字（「移除」）
                     *    仍然在这串标签的开头，所以"可见标签是名字的一部分"也成立。
                     */
                    aria-label={`${t('resourceContrib.remove')}: ${name} (${row.userId})`}
                    onClick={() => props.onRemove(row.userId)}
                  >
                    {t('resourceContrib.remove')}
                  </button>
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      {/* 保存：整份替换（幂等）。成功与失败都必须看得出来 —— 本仓一贯的要求"不许静默"。 */}
      {draft !== null ? (
        <div className="contrib__actions">
          <button type="button" className="cta" disabled={busy || !changed} onClick={props.onSave}>
            {busy ? t('resourceContrib.saving') : t('resourceContrib.save')}
          </button>
          {/*
            ★ 名单没变时「保存名单」是**禁用**的（而不是"点了也报一句已保存"）。
            理由：整份替换是幂等的，服务端对"发一份和现在一模一样"的答案必然是 200 ——
            也就是说**按键会成功，而什么都没发生**。那种"成功"对用户是假话：
            他会以为刚做的操作生效了（而他其实什么都没做），并且在真正想保存时
            因为习惯了"它总会说已保存"而不去看提示。

            ⚠️ 但**禁用的控件必须说明为什么**（本仓 `admin` 那组词条的注释里写着
            同一条规矩）。这里用的正是「名单已保存」这句状态句：它既解释了
            按键为什么是灰的，也是一句事实（屏幕上这份就是服务端存着的那份）。
            它在**保存成功之后**会换成上面那条绿色提示，所以不会重复出现。
          */}
          {!changed && notice === null ? (
            <span className="contrib__state">{t('resourceContrib.saved')}</span>
          ) : null}
        </div>
      ) : null}

      {notice ? <Notice kind={notice.ok ? 'ok' : 'bad'}>{notice.text}</Notice> : null}

      {/* 加人：从全量账号里挑，已经在名单里的人**不出现在这里**。 */}
      {draft !== null ? (
        <div className="contrib__picker">
          {/*
            ⚠️ 用 `<label htmlFor>` 而不是 placeholder 当标签：placeholder 一输入就没了，
               而读屏软件在大多数情况下根本读不到它。
          */}
          <label className="contrib__pickerlabel" htmlFor="contrib-search">
            {t('resourceContrib.add')}
          </label>
          <input
            id="contrib-search"
            className="mcsr-field__input contrib__search"
            value={query}
            disabled={busy || users === null}
            placeholder={t('resourceContrib.searchPlaceholder')}
            onChange={(e) => props.onQueryChange(e.target.value)}
          />
          <p className="contrib__max">{t('resourceContrib.max', { max: CONTRIBUTORS_MAX })}</p>

          {usersError ? (
            <Notice kind="bad">{usersError}</Notice>
          ) : users === null ? (
            <p className="state">{t('common.loading')}</p>
          ) : candidates.length === 0 ? (
            /*
             * ⚠️ 「没有可选的人了」要有，而且不能写成错误：搜索无结果与"所有人都
             *    已经在名单里"是同一句话能覆盖的两种正常情况。
             *    真正的"是不是输错了"由下面那句「最多 N 人」旁边的人自己看。
             */
            <p className="contrib__none">{t('resourceContrib.none')}</p>
          ) : (
            <ul className="contrib__candidates">
              {candidates.map((u) => {
                const name = accountName(u);
                return (
                  <li key={u.id} className="contrib__candidate-row">
                    <button
                      type="button"
                      className="ghostbtn contrib__candidate"
                      disabled={busy || atMax}
                      // 同上：标签里带名字与邮箱，读屏软件才知道加的是谁
                      aria-label={`${t('resourceContrib.add')}: ${name} (${u.email})`}
                      onClick={() => props.onAdd(u.id)}
                    >
                      <span className="contrib__candname">{name}</span>
                      <span className="contrib__candmail">{u.email}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// ① 名单面板（容器：现取名单 + 整份保存）
// ---------------------------------------------------------------------------

export interface ContributorPanelProps {
  resourceId: string;
  /**
   * 只有**管理员**（`user.moderate`：admin / owner）才为 `true` —— **判据在页面里**
   * （`EditResource.tsx` 的 `useCan('user.moderate')`），这里只负责"不是就别渲染"。
   *
   * ⚠️★ 为什么是 `user.moderate` 而**不是** `resource.moderate`：
   *    · `resource.moderate` 属于 `EDITOR_CAPS`（**editor 及以上都有**），它管的是
   *      **内容动作** ——"把这一条下架"。编辑本来就干得了这件事，那是既有行为
   *      （`ModerationBar` / `ContributorVisibilityBar` 的那一档就是它，**别改**）。
   *    · 而改这份名单是**授权动作**：名单上的人可以**不经过审核**直接改这一条。
   *      用 `resource.moderate` 当判据 = 让每一个编辑都能给自己（或同伙）
   *      发免审直编权 —— 那是一个**提权路径**，不是内容治理。
   *    · `user.moderate` 只有 admin / owner 有（`permissions.ts` 的注释里点明了
   *      「editor 没有 user.moderate」；`Layout.tsx` 的账号管理入口用的就是它）。
   *    用户选的是**更严**的那一档：编辑看不到、也改不了这份名单。
   */
  canManage: boolean;
}

/**
 * 管理员专用：这一条的贡献者名单编辑器。
 *
 * ---------------------------------------------------------------------------
 * ⚠️★ 守卫必须在**取任何数之前**，而这个组件里**不能有 hook**
 * ---------------------------------------------------------------------------
 * 非管理员（以及任何编辑页的普通访客）打开这一页时，这个组件必须**一个字都不渲染**：
 *   · 渲染一个空壳等于把"这里有名单"这件事告诉他 —— 用户要求的是**只有管理者看到**；
 *   · 更实际的是**请求**：面板一挂载就会 `GET …/contributors`，而那个端点只给
 *     `user.moderate` ⇒ 每个访客（含编辑）打开编辑页都会多一次注定 403 的请求，
 *     还在服务端留下一条"有人在试着读名单"的日志噪音。
 *
 * ⇒ 所以拆成两层：**这一层没有 hook、只做守卫**，取数与状态都在里层
 *   `ContributorPanelBody`。里层只有在 `canManage` 为真时才被挂载，于是
 *   "不该有的请求"和"不该有的字"一起消失了。
 *   ⚠️ 不要为了少一个组件而把 `useState` 提到这一层再 `return null` ——
 *      那是"条件调用 hook"（React 的规则不允许），而且 Biome 的
 *      `useHookAtTopLevel` 会当场报错。
 */
export function ContributorPanel({ resourceId, canManage }: ContributorPanelProps) {
  if (!canManage) return null;
  return <ContributorPanelBody resourceId={resourceId} />;
}

function ContributorPanelBody({ resourceId }: { resourceId: string }) {
  const { t } = useTranslation();
  const errorText = useApiErrorText();
  const auth = useAuth();

  /** 编辑中的那一份（`null` = 还没取到）。 */
  const [draft, setDraft] = useState<ContributorRow[] | null>(null);
  /** 服务端当前存着的那一份的 id —— 只用来判"有没有改动"。 */
  const [savedIds, setSavedIds] = useState<readonly string[]>([]);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [query, setQuery] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  /*
   * ★ 名单**现取**（不是页面打开时那一份）。
   *
   * ⚠️ 这不是"顺手刷新一下"：保存是**整份替换**、后写的赢（见 shared 里
   *    `ContributorsInputSchema` 的注释）。如果这里用页面打开时缓存的那一份，
   *    另一个管理员刚加的人会在这一份里缺席 —— 于是"保存"会把他**静默删掉**，
   *    而界面从头到尾看起来都很正常。
   *
   * ⚠️ 请求带 `no-store`（见 `fetchResourceContributors` 的注释）：这份名单
   *    给所有管理员看的是同一条路径，浏览器缓存里那一份可能就是
   *    "刚才被别人改过之前"的。
   *
   * ⚠️ 抽成 `useCallback` 是为了**重试**：那个按钮要的就是"把同一件事再跑一遍"，
   *    而不是"多加一个 state 当开关"（后者会逼出一个
   *    `useExhaustiveDependencies` 的豁免注释，而豁免注释是这一条唯一的地方 ——
   *    见 `lib/useAsync.ts` 里那条，它出现的代价是"下一个人不知道为什么"）。
   */
  const loadContributors = useCallback(
    async (signal?: AbortSignal) => {
      setLoadError(null);
      try {
        const list = await fetchResourceContributors(resourceId, signal);
        const rows = contributorRows(list.items);
        setDraft(rows);
        setSavedIds(rows.map((row) => row.userId));
      } catch (err) {
        // abort 是我方主动取消（卸载 / 依赖变了），不当作错误显示
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setDraft(null);
        setLoadError(errorText(err));
      }
    },
    [resourceId, errorText],
  );

  /*
   * 可以加的人。与名单**同时**发出 —— 面板打开时两块都要到位。
   *
   * ⚠️ 它的失败**不牵连**名单：`GET /api/admin/users` 挂了时，名单照常能看、能删，
   *    只有"加人"这一格不可用。两者合成一个 error 的话，一次账号列表的抖动
   *    会让管理员以为整份名单都读不到了（界面上那两件事的下一步完全不同）。
   * ⚠️ 已知边界：那个端点默认只给前 100 个账号（服务端 `limit ?? 100`）。站里账号
   *    超过 100 之后，排在后面的人在选择器里**看不到** —— 那时要么给那个端点加
   *    `?q=`，要么把 `limit` 提上去。今天（自建站、账号数远小于 100）这个折中是
   *    划算的，但它是有代价的，别以为它是"全量"。
   */
  const loadUsers = useCallback(
    async (signal?: AbortSignal) => {
      setUsersError(null);
      try {
        const res = await fetchAdminUsers(signal);
        setUsers(res.items);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setUsers(null);
        setUsersError(errorText(err));
      }
    },
    [errorText],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadContributors(controller.signal);
    void loadUsers(controller.signal);
    /*
     * ⚠️ 两条请求共用**一个** controller：它们都是"打开面板"这一次动作的一部分，
     *    卸载时必须一起停 —— 留下一条在跑的请求只会在组件没了之后 setState。
     * ⚠️ 合并的**只有取消**，不是错误：两个 error state 各归各的（见上面那条注释）。
     */
    return () => controller.abort();
  }, [loadContributors, loadUsers]);

  /** 从候选人里加一个（本地改草稿，保存时才发给服务端）。 */
  function add(userId: string) {
    setNotice(null);
    setDraft((rows) => {
      if (rows === null) return rows;
      if (rows.some((row) => row.userId === userId)) return rows;
      // 上限的真相在 shared（服务端还会再拦一次）；这里挡住的是"点快了多加一个"
      if (rows.length >= CONTRIBUTORS_MAX) return rows;
      const u = users?.find((x) => x.id === userId);
      return [
        ...rows,
        {
          userId,
          displayName: u ? u.displayName : null,
          // 还没保存，但"由谁添加"现在就能答对：加人的是我自己
          addedBy: auth.user?.id ?? null,
        },
      ];
    });
  }

  function remove(userId: string) {
    setNotice(null);
    setDraft((rows) => (rows === null ? rows : rows.filter((row) => row.userId !== userId)));
  }

  async function save() {
    if (draft === null) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await replaceResourceContributors(
        resourceId,
        draft.map((row) => row.userId),
      );
      /*
       * ★ 回读：新的一份**取服务端回来的 `items`**，不是"我发出去的那一份"。
       *
       * ⚠️ 两者今天应该一样，但它们不是同一件东西：`items` 是**库里现在真实
       *    存着的那几行**（带服务端算的 `displayName`、真实的 `addedBy`、
       *    以及新的 `createdAt`）。拿"发出去的那份"当结果的话，界面上会显示
       *    一个我们自己拼的名字 —— 与"整份替换之后到底存了什么"无关，
       *    而这正是唯一值得显示的东西。
       */
      const rows = contributorRows(res.items);
      setDraft(rows);
      setSavedIds(rows.map((row) => row.userId));
      setNotice({ ok: true, text: t('resourceContrib.saved') });
    } catch (err) {
      // ⚠️ 失败**必须**看得见，并且带上服务端/网络那一层的原因（403？404？连不上？）
      setNotice({ ok: false, text: `${t('resourceContrib.failed')} ${errorText(err)}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ContributorPanelView
      draft={draft}
      loadError={loadError}
      savedIds={savedIds}
      users={users}
      usersError={usersError}
      query={query}
      onQueryChange={setQuery}
      busy={busy}
      notice={notice}
      onAdd={add}
      onRemove={remove}
      onSave={() => void save()}
      /*
       * 重试 = **把上面那两条加载再跑一遍**（不加开关 state，见 `loadContributors`）。
       * ⚠️ 两份都重跑：名单失败时账号列表很可能也刚失败（服务端刚重启）。
       */
      onRetry={() => {
        void loadContributors();
        void loadUsers();
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// ③ 这一条的贡献者（或管理员）看到的两个动作
//
// ⚠️ 为什么是**两个**组件、而不是一个（它们在页面上也分在两处）
// ---------------------------------------------------------------------------
// 它们在编辑页上的位置不一样，而且都必须待在"读得到"的地方：
//   · `ContributorDirectNote` —— **表单上方**：它是一句澄清（"你的改动直接生效"），
//     必须在他动手填表**之前**看到。放到底部就等于没有（表单有十四行的正文框，
//     那一句会被挤到屏幕外，而它要拦的正是"他按了错误的那个按钮"）。
//   · `ContributorVisibilityBar` —— **表单下方、名单面板那一层**：它和
//     "谁能改这一条""谁能删"是同一类管理动作，页面上从下到上依次是
//     下架（可逆）→ 名单（授权）→ 删除（不可逆），按严重程度排。
// 合在一个组件里的话，两者被迫共用一个位置，其中必有一个是错的。
// 两者都是纯组件，所以两处都能被 `scripts/resourcerender.tsx` 断言到。
// ---------------------------------------------------------------------------

export interface ContributorDirectNoteProps {
  /**
   * 服务端算好的「能走直编（不审核）」—— 编辑页**直接读它**，
   * 不在前端重算（判据里有一半是数据：你是不是这一条的贡献者，而数据只有服务端有）。
   */
  canDirectEdit: boolean;
}

/**
 * 「你是这一条的贡献者：改动**直接生效**，不进审核队列。」
 *
 * ---------------------------------------------------------------------------
 * ★★ 判据来自服务端（`canDirectEdit`），这里一个字都不算
 * ---------------------------------------------------------------------------
 * 贡献者**不是** `content.author` —— 能力矩阵里没有、也不该有他
 * （用户明确「贡献者不单独作为一个身份组」，见 shared/contributors.ts）。
 * 所以 `useCan('content.author')` 对他是**假的**：
 *   · 照原样他会看到一个"提交修改（待审）"的页面，**被引导去走那条错的路**；
 *   · 而他明明可以直接改（那正是这个功能要的东西），表现却是"这个功能没做"。
 * ⇒ 服务端在取编辑页数据时把那个布尔量一起下发，前端只读。
 *   ⚠️ **不要**在这里补 `|| 自己算一遍`：那必然是第二份会漂移的判据，
 *      而它漂移的方向里有一个是"界面不给按钮、接口其实是开着的"。
 *
 * ⚠️ 这一句与上面那句 `edit.liveUnchanged`（"提交这个修改不会立刻改变页面上的
 *    内容"）说的是**两个不同的按钮**，两句都必须在：主按钮「提交修改」仍然要过审核，
 *    而「直接保存（不审核）」是另一条路。只留一句就会说反。
 */
export function ContributorDirectNote({ canDirectEdit }: ContributorDirectNoteProps) {
  const { t } = useTranslation();
  if (!canDirectEdit) return null;
  return (
    /*
     * ⚠️ 必须走 `em()`：这个词条里有一对 `**`（"直接生效"），裸 `t()` 会让用户
     *    看到一对字面星号。这一点由 `services/api/src/i18n-keys.test.ts` 那条
     *    守卫盯着（它会要求每一处带 `**` 的词条都落在"会处理标记的形状"里）。
     * ⚠️ 措辞里"**这一条**"三个字不能省（词条里写着）：贡献者与
     *    `authoring.directHint`（"你是内容编辑…"）**不是同一种人** ——
     *    编辑对全站有直编权，贡献者只对**这一条**有，而且是别人点名请他当的。
     */
    <p className="contribnote">{em(t('resourceContrib.directEdit'))}</p>
  );
}

export interface ContributorVisibilityBarProps {
  /** 服务端算好的「能走 `PATCH …/visibility`」（这一条的贡献者 or `resource.moderate`）。 */
  canHide: boolean;
  /** 这一条现在是不是下架状态（`status === 'hidden'`）—— 决定按钮是"下架"还是"恢复上架"。 */
  hidden: boolean;
  /** 请求进行中。 */
  busy: boolean;
  /** 上一次下架/恢复失败的那句话；`null` = 没有失败。 */
  failureText: string | null;
  onToggle: () => void;
}

/**
 * 「下架这一条 / 恢复上架」。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 这里**没有**、也不许有删除入口
 * ---------------------------------------------------------------------------
 * 用户原话：「贡献者可以不经过审核直接修改/下架其拥有的资源（**不实际删除**）」。
 * 删除是**不可逆**的，而贡献者拿到的这一份授权恰好是可逆的那一对动作
 * （`published ⇄ hidden`）。所以这个组件里没有任何 `delete*` ——
 * 编辑页那个危险区（`routes/EditResource.tsx`）的显示条件一个字都没放宽。
 *
 * ⚠️ 成功不另发一条提示：按钮翻转 + 下架后的「已下架」状态行就是反馈
 *    （`components/ModerationBar.tsx` 在详情页上用的是同一套做法）。
 *    失败**必须**看得见，而且带上服务端/网络那一层的原因 —— 这是本仓
 *    "不许静默"的底线部分。
 */
export function ContributorVisibilityBar(props: ContributorVisibilityBarProps) {
  const { t } = useTranslation();
  const { canHide, hidden, busy, failureText } = props;

  if (!canHide) return null;

  return (
    <section className="resvis">
      <button
        type="button"
        className={hidden ? 'ghostbtn' : 'dangerbtn'}
        disabled={busy}
        onClick={props.onToggle}
      >
        {hidden ? t('resourceContrib.restore') : t('resourceContrib.hide')}
      </button>

      {/*
        ⚠️ 状态行**只在下架之后**出现：它说的是"现在不在公开页面上"。
           上架时不显示任何状态行 —— 那是默认状态，写一行"已上架"只会
           多一句需要读的话。
      */}
      {hidden ? <span className="resvis__state">{t('moderate.hiddenBadge')}</span> : null}

      {/*
        ★ 这句话是「下架」的知情同意，而且要说清它是**可逆**的：
          "下架之后公开页面上看不到它，但内容与版本历史都还在，随时可以恢复。"
          ⚠️ 它和"删除"必须分得开 —— 用户特意要求贡献者**不能**删除，
             所以"东西还在、随时能恢复"是让人敢按下去的唯一依据。
      */}
      <p className="resvis__hint">{t('resourceContrib.hideHint')}</p>

      {failureText ? <p className="fielderr">{failureText}</p> : null}
    </section>
  );
}
