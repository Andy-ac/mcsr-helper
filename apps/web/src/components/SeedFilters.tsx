import { UPSTREAM_NETHER_FILTERS, UPSTREAM_OVERWORLD_FILTERS } from '@mcsr/shared';
import type { SeedFilters as SeedFilterParams } from '@mcsr/shared/seed';
import { groupVariations, isUnsupportedVariationFilter } from '@mcsr/shared/seed';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '@/components/Form';

/**
 * Ranked Seeds 的筛选面板 —— 两级联动词条 + 完赛时间。
 *
 * ---------------------------------------------------------------------------
 * 为什么词条是"两级"的（Q17）
 * ---------------------------------------------------------------------------
 * 上游的词条长这样：`biome:structure:plains`、`bastion:triple:1`、
 * `end_tower:caged:front_center`。第一段是**分组**，所以界面先让用户选分组
 * （折叠着），再展开该分组下的具体词条（多选 chip）。
 *
 * 一次性把四十多个词条平铺出来是不行的：用户找不到自己想要的那一个，
 * 而"找不到"在他的视角里和"这个功能不支持"没有区别。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 分组**不在这里写死** —— 见下面 SEED_VARIATION_BASE 的说明
 * ---------------------------------------------------------------------------
 */

// ---------------------------------------------------------------------------
// 词条表
// ---------------------------------------------------------------------------

/**
 * 已知词条的**起点**表 —— 逐字抄自 `docs/ranked-seeds-api.md` §5（上游文档的分类树）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 为什么需要这张表，以及它为什么**不是**一份白名单
 * ---------------------------------------------------------------------------
 * 上游**没有**"列出全部词条"的接口。我们手上只有这个端点组：
 *   /random、/search、/match/:id、/match/:id/info、/save
 * 其中没有任何一个能枚举词条 —— `info` 只给**那一条种子**的变种。
 *
 * 所以这张表的定位是"第一次打开页面时至少有东西可选"，而**收口**是靠
 * `variationGroups()`：它把这张表和我们**真的在结果里见过的**词条合起来再分组。
 * 于是上游新增分组时，只要我们见过一次，它就会自己出现在界面上 ——
 * 这正是 `groupVariations` 存在的理由（见 shared/seed.ts 的注释）。
 *
 * 两件事**刻意不做**：
 *   · 不做成 `Record<分组, 词条[]>`：那会把分组名也写死，而分组名是从词条
 *     第一段切出来的（`groupVariations` 就是这么做的），写死等于多一份真相。
 *   · 不在这里补 `end_spawn:*`：上游那一组有 bug，**不许作为筛选出现**
 *     （Q17），由 `isUnsupportedVariationFilter` 在合并时剔掉。
 *     注意**只剔筛选**：它照常出现在结果里（`end_spawn:buried:56` 是真实的），
 *     从结果里删掉等于对用户撒谎 —— 见 SeedResultCard 的变种列表。
 *
 * ⚠️ 已知代价（写在这里免得下次有人再发现一遍）：上游如果**删掉**或**改名**
 *    一个词条，这张表不会跟着变，界面会留下一个点了必然查不到结果的选项。
 *    那是上游文档与上游实现之间的差，我们在这边只能靠"见过的词条"补，
 *    没法靠推断删。
 */
export const SEED_VARIATION_BASE: readonly string[] = [
  // 主世界 —— 生物群系（村庄）
  'biome:structure:desert',
  'biome:structure:plains',
  'biome:structure:savanna',
  'biome:structure:snowy_tundra',
  'biome:structure:taiga',
  // 主世界 —— 箱子战利品（村庄 / 沙漠神殿 / 沉船 / 废弃传送门）
  'chest:structure:carrot',
  'chest:structure:diamond',
  'chest:structure:egap',
  'chest:structure:golden_carrot',
  'chest:structure:looting_sword',
  'chest:structure:obsidian',
  // 主世界 —— 结构形态（沉船 / 废弃传送门）
  'type:structure:completable',
  'type:structure:lava',
  'type:structure:normal',
  'type:structure:sideways',
  'type:structure:upsidedown',
  // 下界 —— 堡垒的生物群系
  'biome:bastion:basalt_deltas',
  'biome:bastion:crimson_forest',
  'biome:bastion:nether_wastes',
  'biome:bastion:soul_sand_valley',
  'biome:bastion:warped_forest',
  // 下界 —— 要塞的生物群系
  'biome:fortress:basalt_deltas',
  'biome:fortress:crimson_forest',
  'biome:fortress:nether_wastes',
  'biome:fortress:soul_sand_valley',
  'biome:fortress:warped_forest',
  // 下界 —— 堡垒形态
  'bastion:good_gap:1',
  'bastion:good_gap:2',
  'bastion:single:1',
  'bastion:single:2',
  'bastion:single:3',
  'bastion:small_single:1',
  'bastion:small_single:2',
  'bastion:small_single:3',
  'bastion:triple:1',
  'bastion:triple:2',
  'bastion:triple:3',
  // 末地 —— 末地塔（`end_spawn:*` 刻意不在这里，见上面的说明）
  'end_tower:caged:back',
  'end_tower:caged:back_center',
  'end_tower:caged:front',
  'end_tower:caged:front_center',
];

/**
 * 合并"起点表 + 我们见过的词条"，去重、剔掉不可筛选的，再分组。
 *
 * ⚠️ 去重是必须的：`groupVariations` **不去重**（见 shared/seed.ts ——
 *    上游自己就会给重复词条，那个函数只负责分组）。不去重的话，
 *    见过一次的词条会在 chip 里出现两遍，而 React 的 key 会撞。
 */
export function variationGroups(observed: readonly string[]): Array<{
  group: string;
  items: string[];
}> {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const raw of [...SEED_VARIATION_BASE, ...observed]) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    // ★ 只从**筛选**里去掉 end_spawn（它照常出现在结果里）
    if (isUnsupportedVariationFilter(value)) continue;
    seen.add(value);
    merged.push(value);
  }
  return groupVariations(merged);
}

/** 服务端 `FILTER_MAX_CHARS` 的同值副本 —— 提前拦住，省一次必然失败的请求。 */
const FILTER_MAX_CHARS = 512;

/**
 * 服务端 `MAX_COMPLETION_MS` 的同值副本（24 小时）。
 *
 * ⚠️ 它是一个**理智边界**而不是业务规则（服务端注释里也是这么写的）：
 *    一场 MC 速通不可能超过一天，而放行任意大的数字只是白送一个
 *    "让上游去扫全表"的口子。这里提前校验只是为了让用户立刻看到提示。
 */
const MAX_COMPLETION_MS = 86_400_000;

// ---------------------------------------------------------------------------
// 完赛时间：「分:秒」→ 毫秒
// ---------------------------------------------------------------------------

/**
 * 解析「分:秒」。返回毫秒，失败时返回**词条 key**（调用方去翻译）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 和 `parseTimecode`（packages/shared/videos.ts）是同一个坑，理由逐字相同
 * ---------------------------------------------------------------------------
 * 视频那边的起始偏移接受 `90` / `1:30` / `1:02:33`，并且在注释里写明：
 * **冒号后面的段必须是 0–59，否则 `1:99` 会被静默当成 159 秒**。
 *
 * 那边已经解过一次，这里又写了一个 —— 是**刻意的**，不是漏了复用：
 *   · 视频那边单位是**秒**、允许三段（时:分:秒）、有个 24h 上限常量在 shared 里；
 *   · 这里单位是**毫秒**、只要两段（分:秒，Q17）、上限是服务端那个常数。
 * 把两个不同的东西塞进一个函数，下一个读代码的人要同时记住两套规则；
 * 而把"分:秒 → 毫秒"搬进 shared 又要动那个不归我改的文件。
 * 代价是这份解析逻辑有两份，所以**两条规则必须一起改**：
 *   1. 冒号后面的段 ≤ 59（`1:75` 不是 135 秒，而是输入错误）
 *   2. 超上限一律拒绝，**不做截断**（截断会产生一个用户没要过的筛选条件，
 *      而结果看起来完全正常）
 *
 * 刻意**不接受**没有冒号的写法（`90`）：在「分:秒」这个标签下，
 * 它到底指 90 秒还是 90 分钟是没有答案的，而默默选一个就是
 * 本项目一直在防的那类静默错误。
 */
export function parseCompletionInput(
  raw: string,
): { ok: true; ms: number } | { ok: false; key: string } {
  const value = raw.trim();
  const parts = value.split(':');
  if (parts.length !== 2) return { ok: false, key: 'seedsPage.errCompletionFormat' };

  const [minRaw, secRaw] = parts;
  // 分最多四位（够到 24 小时上限），秒最多两位（`1:5` 也接住，用户就是想打 5 秒）
  if (!/^\d{1,4}$/.test(minRaw ?? '')) return { ok: false, key: 'seedsPage.errCompletionFormat' };
  if (!/^\d{1,2}$/.test(secRaw ?? '')) return { ok: false, key: 'seedsPage.errCompletionFormat' };

  const minutes = Number(minRaw);
  const seconds = Number(secRaw);
  if (seconds > 59) return { ok: false, key: 'seedsPage.errCompletionSeconds' };

  const ms = (minutes * 60 + seconds) * 1000;
  // 0 也会被服务端拒（`ms <= 0`），而"完赛时间上限 0"本来就没有意义
  if (ms <= 0) return { ok: false, key: 'seedsPage.errCompletionFormat' };
  // ⚠️ 24 小时这条**够得着**：分那段最多四位，1441:00 就会撞上它
  if (ms > MAX_COMPLETION_MS) return { ok: false, key: 'seedsPage.errCompletionTooLong' };

  return { ok: true, ms };
}

// ---------------------------------------------------------------------------
// 筛选状态
// ---------------------------------------------------------------------------

/**
 * 面板的本地状态。**存的是用户输入的原文**，不是解析后的值。
 *
 * ⚠️ 完赛时间存字符串而不是毫秒：解析失败时那个值必须**留在输入框里**
 *    （被清空的话用户不知道自己哪里填错了），而"解析失败"正是它最常见的状态。
 *    同理，词条存数组而不是拼好的逗号串 —— 拼串要在每次增删时重组，
 *    出错的机会比多存一层多。
 */
export interface SeedFilterState {
  /** `''` 表示不限；否则是**小写**取值（发往上游的形状）。 */
  overworld: string;
  nether: string;
  /** 命中的词条，多选表示"同时满足"。 */
  variations: string[];
  /** 用户填的原文，例如 `2:35`。 */
  completion: string;
}

export const EMPTY_SEED_FILTERS: SeedFilterState = {
  overworld: '',
  nether: '',
  variations: [],
  completion: '',
};

export interface BuiltSeedFilters {
  params: SeedFilterParams;
  /** 有没有任何条件 —— 界面靠它决定打 /random 还是 /search。 */
  hasAny: boolean;
  /** 逐控件的错误**词条 key**（拿不到解析结果时才有）。 */
  errors: Partial<Record<'variations' | 'completion', string>>;
}

/**
 * 本地状态 → 发往 API 的形状。
 *
 * ⚠️ 先本地校验一遍再发出去，理由有两层：
 *   1. 用户立刻看到提示，而不是等一个来回；
 *   2. 更重要的是：`completion` 是字符串转数字，填错的话**服务端会 400**，
 *      而那个 400 的 reason 现在读不到（见 lib/seedErrors.ts 的文件头）——
 *      于是红字不知道该放哪。在本地拦住它，这条路径根本不会发生。
 *
 * `overworld` / `nether` 走 `UPSTREAM_*_FILTERS`（**小写**）：
 * 界面显示大写、发出去小写，转换用 `toLowerCase()`（服务端大小写不敏感，
 * 但发小写是我们的契约，见 shared/constants.ts）。
 */
export function buildSeedFilterParams(state: SeedFilterState): BuiltSeedFilters {
  const params: SeedFilterParams = {};
  if (state.overworld) params.overworld = state.overworld.toLowerCase();
  if (state.nether) params.nether = state.nether.toLowerCase();

  const errors: BuiltSeedFilters['errors'] = {};

  if (state.variations.length > 0) {
    const joined = state.variations.join(',');
    if (joined.length > FILTER_MAX_CHARS) errors.variations = 'seedsPage.errFilterTooLong';
    else params.variations = joined;
  }

  if (state.completion.trim()) {
    const parsed = parseCompletionInput(state.completion);
    if (parsed.ok) params.completion = parsed.ms;
    else errors.completion = parsed.key;
  }

  return {
    params,
    hasAny: Boolean(params.overworld || params.nether || params.variations || params.completion),
    errors,
  };
}

// ---------------------------------------------------------------------------
// 分组名的中文
// ---------------------------------------------------------------------------

/**
 * 分组 → 词条 key。
 *
 * ⚠️ 这是一张**翻译表，不是分组清单**。分组清单来自 `groupVariations()`
 *    对实际词条的分组 —— 上游加了新分组，它会自己冒出来，只是这里没有
 *    中文名，于是回退显示原始分组名。**不要**在这里补一个
 *    "全部合法分组"的数组：那样上游加分组时它会静默消失
 *    （同 capabilities.ts 里 TYPE_KEYS 的做法与理由）。
 */
const GROUP_LABEL_KEYS: Record<string, string> = {
  biome: 'seedsPage.group.biome',
  chest: 'seedsPage.group.chest',
  type: 'seedsPage.group.type',
  bastion: 'seedsPage.group.bastion',
  end_tower: 'seedsPage.group.end_tower',
};

// ---------------------------------------------------------------------------
// 面板
// ---------------------------------------------------------------------------

export function SeedFiltersPanel({
  state,
  onChange,
  observedVariations,
  fieldErrors,
}: {
  state: SeedFilterState;
  onChange: (next: SeedFilterState) => void;
  /** 我们在结果里**实际见过**的词条（用来扩表，见 SEED_VARIATION_BASE）。 */
  observedVariations: readonly string[];
  /** 逐控件的红字，已经翻译好。 */
  fieldErrors: Partial<Record<'overworld' | 'nether' | 'variations' | 'completion', string>>;
}) {
  const { t } = useTranslation();

  /*
   * 默认**全部折叠** —— 这正是 Q17 说的"先选结构，再出对应变种"。
   * 一进来就把四十多个词条铺开，用户要先在噪音里找分组名。
   *
   * ⚠️ 状态存的是"用户**明确**点过的那些分组"，而不是"展开集合"。
   *
   *    写成展开集合的话，会有一个看起来像坏了的按钮：选中某个分组里的词条后
   *    它必须保持展开（否则用户看不到自己选了什么），于是
   *    `open = 有选中 || 在展开集合里` —— 这时点分组头，展开集合确实变了，
   *    但 `open` 仍然因为"有选中"而保持 true，**按钮看上去没反应**。
   *    存"用户的明确选择"就能表达三态：没点过（按选中情况自动）、
   *    点开、点关，而且点关之后真的会关上。
   */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const groups = variationGroups(observedVariations);
  const selectedSet = new Set(state.variations);

  function toggleVariation(item: string) {
    const next = selectedSet.has(item)
      ? state.variations.filter((v) => v !== item)
      : [...state.variations, item];
    onChange({ ...state, variations: next });
  }

  return (
    <div className="seed__filters">
      <div className="formrow">
        <Field id="seed-ow" label={t('seedsPage.filterOverworld')}>
          <select
            id="seed-ow"
            className="mcsr-field__input"
            value={state.overworld}
            onChange={(e) => onChange({ ...state, overworld: e.target.value })}
          >
            <option value="">{t('seedsPage.filterAny')}</option>
            {/*
              ⚠️ 显示**大写**、发送**小写**：`UPSTREAM_OVERWORLD_FILTERS` 是小写
              （那是发往上游的形状），而大写是我们对外统一的写法。
              一律从 shared 常量生成，**不要**在这里手写一份 ——
              两份词表一定会漂移，而漂移的表现是"界面上有的选项点了 400"。
            */}
            {UPSTREAM_OVERWORLD_FILTERS.map((value) => (
              <option key={value} value={value}>
                {structureLabel(value.toUpperCase(), t)}
              </option>
            ))}
          </select>
        </Field>

        <Field id="seed-nether" label={t('seedsPage.filterNether')}>
          <select
            id="seed-nether"
            className="mcsr-field__input"
            value={state.nether}
            onChange={(e) => onChange({ ...state, nether: e.target.value })}
          >
            <option value="">{t('seedsPage.filterAny')}</option>
            {UPSTREAM_NETHER_FILTERS.map((value) => (
              <option key={value} value={value}>
                {structureLabel(value.toUpperCase(), t)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {fieldErrors.overworld ? <p className="fielderr">{fieldErrors.overworld}</p> : null}
      {fieldErrors.nether ? <p className="fielderr">{fieldErrors.nether}</p> : null}

      <div className="mcsr-field seed__variations">
        <div className="seed__variationshead">
          <span className="mcsr-field__label">{t('seedsPage.variations')}</span>
          {state.variations.length > 0 ? (
            <>
              <span className="seed__count">
                {t('seedsPage.variationsSelected', { count: state.variations.length })}
              </span>
              <button
                type="button"
                className="ghostbtn"
                onClick={() => onChange({ ...state, variations: [] })}
              >
                {t('seedsPage.variationsClear')}
              </button>
            </>
          ) : null}
        </div>

        {groups.map(({ group, items }) => {
          const selectedInGroup = items.filter((v) => selectedSet.has(v)).length;
          /*
           * 三态：没点过 → 有选中就自动展开（选中状态不该藏在折叠下面）；
           * 点过 → 完全听用户的，包括"关掉一个里面有选中的分组"。
           */
          const open = overrides[group] ?? selectedInGroup > 0;
          return (
            <div key={group} className="seed__group">
              <button
                type="button"
                className="seed__grouphead"
                aria-expanded={open}
                onClick={() => setOverrides((prev) => ({ ...prev, [group]: !open }))}
              >
                <span className="seed__grouptoggle" aria-hidden="true">
                  {open ? '-' : '+'}
                </span>
                <span>{GROUP_LABEL_KEYS[group] ? t(GROUP_LABEL_KEYS[group]) : group}</span>
                {selectedInGroup > 0 ? (
                  <span className="seed__count">{selectedInGroup}</span>
                ) : null}
              </button>

              {open ? (
                <div className="seed__chips">
                  {items.map((item) => {
                    const on = selectedSet.has(item);
                    return (
                      <button
                        key={item}
                        type="button"
                        className={`seed__chip${on ? ' is-on' : ''}`}
                        aria-pressed={on}
                        onClick={() => toggleVariation(item)}
                      >
                        {/*
                          ⚠️ 词条**原样显示**，不做任何大小写转换。
                          它们是命名空间 id，大小写是有意义的（见
                          shared/seed.ts 的 SeedInfo.variations）。
                        */}
                        {item}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}

        <p className="mcsr-field__hint">{t('seedsPage.variationsHint')}</p>
        <p className="mcsr-field__hint">{t('seedsPage.variationsSource')}</p>
        {fieldErrors.variations ? <p className="fielderr">{fieldErrors.variations}</p> : null}
      </div>

      <Field
        id="seed-completion"
        label={t('seedsPage.completion')}
        hint={t('seedsPage.completionHint')}
      >
        <input
          id="seed-completion"
          className="mcsr-field__input"
          /*
           * 完赛时间其实是个小数字（分钟数），用 type="number" 是安全的 ——
           * 但**种子输入框不是**，那两处必须是文本框（见 shared/seed.ts）。
           * 这里跟着一起用文本 + inputMode，是为了让整张表的输入方式一致。
           */
          inputMode="numeric"
          value={state.completion}
          placeholder={t('seedsPage.completionPlaceholder')}
          onChange={(e) => onChange({ ...state, completion: e.target.value })}
        />
        {fieldErrors.completion ? <p className="fielderr">{fieldErrors.completion}</p> : null}
      </Field>
    </div>
  );
}

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
const STRUCTURE_LABEL_KEYS: Record<string, string> = {
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
