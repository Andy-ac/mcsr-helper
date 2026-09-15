/**
 * 019：实时分享（`live_shares`）。
 *
 * 用户要求：让**已登录用户**短暂地把「私人房房间号」或「一组世界种子」挂在一块
 * 公共看板上，每条自带一个 5 / 10 / 15 / 20 分钟的展示窗口，**到点自己消失**，
 * 作者随时可下架（可恢复）。
 *
 * 表的形状（一张表 + `kind` + 类型化 JSON payload）与它的代价 —— 数据库不知道
 * payload 的形状，所以写入与读出必须过同一份 zod —— 写在
 * `packages/shared/src/liveShares.ts` 与 `docs/live-shares-spec.md` §3。
 * **先去读那两处的说明**；下面只写**这张表自己**的四个决定，DDL 本身逐字照
 * spec §3.1（这样它还能与文档逐行对得上）。
 *
 * ===========================================================================
 * 一、★ room 那个部分唯一索引的谓词**不看过期**（这一节是给下一个人看的）
 * ===========================================================================
 * `idx_live_shares_room_one` 的谓词是 `kind='room' AND status='active'` ——
 * 它**只看状态，不看 `expires_at`**。所以一条 1 分钟前到点、但回收任务（每小时一次）
 * 还没跑的行，**照样占着那个名额**。
 *
 * ⇒ 发布那条路（`createShare`）的**第一步必须**把我自己所有 `active` 的 room 行
 *   置成 `replaced`，再插新行。那不是"顺手清理"，是**让索引能成立的必需步骤**。
 *   ⚠️ 谁把它改成"先查有没有、有就报错"，谁就会让"刚过期的那一小时里发不出新的一条"
 *     （spec §3.4 与 §11.1 各有一条测试钉着这个行为）。
 *   ⚠️ 而**额度计数**（seed 那 20 条）的判据相反：它**看过期**。两处不一致是刻意的，
 *      见 spec §3.3 —— 索引与限额的口径不同，而它们**必须**不同。
 *
 * ===========================================================================
 * 二、这个迁移**不重建任何表**
 * ===========================================================================
 * 全部是 `CREATE TABLE` + `CREATE INDEX` ⇒ **不需要** `PRAGMA foreign_keys`
 * （那个 PRAGMA 在事务里无效，见 `migrate.ts` 里 007/008/012/016 的注释），
 * 因此它**留在事务里**：失败即整条回滚，不会留下半成品。
 * 别看到"加一张表"就条件反射地给它加 `noTransaction` —— 那会白白丢掉回滚。
 *
 * ===========================================================================
 * 三、两条 CHECK 是刻意加的（把不可能的状态变成插不进去的行）
 * ===========================================================================
 *   · `expires_at > created_at`：展示窗口永远是正数。没有它，一条"还没发就已经过期"
 *     的行可以被写进去，而它在看板上表现为"发了但谁也看不到"。
 *   · `(status = 'hidden') = (hidden_at IS NOT NULL)`：**下架时间与下架状态必须
 *     同时出现或同时缺席**。没有这一条，"已下架但不知道什么时候下架的"和
 *     "没下架却带着下架时间"两种行都能写进去，而它们在审计里看起来都正常。
 *   （另外两个 `CHECK (... IN (...))` 是 kind 与 status 的**值域**：它们让数据层
 *     可以放心把这两列标成 shared 里那两个联合类型。）
 *
 * ===========================================================================
 * 四、这一版**故意不做**的事
 * ===========================================================================
 *   · **不把 seed 的 20 条额度写进 schema**（没有 `slot` 列、没有 `CHECK(slot < 20)`）：
 *     能强制，但以后把 20 改成 30 就要重建表（SQLite 改 CHECK 只能重建）——
 *     而"以后加东西不用迁移"正是选 JSON payload 的全部理由。
 *     ⇒ 语义不变量进库（一人一条 room），**额度进数据层**（写入事务里数一遍）。
 *   · **不给 payload 建索引、不做全文搜索**：内容是 20 分钟一换的，搜索一个正在
 *     消失的东西没有意义。看板永远按 `kind + expires_at` 取，索引见下面三个。
 */
export const m019LiveShares = `
  CREATE TABLE live_shares (
    id          TEXT    PRIMARY KEY,
    user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT    NOT NULL CHECK (kind IN ('room','seed')),
    payload     TEXT    NOT NULL,                    -- JSON，形状由 kind 决定
    note        TEXT    NOT NULL DEFAULT '',         -- 选填 ⇒ 空串（不是 NULL）
    status      TEXT    NOT NULL CHECK (status IN ('active','hidden','replaced')),
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    hidden_at   INTEGER,                             -- 只有 hidden 时有值
    CHECK (expires_at > created_at),
    CHECK ((status = 'hidden') = (hidden_at IS NOT NULL))
  );

  -- ★ 语义不变量：一个人同时只能有一条「私人房」在展示
  CREATE UNIQUE INDEX idx_live_shares_room_one
    ON live_shares(user_id) WHERE kind = 'room' AND status = 'active';

  -- 看板查询（按 kind + 有效期）
  CREATE INDEX idx_live_shares_board  ON live_shares(kind, expires_at);
  -- 「我的那些」查询 + 额度计数
  CREATE INDEX idx_live_shares_user   ON live_shares(user_id, kind, status);
  -- 回收任务
  CREATE INDEX idx_live_shares_sweep  ON live_shares(expires_at);
`;
