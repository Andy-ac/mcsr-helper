# 「排位赛种子」选择器重构 —— 冻结规格（2026-09-16）

> 这份文件是**契约**，不是计划。计划（`docs/seeds-picker-plan.md`）从它推出来，
> 冲突时**以这份为准**。§2 是从生产上游**实测**来的事实，不是抄文档的。

---

## §1 用户原话与裁决

### 1.1 原话（逐字，2026-09-16）

> 「"排位赛种子"选择页面需要重构，包含"世界种子"和"随机数种子"两者，在顶上横向排布，
> "随机数种子"栏目只需在页面中说明尚未完成
> 世界种子选择界面的结构说明如下：
> 1、选择主世界（横向一排按钮选择，五选一并均互斥）
> 对于每种选择的主世界，在下面显示对应的一排按钮，每个按钮允许用户选择（点一下/绿色）/禁用
> （点两下/红色）/不选（不点或点三下），每个按钮包含一个变种，详见
> http://198.51.100.20:8080/v2.html 的"变种类型"部分，其中 village 的五种 biome 互斥，
> ruined portal 的两种 type 互斥，shipwreck 的 type 互斥，当互斥的第二个选项点成绿色时，
> 前一个绿色的熄灭。对应的 api 见同一个网页的端点第 2 部分，绿色为 variations，红色为 without。
> 暂时用英文原文展示，但写在词汇表 ts 文件里，之后我会修改。
> 2、选择 bastion（首先是横向一排按钮选择 biome，五选一并均互斥，然后在下面一排按钮选择
> bastion 类型，四选一并均互斥）
> 对于每种选择的 bastion 类型，在下面显示对应的一排按钮，每个按钮允许用户选择（点一下/绿色）/
> 禁用（点两下/红色）/不选（不点或点三下），每个按钮包含一个变种，详见……"变种类型"部分
> bastion 的四种类型，暂时不做互斥处理，但注意之后 bridge 的 bastion:single:1 和 stables 的
> bastion:single:1 翻译会略有不同，因此在词汇表 ts 文件中对于每种 bastion 子类型最好分开。
> 3、选择 fortress（横向一排按钮选择，五选一并均互斥）
> 4、暂时不做关于 end 的任何选择
> 5、"按比赛 ID 查"部分保留原样，但所有展示的种子不要三位一断（包括上面的"按条件随机抽一条"）」

### 1.2 七条裁决（用户当场选的）

| # | 问题 | 裁决 |
|---|---|---|
| R1 | 新按钮面板与现有面板的关系 | **完全替换**两个下拉 + 全部折叠 chip；**保留「完赛时间上限」**（它没有替代品，删掉就是功能回退） |
| R2 | 顶部行能不能一个都不选 | **能不选 = 该条件不限**；再点已选中的那颗**取消** |
| R3 | 互斥的边界 | **只有「绿↔绿」互斥**；被顶掉的那颗回到**灰色**；**允许「A 绿 + B 红」同时存在** |
| R4 | 「按比赛 ID 查」放哪 | 放在**「世界种子」标签页里**，筛选面板下面 |
| R5 | 「三位一断」的范围 | **连直播分享那边一起改**（改的是共享函数） |
| R6 | 变种按钮上显示什么 | **上游标识原文**（`bastion:single:1`）；词汇表里也存原文，用户之后替换成中文 |
| R7 | 执行方式 | 多智能体流水线（同上一轮） |

---

## §2 实测事实（2026-09-16，24 条探测 + 一轮时间探针）

⚠️ 上一轮的教训（`docs/ranked-live-spec.md` §2）：**上游文档与真实响应不一致**。
所以这一节全部是实测读数，不是抄文档。原始输出在 `.cache/seeds-probe.out.txt`。

### 2.1 命中数一览（判据：AND / OR / 排除到底生不生效）

| # | 查询 | 结果 |
|---|---|---|
| ① | 无参数 | 200，`availableCounts=2518057`（基线） |
| ② | `overworld=village` | 200，964637 |
| ③ | ②+`variations=biome:structure:plains` | 200，484673 |
| ④ | ②+`variations=biome:structure:desert` | 200，358437 |
| ⑤ | ②+`variations=biome:structure:plains,biome:structure:desert` | **404** |
| ⑥ | ②+`without=chest:structure:obsidian` | 200，879334（< ② ⇒ 真的排除了） |
| ⑦ | ③+`without=chest:structure:obsidian` | 200，438209（< ③ ⇒ 绿红可同时生效） |
| ⑧ | ②+两个 `without` | 200，798326 |
| ⑨ | `nether=bridge` | 200，640517 |
| ⑩ | `nether=stables&variations=bastion:single:1` | 200，286125 |
| ⑪ | `nether=bridge&variations=bastion:single:1` | 200，320913（**与 ⑩ 同词条不同值** ⇒ 分离分键有实据） |
| ⑫ | `variations=biome:bastion:nether_wastes` | 200，1021955 |
| ⑬ | ⑫+`nether=bridge` | 200，259155 |
| ⑭ | `variations=biome:fortress:crimson_forest` | 200，656045 |
| ⑮ | `variations=end_tower:caged:front_center` | 200，500531 |
| ⑯ | `variations=end_spawn:buried:56` | **200，338758**（见 §8.2） |
| ⑰ | `variations=some:future:lexicon`（**上游不认识的词条**） | **404** |
| ⑱ | `variations=X&without=X`（自相矛盾） | 404 |
| ⑲ | `completion=720000` | 200，85690 |
| ⑳ | `overworld=buried_treasure` | 200，81235 |
| ㉑ | `overworld=desert_temple` | 200，550492 |
| ㉒ | `nether=bridge&variations=bastion:triple:2` | 200，261365 |
| ㉓ | `overworld=plains`（非法枚举） | **404** |
| ㉔ | `nether=fortress`（非法枚举） | **404** |

### 2.2 由此定下的六条判据

1. **`variations` 是 AND**（⑤ 平原+沙漠 = 404 —— 一个村庄不可能同时是两种群系）。
2. **`without` 真的排除**，而且多个 `without` 是"排除**任一**"。
3. **绿与红可以同时对一个种子生效**（⑦ 是合法的上游查询）⇒ R3 的裁决有 API 依据。
4. **零命中是 HTTP 404**，响应体是 `{"detail":"未找到符合条件的种子数据"}`
   —— ⚠️ **没有 `success` 字段**，所以"按 `success:false` 判空"的那条路在上游这条路上走不到。
5. **上游不认识的词条 = 404**（⑰），**和"没有命中"逐字同形**。
   ⇒ 词条写错时用户看到的永远是「没有命中」，而不是「这个词条不存在」。
   这是**我们只能在本地拦住**的一类错（我们的按钮只发自己表里的标识，所以拦得住）。
6. **非法枚举值也是 404**（㉓㉔）—— 上游**从不校验** `overworld` / `nether`。
   我们的代理先自己校验（400 `bad_overworld` / `bad_nether`）比上游好，这一层要留着。

### 2.3 ★★ 时间：带筛选的查询要 **3.2–4.1 秒**

```
无参数基线（唯一那一次无参数查询）              606 ms
带 `overworld=` 单选（无 variations）           123 / 247 / 331 / 339 / 411 ms
带 variations / without                         3185 / 3218 / 3271 / 3345 / 3523 / 4115 ms
                                               （completion 只有一次预热期读数 1022ms —— 有意不归类）
同一查询重复三次（静默 20 秒后，快慢交替）      快: 411 / 339 / 331ms   慢: 3271 / 3185 / 3218ms
连打 24 条时观察到的峰值                        5347 / 6973 / 7589 / 7811 ms
```

⚠️ **这一节的两组读数来自两份探针输出，逐行都能对上**（2026-09-16 订正时补的锚点）：
`.cache/seeds-probe.out.txt` —— `606ms` 是 ①无参数、`247ms` 是 ㉑沙漠神殿、
峰值那四个是 ⑧/⑫/⑭/⑮；`.cache/seeds-timing.out.txt` —— `123ms` 是 快②buried_treasure、
`331 / 339 / 411` 与 `3271 / 3185 / 3218` 是 快①/慢① 的三轮，另三个慢读数
（3345 / 3523 / 4115）在 慢②/慢③/慢④。

⚠️ **原先第一行的括注写错了**：它把 `606ms` 也归进"`overworld=` 单选"，而那是
**无参数基线**（探针 ①）。峰值那一格原写 **7586**，实测是 **7589**（同文件第 28 行
`200 7589ms ⑭要塞生物群系`）—— 这个错数一共出现在**三处**（本文件这一段、
`docs/seeds-picker-plan.md` 的 T2 代码块、`services/api/src/seeds/upstream.ts` 的注释），
三处已一起订正（Task 8 Step 2b）。

⇒ **是查询本身的性质，不是探针的突发流量**（同一查询三次重复，快的一直 <0.5s，慢的一直 3.2s）。
⇒ 而 `services/api/src/seeds/upstream.ts` 的 `DEFAULT_TIMEOUT_MS = 5000`，
它的理由那一行写着「实测上游在几十毫秒内就返回」—— **那句话对带筛选的查询是错的**。
5 秒只剩 0.9–1.8 秒余量，而突发时实测到 7.6 秒 ⇒ **合法的筛选查询会被报成"种子服务暂时不可用"**。
这一条在**今天**就已经成立（旧界面的 chip 也是走 variations），只是这一轮把筛选变成了主路径，
所以它必须一起修（§3.2）。

### 2.4 响应形状（成功）

```json
{"success":true,"message":"随机获取满足条件的一条种子数据",
 "data":{"id":4796333,"overworldSeed":"166877284373271551","netherSeed":"203602852864830",
         "theEndSeed":"166877284373271551","availableCounts":484673}}
```

`data.id` **就是 matchId**（既有结论，`seeds/upstream.ts:43` 记着实测），
所以检索结果卡片上那颗「结构与变种」按钮有 ID 可用。种子的三个值**全程是字符串**。

---

## §3 架构与代价

### 3.1 不新增端点、不动 CSP、不落库

四个面板都走**我们既有的** `/api/ranked-seeds/*` 代理，理由和当初一样（上游是用户自己的一台
1 核机器，代理负责限流与归一化）。⇒ 这一轮**没有任何服务端路由代码是新增的**：
`routes/seeds.ts` 早就解析并转发 `without`（`for (const name of ['variations','without'])`），
只是界面从来没有暴露过它。**唯一的服务端改动是 §3.2 那个超时常数。**

### 3.2 上游超时 5s → 15s（有实测依据的一行改动）

| | |
|---|---|
| 改什么 | `services/api/src/seeds/upstream.ts` 的 `DEFAULT_TIMEOUT_MS`：`5_000` → `15_000` |
| 为什么 | §2.3：带筛选的查询实测 3.2–4.1 秒，突发 7.6 秒。5 秒只有 0.9 秒余量 |
| 代价（写在明面上） | 上游**真的**挂掉时，用户要多等 10 秒才看到「暂时不可用」，而不是 5 秒 |
| 为什么不用环境变量 | 生产**没有**设 `MCSR_SEED_TIMEOUT_MS`（已核实 `systemctl show` 的 Environment 里没有它），
所以改默认值就是改生产行为；而且这样**任何部署形态**都对，不依赖某台机器的 unit 文件 |
| 顺带必须做的 | 那一段注释（「实测上游在几十毫秒内就返回」）是**错的**，要按 §2.3 的读数订正 ——
留着它，下一个人会照着这句话把数字改回 5 秒 |

⚠️ 客户端**没有**自己的超时（`routes/Seeds.tsx` 调用 `searchSeed(params)` 时**不传** `signal`），
所以服务端这一改是有效的，不会被前端先掐掉。

### 3.3 慢查询的 UX 代价（写在明面上）

带筛选的一次查询要 **3–4 秒**。所以：

- 「查询中…」这个状态**必须能把 3–4 秒撑住**，而且**不能**看起来像卡死
  （文案要说清"带条件的查询本来就慢"，否则用户会在第二秒开始反复点，
  而每次点击都是一次新的上游请求，且每 IP 每分钟只有 20 次配额）。
- 页面**不做**任何自动重试、不在按钮变化时自动查询 —— 每一次上游请求都由用户的
  一个明确动作（点「抽一条」）触发。这条约束是既有的（Seeds.tsx 文件头第 3 条），继续保持。

### 3.4 服务端的 `reason` 在读路径上到不了前端（已知，且本轮不依赖它）

`requestCore()` 非 2xx 时只构造 `ApiError(message, status, code)`
（`apps/web/src/lib/api.ts:307`）—— `reason` / `min` / `allowed` 只有写路径的 `sendJson` 才传。
所以 `seedErrors.ts` 的 `apiReason()` 在读路径上**恒为 null**。

⇒ 本轮**唯一可达的 400** 是 `bad_completion`，而它在本地就被 `parseCompletionInput` 拦住了
⇒ 这个缺口**不阻塞本功能**，也不在本轮修（它是 `lib/api.ts` 的既有设计，动它要连带
`seedErrors.ts` 那两张表，属于另一件事）。记进 §8.4。

⚠️ 但它有一个**必须知道的推论**：检索路径上的 404 **读不到 `reason: 'no_match'`**，
所以界面靠的是 `describeSeedQueryError()` 里"检索路径上的无 reason 404"那一支
（`seedErrors.ts:320-329`）显示「条件太窄」。**那一支是本功能真正的用户可见路径，不能被删。**

---

## §4 数据模型（纯函数，放 `packages/shared/src/seedPicker.ts`）

### 4.1 三态标记

```ts
export type SeedPickerMark = 'none' | 'with' | 'without';
```

**循环顺序**：`none → with → without → none`（点一下 / 点两下 / 点三下）。

### 4.2 结构表（逐条抄自上游 v2 的「变种类型」，§1.1 的链接）

| 上下文 | 变种（上游标识原文） | 互斥组 |
|---|---|---|
| `village` | `biome:structure:desert` `biome:structure:plains` `biome:structure:savanna` `biome:structure:snowy_tundra` `biome:structure:taiga` | **`biome`（5 个互相排斥）** |
| `village` | `chest:structure:diamond` `chest:structure:obsidian` | 无 |
| `desert_temple` | `chest:structure:diamond` `chest:structure:egap` | 无 |
| `shipwreck` | `chest:structure:carrot` `chest:structure:diamond` | 无 |
| `shipwreck` | `type:structure:normal` `type:structure:sideways` `type:structure:upsidedown` | **`type`（3 个互相排斥）** |
| `ruined_portal` | `chest:structure:egap` `chest:structure:golden_carrot` `chest:structure:looting_sword` | 无 |
| `ruined_portal` | `type:structure:completable` `type:structure:lava` | **`type`（2 个互相排斥）** |
| `buried_treasure` | **（无变种）** | — |
| bastion `bridge` | `bastion:single:1` `bastion:single:2` `bastion:triple:1` `bastion:triple:2` | 无（R：本轮不做） |
| bastion `treasure` | **（无变种）** | — |
| bastion `housing` | `bastion:single:1` `bastion:triple:1` `bastion:triple:2` | 无 |
| bastion `stables` | `bastion:good_gap:1` `bastion:good_gap:2` `bastion:single:1` `bastion:single:2` `bastion:single:3` `bastion:small_single:1` `bastion:small_single:2` `bastion:small_single:3` `bastion:triple:1` `bastion:triple:2` `bastion:triple:3` | 无 |

**四个顶部单选行**（每一个都是"五选一/四选一 + 可空"）：

| 行 | 取值 | 发往上游 |
|---|---|---|
| 主世界 | `village` `desert_temple` `shipwreck` `ruined_portal` `buried_treasure` | `overworld=` |
| bastion 生物群系 | `biome:bastion:{basalt_deltas,crimson_forest,nether_wastes,soul_sand_valley,warped_forest}` | `variations=` |
| bastion 类型 | `bridge` `treasure` `housing` `stables` | `nether=` |
| fortress 生物群系 | `biome:fortress:{同上五种}` | `variations=` |

### 4.3 状态与不变式

```ts
export interface SeedPickerState {
  overworld: string;      // '' = 不限，否则五个取值之一
  bastionBiome: string;   // '' = 不限，否则 biome:bastion:* 之一
  bastionType: string;    // '' = 不限，否则四个取值之一
  fortressBiome: string;  // '' = 不限，否则 biome:fortress:* 之一
  /** 完赛时间上限，**存用户输入的原文**（`''` = 不限）。解析失败时它必须留在输入框里。 */
  completion: string;
  /** 标记：键 = `markKey(上下文, 变种 id)`，上下文形如 `overworld:village` / `bastion:bridge`。 */
  marks: Readonly<Record<string, SeedPickerMark>>;
}
```

⚠️ `completion` **放在 state 里**（而不是像旧实现那样当一个并列的 prop）：
整个筛选面板于是只有 `state` + `onChange` 两个 prop，构建参数时也不会出现
"调用方忘了把第二个参数传进来"那种错法。**存原文不存毫秒**的理由照旧：解析失败时
那个值必须留在输入框里（被清空的话用户不知道自己哪里填错了），而"解析失败"正是它最常见的状态。

**不变式（每条都要有断言）**：

1. **顶行的取值只能来自它自己那张表**（防手滑写一个拼错的字符串；上游对非法枚举回 404，
   所以拼错的表现是"永远查不到"，而不是报错）。
2. **标记按上下文分开存**，而**只有当前选中的那个上下文的标记会被发出去**。
   ⇒ 用户选了村庄、标了平原绿，切到沉船再切回来，**平原还是绿的**（不丢他的工作），
   而且**切到沉船时绝不会把村庄的标记发上去**（那会是一条必然 404 的查询）。
3. **互斥只在「绿↔绿」之间**：把 X 设成 `with` 时，**同一互斥组**里其他 `with` 变成 `none`。
   `without` **不参与**互斥（R3：允许「A 绿 + B 红」）。
4. **三态循环**与互斥是两件事，顺序固定：先按循环算出新标记，再跑互斥。
   `none → with` 会顶掉同组其他绿；`with → without` **不**顶掉任何东西。

### 4.4 参数映射（`buildSeedPickerParams(state)`）

| 界面 | 参数 | 说明 |
|---|---|---|
| 主世界选中 | `overworld=<小写>` | 没选就不发这个参数 |
| bastion 类型选中 | `nether=<小写>` | 没选就不发 |
| bastion 生物群系选中 | `variations` 里加一条 | |
| fortress 生物群系选中 | `variations` 里加一条 | 与上一条**可以并存**（实测 ⑬：堡壘群系 + `nether=bridge` 有 259155 条） |
| 当前主世界上下文里的**绿** | `variations` 里各加一条 | |
| 当前 bastion 类型上下文里的**绿** | `variations` 里各加一条 | |
| 所有**红**（两个上下文一起） | `without=`，逗号分隔 | |
| 完赛时间上限 | `completion=<毫秒>` | 沿用既有解析 |

- `variations` 用**英文逗号**拼接，顺序固定（先 bastion 群系、再 fortress 群系、再主世界、再 bastion 变种），
  这样同一个界面状态永远产生**同一个字符串**（界面靠它判断"结果是不是过期的"，见 §6.4）。
- `hasAny` = 上面任意一项有值（决定打 `/random` 还是 `/search`）。
- **超长**：拼接后的 `variations` / `without` 各自 > **512** 字符时给错误词条
  `seedsPage.errFilterTooLong`（与 `routes/seeds.ts` 的 `FILTER_MAX_CHARS` 同值）。

  ⚠️ **但这个上限在当前这张表下够不着，所以它是一条防御性的 clamp，不是一条会触发的规则。**
  逐格算过（标识最长的一条是 `biome:fortress:soul_sand_valley` = 31 字符）：

  | 参数 | 最坏组合 | 字符数 |
  |---|---|---|
  | `variations` | bastion 群系(30) + fortress 群系(31) + 村庄**最多 3 个绿**(1 个 biome + 2 个 chest = 75) + stables **11 个全绿**(198) = 16 项 | **349**（含 15 个逗号） |
  | `without` | 村庄 7 项全红(164) + stables 11 项全红(198) = 18 项 | **379**（含 17 个逗号） |

  ⚠️ 村里**不可能** 5 个 biome 全绿（它们互斥）—— 早期版本这里写的是
  "7 + 11 + 2 = 20 条 ⇒ 约 520 字符"，那是**错的**：它既漏了互斥、又高估了标识长度。
  ⇒ 判据：clamp **留着**（它守的是"未来改表之后不会把一条超长串发上去"），
  但**不许**声称从界面上能触发它；测试要**直接构造**一个超长的 state 去验它，
  而不是去找一条走得到的点击路径（那条路不存在）。
  一条"永远走不到"的检查如果被写进验收，下一个人会花半天去找它 —
  这正是本仓反复记下的那一族（`pending.md` §5.67 / §5.79）。

---

## §5 词汇表（用户之后要改的就是这里）

### 5.1 放哪、长什么样

- **文件**：`packages/shared/src/i18n/zh-CN.ts` 与 `packages/shared/src/i18n/en.ts`
  的 `seedsPage.variation.*` 下（用户此前已经改过 `zh-CN.ts`，见 `progress.md` §十五①）。
- **值**：**上游标识原文**（R6）。**两种语言都写同一串英文**。
  ⚠️ 理由与上一轮的时间线词条逐字相同（`packages/shared/src/ranked/timeline.ts`）：
  值就是标识本身，于是"表里有"与"表里没有"不会显示成两种不同的东西。这一轮的表是固定的，
  但仍然照这个走 —— 用户明确说了"暂时用英文原文展示"。
- **键名规则**：`seedsPage.variation.<上下文>.<短名>`。

### 5.2 ★ bastion 子类型**分开分键**（用户明确要求）

`bastion:single:1` 在 bridge 与 stables 下的翻译**会不一样**（上游文档：stables 的
`single:1/2/3` 是**双箱塔**、`small_single:1/2/3` 是**单箱塔**）。所以：

```
seedsPage.variation.bridge.single1   = 'bastion:single:1'
seedsPage.variation.stables.single1  = 'bastion:single:1'   ← 同一个标识，两个键
```

⇒ **同一个标识在不同 bastion 子类型下必须是不同的键**，将来改一处不会连带改另一处。
这一条有实据：实测 ⑩ 与 ⑪ 的同词条在两种类型下命中数不同（286125 / 320913），
说明上游确实是两种东西。

### 5.3 主世界与 bastion 的变种一律**按上下文 + 标识**分键

⚠️ **本节在 2026-09-16 被订正过**：原文写的是"`chest:structure:diamond` 同时出现在
village / desert_temple / shipwreck，**共用一个键**"，而 §5.1 的规则、§5.4 的清单、
以及"47 条键"那个总数说的都是**每格一个键**。**两份自相矛盾**，而 Task 3 的实现者
照着 §5.1/§5.4 做了并把它写进了断言，还把这个矛盾报了上来。

**裁决：按 §5.1/§5.4 的走 —— 一律按上下文分键。** 理由：

- 规则**没有例外**好记也好查：`seedsPage.variation.<上下文>.<短名>`。
  留一个"这个键是共用的"特例，下一个人就必须先判断"这个标识算不算跨上下文的那一类"。
- 用户接下来要**手工**翻这 47 条。真到某天想让沉船里的钻石箱和村庄里的说法不同时，
  分键的写法**不用动表**；共用键的写法要先改表再补词条。
- 群系那两行本来就是分开的（`biome:bastion:*` 与 `biome:fortress:*` 是两串不同的标识），
  所以"按上下文分键"在主世界/bastion/群系三类上是同一个规则。

**代价（写在明面上）**：今天 `chest:structure:diamond` 会在
`village.diamond` / `desertTemple.diamond` / `shipwreck.diamond` **三个键里各存一份同样的英文**。
用户翻译时如果三处说法相同，他要改三处；**只改了一处**的表现是同一个意思在三种结构下
两种语言混着显示。⇒ 真要合并时，改法是"把三行的 `labelKey` 指向同一个键"，
改动只在表里、词条不用动。

### 5.4 完整的键清单（37 条变种 + 10 条群系 = **47 条键**）

⚠️ **标题在 2026-09-16 订正过**：原文写的是"47 条变种 + 10 条群系"，把**总数**
当成了变种数 —— 照它数下去会得到 57，而"键数断言"将来是拿这个数去对的。
正文列的是：主世界 19 条（村庄 7 + 沙漠神殿 2 + 沉船 5 + 废弃传送门 5）
＋ bastion 18 条（bridge 4 + housing 3 + stables 11）＝ **37 条变种**，
再加 bastion / fortress 两份群系各 5 条 ＝ **47 条键**。

```
主世界（按上下文分键；buried_treasure 没有变种，所以没有它的键）
  village.desert / village.plains / village.savanna / village.snowyTundra / village.taiga
  village.diamond / village.obsidian
  desertTemple.diamond / desertTemple.egap
  shipwreck.carrot / shipwreck.diamond
  shipwreck.normal / shipwreck.sideways / shipwreck.upsidedown
  ruinedPortal.egap / ruinedPortal.goldenCarrot / ruinedPortal.lootingSword
  ruinedPortal.completable / ruinedPortal.lava

bastion 变种（★ 按子类型分开）
  bridge.single1 / bridge.single2 / bridge.triple1 / bridge.triple2
  housing.single1 / housing.triple1 / housing.triple2
  stables.goodGap1 / stables.goodGap2
  stables.single1 / stables.single2 / stables.single3
  stables.smallSingle1 / stables.smallSingle2 / stables.smallSingle3
  stables.triple1 / stables.triple2 / stables.triple3
  （treasure 没有变种，所以没有它的键）

bastion 生物群系 = seedsPage.variation.bastionBiome.{basaltDeltas,crimsonForest,netherWastes,soulSandValley,warpedForest}
fortress 生物群系 = seedsPage.variation.fortressBiome.{同上五个}
```

### 5.5 新增的非变种词条

两个标签页名、RNG 占位那一块、四排按钮的标题、三态图例、以及一句"带条件的查询比较慢"。
⚠️ 这些是**中文**（不是标识），所以它们要走字体覆盖检查 —— 已预检：**不需要补字**
（`.cache/font-precheck.mjs`，常规与粗体各 7368 码位，候选文案零缺字）。

---

## §6 界面

### 6.1 顶部两个标签页（**本地状态，不是路由**）

| 标签 | 内容 |
|---|---|
| **世界种子** | §6.2 的筛选面板 + 结果卡 + §6.5 的「按比赛 ID 查」 |
| **随机数种子** | **只有一段说明，一个按钮都没有** |

**裁决：用本地状态而不是 `/seeds/world`、`/seeds/rng` 两条路由。**
理由：用户说的是"在顶上横向排布"，不是"两个页面"；路由方案要连带改 `App.tsx`
的路由表、`/seeds` 重定向、以及 `homerender.tsx` 里那条读 `path="/seeds"` 的守卫，
而其中一栏**是空的**，没有可深链的内容。
**代价**：RNG 那一栏没有自己的 URL；将来真做出来时再加两条路由是个小改动。

### 6.2 「世界种子」标签页的筛选面板

从上到下，**每排按钮横向排布**：

```
主世界结构                                          ← 组名**单独一行，在它那一排按钮上面**
[村庄] [沙漠神殿] [沉船] [废弃传送门] [埋藏的宝藏]      ← 单选，可空
结构变种                                            ← 选中村庄时出现；与上一排**同级，不缩进**
[biome:structure:desert] [..:plains] [..:savanna] [..:snowy_tundra] [..:taiga]
[chest:structure:diamond] [chest:structure:obsidian]  ← 三态；前五个互斥

下界堡垒遗迹 · 生物群系
[bio..basalt_deltas] [..crimson_forest] [..nether_wastes] [..soul_sand_valley] [..warped_forest]   ← 单选，可空
下界堡垒遗迹 · 类型
[桥] [藏宝室] [居住区] [疣猪兽棚]                     ← 单选，可空
堡垒变种                                            ← 选中桥时出现；同样不缩进
[bastion:single:1] [bastion:single:2] [bastion:triple:1] [bastion:triple:2]   ← 三态，不互斥

要塞 · 生物群系
[bio..basalt_deltas] [..crimson_forest] [..nether_wastes] [..soul_sand_valley] [..warped_forest]   ← 单选，可空

完赛时间上限      [分:秒，例如 2:35]      ← **保留原样**
                                    [抽一条]   ← 既有按钮，文案沿用；它属于**页面**，但渲染在
                                                 同一张卡里（`.seed__pickercard`，见下）
三态图例          点一下＝要求（绿）· 点两下＝排除（红）· 点三下＝取消
                 ⚠️ 这一句的**权威文本是计划里 Task 4 的新文案表**
                 （`seedsPage.pickLegend` / `pickLegendNote`），本节的草稿
                 （原先写的 `灰=不选 · 绿=要求（variations） · 红=排除（without）`）
                 **不是**要上线的那句话：`variations` / `without` 是给开发者看的参数名，
                 用户读不懂，而这一句要说的是**怎么点**。
```

⚠️ **上面这张图在 2026-09-16 按实际做出来的界面订正过两处**（Task 5 的实现者发现、
用户裁定"接受偏差、改文档"，Task 8 回填）：

1. **组名在按钮上面一行，不在左边一列。** 原来的图把组名画成左栏
   （`主世界结构        [村庄] …`）。做不出来不是排版偏好问题：每一排是一个
   `<fieldset>` + `<legend>`，而 **`<legend>` 不能作为 flex 子项参与排版**
   （它渲染在 fieldset 的边框区）。这个结构本仓**已经裁过三次**
   （`CalendarFilters` / `CalendarList` / `MarksPanel`），理由逐字记在
   `apps/web/src/styles.css` 的 `.grid-filters__row` 那一段与 `SeedPicker.tsx`
   的 `TopRow` 上：**语义优先于对齐方式**。
   用户的要求是"横向一排按钮选择"，而 `.seed__rowbtns` 确实是一行横向 flex ⇒ 不算破坏。
2. **变种那一排不缩进**，它与拥有它的那一排是**同级的 `<fieldset>`**
   （DOM 里紧跟在后面，没有包裹层、没有 `padding-left`）。
   原来图里那个 `└` 的从属关系在代码里是**渲染条件**（`overworldRow.variations.length > 0`）
   与**上下文**（`overworldContext(...)`），不是缩进。

⇒ 下一轮谁再改这一页，请拿这份图与 `SeedPicker.tsx` 对一眼：**图现在描述的就是做出来的那一个**，
不再是一个从未被建造的版本（`docs/progress.md §二十一` 记了这次订正的经过）。

- **顶层的四个单选行**用**已有的中文标签**（`seedsPage.structure.VILLAGE` 等已经是
  村庄 / 沙漠神殿 / 沉船 / 废弃传送门 / 埋藏的宝藏 / 桥 / 藏宝室 / 居住区 / 疣猪兽棚）。
- **变种按钮**上是 §5 的词汇表值（这一轮 = 上游标识原文）。
- **三态的颜色**：绿 / 红 / 灰，配套 `aria-pressed` 与一条可见的图例
  （只靠颜色表达状态对色盲用户不可用，而这是唯一表达状态的手段）。
- 没有变种的结构（`buried_treasure`、bastion 的 `treasure`）**不渲染任何空排** ——
  一排零个按钮比没有那一排更让人困惑。
- 不选任何结构时，**不渲染任何变种排**。

### 6.3 五个状态（沿用既有的一整套）

| 状态 | 表现 |
|---|---|
| 初始 | 「还没有结果。点上面的按钮抽一条。」（`seedsPage.resultEmpty`） |
| 查询中 | 「查询中…」+ **一句说清带条件本来就慢**的提示（§3.3） |
| 成功 | 命中数 + 种子卡（`SeedResultCard`，**不受这一轮影响**，除了 §7） |
| 零命中 | 既有 404 路径 → 「条件太窄」（`seedsPage.errNoMatch` + hint） |
| 失败 | 既有 `errUnavailable` / `errRate` 等 |

### 6.4 「结果是不是过期的」那句话必须继续存在

既有实现用 `resultKey`（序列化后的筛选参数）对比当前参数，改了条件但没重抽时提醒用户
（`Seeds.tsx:70-79`）。**这一条必须保留**：按钮式界面里"改条件"比下拉更容易发生，
而卡片上那条种子**不再对应**当前条件这件事，在界面上没有任何别的地方能看出来。

### 6.5 「按比赛 ID 查」**原样保留**（R4）

- 输入框、下界提示、404 的两个出口（补录提示 + 只查结构与变种）、`SeedInfoPanel`：
  **一个字都不改**。
- 唯一的变化是位置：它现在在**「世界种子」标签页里**，筛选面板下面。
- 「社区种子分享 · 即将开放」那一块**保留**（它是 Q7/Q8 的说明，与本轮无关）。

---

## §7 种子的显示：去掉千位分隔符

- **改什么**：`packages/shared/src/seed.ts` 的 `formatSeedForDisplay()` **删掉**
  （它变成恒等函数之后留着比删掉更坏），三个消费点直接渲染原始字符串。
- **消费点（全仓只有两处，已 grep 核实）**：
  1. `apps/web/src/components/SeedResultCard.tsx:130`（这一页的种子卡）
  2. `packages/ui/src/SeedInput.tsx:87` —— ⚠️ **全仓没有任何地方引用它**
     （只有 `packages/ui/src/index.ts` 转出），是死代码
- ⇒ **对用户可见的效果**：只有种子检索这一页变了。
  直播分享的看板本来就直接渲染 `payload.overworld`（`ShareCard.tsx:195`），**本来就没有分隔符**。
  （用户选了"连直播分享那边一起改"，实测结论是那一边**本来就没变**，
  所以这一条的实际改动面就是上面两处 + 注释。）
- 连带要改的注释（**逐处核实过**，`git grep formatSeedForDisplay` 只有这四个位置）：
  `packages/shared/src/seed.ts:80`（函数本身）与 `:115`（`SeedRecord` 上方那句
  "界面渲染时用 `formatSeedForDisplay` 加千位分隔符"）、
  `apps/web/src/components/SeedResultCard.tsx:2`（import）与 `:23`（文件头那条规则）。
  ⚠️ `README.md:66` **不用改** —— 那一句讲的是"输入框用 `inputMode="text"`"，
  引用 `SeedInput.tsx` 只是为了指那份写法，与千位分隔符无关。
- ⚠️ **复制按钮继续走原始字符串**（这一点不变）。
- ⚠️ `title` 属性继续挂着原始值（鼠标悬停能看到完整值）。

---

## §8 非目标与裁决

### 8.1 非目标

- **不做 end 的任何选择**（用户第 4 条）：`end_tower:caged:*` 与 `end_spawn:*` 都不出现在界面上。
  ⚠️ `SeedInfoPanel`（结果里的"结构与变种"）照旧显示它们 —— 那是**事实**，不是筛选。
- **不做 bastion 变种的互斥**（用户第 2 条明说"暂时不做互斥处理"）。
- **不做自动查询 / 自动重试 / 轮询**（§3.3）。
- **不改 `end_spawn` 的服务端拒绝**（见 8.2）。
- **不改读路径的 `reason` 管道**（§3.4）。
- **不改 `/api/ranked-seeds/*` 的任何路由或校验逻辑**（`without` 早就通了）。

### 8.2 ⚠️ 实测与旧结论冲突的一处：`end_spawn:buried:56` 现在是**可用的**

- 既有事实：`routes/seeds.ts` 对 `end_spawn:*` 一律 **400 `end_spawn_unsupported`**，
  理由是"上游那一组有 bug"（上一轮 Q17 的裁决）。
- **本轮实测**：`GET /seed?variations=end_spawn:buried:56` → **200，`availableCounts=338758`**（⑯）。
  也就是说上游那条路**现在是通的**。
- **裁决：本轮不动它。** 理由三条：① 本轮不做 end 界面，所以没有任何界面路径会发出它；
  ② 那条拒绝是用户当年基于"上游有 bug"拍的，改它需要一个**新的**用户裁决，
  而不是我在这里顺手推翻；③ 动它要连带改 `error-codes` 的清单与前端两张表。
- ⇒ 记进 `pending.md`，并在给用户的收尾报告里**明写**这条冲突，让他决定。

### 8.3 没有变种的上下文仍然要能被选中

`buried_treasure` 与 bastion 的 `treasure` 没有变种，但它们**是合法的 `overworld` / `nether`
取值**（实测 ⑳ 81235 / ⑨ 等）。所以"选它 → 不渲染变种排"是**正确行为**，不是漏了。

### 8.4 词条表不再"自动学习"（写下来的代价）

旧实现会把结果里**实际见过**的词条并进起点表（`observedVariations` / `harvest`），
所以上游加一个新词条时，界面上**自己**会长出一个 chip。

这一轮的按钮集是**固定**的（每个按钮对应一个具体变种、且按结构分排），
**自动学习那一套没有地方可去**，所以整块删掉（连同 `SEED_VARIATION_BASE`、
`variationGroups`、`groupVariations` 的唯一消费方、`GROUP_LABEL_KEYS`、折叠用的 `overrides`）。

**代价（明写）**：上游新增一个变种时，界面上**不会**自己出现 —— 要有人去改
`packages/shared/src/seedPicker.ts` 的表和两份词条。这正是"词汇表 ts 文件、之后我会修改"
那句用户原话所接受的分工。⚠️ 结果里的原始词条照旧显示（`SeedInfoPanel` 不动），
所以"上游给了什么"这件事在界面上仍然看得见。

---

## §9 验收

### 9.1 必须能演示的行为（每一条都要有断言）

1. 三态循环：同一次点击序列 `none → with → without → none`。
2. 互斥只作用于绿：village 里 desert 绿 → plains 绿 ⇒ desert 变成**灰**（不是红）。
3. 绿红可并存：desert 绿 + plains 红 ⇒ `variations` 有 desert、`without` 有 plains。
4. 红不互斥：desert 红 + plains 红 都留着。
5. **标记按上下文分开**：village 标 plains 绿 → 切 shipwreck → `variations` **不含** plains
   → 切回 village ⇒ plains 仍绿。
6. bastion 的 `single1` 在 bridge 与 stables 下是**两个不同的键**（bridge 绿不影响 stables）。
7. 四个顶行的"再点一次取消"。
8. 参数拼接：`overworld` / `nether` / `variations` 的顺序稳定、同一状态同一字符串。
9. **512 的 clamp 真的会拦**：**直接构造**一个超过 512 字符的 state
   （不用点击路径 —— §4.4 算过界面上够不着），断言给 `errFilterTooLong`
   且 `params.variations === undefined`（宁可不出错的条件，也不要一条必然被上游 400 的查询）。
10. 零命中走「条件太窄」而不是「去补录」（§3.4 的那一支）。
11. `buried_treasure` / `treasure` 不渲染空排。
12. 种子值**没有千位分隔符**，且复制出来仍然是没有分隔符的原值。

### 9.2 mutation（每一处都要点名一条断言）

| # | 改坏什么 | 期望红的那条 |
|---|---|---|
| ① | 互斥时把被顶掉的设成 `without` 而不是 `none` | 断言 2 |
| ② | 让 `without` 也参与互斥 | 断言 3/4 |
| ③ | 标记改成全局（不按上下文分） | 断言 5 |
| ④ | bastion 子类型共用同一个键 | 断言 6 |
| ⑤ | 顶行不做"再点取消" | 断言 7 |
| ⑥ | 512 的 clamp 删掉 | 断言 9（直接构造超长 state 那条） |

---

## §10 冻结表（不许在实现中漂移的东西）

| 项 | 值 |
|---|---|
| 主世界取值（顺序） | `village` `desert_temple` `shipwreck` `ruined_portal` `buried_treasure` |
| bastion 类型取值（顺序） | `bridge` `treasure` `housing` `stables` |
| 群系取值（顺序） | `basalt_deltas` `crimson_forest` `nether_wastes` `soul_sand_valley` `warped_forest` |
| 变种标识 | §4.2 逐字；**不允许**为了好看改大小写或分隔符 |
| 三态循环 | `none → with → without → none` |
| 互斥 | 只有 `with↔with`；被顶掉的回 `none` |
| 绿→参数 | `variations`（逗号分隔） |
| 红→参数 | `without`（逗号分隔） |
| 顶行→参数 | 主世界→`overworld`；bastion 类型→`nether`；两个群系行→`variations` |
| 过滤串长度上限 | 512 字符（与 `routes/seeds.ts` 的 `FILTER_MAX_CHARS` 同值） |
| 上游超时 | `DEFAULT_TIMEOUT_MS = 15_000` |
| 标签页 | **两个**，本地状态，不是路由 |
| 词汇表值 | 这一轮 = 上游标识原文，两种语言同一串 |
| 种子显示 | 无千位分隔符；复制走原始字符串 |
| 未变动的部分 | 「按比赛 ID 查」整块、`SeedInfoPanel`、「社区种子分享」说明块 |
