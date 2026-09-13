/**
 * 直编之后**该对用户说什么** —— 全站唯一一处。
 *
 * ---------------------------------------------------------------------------
 * 为什么它值得单独一个文件（它不是"工具函数"，是一条判据）
 * ---------------------------------------------------------------------------
 * 这段逻辑曾经写在 `EditResource.tsx` 的行内三元里，而且**写反了**，后果是
 * **恒撒谎**：
 *
 *   · 服务端的直编路径**必然**返回 `liveRevisionUnchanged: false`
 *     （`services/api/src/routes/authoring.ts` 的创建与改写两处都是 `false`）；
 *   · 于是那两个分支里**只有 `false` 那一支可达**，"看起来有两档、实际只有一档"；
 *   · 而它显示的是「已直接发布，线上已可见」—— 对一条**被下架**的条目
 *     （直编会保留 `hidden`）那就是一句假话。用户会因此不去点「恢复上架」，
 *     而那条内容会一直躺在下架状态里，**没有任何报错**。
 *
 * ⇒ 所以它必须**可被断言**。行内三元只能靠人眼看，而这一处恰好是"看起来对、
 *    实际恒走一支"的形状 —— 人眼最容易放过的那一类。抽成纯函数之后，
 *    `scripts/authoringNotice.ts` 能把**两个组合各断言一次**（spec §10.2 第 16 条），
 *    并且用一个"变异探针"证明断言真的会红。
 *
 * ⚠️ 它的入参形状刻意用**结构子集**（只要 `status` 与 `liveRevisionUnchanged`），
 *    而不是整个 `DirectWriteResult`：这样断言不需要构造一个完整的响应对象，
 *    也就不会因为服务端**多返回一个无关字段**而让断言失效。
 */

/** 一条直编写操作的结果里，与"该说什么"有关的那两个字段。 */
export interface DirectOutcome {
  /** 服务端返回的**真实**状态（不是前端推的） */
  status: string;
  /** "这次改动有没有进线上那一行" */
  liveRevisionUnchanged: boolean;
}

/** 文案来源 —— 传 `t` 进来而不是 import i18n 单例：断言里可以喂固定串。 */
export type Translate = (key: string) => string;

/**
 * 该显示的提示。
 *
 * 三个分支，**依据是两个字段的组合**，不是单一字段：
 *
 * | `liveRevisionUnchanged` | `status`    | 说什么 |
 * |---|---|---|
 * | `true`（改的是草稿/待审） | 任意        | 只说"已保存" —— 线上本来就没有这一版，**不能**说"线上已更新" |
 * | `false`                  | `'hidden'` | **两件事都要说**：改动已生效 **+** 它目前仍然不在站上 |
 * | `false`                  | 其它        | "已直接发布，线上已可见" |
 *
 * ⚠️ 中间那一档是这条判据的**全部价值**：只说"已生效"会让用户以为内容已经
 *    重新上线了（而它还在下架状态）；只说"还在下架"又会让他以为改动没保存。
 *    两个信息缺任何一个，用户下一步都会做错。
 */
export function directWriteNotice(outcome: DirectOutcome, t: Translate): string {
  if (outcome.liveRevisionUnchanged) {
    // 改的是草稿 / 待审：线上那一行**没有被碰过**，说"线上已更新"就是撒谎
    return t('authoring.saved');
  }
  if (outcome.status === 'hidden') {
    /*
     * ⚠️ 第二句用 `marks.gone`（"这条内容当前不在站上"）而**不是**
     *    `moderate.hiddenNote`：后者句子里带 Markdown 的 `**` 强调，而它只在
     *    `ModerationBar` 里经过 `em()` 渲染；字符串拼接出来的那一份会把星号
     *    **原样显示给用户**（见 `components/Emphasis.tsx` 的文件头）。
     *    `marks.gone` 是一句干净的陈述句，正是这里要说的意思，而且它已经有
     *    中英两份 —— 不需要为一个提示新造词条。
     *    （它的字面是"这条内容当前不在站上"，在收藏页与这里都成立。）
     */
    return `${t('authoring.saved')} ${t('marks.gone')}`;
  }
  return t('authoring.published');
}
