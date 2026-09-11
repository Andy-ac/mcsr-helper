import { sql } from '../sql';

/**
 * 002 · 给资源加"来源"标记
 *
 * 为什么需要它：
 *
 *   导入脚本（content/resources.json）执行的是"让文件成为唯一真相" ——
 *   文件里没有的条目会被**删除**。这在 M1 是对的：内容全部来自文件。
 *
 *   但 M2 之后，用户提交的资源会进同一张表。如果导入脚本继续无差别地删，
 *   它会把用户提交的内容一起删掉 —— 而且是在每次部署时静默发生。
 *
 *   所以每条记录必须记住自己是"从文件导入的"还是"用户提交的"，
 *   导入脚本只管理前者。
 *
 *   `source` 默认给 'import'：现有数据（以及所有用该文件导入的数据）都属于这一类。
 *   用户提交会显式写 'user'。
 *
 * 为什么不在 001 里直接加：
 *   001 已经在本地应用过了。迁移一旦发布就应该是不可变的 —— 改它会让
 *   "本地库"和"服务器库"的结构看起来一样、实际不一样，而那类问题极难排查。
 *   加一个 002 只多几行，但把这条规矩立住了。
 */
export const m002ResourceSource = sql`
  ALTER TABLE resources ADD COLUMN source TEXT NOT NULL DEFAULT 'import'
    CHECK (source IN ('import', 'user'));

  CREATE INDEX idx_resources_source ON resources (source);
`;
