/**
 * 结构名 → 中文。**从 `components/SeedFilters.tsx` 整段搬过来的**（2026-09-16）。
 *
 * ⚠️ 为什么搬、以及旧文件里那一份为什么**先留着**
 * ---------------------------------------------------------------------------
 * 这两样东西（这张映射表与 `structureLabel()`）的消费方**不止**旧筛选面板：
 * `SeedResultCard` 也用它（种子的"结构与变种"那一块）。而旧面板本轮由 Task 6 删除
 * —— 如果等到删文件那天再搬，Task 5 与 Task 6 之间的那棵树就是红的（找不到模块）。
 * 所以顺序反过来：**先建新家、把唯一的跨文件消费方指过来**，旧面板里那一份留着
 * 给自己用。Task 6 删掉整个文件时它会跟着消失，于是**不会**留下两个定义。
 *
 * ⚠️ 搬的是**位置**，一个字都没改（连两段注释一起搬）：它现在被 `SeedResultCard`
 *    与（Task 6 之后）任何人 import，而"搬过来顺手再改改"正是让两份实现开始分叉的
 *    那种改法 —— 分叉的表现是列表里显示"村庄"、卡片上显示 `VILLAGE`。
 */

/**
 * 结构名 → 词条 key。
 *
 * ⚠️ 取值是**大写**的：上游 `seedinfo` 和自有库都是大写，只有发往上游的
 *    筛选参数是小写（那个转换在服务端做，见 routes/seeds.ts 的 pickFilter）。
 *
 * 表里没有的取值回退显示**原始英文名**，不显示空白 ——
 * 空白会让人以为界面坏了，而英文名至少能读懂是什么
 * （同 capabilities.ts 里 TYPE_KEYS 的兜底理由）。
 *
 * ⚠️ 兜底**不能**写成 `t('seedsPage.structure.' + value)`：i18next 对找不到
 *    的 key 不报错，而是把**整条 key** 原样显示出来，于是界面上会出现
 *    `seedsPage.structure.OCEAN_MONUMENT` 这种东西。
 */
export const STRUCTURE_LABEL_KEYS: Record<string, string> = {
  VILLAGE: 'seedsPage.structure.VILLAGE',
  DESERT_TEMPLE: 'seedsPage.structure.DESERT_TEMPLE',
  RUINED_PORTAL: 'seedsPage.structure.RUINED_PORTAL',
  SHIPWRECK: 'seedsPage.structure.SHIPWRECK',
  BURIED_TREASURE: 'seedsPage.structure.BURIED_TREASURE',
  JUNGLE_TEMPLE: 'seedsPage.structure.JUNGLE_TEMPLE',
  BRIDGE: 'seedsPage.structure.BRIDGE',
  HOUSING: 'seedsPage.structure.HOUSING',
  STABLES: 'seedsPage.structure.STABLES',
  TREASURE: 'seedsPage.structure.TREASURE',
};

/** 结构名 → 中文；未知取值回退成原始英文名。 */
export function structureLabel(value: string, t: (key: string) => string): string {
  const key = STRUCTURE_LABEL_KEYS[value];
  return key ? t(key) : value;
}
