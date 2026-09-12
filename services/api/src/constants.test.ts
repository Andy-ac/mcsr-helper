/**
 * 结构词表之间的**子集关系** —— 两份词表必须一直是同一件事的两个投影。
 *
 * ---------------------------------------------------------------------------
 * 这个文件守的是哪一类 bug
 * ---------------------------------------------------------------------------
 * 主世界结构在这个项目里有**三份**相关的取值，它们必须互相一致：
 *
 *   1. `OVERWORLD_STRUCTURES`（大写）—— **自有数据库** `MatchSeed.overworld`
 *      的真实取值，6 个（2026-09-12 用全表 GROUP BY 核对过，见 own-db-facts.md §2）
 *   2. `UPSTREAM_OVERWORLD_FILTERS`（小写）—— Ranked Seeds 上游 `/seed`
 *      认的**筛选**取值，5 个
 *   3. `NETHER_STRUCTURES` / `UPSTREAM_NETHER_FILTERS` —— 同样的一对（下界）
 *
 * 三者分开写**不是**笔误，理由写在 constants.ts 的常量注释里（大小写方向相反、
 * 上游没有 jungle_temple）。但分开写就意味着**它们会漂移**，而漂移的表现是：
 *
 *   界面上出现一个选项 → 用户点它 → 上游 400
 *
 * 这类 bug 只在用户真的点了那个选项时才出现，单元测试和接口测试都看不见它 ——
 * 除非有人专门把两份词表对起来看。这个文件就是那个"专门对一次"。
 *
 * ---------------------------------------------------------------------------
 * 为什么测试写在 services/api 里而不是 packages/shared 里
 * ---------------------------------------------------------------------------
 * 和 `error-codes.test.ts` / `i18n-keys.test.ts` 同理：shared 包只有 typecheck，
 * 没有测试运行器，而这两类"跨层一致性"的断言需要真实的测试环境。
 * `pnpm -F @mcsr/api test` 会跑到它们。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  NETHER_STRUCTURES,
  OVERWORLD_STRUCTURES,
  UPSTREAM_NETHER_FILTERS,
  UPSTREAM_OVERWORLD_FILTERS,
} from '@mcsr/shared';

const lower = (values: readonly string[]): string[] => values.map((v) => v.toLowerCase()).sort();

describe('★ 结构词表：自有库 / 上游筛选 两份取值的关系', () => {
  it('上游的主世界筛选词表是自有库词表的**真子集**（只差大小写）', () => {
    const own = new Set(lower(OVERWORLD_STRUCTURES));
    const upstream = lower(UPSTREAM_OVERWORLD_FILTERS);

    const unknown = upstream.filter((v) => !own.has(v));
    assert.deepEqual(
      unknown,
      [],
      `上游筛选词表里出现了自有库没有的结构：${unknown.join(', ')}。\n` +
        '上游的取值必须能在自有库里找到对应物，否则同一个结构在两条数据源下\n' +
        '会是两个不同的东西，将来合并查询时对不上。',
    );
  });

  it('★ 上游**没有** jungle_temple —— 这个差集是有意的，不是漏了', () => {
    /*
     * 自有库真的存在 `JUNGLE_TEMPLE` 的比赛（10,175 条，占 0.08%，见
     * own-db-facts.md §2），但上游 `/seed` 的筛选词表里**没有**它。
     *
     * 这条断言把"差集恰好是这一个"钉住，有两个作用：
     *   · 哪天有人"顺手"把 jungle_temple 加进上游词表，这里会红 ——
     *     而那会在界面上造出一个上游必然 400 的选项
     *   · 哪天上游真的支持了它，这里也会红，逼我们回去确认上游的行为
     */
    const own = new Set(lower(OVERWORLD_STRUCTURES));
    const upstream = new Set(lower(UPSTREAM_OVERWORLD_FILTERS));

    const onlyInOwn = [...own].filter((v) => !upstream.has(v)).sort();
    assert.deepEqual(onlyInOwn, ['jungle_temple']);
  });

  it('下界的两份词表**恰好相同**（只差大小写）', () => {
    // 下界没有主世界那样的差集：自有库和上游都是这 4 个
    assert.deepEqual(lower(NETHER_STRUCTURES), lower(UPSTREAM_NETHER_FILTERS));
  });

  it('★ 那 5 个"看起来合理但不存在"的值不许回来', () => {
    /*
     * `OVERWORLD_STRUCTURES` 原来有 11 项，其中 5 项在 1303 万行真实数据里
     * **一次都没出现**（own-db-facts.md §2）。它们是"看起来合理"的猜测：
     * 掠夺者前哨站、女巫小屋、海底神殿、雪屋、要塞 —— 都是 Minecraft 里
     * 真实存在的结构，只是 Ranked 的种子筛选不用它们。
     *
     * ⚠️ 留着它们的代价不是"多几个选项"：界面会给用户一个**选了必然
     *    查不到结果**的筛选项，而他会以为是自己操作错了。
     *    一个永远查不出东西的选项比没有这个选项更糟。
     *
     * 这个列表同时是**这份测试自己的存在理由**：如果哪天有人觉得
     * "少了几个结构"，他至少会先看到这段为什么不允许。
     */
    const neverOccurred = [
      'PILLAGER_OUTPOST',
      'WITCH_HUT',
      'OCEAN_MONUMENT',
      'IGLOO',
      'STRONGHOLD',
    ];

    for (const value of neverOccurred) {
      assert.ok(
        !(OVERWORLD_STRUCTURES as readonly string[]).includes(value),
        `${value} 在 1303 万行真实数据里从未出现，不该出现在词表里。` +
          '如果你认为它应该存在，请先用全表 GROUP BY 重新核对 own-db-facts.md §2。',
      );
    }
  });

  it('词表里没有重复值（重复会让界面出现两个一模一样的选项）', () => {
    for (const [name, values] of [
      ['OVERWORLD_STRUCTURES', OVERWORLD_STRUCTURES],
      ['NETHER_STRUCTURES', NETHER_STRUCTURES],
      ['UPSTREAM_OVERWORLD_FILTERS', UPSTREAM_OVERWORLD_FILTERS],
      ['UPSTREAM_NETHER_FILTERS', UPSTREAM_NETHER_FILTERS],
    ] as const) {
      assert.equal(new Set(values).size, values.length, `${name} 里有重复值`);
    }
  });

  it('上游词表全小写、自有库词表全大写（发往上游与展示的形状不能混）', () => {
    /*
     * ⚠️ 大小写方向反了**不会报错**，只会让筛选永远查不到东西：
     *    上游对大小写实际是宽容的（实测修正 1），但那不代表我们可以依赖它 ——
     *    契约写的是小写，而"上游恰好容忍"和"上游承诺支持"是两件事。
     */
    for (const values of [UPSTREAM_OVERWORLD_FILTERS, UPSTREAM_NETHER_FILTERS]) {
      for (const v of values) assert.equal(v, v.toLowerCase(), `${v} 应当是小写`);
    }
    for (const values of [OVERWORLD_STRUCTURES, NETHER_STRUCTURES]) {
      for (const v of values) assert.equal(v, v.toUpperCase(), `${v} 应当是大写`);
    }
  });
});
