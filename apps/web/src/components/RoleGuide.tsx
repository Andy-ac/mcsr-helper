import { capabilitiesByType, ROLE_LABEL_KEYS, type UserRole } from '@mcsr/shared/permissions';
import { useTranslation } from 'react-i18next';
import { em } from '@/components/Emphasis';
import { describeCapabilities } from '@/lib/capabilities';

/**
 * 「这五种身份分别能做什么」——**能力从权限矩阵读，只有措辞是手写的**。
 *
 * ---------------------------------------------------------------------------
 * 为什么不直接写一段说明文字
 * ---------------------------------------------------------------------------
 * 手写的权限说明一定会过期，而且是**静默过期**：矩阵里给 editor 加了一个能力，
 * 说明文字不会变，于是界面在骗人 —— 而"界面说的和实际不一样"比没有说明更糟，
 * 因为用户会照着它做决定（"原来审核员也能下架内容啊"）。
 *
 * 所以分工是：
 *   · **能不能做** → 从矩阵读（capabilitiesByType），不可能过期；
 *   · **那句话怎么说** → CAP_TEXT 里手写；它过期了也只是措辞不够好，
 *     不会变成假信息（最坏情况是显示能力名本身）。
 */
/**
 * 能力 → **词条 key**（`auth.capDesc*`）。
 *
 * ⚠️ 2026-09-13：这张表**原先装的是写死的中文**（`CAP_TEXT`），所以英文界面下
 *    角色说明会夹一整段中文。现在只存 key，文案在 `packages/shared/src/i18n/`
 *    两本字典里（中英各一份）。
 *
 * ⚠️ 按**完整能力名**索引，不能按动作名：同一个动作在不同类型下说的话不一样
 *   （`calendar.submit` 是"提交赛事与活动"、`seed.submit` 是"分享世界种子"）。
 *
 * ⚠️ 这张表的 key 是**动态引用**（`t(CAP_DESC[cap])`）——「按字面量 grep key」
 *    那种守卫**看不到它**。所以：少一行 / 打错一个字母都不会报错，
 *    只会安静地退化成下面那个兜底（`action.label`，短标签，已翻译）。
 *    ⇒ 兜底是**故意的**（总比空白或裸 key 强），但改这张表时要自己看一眼。
 */
const CAP_DESC: Record<string, string> = {
  'resource.submit': 'auth.capDescResourceSubmit',
  'resource.editOwn': 'auth.capDescResourceEditOwn',
  'resource.editAny': 'auth.capDescResourceEditAny',
  'resource.editUnpublished': 'auth.capDescResourceEditUnpublished',
  'resource.feature': 'auth.capDescResourceFeature',
  'resource.moderate': 'auth.capDescResourceModerate',
  'resource.review': 'auth.capDescResourceReview',
  'calendar.submit': 'auth.capDescCalendarSubmit',
  'calendar.review': 'auth.capDescCalendarReview',
  'video.submit': 'auth.capDescVideoSubmit',
  'seed.submit': 'auth.capDescSeedSubmit',
  'seed.review': 'auth.capDescSeedReview',
  /*
   * ★ `share.moderate`（实时分享的治理）—— 2026-09-15。
   * ⚠️ 这一行的缺与不缺**在页面上看起来一模一样**：渲染的是
   *    `t(CAP_DESC[cap] ?? '') || action.label`，少一行只会退回到那个短标签
   *    （而分享的短标签正是从别人那里继承来的「管理身份组」，见
   *    `capabilities.ts` 的 `CAP_OVERRIDES`）。⇒ 这一条现在由
   *    `apps/web/scripts/roleguide.tsx` 第 ⑦ 条守着。
   */
  'share.moderate': 'auth.capDescShareModerate',
  /*
   * ★ `catalog.editTags`（B1：mod 目录的标签）。
   * ⚠️ 缺这一行与缺上面那一行**症状完全相同**（安静地退回短标签），
   *    所以它同样由 `apps/web/scripts/roleguide.tsx` 第 ⑦ 条守着。
   */
  'catalog.editTags': 'auth.capDescCatalogEditTags',
  'user.moderate': 'auth.capDescUserModerate',
  'audit.read': 'auth.capDescAuditRead',
};

/**
 * ★ 上面那张表**覆盖了哪些能力** —— 给渲染自检断言用
 * （`apps/web/scripts/roleguide.tsx` 第 ⑥/⑦ 条）。
 *
 * ⚠️ 为什么要导出它、而不是让脚本把 `CAP_DESC` 再抄一份：抄一份的守卫会和这张表
 *    一起漂移，而漂移的守卫是假守卫（同一件事在本文件上面那段注释里已经写过一次：
 *    按字面量 grep key 的守卫看不到 `t(CAP_DESC[cap])` 这种拼出来的引用）。
 */
export const CAP_DESC_COVERED: ReadonlySet<string> = new Set(Object.keys(CAP_DESC));

/** 等级规则 —— 这些**不是能力**，矩阵里没有，只能写下来。 */
const RANK_NOTES: Record<UserRole, string> = {
  owner: 'auth.rankNoteOwner',
  admin: 'auth.rankNoteAdmin',
  editor: 'auth.rankNoteEditor',
  reviewer: 'auth.rankNoteReviewer',
  user: 'auth.rankNoteUser',
};

/**
 * 展示顺序：**从高到低**。
 * 矩阵里的顺序是从低到高（方便代码推理），而给人看的说明从最高权限开始 ——
 * 读者通常先想知道"最高能做到什么"。
 */
const DISPLAY_ORDER: UserRole[] = ['owner', 'admin', 'editor', 'reviewer', 'user'];

export function RoleGuide() {
  const { t } = useTranslation();

  return (
    <section className="roleguide">
      <h3 className="related__title">{t('auth.roleGuideTitle')}</h3>
      <p className="muted">{em(t('auth.roleGuideIntro'))}</p>

      <div className="roleguide__list">
        {DISPLAY_ORDER.map((role) => {
          const groups = describeCapabilities(capabilitiesByType(role), t);
          return (
            <div className="roleguide__item" key={role}>
              <div className="roleguide__head">
                <span className={`badge badge--role badge--role-${role}`}>
                  {t(ROLE_LABEL_KEYS[role])}
                </span>
              </div>
              {/*
                ⚠️ 这里必须走 `em()` —— 而且这一处**比看起来重要**：
                等级说明是通过 `RANK_NOTES` 这张**映射表**取的
                （`t(RANK_NOTES[role])`），所以"按字面量 grep 词条 key"
                那种改法会**漏掉整张表** —— 五个角色全都带星号露出来。
                2026-09-13 就是这么漏的，最后是**渲染检查**（扫 innerText 里的
                `**`）才把它抓出来的：逐个改字面量调用点治不了间接引用。
              */}
              <p className="roleguide__note">{em(t(RANK_NOTES[role]))}</p>

              <ul className="roleguide__caps">
                {groups.flatMap((group) =>
                  group.actions.map((action) => (
                    // 每条都是"类型 · 具体能做什么"，类型来自矩阵，措辞来自 CAP_DESC→词条
                    <li key={action.capability}>
                      <span className="roleguide__type">{group.label}</span>
                      {/*
                        ⚠️ 必须走 `em()`：词条里有三条自己用了 `**…**`
                        （editAny / editUnpublished / moderate）。
                        不走的话用户看到的是 `修改任何**已上架**的条目`。
                        ⚠️ 这几条**现在在词条里**（曾经在组件里），所以
                        "扫 i18n 文件找 `**`"和"扫组件找 `**`"两条路都只能看到一半 ——
                        真正兜住它的是**渲染检查**（扫 innerText 里的 `**`）。
                      */}
                      {em(t(CAP_DESC[action.capability] ?? '') || action.label)}
                    </li>
                  )),
                )}
              </ul>
            </div>
          );
        })}

        {/*
          游客单独一栏。它**不是角色**（数据库里没有这个人），而是"没有登录"
          这个状态 —— 但它是最该写清楚的一栏：整站的访问模型就是
          "浏览不需要登录、登录只是为了提交"。写出来是为了让
          "为什么我什么都不用登录就能看"看起来是有意的，而不是漏做了权限。
        */}
        <div className="roleguide__item">
          <div className="roleguide__head">
            <span className="badge badge--role">{t('auth.roleGuest')}</span>
          </div>
          <p className="roleguide__note">{t('auth.rankNoteGuest')}</p>
          <ul className="roleguide__caps">
            <li>{t('auth.guestCan1')}</li>
            <li>{t('auth.guestCan2')}</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
