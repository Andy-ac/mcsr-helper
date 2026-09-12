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
const CAP_TEXT: Record<string, string> = {
  'resource.submit': '提交新的资源条目（推荐网站或工具）',
  'resource.editOwn': '修改自己提交的条目',
  'resource.editAny': '修改任何**已上架**的条目（wiki 式，改动一样要过审核）',
  'resource.editUnpublished': '修改别人**还没上架**的草稿',
  'resource.feature': '设置或取消「精选」「官方」',
  'resource.moderate': '把已上架的内容**下架**，以及恢复',
  'resource.review': '审核资源库的提交（批准 / 驳回）',
  'calendar.submit': '提交赛事与活动（M4）',
  'calendar.review': '审核日历内容（M4）',
  'video.submit': '提交视频链接（M4）',
  'seed.submit': '分享世界种子（M4）',
  'seed.review': '审核种子分享（M4）',
  'user.moderate': '管理账号与角色',
  'audit.read': '查看审计日志',
};

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
                    // 每条都是"类型 · 具体能做什么"，类型来自矩阵，措辞来自 CAP_TEXT
                    <li key={action.capability}>
                      <span className="roleguide__type">{group.label}</span>
                      {/*
                        ⚠️ 必须走 `em()`：这张表里有三条自己用了 `**…**`
                        （editAny / editUnpublished / moderate）。
                        不走的话用户看到的是 `修改任何**已上架**的条目` ——
                        而这一处特别容易漏，因为**这些话在组件里、不在词条里**，
                        所以"扫 i18n 文件找 `**`"那种改法完全看不到它。
                        2026-09-13 就是渲染检查才抓到的。
                      */}
                      {em(CAP_TEXT[action.capability] ?? action.label)}
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
