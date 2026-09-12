# Ranked Seeds —— 上游 API 契约（实测）

> 采集时间：2026-09-12，来源：`http://198.51.100.20:8080/v2.html`（API 文档）
> 与 `http://198.51.100.20:8082`（图形化查询工具）。这是用户**自己的**服务，
> 与 `docs/own-db-facts.md` 里那台 MySQL 是同一台机器上的不同暴露面。

---

## ⚠️⚠️ 先读这一节：实测修正（2026-09-12 晚，代理实现时实测）

**下面 §1–§5 是照上游文档抄的，而实测发现文档有几处是错的或没写的。**
实现以本节为准；§1–§5 保留是为了对照"文档说的"和"实际是的"差在哪。

### 修正 1：上游版本是 **v2.1.0**，不是文档写的 v2.0.0

### 修正 2：上游**没有任何 CORS 头**

`Server: uvicorn`，没有 `Access-Control-Allow-Origin` 之类的头。
→ 这回答了一个原本悬着的问题：**代理不只是为了绕开混合内容，
   跨域调用本来就不可能**。浏览器直连这条路是彻底不通的，不是"配一下就行"。

### 修正 3：`/seed` 的响应字段叫 `id`，`availableCounts` 在 `data` 里

实测 `id` **就是 matchId**（`/seed` 给出 `id=6124756`，而 `/seed/6124756`
返回完全相同的三个种子值）。所以对外统一成平铺的 `seed` 对象，
`availableCounts` 提到 `seed` 之外 —— 它是**这次查询**的属性，不是这条种子的属性。

### 修正 4：`/seed/{matchId}` 返回的是**嵌套**的 `data.seeds{...}`

和 `/seed` 的平铺形状不一样。两个端点同一个意思、两种形状。

### 修正 5：`/seedinfo` 的 404 **不走** `{success,message,data}` 外壳

是 FastAPI 默认的 `{"detail": "..."}`。

### 修正 6：`POST /seed` 的 `matchDate` 是**字符串**

而它的 GET 返回的是**数字毫秒**。同一个字段两种类型。

### 修正 7：`end_spawn:*` —— 查询时拒绝，但返回里**保留**

用户说这个变种"有 bug"，所以**作为筛选参数**要拒绝。
但实测 `seedinfo` 的返回里**真的会**出现 `end_spawn:buried:56` ——
所以**结果里必须保留它**，剔掉等于对用户撒谎。

**这个区分很重要，别把它简化成"这个变种不支持"**：
不支持的是"按它筛"，不是"它不存在"。

### 修正 8：`POST /seed` 重复时是否真返回 409 —— **未核实**

核实它就必须真的往用户库里写一条。按 409 实现，并额外分类处理
`200 + success:false` 这种兜底形态。**这条是唯一没有实测支撑的假设。**


## 0. ⚠️ 这是 M4 种子部分的**范围变更**

`docs/v1-plan.md` 里"种子分享"指的是**社区提交的固定模板 UGC**。
用户 2026-09-12 的答复把优先级改成：

> 「种子项目下先做一个子项目 **Ranked Seeds**，参考 `…/v2.html`，可自选词条，
>   其余的如 rsg、ssg 等**先留空**」

即：**先对接上游的 Ranked 种子检索**，社区 UGC 分享（RSG / SSG 那套）暂缓。

## 1. 上游接口

Base URL：`http://198.51.100.20:8001/api/v2/` ｜ JSON ｜ UTF-8 ｜ 版本 v2.0.0

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/seed` | 随机一条（无筛选） |
| GET | `/seed?overworld=&nether=&variations=&without=&completion=` | 随机一条**满足条件**的 |
| GET | `/seed/{matchId}` | 按比赛 ID 取三个世界的种子值 |
| GET | `/seedinfo/{matchId}` | 按比赛 ID 取详细信息（结构 + 变种） |
| POST | `/seed` | **把种子录入数据库**（写入！） |

响应外壳统一是 `{ success, message, data }`。

### 1.1 筛选参数（这就是"可自选词条"）

| 参数 | 取值 |
|---|---|
| `overworld` | `village` / `desert_temple` / `shipwreck` / `ruined_portal` / `buried_treasure` —— **小写，只有 5 个** |
| `nether` | `bridge` / `treasure` / `housing` / `stables` —— **小写，4 个** |
| `variations` | 逗号分隔，**同时满足全部**（AND） |
| `without` | 逗号分隔，**排除任意一个**（NOT ANY） |
| `completion` | 毫秒；**带上它就只返回排位模式**且完赛时间 ≤ 该值 |

### 1.2 `availableCounts` —— 一个很好用的字段

每次查询都返回**满足当前条件的种子总数**（例：无条件 1,039,488；加了五条筛选后 140）。
→ 这让"这个筛选组合有多少结果"可以在点之前就告诉用户，而不是让人反复试空结果。

### 1.3 `seedinfo` 返回的形状（注意大小写不一致）

```json
{ "matchId": 3650001,
  "overworld": "VILLAGE",          // ← 大写
  "nether": "BRIDGE",              // ← 大写
  "end_towers": "[76, 79, 85, 97]",// ← 是**字符串**，内容是 JSON 数组
  "variations": "[\"biome:structure:plains\", …]" } // ← 也是字符串
```

⚠️ 两处**不一致**必须在适配层抹平，否则会一路漏到界面上：
1. **筛选参数用小写，`seedinfo` 返回大写**（`village` vs `VILLAGE`）
2. `end_towers` 和 `variations` 是**被字符串包住的 JSON**，要二次 `JSON.parse`

## 2. ⚠️⚠️ 上线前必须解决的硬阻塞：混合内容

- 我们的站点是 **HTTPS**（`https://mcsrhelper.com`）
- 上游 API 是 **HTTP**（`http://198.51.100.20:8001`）

**浏览器会直接拦掉** https 页面里对 http 的 XHR/fetch —— 这不是"可能有问题"，
是必然失败，而且报的是 CORS / mixed-content 之类的错，看起来像配置问题，
很容易被误判成"上游挂了"。

→ **必须由我们的后端代理**：浏览器 → 我们（https）→ 上游（http，服务器到服务器不受限制）。
这顺带带来两个好处（也带来两个必须处理的责任）：
- ✅ 可以缓存（上游是"随机取一条"，不缓存的话每次点击都是一次上游请求）
- ✅ 可以隐藏上游地址、统一错误形状
- ⚠️ 必须**限流**：否则我们的用户可以把上游打挂，而那是用户自己的服务
- ⚠️ 必须**超时 + 降级**：上游不可达时要有明确文案，不能让我们自己的页面转圈到天荒地老

## 3. 数据规模与新鲜度（上游自述）

| 项 | 值 |
|---|---|
| 种子数据 | **约 300 万条**，覆盖 2025-11-13 起约 **80%** 的实际种子 |
| 比赛/玩家 | 约 600 万条 |
| `/seed` 新鲜度 | **实时**（比赛结束后 30 分钟内入库） |
| `/seedinfo` 新鲜度 | **也是实时** |
| 覆盖范围 | 排位模式、休闲模式、房主有铁镐及以上会员等级的私人房间 |

⚠️ **上游文档在这里是错的。** `v2.html` 里写着 `/seedinfo`「数据可能有数天的延迟」，
但用户 2026-09-12 明确更正：**两个端点实际都是实时更新的，是文档没跟上**。

→ 后果：**界面上不要写任何"数据可能有延迟"的提示**。
假提示比没有提示更糟 —— 用户会因此不去信任一个其实准确的数字，而我们还要为它写文案。

⚠️ 但 "80% 覆盖" 仍然成立，所以 **"查不到"是常态而不是异常**：用户按 matchId 查一个
不存在的 ID 时，界面必须说清"这条不在库里（可能是那 20%）"，
而不是"出错了"或"没有数据"。

## 4. 本项目的词条中文名（取自上游工具，直接沿用）

主世界：村庄 / 沙漠神殿 / 沉船 / 废弃传送门 / 埋藏的宝藏
下界堡垒：桥 / 藏宝室 / 居住区 / 疣猪兽棚

## 5. 变种（variations）分类树 —— 上游原文

命名空间格式 `类别:目标:取值`。

**Overworld**
- Village：`biome:structure:` `desert`·`plains`·`savanna`·`snowy_tundra`·`taiga`；
  `chest:structure:` `diamond`·`obsidian`
- Desert Temple：`chest:structure:` `diamond`·`egap`
- Ruined Portal：`chest:structure:` `egap`·`golden_carrot`·`looting_sword`；
  `type:structure:` `completable`·`lava`
- Shipwreck：`chest:structure:` `carrot`·`diamond`；`type:structure:` `normal`·`sideways`·`upsidedown`
- Buried Treasure：**无变种**

**Bastion**
- 通用：`biome:bastion:` `basalt_deltas`·`crimson_forest`·`nether_wastes`·`soul_sand_valley`·`warped_forest`
- Bridge：`bastion:single:` `1`·`2`；`bastion:triple:` `1`·`2`
- Treasure：**无变种**
- Housing：`bastion:single:1`；`bastion:triple:` `1`·`2`
- Stables：`bastion:good_gap:` `1`·`2`；
  `bastion:single:` `1`·`2`·`3`（双箱塔）；`bastion:small_single:` `1`·`2`·`3`（单箱塔）；
  `bastion:triple:` `1`·`2`·`3`

**Fortress**：`biome:fortress:` `basalt_deltas`·`crimson_forest`·`nether_wastes`·`soul_sand_valley`·`warped_forest`

**End**：`end_tower:caged:` `back`·`back_center`·`front`·`front_center`；`end_spawn:buried:xx`（xx 为 20–64）

## 6. ⚠️ `POST /seed` 是写接口 —— 用户决定**暂时暴露**，但必须加守卫

它能往用户的数据库里插入记录（`matchId` 唯一，重复返回 409）。

**用户的决定（2026-09-12）**：暂时暴露，理由是「以便用户在客户端内保存种子」。
我原本建议不暴露，记录一下分歧与理由，以及**为什么最后按用户的来**：
这个接口正是上游 80% 覆盖率之外那 20% 的补录入口，而补录需要真人。
拒绝它等于砍掉一个用户明确要的能力。

**但暴露写接口必须有守卫**（这几条不是可选项）：

| 守卫 | 为什么 |
|---|---|
| **必须登录且邮箱已验证** | 复用现有的登录闸门，匿名用户绝不能写 |
| **严格的入参校验** | `matchId` 必须是 ≥ 3650001 的整数；三个种子值必须是 64 位整数字符串（正则 + 范围检查），**绝不 parseInt** |
| **单独且更严的限流** | 比查询严得多（写接口被刷的后果是脏数据，不是慢） |
| **每次写入记审计** | 审计里要有**是谁**通过我们站点写进去的 —— 上游没有这个信息，只有我们知道 |
| **开关** | 一个配置项能一键关掉，出问题不必重新部署 |

⚠️ **一个我还没得到确认的语义问题**（已按"补录"设计，若理解错要改）：
`matchId` 是唯一键，而 `/seed` 返回的每一条**本来就已经在库里**，
所以对"刚查到的种子"点保存**必然 409**。
→ 因此"保存"入口我按**手动补录**来做（表单：比赛 ID + 三个种子值），
而不是结果卡片上的一个收藏按钮。**如果用户的本意是后者，那这个功能需要另做设计**
（我们自己库里存一份"收藏"，与上游无关）。

## 7. ⚠️ 已确认要排除的上游项

**`end_spawn:buried:xx` 一整条去掉** —— 用户 2026-09-12 指出**它有 bug**。
所以变种词条里不出现 `end_spawn:*`；`end_tower:caged:*` 保留。

（用户同时说"其余的两级联动详细情况等做完后再修改" ——
即：先按下面的联动做出来，具体分组再迭代。）
