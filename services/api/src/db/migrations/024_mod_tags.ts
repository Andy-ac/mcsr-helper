/**
 * 024：B1 的**人工标签层**两张表。
 *
 * | 表 | 语义 |
 * |---|---|
 * | `mod_tag_assignments` | `modid → 人工标签数组`（JSON 文本）。**有一行**就表示"管理员设过"； 值是 `[]` 表示"清空了"。 |
 * | `mod_tag_labels`      | `tag → 两种语言的显示名`（对目录里那层的**覆盖 / 新增**）。 |
 *
 * ===========================================================================
 * 一、为什么住 DB（而不是写 `content/mod-overrides.json`）
 * ===========================================================================
 * `deploy/deploy.sh` 每次部署都会把 `content/{resources,file-catalog,mod-catalog}.json`
 * 同步上去 ⇒ **服务端写那些文件会被下一次部署静默抹掉**。而"管理员可编辑的数据住 DB"
 * 在本仓有先例（`content_contributors` / `tracked_creators`）。
 * ⚠️ 于是"手写那一层"的去处是：生成器把它搬进目录产物（顶层 `manualTags`），
 *    服务端拿它当"出厂值"，DB 这一层是**覆盖**。
 *
 * ===========================================================================
 * 二、为什么 `modid` **没有**外键
 * ===========================================================================
 * mod 目录住在文件里（`content/mod-catalog.json`），**没有一张 mod 表** ⇒
 * 没有可指向的目标。这与 `content_contributors.entity_id` 那条先例同一个理由
 * （见 `018_content_contributors.ts` 的文件头）。删掉一个 mod（改目录 + 重新生成）时，
 * 这一行会变成**孤儿行** —— 它不报错，只是永远匹配不上任何 mod；T7 的收口里
 * 记一条"孤儿行不清理"的接受代价。
 *
 * ===========================================================================
 * 三、为什么两列都**不用**默认值 / 为什么 `updated_by` 可空
 * ===========================================================================
 * · `updated_at` / `zh` / `en` / `tags` 都必填：写的时候一定要给（没有"默认的空标签"这种东西）。
 * · `updated_by` 用 `ON DELETE SET NULL`：那个人注销之后**这一行要留着**
 *   （与 `content_contributors.added_by` 逐字同一条）。
 *
 * ⚠️ 纯 `CREATE TABLE` ⇒ **留在事务里**（不加 `noTransaction`：那是给需要
 *    `PRAGMA foreign_keys` 的重建表迁移用的），失败即整体回滚。
 */
export const m024ModTags = `
  CREATE TABLE mod_tag_assignments (
    modid      TEXT PRIMARY KEY,
    tags       TEXT NOT NULL,
    updated_by TEXT REFERENCES users (id) ON DELETE SET NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE mod_tag_labels (
    tag        TEXT PRIMARY KEY,
    zh         TEXT NOT NULL,
    en         TEXT NOT NULL,
    updated_by TEXT REFERENCES users (id) ON DELETE SET NULL,
    updated_at INTEGER NOT NULL
  );
`;
