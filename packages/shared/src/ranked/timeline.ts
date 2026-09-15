/*
 * ★★ 上游 `timeline.type` 的显示（用户 2026-09-16 的裁决）：
 *    **界面暂时原样显示英文标识**，同时在 zh-CN.ts 里为每个已知标识配好词条
 *    （值先写英文，用户稍后自行校准），**未知标识回落到原样**。
 * ⚠️ 回落这一条是本节的核心：i18next 查不到 key 时**原样返回 key** ⇒ 直接 `t()` 会让
 *    上游加一个新节点就在界面上印出 `ranked.timeline.xxx`（渲染自检的"裸 key 泄漏"扫描会红）。
 * ⇒ 判据是"这个 type 在不在表里"，不是"t() 有没有返回值"。
 * ⚠️ 表里的 key 是**扁平**的（上游命名空间深度不一，`story.*` / `nether.*` / `end.*` /
 *    `projectelo.timeline.*` 四层都有）：照上游的分层拼 key 会在界面那一层多出一套
 *    "先按最后一个点拆、再猜前缀"的解析逻辑，而它唯一的作用是把 key 拼出来。
 * ⚠️ 表里有 N 条，就有 N 条词条 —— `apps/web/scripts/rankedrender.tsx` 会**逐条**断言
 *    两种语言里都有（与「实时分享」的 `FROZEN_KEYS` 同一手法）：漏一条就会印出裸 key。
 */

/** 上游 `timeline.type` → 我们的词条 key。今天实测出现过的都在这里，**上游加了新值 ⇒ 回落到原样显示**。 */
export const TIMELINE_LABEL_KEYS: Record<string, string> = {
  'story.root': 'ranked.timeline.root',
  'story.enter_the_nether': 'ranked.timeline.enterTheNether',
  'nether.find_fortress': 'ranked.timeline.findFortress',
  'nether.find_bastion': 'ranked.timeline.findBastion',
  'projectelo.timeline.blind_travel': 'ranked.timeline.blindTravel',
  'story.follow_ender_eye': 'ranked.timeline.followEnderEye',
  'story.enter_the_end': 'ranked.timeline.enterTheEnd',
  'end.enter_end_portal': 'ranked.timeline.enterEndPortal',
  'end.kill_dragon': 'ranked.timeline.killDragon',
};

/**
 * 一个进度标识的显示文本：表里有的走词条，**不在表里的原样返回**，`null` / 空串走占位符词条。
 *
 * ⚠️ `Object.hasOwn` 而不是 `in`、也不是 `TIMELINE_LABEL_KEYS[type] !== undefined`：
 *    后两者都**沿着原型链**回答"有没有这个名字" —— `'constructor' in TIMELINE_LABEL_KEYS`
 *    是 `true`，查表拿到 `Object.prototype.constructor`（一个函数），最后把
 *    `function Object() { [native code] }` 印到界面上。上游只要发一个叫 `constructor`
 *    的节点就会命中，而这一层存在的理由正是"上游随时会加新值"。
 *    与 `apps/web/src/lib/shareErrors.ts` 里那条是同一个理由。
 * ⚠️ 空串走占位符（而不是原样返回空串）：空串会在卡片上留下一个看不见的格子，
 *    读者分不出"没有进度"与"渲染坏了"；`—` 至少是一句真话。
 */
export function timelineLabel(type: string | null, t: (key: string) => string): string {
  if (!type) return t('ranked.unknown');
  const key = Object.hasOwn(TIMELINE_LABEL_KEYS, type) ? TIMELINE_LABEL_KEYS[type] : null;
  return key ? t(key) : type; // ⛔ 未知 ⇒ 原样；绝不 t(type)（那会印出 key 本身）
}
