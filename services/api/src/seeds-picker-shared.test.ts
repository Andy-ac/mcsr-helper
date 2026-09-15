/**
 * 「排位赛种子选择器」共享层的测试：结构表、三态标记、参数映射、完赛时间解析。
 *
 * ⚠️ 为什么这些断言写在 `services/api` 里：`apps/web` **没有测试运行器**（它只有一串渲染
 *    自检脚本），本仓唯一的单元测试跑在这里（`node --import tsx --test "src/**\/*.test.ts"`）。
 *    所以凡是值得写断言的纯逻辑都必须住在 `packages/shared`，与它配套的断言只能落在本文件
 *    —— 与 `ranked-shared.test.ts` 是同一个做法。
 * ⚠️ 表里的字符串是**上游的命名空间 id**：写错一个字母**不会报错**，只会"永远查不到"。
 *    所以下面除了行为断言，还有一整节"表本身"的自检（逐条对照 spec §4.2 / §5.4 / §10）。
 * ⚠️ 本文件**不打网络**、不出现任何真实域名（表与状态全是内联对象）。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UPSTREAM_NETHER_FILTERS, UPSTREAM_OVERWORLD_FILTERS } from '@mcsr/shared';
import {
  activeMarks,
  bastionContext,
  buildSeedPickerParams,
  cycleMark,
  EMPTY_SEED_PICKER,
  markKey,
  markOf,
  overworldContext,
  parseCompletionInput,
  pickTop,
  SEED_PICKER_BASTION_BIOMES,
  SEED_PICKER_BASTION_TYPES,
  SEED_PICKER_FORTRESS_BIOMES,
  SEED_PICKER_OVERWORLD,
  type SeedPickerMark,
  type SeedPickerState,
  type SeedPickerVariation,
  tapVariation,
} from '@mcsr/shared/seedPicker';

// ---------------------------------------------------------------------------
// 小助手：操作数一律从表里取，**不手写标识**（手写等于把表抄第二遍，抄错了没人发现）
// ---------------------------------------------------------------------------

/** 主世界表里的一行。取不到就当场炸 —— 静默的 `undefined` 会让后面每条断言读的是 undefined 属性。 */
function overworldRow(value: string) {
  const row = SEED_PICKER_OVERWORLD.find((s) => s.value === value);
  assert.ok(row, `主世界表里必须有 ${value}`);
  return row;
}

/** bastion 类型表里的一行。 */
function bastionRow(value: string) {
  const row = SEED_PICKER_BASTION_TYPES.find((s) => s.value === value);
  assert.ok(row, `bastion 类型表里必须有 ${value}`);
  return row;
}

/** 某一行里的一个变种。 */
function variationOf(rows: readonly SeedPickerVariation[], id: string): SeedPickerVariation {
  const found = rows.find((v) => v.id === id);
  assert.ok(found, `这一行里必须有变种 ${id}`);
  return found;
}

/** 点一下主世界某一行里的一个变种：上下文与"同组兄弟"都从表里取。 */
function tapOverworld(state: SeedPickerState, value: string, id: string): SeedPickerState {
  const row = overworldRow(value);
  return tapVariation(
    state,
    overworldContext(value),
    variationOf(row.variations, id),
    row.variations,
  );
}

/** 点一下 bastion 类型某一行里的一个变种。 */
function tapBastion(state: SeedPickerState, value: string, id: string): SeedPickerState {
  const row = bastionRow(value);
  return tapVariation(
    state,
    bastionContext(value),
    variationOf(row.variations, id),
    row.variations,
  );
}

/** 点两下 ⇒ 红（`none → with → without`）。红不参与互斥，所以"造一条红"必须走两步。 */
function tapRedOverworld(state: SeedPickerState, value: string, id: string): SeedPickerState {
  return tapOverworld(tapOverworld(state, value, id), value, id);
}

/** 同上，用于 bastion 那一排。 */
function tapRedBastion(state: SeedPickerState, value: string, id: string): SeedPickerState {
  return tapBastion(tapBastion(state, value, id), value, id);
}

/** 起点状态：选中某个主世界结构（可选再选一个 bastion 类型）。 */
function selected(overworld: string, bastionType = ''): SeedPickerState {
  let state = pickTop(EMPTY_SEED_PICKER, 'overworld', overworld);
  if (bastionType) state = pickTop(state, 'bastionType', bastionType);
  return state;
}

// ---------------------------------------------------------------------------
// ① 三态循环
// ---------------------------------------------------------------------------

describe('三态循环（spec §4.1 / §9.1 ①）', () => {
  it('★ none → with → without → none', () => {
    assert.equal(cycleMark('none'), 'with');
    assert.equal(cycleMark('with'), 'without');
    assert.equal(cycleMark('without'), 'none');
  });

  it('★★ 一个变种连点三下回到起点（一条点击序列，不是三个互不相干的断言）', () => {
    const id = 'biome:structure:plains';
    const context = overworldContext('village');
    let state = selected('village');
    assert.equal(markOf(state, context, id), 'none', '没点过是灰');

    state = tapOverworld(state, 'village', id);
    assert.equal(markOf(state, context, id), 'with', '第一下：要求（variations）');

    state = tapOverworld(state, 'village', id);
    assert.equal(markOf(state, context, id), 'without', '第二下：排除（without）');

    state = tapOverworld(state, 'village', id);
    assert.equal(markOf(state, context, id), 'none', '第三下：回到灰（键还在，值就是 none）');
  });

  it('★ 上下文与标记键的形状（spec §4.3）', () => {
    assert.equal(overworldContext('village'), 'overworld:village');
    assert.equal(bastionContext('bridge'), 'bastion:bridge');
    assert.equal(
      markKey('overworld:village', 'biome:structure:plains'),
      'overworld:village#biome:structure:plains',
    );
  });

  it('★ 查标记不会被原型链骗到（键里带 `#`，永远撞不上 `constructor` 这种名字）', () => {
    /*
     * 同一个坑本仓踩过一次（`ranked/timeline.ts` 用 `in` 查表，`'constructor' in 表` 是 true）。
     * 这里查的是 `marks[key]`，而 `markKey` 产出的键**一定含 `#`**，所以原型链上的那些名字
     * 永远不可能是键 —— 这一条就是那个"一定"的判据。
     */
    assert.equal(markOf(EMPTY_SEED_PICKER, 'constructor', 'toString'), 'none');
    assert.equal(markOf(EMPTY_SEED_PICKER, '', 'constructor'), 'none');
    assert.equal(markOf(EMPTY_SEED_PICKER, '__proto__', 'hasOwnProperty'), 'none');
  });

  it('★ 没点过的变种一律是灰：`none` 是缺省值，不是 undefined', () => {
    const state = selected('village', 'stables');
    for (const variation of overworldRow('village').variations) {
      assert.equal(markOf(state, overworldContext('village'), variation.id), 'none');
    }
    assert.equal(markOf(state, bastionContext('stables'), 'bastion:triple:3'), 'none');
    assert.equal(
      markOf(state, overworldContext('shipwreck'), 'type:structure:lava'),
      'none',
      '没选中的结构同样是灰',
    );
  });
});

// ---------------------------------------------------------------------------
// ② 互斥：只有绿↔绿（spec §4.3 不变式 3/4、§9.1 ②③④）
// ---------------------------------------------------------------------------

describe('互斥只作用于绿↔绿（spec §4.3 不变式 3/4、§9.1 ②③④）', () => {
  const CONTEXT = 'overworld:village';

  it('★★ desert 绿 → plains 绿 ⇒ desert 变**灰**（不是红）', () => {
    let state = selected('village');
    state = tapOverworld(state, 'village', 'biome:structure:desert');
    state = tapOverworld(state, 'village', 'biome:structure:plains');

    assert.equal(markOf(state, CONTEXT, 'biome:structure:plains'), 'with');
    /*
     * ⚠️ 这一条是 mutation ① 的判据：把"被顶掉的"设成 `without` 的话，这里会是 'without' ——
     *    界面上那颗按钮从绿变红，而用户只是想让平原绿，等于顺手得到一条"排除沙漠"。
     */
    assert.equal(markOf(state, CONTEXT, 'biome:structure:desert'), 'none');

    const { params } = buildSeedPickerParams(state);
    assert.equal(params.variations, 'biome:structure:plains');
    assert.equal(params.without, undefined, '互斥不许顺手造出一条排除');
  });

  it('★★ 绿红可并存：desert 绿 + plains 红（互斥不碰红，红也不顶绿）', () => {
    /*
     * 点击序列是有讲究的：红必须点两下，而第一下（变绿）会把同组的绿顶掉，所以顺序是
     *   desert 绿 → plains 绿（desert 变灰）→ plains 红 → desert 绿（plain 的红必须留着）。
     */
    let state = selected('village');
    state = tapOverworld(state, 'village', 'biome:structure:desert');
    state = tapOverworld(state, 'village', 'biome:structure:plains');
    state = tapOverworld(state, 'village', 'biome:structure:plains');
    state = tapOverworld(state, 'village', 'biome:structure:desert');

    assert.equal(markOf(state, CONTEXT, 'biome:structure:desert'), 'with');
    assert.equal(markOf(state, CONTEXT, 'biome:structure:plains'), 'without');

    const { params } = buildSeedPickerParams(state);
    assert.equal(params.variations, 'biome:structure:desert');
    assert.equal(params.without, 'biome:structure:plains');
  });

  it('★ 红不互斥：两条红都留着（spec §9.1 ④）', () => {
    let state = selected('village');
    state = tapRedOverworld(state, 'village', 'biome:structure:desert');
    state = tapRedOverworld(state, 'village', 'biome:structure:plains');

    const { params } = buildSeedPickerParams(state);
    assert.equal(params.without, 'biome:structure:desert,biome:structure:plains');
    assert.equal(params.variations, undefined);
  });

  it('★★ `with → without` 不顶掉任何东西（不变式 4 的另一半）', () => {
    /*
     * 同组里"红不顶绿"要用**别的组**来验：village 的 5 个 biome 全绿本来就自相矛盾（互斥）。
     * 这里让 desert（biome 组）绿着，再把 obsidian（chest 组，无互斥）点成红。
     */
    let state = selected('village');
    state = tapOverworld(state, 'village', 'biome:structure:desert');
    state = tapOverworld(state, 'village', 'chest:structure:obsidian');
    state = tapOverworld(state, 'village', 'chest:structure:obsidian');

    assert.equal(markOf(state, CONTEXT, 'biome:structure:desert'), 'with', '变红不许动别人');
    const { params } = buildSeedPickerParams(state);
    assert.equal(params.variations, 'biome:structure:desert');
    assert.equal(params.without, 'chest:structure:obsidian');
  });

  it('★★ 没有互斥组的变种可以同时绿（`exclusive: null` 的不顶人）', () => {
    let state = selected('shipwreck');
    state = tapOverworld(state, 'shipwreck', 'chest:structure:carrot');
    state = tapOverworld(state, 'shipwreck', 'chest:structure:diamond');
    state = tapOverworld(state, 'shipwreck', 'type:structure:normal');
    state = tapOverworld(state, 'shipwreck', 'type:structure:sideways');

    const context = overworldContext('shipwreck');
    assert.equal(markOf(state, context, 'chest:structure:carrot'), 'with', '箱子那两条不互斥');
    assert.equal(markOf(state, context, 'chest:structure:diamond'), 'with');
    assert.equal(markOf(state, context, 'type:structure:normal'), 'none', '形态那三条互斥');
    assert.equal(
      buildSeedPickerParams(state).params.variations,
      'chest:structure:carrot,chest:structure:diamond,type:structure:sideways',
    );
  });
});

// ---------------------------------------------------------------------------
// ③ 标记按上下文分开存（spec §4.3 不变式 2、§9.1 ⑤⑥）
// ---------------------------------------------------------------------------

describe('标记按上下文分开（spec §4.3 不变式 2、§9.1 ⑤⑥）', () => {
  it('★★ 切走的结构不会带出它的标记，切回来绿还在（不丢用户的工作）', () => {
    const village = overworldContext('village');
    let state = selected('village');
    state = tapOverworld(state, 'village', 'biome:structure:plains');
    assert.equal(buildSeedPickerParams(state).params.variations, 'biome:structure:plains');

    state = pickTop(state, 'overworld', 'shipwreck');
    assert.equal(state.overworld, 'shipwreck');
    assert.equal(
      buildSeedPickerParams(state).params.variations,
      undefined,
      '沉船时把村庄的标记发上去 = 一条必然 404 的查询',
    );
    assert.ok(
      !activeMarks(state).some((m) => m.context === village),
      '村庄的上下文不在当前选中里，一个标记都不许产出',
    );
    assert.equal(markOf(state, village, 'biome:structure:plains'), 'with', '切走不丢标记');

    state = pickTop(state, 'overworld', 'village');
    assert.equal(
      buildSeedPickerParams(state).params.variations,
      'biome:structure:plains',
      '切回来还是绿的',
    );
  });

  it('★★ bastion 的 `single1` 在 bridge 与 stables 下是两个键、两个标记', () => {
    const bridge = bastionContext('bridge');
    const stables = bastionContext('stables');
    const id = 'bastion:single:1';

    // 标识相同、词条键必须不同（用户：这两个将来翻译不一样）
    assert.notEqual(
      variationOf(bastionRow('bridge').variations, id).labelKey,
      variationOf(bastionRow('stables').variations, id).labelKey,
    );

    let state = pickTop(EMPTY_SEED_PICKER, 'bastionType', 'bridge');
    state = tapBastion(state, 'bridge', id);
    assert.equal(buildSeedPickerParams(state).params.variations, id);

    state = pickTop(state, 'bastionType', 'stables');
    assert.equal(
      buildSeedPickerParams(state).params.variations,
      undefined,
      'stables 下那一条不许因为是同一个标识就跟着绿',
    );
    assert.equal(markOf(state, stables, id), 'none', 'stables 的 single1 从没被点过');
    assert.equal(markOf(state, bridge, id), 'with');

    state = pickTop(state, 'bastionType', 'bridge');
    assert.equal(buildSeedPickerParams(state).params.variations, id, '切回 bridge 仍然是绿的');

    // 另一半：分开存意味着"在 stables 里标的"不该出现在 bridge 里
    let other = pickTop(EMPTY_SEED_PICKER, 'bastionType', 'stables');
    other = tapBastion(other, 'stables', id);
    assert.equal(markOf(other, stables, id), 'with', 'stables 那一边点得绿');
    other = pickTop(other, 'bastionType', 'bridge');
    assert.equal(markOf(other, bridge, id), 'none', 'bridge 的 single1 与 stables 的 single1 无关');
    assert.equal(buildSeedPickerParams(other).params.variations, undefined);
  });

  it('★★ 同名互斥组不跨上下文：沉船的 `type` 不许顶掉废弃传送门的 `type`', () => {
    /*
     * `type` 这个组名在 shipwreck 与 ruined_portal 下都出现，而互斥**只发生在同一个上下文内部**
     * （同一时刻只有一个主世界结构是"当前选中的"，另一个的标记正躺在 marks 里等用户切回来）。
     * 把组名当全局唯一的话，用户在沉船里点一下形态，废弃传送门里标过的那个会被静默清掉 ——
     * 而界面上什么都看不出来（那一排根本不在屏幕上）。
     */
    const portal = overworldContext('ruined_portal');
    let state = selected('ruined_portal');
    state = tapOverworld(state, 'ruined_portal', 'type:structure:lava');
    state = pickTop(state, 'overworld', 'shipwreck');
    state = tapOverworld(state, 'shipwreck', 'type:structure:normal');
    state = tapOverworld(state, 'shipwreck', 'type:structure:sideways');

    assert.equal(markOf(state, portal, 'type:structure:lava'), 'with', '别处的同组标记不许被顶掉');
    state = pickTop(state, 'overworld', 'ruined_portal');
    assert.equal(buildSeedPickerParams(state).params.variations, 'type:structure:lava');
  });

  it('★★ 没选中的上下文里的标记一个都不发（不变式 2 的另一半）', () => {
    // 界面上点不出这种 state（没有那一排按钮），但映射函数必须照样不发：
    // 发了就是一条必然 404 的查询（"沉船 + 村庄的生物群系"）。
    const state = tapOverworld(EMPTY_SEED_PICKER, 'village', 'biome:structure:plains');
    assert.equal(
      markOf(state, overworldContext('village'), 'biome:structure:plains'),
      'with',
      '标记本身写进去了',
    );
    assert.deepEqual(activeMarks(state), [], '但没选中村庄 ⇒ 一条都不产出');
    const { params, hasAny } = buildSeedPickerParams(state);
    assert.deepEqual(params, {});
    assert.equal(hasAny, false);
  });
});

// ---------------------------------------------------------------------------
// ④ 四个顶行：再点一次取消（spec §9.1 ⑦）
// ---------------------------------------------------------------------------

describe('顶行单选：再点一次取消（spec §9.1 ⑦）', () => {
  it('★ 四个字段各自"同一个值点两下 ⇒ 空"', () => {
    const cases = [
      ['overworld', 'village'],
      ['bastionBiome', 'biome:bastion:crimson_forest'],
      ['bastionType', 'bridge'],
      ['fortressBiome', 'biome:fortress:warped_forest'],
    ] as const;
    for (const [field, value] of cases) {
      const once = pickTop(EMPTY_SEED_PICKER, field, value);
      assert.equal(once[field], value, field);
      assert.equal(pickTop(once, field, value)[field], '', `${field} 再点一次必须取消`);
    }
  });

  it('★ 换一个取值是"改选"，不是取消', () => {
    const state = pickTop(
      pickTop(EMPTY_SEED_PICKER, 'overworld', 'village'),
      'overworld',
      'shipwreck',
    );
    assert.equal(state.overworld, 'shipwreck');
  });

  it('★★ 顶行只管自己那一个字段：不清标记（切回来工作还在）', () => {
    let state = selected('village');
    state = tapOverworld(state, 'village', 'chest:structure:diamond');
    const cancelled = pickTop(state, 'overworld', 'village');
    assert.equal(cancelled.overworld, '');
    assert.equal(
      activeMarks(cancelled).length,
      0,
      '取消之后没有选中的上下文 ⇒ 标记不产出（但它们还在 marks 里，见下一条）',
    );
    const back = pickTop(cancelled, 'overworld', 'village');
    assert.equal(buildSeedPickerParams(back).params.variations, 'chest:structure:diamond');
  });
});

// ---------------------------------------------------------------------------
// ⑤ activeMarks + 参数映射（spec §4.4）
// ---------------------------------------------------------------------------

describe('activeMarks：只有当前选中的上下文会进去，顺序照表', () => {
  it('★★ 灰的不产出；绿红都产出；顺序是**表里的顺序**，不是点击顺序', () => {
    let state = selected('village');
    // 故意倒着点：先点表里靠后的 chest 组，再点 biome 组
    state = tapOverworld(state, 'village', 'chest:structure:obsidian');
    state = tapOverworld(state, 'village', 'chest:structure:diamond');
    state = tapRedOverworld(state, 'village', 'biome:structure:plains');
    state = tapOverworld(state, 'village', 'biome:structure:taiga');

    assert.equal(markOf(state, overworldContext('village'), 'biome:structure:savanna'), 'none');
    assert.deepEqual(
      activeMarks(state).map((m) => [m.context, m.variation.id, m.mark]),
      [
        ['overworld:village', 'biome:structure:plains', 'without'],
        ['overworld:village', 'biome:structure:taiga', 'with'],
        ['overworld:village', 'chest:structure:diamond', 'with'],
        ['overworld:village', 'chest:structure:obsidian', 'with'],
      ],
      '产出顺序 = village 表里的顺序（biome 组在 chest 组之前），与点击顺序无关',
    );
  });

  it('★ 两个上下文一起时：主世界的标记在前，bastion 的在后（与界面从上到下一致）', () => {
    let state = selected('village', 'stables');
    state = tapBastion(state, 'stables', 'bastion:triple:1');
    state = tapOverworld(state, 'village', 'chest:structure:diamond');
    assert.deepEqual(
      activeMarks(state).map((m) => m.context),
      ['overworld:village', 'bastion:stables'],
    );
  });
});

describe('参数映射（spec §4.4）', () => {
  it('★ 空状态：五个字段都空、marks 空、什么都不发', () => {
    assert.deepEqual(EMPTY_SEED_PICKER, {
      overworld: '',
      bastionBiome: '',
      bastionType: '',
      fortressBiome: '',
      completion: '',
      marks: {},
    });
    const built = buildSeedPickerParams(EMPTY_SEED_PICKER);
    assert.deepEqual(built.params, {});
    assert.deepEqual(built.errors, {});
    assert.equal(built.hasAny, false);
  });

  it('★ 主世界 → `overworld=`，bastion 类型 → `nether=`，取值原样透传（已经是小写）', () => {
    const built = buildSeedPickerParams(selected('ruined_portal', 'housing'));
    assert.equal(built.params.overworld, 'ruined_portal');
    assert.equal(built.params.nether, 'housing');
    assert.equal(built.params.variations, undefined, '没标变种就不发这个参数');
    assert.equal(built.params.without, undefined);
    assert.equal(built.params.completion, undefined);
    assert.deepEqual(built.errors, {});
    assert.equal(built.hasAny, true);
  });

  it('★ 两张表的顶行取值各自落到正确的参数上（五个结构、四个类型逐个走一遍）', () => {
    for (const row of SEED_PICKER_OVERWORLD) {
      assert.equal(buildSeedPickerParams(selected(row.value)).params.overworld, row.value);
    }
    for (const row of SEED_PICKER_BASTION_TYPES) {
      const state = pickTop(EMPTY_SEED_PICKER, 'bastionType', row.value);
      assert.equal(buildSeedPickerParams(state).params.nether, row.value);
    }
  });

  it('★★ 两个群系行各进 `variations` 一条，且与 `nether=` 并存（实测 ⑬）', () => {
    let state = pickTop(EMPTY_SEED_PICKER, 'bastionBiome', 'biome:bastion:basalt_deltas');
    state = pickTop(state, 'fortressBiome', 'biome:fortress:soul_sand_valley');
    state = pickTop(state, 'bastionType', 'bridge');
    const { params } = buildSeedPickerParams(state);
    assert.equal(params.variations, 'biome:bastion:basalt_deltas,biome:fortress:soul_sand_valley');
    assert.equal(params.nether, 'bridge', '群系与类型是两条不同的参数，可以同时给');
  });

  it('★★ variations 的顺序冻结：bastion 群系 → fortress 群系 → 主世界绿 → bastion 绿', () => {
    let state = pickTop(EMPTY_SEED_PICKER, 'overworld', 'village');
    state = pickTop(state, 'bastionType', 'stables');
    state = pickTop(state, 'bastionBiome', 'biome:bastion:warped_forest');
    state = pickTop(state, 'fortressBiome', 'biome:fortress:crimson_forest');
    state = tapOverworld(state, 'village', 'biome:structure:taiga');
    state = tapBastion(state, 'stables', 'bastion:triple:3');
    assert.deepEqual(buildSeedPickerParams(state).params.variations?.split(','), [
      'biome:bastion:warped_forest',
      'biome:fortress:crimson_forest',
      'biome:structure:taiga',
      'bastion:triple:3',
    ]);
  });

  it('★★ 同一状态算两次逐字相同；两个函数都不改入参', () => {
    let state = pickTop(EMPTY_SEED_PICKER, 'overworld', 'village');
    state = pickTop(state, 'bastionType', 'stables');
    state = tapOverworld(state, 'village', 'biome:structure:taiga');
    state = tapBastion(state, 'stables', 'bastion:triple:1');
    const before = structuredClone(state);

    const first = buildSeedPickerParams(state);
    const second = buildSeedPickerParams(state);
    assert.equal(JSON.stringify(first.params), JSON.stringify(second.params), '同一状态 ⇒ 同一串');
    assert.deepEqual(state, before, '算参数不许就地改 state');

    tapOverworld(state, 'village', 'chest:structure:diamond');
    tapBastion(state, 'stables', 'bastion:single:2');
    assert.deepEqual(state, before, 'tapVariation 也不许就地改 state');
  });

  it('★★ 顺序来自表、不来自点击顺序（倒着点，正着出）', () => {
    let state = selected('village');
    state = tapOverworld(state, 'village', 'chest:structure:obsidian'); // 表里靠后
    state = tapOverworld(state, 'village', 'chest:structure:diamond'); // 表里靠前
    assert.equal(
      buildSeedPickerParams(state).params.variations,
      'chest:structure:diamond,chest:structure:obsidian',
    );
  });

  it('★★ without 的顺序：主世界的红在前、bastion 的红在后（各自按表里的顺序）', () => {
    let state = selected('village', 'stables');
    state = tapRedOverworld(state, 'village', 'chest:structure:obsidian'); // 表里第 7 条
    state = tapRedOverworld(state, 'village', 'biome:structure:desert'); // 表里第 1 条
    state = tapRedBastion(state, 'stables', 'bastion:triple:2');
    assert.deepEqual(buildSeedPickerParams(state).params.without?.split(','), [
      'biome:structure:desert',
      'chest:structure:obsidian',
      'bastion:triple:2',
    ]);
  });

  it('★ hasAny 看的是**参数**（`SeedFilters` 那五个字段一个都没有才是 false）', () => {
    assert.equal(buildSeedPickerParams(EMPTY_SEED_PICKER).hasAny, false, '空状态 ⇒ 打 /random');

    const withFilter: SeedPickerState[] = [
      selected('village'),
      selected('village', 'bridge'),
      pickTop(EMPTY_SEED_PICKER, 'bastionBiome', 'biome:bastion:nether_wastes'),
      pickTop(EMPTY_SEED_PICKER, 'fortressBiome', 'biome:fortress:nether_wastes'),
      { ...EMPTY_SEED_PICKER, completion: '2:35' },
      // ★ 只有红也算：`without` 会真的把东西排除掉，那不是"没有条件"
      tapRedOverworld(selected('village'), 'village', 'chest:structure:obsidian'),
    ];
    for (const state of withFilter) {
      assert.equal(buildSeedPickerParams(state).hasAny, true, JSON.stringify(state));
    }
  });

  it('★ 完赛时间：原文进 state、毫秒进 `completion`；空串/纯空格 = 不限', () => {
    assert.equal(
      buildSeedPickerParams({ ...EMPTY_SEED_PICKER, completion: '2:35' }).params.completion,
      155_000,
    );
    assert.equal(buildSeedPickerParams(EMPTY_SEED_PICKER).params.completion, undefined);
    assert.equal(
      buildSeedPickerParams({ ...EMPTY_SEED_PICKER, completion: '   ' }).params.completion,
      undefined,
    );
  });

  it('★★ 解析失败 ⇒ 报错词条、不发 `completion`，而原文**留在 state 里**', () => {
    const raw = '1:75';
    const state = { ...EMPTY_SEED_PICKER, completion: raw };
    const built = buildSeedPickerParams(state);
    assert.equal(built.errors.completion, 'seedsPage.errCompletionSeconds');
    assert.equal(built.params.completion, undefined);
    assert.equal(state.completion, raw, '界面要把用户填的东西留在输入框里，所以这里不许就地改');
  });
});

// ---------------------------------------------------------------------------
// ⑥ 512 的 clamp：直接构造超长 state（spec §4.4 / §9.1 ⑨）
// ---------------------------------------------------------------------------

describe('512 的 clamp（spec §4.4 / §9.1 ⑨）', () => {
  /*
   * ⚠️ 为什么**直接构造**而不是"找一条点击路径"：这个上限从界面上**够不着**。
   *    spec §4.4 逐格算过 —— 村庄的 5 个 biome 互斥（最多 3 个绿），
   *    `variations` 最坏 **349** 字符、`without` 最坏 **379**，都到不了 512。
   *    它守的是"**将来改表之后**不会把一条必然被上游 400 的串发上去"。
   *    要是把这条测试写成"我要证明界面上能触发它"，下一个人会花半天去找一条不存在的路。
   * ⚠️ 标识用服务端字符集里允许的字符（小写字母/数字/下划线/冒号/逗号/连字符），长度**恰好 26**：
   *    边界那一侧"恰好 512"是拿这个长度算出来的，长度一变那条断言就变成空过。
   * ⚠️ 键一律用 `markKey()` 生成，不手拼字符串 —— 手拼等于把被测的规则又抄了一遍。
   */
  const LONG_IDS = Array.from(
    { length: 30 },
    (_, i) => `biome:structure:${'a'.repeat(8)}${i.toString(36).padStart(2, '0')}`,
  );
  /** 前 19 条：19×26 个字符 + 18 个逗号 = **恰好 512**。 */
  const AT_LIMIT_IDS = LONG_IDS.slice(0, 19);
  /** 只把最后一条加长一个字符 ⇒ 513。判据是 `> 512`，不是 `>= 512`。 */
  const ONE_CHAR_OVER_IDS = AT_LIMIT_IDS.map((id, i) =>
    i === AT_LIMIT_IDS.length - 1 ? `${id}a` : id,
  );

  /** 一个"选了村庄、但 marks 是手工塞的"的状态（那些 id **不在表里** —— 表里的最多 349 字符）。 */
  function stateWithMarks(
    context: string,
    ids: readonly string[],
    mark: SeedPickerMark,
  ): SeedPickerState {
    const marks: Record<string, SeedPickerMark> = {};
    for (const id of ids) marks[markKey(context, id)] = mark;
    return { ...EMPTY_SEED_PICKER, overworld: 'village', marks };
  }

  it('★★ `variations` 超 512 ⇒ 错误词条，而且**一个参数都不发**', () => {
    const joined = LONG_IDS.join(',');
    assert.ok(joined.length > 512, '夹具本身必须先过线，否则这条断言是空过的');
    const built = buildSeedPickerParams(stateWithMarks('overworld:village', LONG_IDS, 'with'));
    assert.equal(built.errors.variations, 'seedsPage.errFilterTooLong');
    assert.equal(
      built.params.variations,
      undefined,
      '宁可不出错的条件，也不要一条必然被上游 400 的查询',
    );
    assert.equal(built.params.without, undefined);
  });

  it('★★ `without` 超 512 同样拦（错词条走同一个槽位 —— 契约里只有两个槽）', () => {
    const built = buildSeedPickerParams(stateWithMarks('overworld:village', LONG_IDS, 'without'));
    assert.equal(built.errors.variations, 'seedsPage.errFilterTooLong');
    assert.equal(built.params.without, undefined);
    assert.equal(built.params.variations, undefined);
  });

  it('★★ 上界那一侧：**恰好 512** 不许报错（只会红的守卫分不清"clamp 生效"和"整个函数没工作"）', () => {
    const joined = AT_LIMIT_IDS.join(',');
    assert.equal(joined.length, 512, '★ 夹具必须**恰好**落在边界上');

    const green = buildSeedPickerParams(stateWithMarks('overworld:village', AT_LIMIT_IDS, 'with'));
    assert.deepEqual(green.errors, {});
    assert.equal(green.params.variations, joined);
    assert.equal(green.hasAny, true);

    const red = buildSeedPickerParams(stateWithMarks('overworld:village', AT_LIMIT_IDS, 'without'));
    assert.deepEqual(red.errors, {});
    assert.equal(red.params.without, joined);
  });

  it('★★ 513 就拦（判据是 `> 512`，不是 `>= 512`）', () => {
    assert.equal(ONE_CHAR_OVER_IDS.join(',').length, 513);
    const built = buildSeedPickerParams(
      stateWithMarks('overworld:village', ONE_CHAR_OVER_IDS, 'with'),
    );
    assert.equal(built.errors.variations, 'seedsPage.errFilterTooLong');
    assert.equal(built.params.variations, undefined);
  });
});

// ---------------------------------------------------------------------------
// ⑦ 完赛时间解析（从 SeedFilters.tsx **原样**搬来，行为不许变）
// ---------------------------------------------------------------------------

describe('完赛时间解析（原样搬来，行为不许变）', () => {
  it('★ 分:秒 → 毫秒', () => {
    assert.deepEqual(parseCompletionInput('2:35'), { ok: true, ms: 155_000 });
  });

  it('★ 冒号后面的段 ≤ 59：`1:75` 是输入错误，不是 135 秒', () => {
    assert.deepEqual(parseCompletionInput('1:75'), {
      ok: false,
      key: 'seedsPage.errCompletionSeconds',
    });
  });

  it('★ 没有冒号的写法不接受：`90` 到底是 90 秒还是 90 分钟，没有答案', () => {
    assert.deepEqual(parseCompletionInput('90'), {
      ok: false,
      key: 'seedsPage.errCompletionFormat',
    });
  });

  it('★ 24 小时上限**够得着**：`1441:00` 撞它', () => {
    assert.deepEqual(parseCompletionInput('1441:00'), {
      ok: false,
      key: 'seedsPage.errCompletionTooLong',
    });
  });

  it('★ 边界与形状：`1440:00` 正好是上限（放行）、`0:00` 拒绝、秒写一位照收、两边空白去掉', () => {
    // 上限是"分那段最多四位"够得到的那一格：1440 分 = 24 小时 **整**，判据是 `>` 上限而不是 `>=`。
    assert.deepEqual(parseCompletionInput('1440:00'), { ok: true, ms: 86_400_000 });
    // 而 `24:00` 是 24 **分钟**（分:秒 不是时:分）：这一格钉住"分钟 × 60 + 秒"这个算式。
    assert.deepEqual(parseCompletionInput('24:00'), { ok: true, ms: 1_440_000 });
    assert.deepEqual(parseCompletionInput('0:00'), {
      ok: false,
      key: 'seedsPage.errCompletionFormat',
    });
    assert.deepEqual(parseCompletionInput('1:5'), { ok: true, ms: 65_000 });
    assert.deepEqual(parseCompletionInput(' 2:35 '), { ok: true, ms: 155_000 });
  });

  it('★ 其它坏形状一律是**格式**错（不是别的错）', () => {
    const bad = ['', 'abc', '1:2:3', '12345:00', '-1:00', '1:', ':30', '1：30'];
    for (const raw of bad) {
      assert.deepEqual(
        parseCompletionInput(raw),
        { ok: false, key: 'seedsPage.errCompletionFormat' },
        JSON.stringify(raw),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// ⑧ 表本身的自检（spec §4.2 / §5.4 / §10 冻结表）
// ---------------------------------------------------------------------------

/**
 * spec §4.2 的**独立第二份**：结构表逐条手抄（上下文 → [标识, 互斥组]）。
 *
 * ⚠️ 为什么要在测试里再抄一遍：这是唯一能发现"实现里抄错一个字母"的办法 ——
 *    标识写错**不报错**，只是永远查不到（本轮全局约束 1）。
 *    抄的时候看的是 spec §4.2（不许看 `seedPicker.ts`），否则两份一起错就没意义了。
 * ⚠️ **顺序**也是契约的一部分：界面拿"序列化后的参数串"判断结果是否过期（spec §6.4），
 *    表的顺序变了，同一个界面状态拼出来的串就变了。
 */
const SPEC_VARIATIONS: Record<string, ReadonlyArray<readonly [string, string | null]>> = {
  village: [
    ['biome:structure:desert', 'biome'],
    ['biome:structure:plains', 'biome'],
    ['biome:structure:savanna', 'biome'],
    ['biome:structure:snowy_tundra', 'biome'],
    ['biome:structure:taiga', 'biome'],
    ['chest:structure:diamond', null],
    ['chest:structure:obsidian', null],
  ],
  desert_temple: [
    ['chest:structure:diamond', null],
    ['chest:structure:egap', null],
  ],
  shipwreck: [
    ['chest:structure:carrot', null],
    ['chest:structure:diamond', null],
    ['type:structure:normal', 'type'],
    ['type:structure:sideways', 'type'],
    ['type:structure:upsidedown', 'type'],
  ],
  ruined_portal: [
    ['chest:structure:egap', null],
    ['chest:structure:golden_carrot', null],
    ['chest:structure:looting_sword', null],
    ['type:structure:completable', 'type'],
    ['type:structure:lava', 'type'],
  ],
  buried_treasure: [],
  bridge: [
    ['bastion:single:1', null],
    ['bastion:single:2', null],
    ['bastion:triple:1', null],
    ['bastion:triple:2', null],
  ],
  treasure: [],
  housing: [
    ['bastion:single:1', null],
    ['bastion:triple:1', null],
    ['bastion:triple:2', null],
  ],
  stables: [
    ['bastion:good_gap:1', null],
    ['bastion:good_gap:2', null],
    ['bastion:single:1', null],
    ['bastion:single:2', null],
    ['bastion:single:3', null],
    ['bastion:small_single:1', null],
    ['bastion:small_single:2', null],
    ['bastion:small_single:3', null],
    ['bastion:triple:1', null],
    ['bastion:triple:2', null],
    ['bastion:triple:3', null],
  ],
};

/**
 * spec §5.4 的完整键清单 —— **47 条**（37 条变种 + 10 条群系），逐条手抄。
 * Task 4 往字典里写的、Task 5 渲染时 `t()` 的就是这一张。
 */
const SPEC_LABEL_KEYS: readonly string[] = [
  'seedsPage.variation.village.desert',
  'seedsPage.variation.village.plains',
  'seedsPage.variation.village.savanna',
  'seedsPage.variation.village.snowyTundra',
  'seedsPage.variation.village.taiga',
  'seedsPage.variation.village.diamond',
  'seedsPage.variation.village.obsidian',
  'seedsPage.variation.desertTemple.diamond',
  'seedsPage.variation.desertTemple.egap',
  'seedsPage.variation.shipwreck.carrot',
  'seedsPage.variation.shipwreck.diamond',
  'seedsPage.variation.shipwreck.normal',
  'seedsPage.variation.shipwreck.sideways',
  'seedsPage.variation.shipwreck.upsidedown',
  'seedsPage.variation.ruinedPortal.egap',
  'seedsPage.variation.ruinedPortal.goldenCarrot',
  'seedsPage.variation.ruinedPortal.lootingSword',
  'seedsPage.variation.ruinedPortal.completable',
  'seedsPage.variation.ruinedPortal.lava',
  'seedsPage.variation.bridge.single1',
  'seedsPage.variation.bridge.single2',
  'seedsPage.variation.bridge.triple1',
  'seedsPage.variation.bridge.triple2',
  'seedsPage.variation.housing.single1',
  'seedsPage.variation.housing.triple1',
  'seedsPage.variation.housing.triple2',
  'seedsPage.variation.stables.goodGap1',
  'seedsPage.variation.stables.goodGap2',
  'seedsPage.variation.stables.single1',
  'seedsPage.variation.stables.single2',
  'seedsPage.variation.stables.single3',
  'seedsPage.variation.stables.smallSingle1',
  'seedsPage.variation.stables.smallSingle2',
  'seedsPage.variation.stables.smallSingle3',
  'seedsPage.variation.stables.triple1',
  'seedsPage.variation.stables.triple2',
  'seedsPage.variation.stables.triple3',
  'seedsPage.variation.bastionBiome.basaltDeltas',
  'seedsPage.variation.bastionBiome.crimsonForest',
  'seedsPage.variation.bastionBiome.netherWastes',
  'seedsPage.variation.bastionBiome.soulSandValley',
  'seedsPage.variation.bastionBiome.warpedForest',
  'seedsPage.variation.fortressBiome.basaltDeltas',
  'seedsPage.variation.fortressBiome.crimsonForest',
  'seedsPage.variation.fortressBiome.netherWastes',
  'seedsPage.variation.fortressBiome.soulSandValley',
  'seedsPage.variation.fortressBiome.warpedForest',
];

describe('表本身（spec §4.2 / §5.4 / §10 冻结表）', () => {
  it('★ 主世界五条、bastion 类型四条，**顺序逐字**', () => {
    assert.deepEqual(
      SEED_PICKER_OVERWORLD.map((row) => row.value),
      ['village', 'desert_temple', 'shipwreck', 'ruined_portal', 'buried_treasure'],
    );
    assert.deepEqual(
      SEED_PICKER_BASTION_TYPES.map((row) => row.value),
      ['bridge', 'treasure', 'housing', 'stables'],
    );
  });

  it('★★ 两排顶行的取值与顺序**就是上游词表本身**（`UPSTREAM_*_FILTERS`，不是手抄的副本）', () => {
    /*
     * ★★ 这一条是**整支分支的终审之后补的**，补的是一个**跨任务**的缺口 ——
     *    任何单个任务的评审都看不见它：`packages/shared/src/seedPicker.ts` 在
     *    `SEED_PICKER_OVERWORLD`（`:99`）与 `SEED_PICKER_BASTION_TYPES`（`:204`）
     *    的注释里声称"顺序 = `UPSTREAM_OVERWORLD_FILTERS` / `UPSTREAM_NETHER_FILTERS`"，
     *    而**没有任何门禁核过这句话**：上面那条 `it` 比的是**手抄的字面量**，
     *    于是上游词表那一侧（`packages/shared/src/constants.ts`）改名或换序时，
     *    两份"真相"各自漂开而本文件照样全绿 —— 界面那一排按钮的顺序、
     *    以及序列化后用来判断"这条种子还是不是当前条件的"那个参数串（spec §6.4），
     *    都跟着表的顺序走。
     *    ⚠️ 两份表**不能**合并成一份：大小写与成员都刻意不同（自有库/上游的投影关系
     *      写在 `constants.ts` 的那一段说明里，`constants.test.ts` 守着它）。
     *      所以这里能做的就是"把这句话变成断言"。
     *    ⚠️ 判据用 `assert.deepEqual` 而**不是**集合比较：改名与**换序**都要红
     *      （"顺序"正是注释声称的那件事；只比集合的话换序照样绿）。
     */
    assert.deepEqual(
      SEED_PICKER_OVERWORLD.map((row) => row.value),
      [...UPSTREAM_OVERWORLD_FILTERS],
      '主世界那一排的 `value` 逐字且**按序**等于 `UPSTREAM_OVERWORLD_FILTERS`',
    );
    assert.deepEqual(
      SEED_PICKER_BASTION_TYPES.map((row) => row.value),
      [...UPSTREAM_NETHER_FILTERS],
      'bastion 类型那一排的 `value` 逐字且**按序**等于 `UPSTREAM_NETHER_FILTERS`',
    );
    /*
     * ⚠️ 两条探针：上面那两条判据必须对"两边都空"之外的两种改法敏感 ——
     *    只写"集合相等"的那种写法在这两种改法下都会绿，而它们正是这条断言存在的理由。
     *    （`[...x].reverse()` 先复制再翻，不会动到那两个常量本身。）
     */
    assert.equal(UPSTREAM_OVERWORLD_FILTERS.length, 5, '★ 探针：上游主世界词表确实是 5 条');
    assert.equal(UPSTREAM_NETHER_FILTERS.length, 4, '★ 探针：上游下界词表确实是 4 条');
    assert.notDeepEqual(
      [...UPSTREAM_OVERWORLD_FILTERS].reverse(),
      [...UPSTREAM_OVERWORLD_FILTERS],
      '★ 探针：**换序**必须被判成不等（否则"顺序也核过了"是假的）',
    );
    assert.notDeepEqual(
      UPSTREAM_OVERWORLD_FILTERS.map((value) => `${value}_renamed`),
      [...UPSTREAM_OVERWORLD_FILTERS],
      '★ 探针：**改名**必须被判成不等（否则"取值也核过了"是假的）',
    );
  });

  it('★ 两个群系行各五条，取值就是**完整标识**（不是短名）', () => {
    assert.deepEqual(
      SEED_PICKER_BASTION_BIOMES.map((row) => row.value),
      [
        'biome:bastion:basalt_deltas',
        'biome:bastion:crimson_forest',
        'biome:bastion:nether_wastes',
        'biome:bastion:soul_sand_valley',
        'biome:bastion:warped_forest',
      ],
    );
    assert.deepEqual(
      SEED_PICKER_FORTRESS_BIOMES.map((row) => row.value),
      [
        'biome:fortress:basalt_deltas',
        'biome:fortress:crimson_forest',
        'biome:fortress:nether_wastes',
        'biome:fortress:soul_sand_valley',
        'biome:fortress:warped_forest',
      ],
    );
  });

  it('★★ 九个上下文的变种与互斥组**逐条**对照 spec §4.2', () => {
    const actual: Record<string, ReadonlyArray<readonly [string, string | null]>> = {};
    for (const row of SEED_PICKER_OVERWORLD) {
      actual[row.value] = row.variations.map((v) => [v.id, v.exclusive] as const);
    }
    for (const row of SEED_PICKER_BASTION_TYPES) {
      actual[row.value] = row.variations.map((v) => [v.id, v.exclusive] as const);
    }
    assert.deepEqual(
      Object.keys(actual).sort(),
      Object.keys(SPEC_VARIATIONS).sort(),
      '上下文的个数与名字',
    );
    for (const [value, expected] of Object.entries(SPEC_VARIATIONS)) {
      assert.deepEqual(actual[value], expected, `${value} 的变种（顺序与互斥组都在这里）`);
    }
  });

  it('★ 条数：变种共 37 条（47 条键 = 37 变种 + 10 群系）', () => {
    const variations = [...SEED_PICKER_OVERWORLD, ...SEED_PICKER_BASTION_TYPES].flatMap(
      (row) => row.variations,
    );
    assert.equal(variations.length, 37);
  });

  it('★★ 没有变种的两个上下文是**空数组**，不是缺字段、不是 undefined', () => {
    /*
     * ⚠️ 界面靠 `variations.length > 0` 决定"这一排要不要渲染"（没有变种的结构不渲染空排，
     *    spec §6.2）：`undefined.length` 会把整个面板打崩，而"恰好是空数组"只是那一排不出现。
     */
    assert.ok(Array.isArray(overworldRow('buried_treasure').variations));
    assert.equal(overworldRow('buried_treasure').variations.length, 0);
    assert.ok(Array.isArray(bastionRow('treasure').variations));
    assert.equal(bastionRow('treasure').variations.length, 0);
  });

  it('★★ 47 条 labelKey 与 spec §5.4 逐条相同（Task 4 的字典照这份写）', () => {
    const keys = [
      ...SEED_PICKER_OVERWORLD.flatMap((row) => row.variations.map((v) => v.labelKey)),
      ...SEED_PICKER_BASTION_TYPES.flatMap((row) => row.variations.map((v) => v.labelKey)),
      ...SEED_PICKER_BASTION_BIOMES.map((row) => row.labelKey),
      ...SEED_PICKER_FORTRESS_BIOMES.map((row) => row.labelKey),
    ];
    assert.equal(keys.length, 47, '37 条变种键 + 10 条群系键');
    assert.equal(new Set(keys).size, keys.length, '键不许重复（重复就是两个变种共用一个词条）');
    for (const key of keys) assert.ok(key.startsWith('seedsPage.'), key);
    assert.deepEqual([...keys].sort(), [...SPEC_LABEL_KEYS].sort());
  });

  it('★★ 同一个上下文里不许两个变种共键；而 bastion 的两个子类型**必须**分开分键', () => {
    for (const row of [...SEED_PICKER_OVERWORLD, ...SEED_PICKER_BASTION_TYPES]) {
      const keys = row.variations.map((v) => v.labelKey);
      assert.equal(new Set(keys).size, keys.length, `${row.value} 里有重复的词条键`);
    }
    /*
     * ★ 唯一会踩到这条的是**同一个标识**：`bastion:single:1` 同时出现在 bridge 与 stables 下。
     *   两者的翻译将来不一样（上游文档：stables 的 single 是双箱塔、small_single 是单箱塔），
     *   共用一个键的表现是"界面上两个不同的东西显示同一个词"，而且没有任何报错。
     */
    const bridgeSingle1 = variationOf(bastionRow('bridge').variations, 'bastion:single:1');
    const stablesSingle1 = variationOf(bastionRow('stables').variations, 'bastion:single:1');
    assert.equal(bridgeSingle1.labelKey, 'seedsPage.variation.bridge.single1');
    assert.equal(stablesSingle1.labelKey, 'seedsPage.variation.stables.single1');
  });

  it('★★ 反过来：同一个标识在**三个主世界结构**下是三个键（diamond）', () => {
    /*
     * ⚠️ spec §5.3 有一句"`chest:structure:diamond` … 共用一个键"，它与 §5.1 的键名规则
     *    （`seedsPage.variation.<上下文>.<短名>`）、§5.4 的完整清单、以及"共 47 条键"这个总数
     *    **互相矛盾**（真的共用的话总数会掉到 45）。这里按 §5.1 + §5.4 + 简报的表走：三个键。
     */
    assert.equal(
      variationOf(overworldRow('village').variations, 'chest:structure:diamond').labelKey,
      'seedsPage.variation.village.diamond',
    );
    assert.equal(
      variationOf(overworldRow('desert_temple').variations, 'chest:structure:diamond').labelKey,
      'seedsPage.variation.desertTemple.diamond',
    );
    assert.equal(
      variationOf(overworldRow('shipwreck').variations, 'chest:structure:diamond').labelKey,
      'seedsPage.variation.shipwreck.diamond',
    );
  });

  it('★★ 互斥组：同一上下文里非 null 的 `exclusive` 只有一种，且每组至少两个成员', () => {
    for (const row of [...SEED_PICKER_OVERWORLD, ...SEED_PICKER_BASTION_TYPES]) {
      const groups = row.variations.map((v) => v.exclusive).filter((group) => group !== null);
      assert.ok(new Set(groups).size <= 1, `${row.value} 里出现了多个互斥组`);
      for (const group of new Set(groups)) {
        const members = row.variations.filter((v) => v.exclusive === group);
        // 一个人一组等于"互斥静默失效"（组名打错一个字母就是这种表现），所以钉住至少两个成员。
        assert.ok(members.length >= 2, `${row.value} 的 ${group} 组只有 ${members.length} 个成员`);
      }
    }
    assert.deepEqual(
      overworldRow('village').variations.map((v) => v.exclusive),
      ['biome', 'biome', 'biome', 'biome', 'biome', null, null],
    );
    assert.deepEqual(
      overworldRow('shipwreck').variations.map((v) => v.exclusive),
      [null, null, 'type', 'type', 'type'],
    );
    assert.deepEqual(
      overworldRow('ruined_portal').variations.map((v) => v.exclusive),
      [null, null, null, 'type', 'type'],
    );
    // R2：本轮**不做** bastion 变种的互斥 ⇒ 四个类型下的变种一个互斥组都没有。
    for (const row of SEED_PICKER_BASTION_TYPES) {
      assert.ok(
        row.variations.every((v) => v.exclusive === null),
        `${row.value} 的 bastion 变种不许有互斥组`,
      );
    }
  });

  it('★★ 标识里不可能出现 `#`（这就是 `markKey` 敢拿它当分隔符的理由）', () => {
    const ids = [...SEED_PICKER_OVERWORLD, ...SEED_PICKER_BASTION_TYPES].flatMap((row) =>
      row.variations.map((v) => v.id),
    );
    assert.equal(ids.length, 37);
    for (const id of ids) {
      assert.ok(!id.includes('#'), id);
      // 与 `routes/seeds.ts` 那 512 字符校验放行的是**同一套字符**（大写会被它 400 掉）。
      assert.match(id, /^[a-z0-9_:,-]+$/, id);
    }
  });

  it('★ 顶行那九个词条键就是界面在用的那九个（`seedsPage.structure.*`）', () => {
    assert.deepEqual(
      SEED_PICKER_OVERWORLD.map((row) => row.labelKey),
      [
        'seedsPage.structure.VILLAGE',
        'seedsPage.structure.DESERT_TEMPLE',
        'seedsPage.structure.SHIPWRECK',
        'seedsPage.structure.RUINED_PORTAL',
        'seedsPage.structure.BURIED_TREASURE',
      ],
    );
    assert.deepEqual(
      SEED_PICKER_BASTION_TYPES.map((row) => row.labelKey),
      [
        'seedsPage.structure.BRIDGE',
        'seedsPage.structure.TREASURE',
        'seedsPage.structure.HOUSING',
        'seedsPage.structure.STABLES',
      ],
    );
  });
});
