import { sql } from '../sql';

/**
 * 003 · 资源卡片需要的两个字段
 *
 * 界面改成卡片式之后，卡片要展示图片和"官方"标记。
 *
 *   image_url —— 卡片配图。**允许为空**：为空时前端会退回到该站点的
 *                <origin>/favicon.ico，再失败就渲染一个首字母方块。
 *                这样 9 条现有内容不需要任何改动就立刻有图，
 *                而想指定正式配图的条目随时可以填。
 *
 *   official  —— "官方"标记（官方站点 / 官方工具）。和 featured（精选）
 *                是两个独立的维度：一个条目可以既不是精选也不是官方，
 *                也可以是官方但不精选。所以用两个布尔而不是一个枚举。
 *
 * 注意仍然是 INTEGER 0/1 —— SQLite 没有 boolean。
 */
export const m003ResourceCardFields = sql`
  ALTER TABLE resources ADD COLUMN image_url TEXT;
  ALTER TABLE resources ADD COLUMN official INTEGER NOT NULL DEFAULT 0 CHECK (official IN (0, 1));

  -- 子 tab 会按 kind + official 组合筛选，且排序仍是 featured 优先
  CREATE INDEX idx_resources_official ON resources (official, status);
`;
