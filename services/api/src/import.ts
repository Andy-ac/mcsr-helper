/**
 * 资源库导入脚本（M1 阶段的"管理员录入"，M2 之后仍然负责策展内容）。
 *
 * 为什么先做脚本而不是后台界面：
 *   M1 的目标是**让游客能浏览**。内容从哪来是次要问题 —— 用脚本能立刻开始录，
 *   而且内容文件进版本管理，改了什么一目了然。后台录入界面放到 M2（和审核流一起做）。
 *
 * 用法：
 *   pnpm -F @mcsr/api content:import                  # 预演：只打印，不写库
 *   pnpm -F @mcsr/api content:import -- --apply      # 真正写库
 *   node dist/import.js --apply --file /path/to.json  # 服务器上（构建产物）
 *
 * ⚠️ 它只管理 `source = 'import'` 的记录。用户提交的内容（M2 起）不会被它碰到 ——
 *    见 db/migrations/002_resource_source.ts 里的说明。
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { normalizeResourceInput, ResourceSchema } from '@mcsr/shared/resources';
import { z } from 'zod';

import { closeDb, dbPath } from './db';
import {
  countBySource,
  deleteImportedNotIn,
  type ResourceInput,
  upsertResource,
} from './resources';

/** 导入文件里每条记录的形态：id 可省（省略时从 url 推导），时间戳由脚本生成。 */
const ImportEntrySchema = ResourceSchema.omit({
  createdAt: true,
  updatedAt: true,
  summary: true,
}).extend({
  id: z.string().min(1).max(64).optional(),
  summary: z.string().max(300).nullable().optional(),
});

const ImportFileSchema = z.object({
  resources: z.array(ImportEntrySchema).min(1),
});

/** 从 URL 推导一个稳定的 slug 作 id，这样重复导入不会产生新条目。 */
function idFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`
      .replace(/^www\./, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 64);
  } catch {
    return url.replace(/[^a-z0-9]+/gi, '-').slice(0, 64);
  }
}

/**
 * 路径解析：相对路径按**当前工作目录**解析。
 *
 * 之前写的是 `resolve(process.cwd(), '../../', file)` —— 那假设了"cwd 一定是
 * services/api"。本地跑没问题，服务器上（cwd 是 /srv/mcsr-helper）就会指到一个
 * 不存在的地方。把层级写死在脚本里，是"本地能跑、线上找不到文件"的常见来源。
 */
function resolveContentFile(file: string): string {
  return isAbsolute(file) ? file : resolve(process.cwd(), file);
}

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const fileIndex = argv.indexOf('--file');
  const fromFlag = fileIndex >= 0 ? argv[fileIndex + 1] : undefined;
  return { apply, file: resolveContentFile(fromFlag ?? 'content/resources.json') };
}

function main() {
  const { apply, file } = parseArgs(process.argv.slice(2));

  console.log(`[import] 内容文件: ${file}`);
  console.log(`[import] 数据库  : ${dbPath()}`);
  console.log(`[import] 模式    : ${apply ? '写入 (--apply)' : '预演（加 --apply 才会写库）'}`);
  console.log('');

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`✗ 读取失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const parsed = ImportFileSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('✗ 内容文件校验失败：');
    for (const issue of parsed.error.issues) {
      console.error(`   ${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`);
    }
    process.exit(1);
  }

  // 校验通过后再补全 id 与规范化字段，保证写库的形态和 API 返回的完全一致。
  const entries: ResourceInput[] = parsed.data.resources.map((entry, index) => {
    const id = entry.id ?? idFromUrl(entry.url);
    if (!id) {
      console.error(`✗ 第 ${index + 1} 条无法推导出 id，请显式填写 id`);
      process.exit(1);
    }
    const normalized = normalizeResourceInput({
      body: entry.body,
      summary: entry.summary ?? null,
      tags: entry.tags,
      titleEn: entry.titleEn,
    });
    return {
      id,
      kind: entry.kind,
      title: entry.title,
      titleEn: normalized.titleEn,
      url: entry.url,
      summary: normalized.summary,
      body: entry.body,
      lang: entry.lang,
      tags: normalized.tags,
      featured: entry.featured,
      status: entry.status,
    };
  });

  // 重复 id 是内容文件里最常见的错误（两条不同记录推出了同一个 slug）
  const seen = new Map<string, number>();
  for (const [i, e] of entries.entries()) {
    const prev = seen.get(e.id);
    if (prev !== undefined) {
      console.error(`✗ id 冲突: "${e.id}"（第 ${prev + 1} 条与第 ${i + 1} 条）`);
      console.error('   请在内容文件里显式给其中一条写一个不同的 id。');
      process.exit(1);
    }
    seen.set(e.id, i);
  }

  console.log(`[import] 解析到 ${entries.length} 条：`);
  for (const e of entries) {
    console.log(`   ${e.featured ? '★' : ' '} ${e.id.padEnd(38)} ${e.kind.padEnd(8)} ${e.title}`);
  }

  if (!apply) {
    console.log('\n[import] 预演结束 —— 没有写入任何东西。加 --apply 执行。');
    closeDb();
    return;
  }

  const before = countBySource();
  console.log(
    `\n[import] 写入前：本文件管理 ${before.import} 条，用户提交 ${before.user} 条（后者不会被碰）`,
  );

  const stats = { inserted: 0, updated: 0 };
  for (const entry of entries) {
    stats[upsertResource(entry, { source: 'import' })] += 1;
  }
  const removed = deleteImportedNotIn(entries.map((e) => e.id));

  if (removed.length > 0) {
    console.log(`[import] 删除 ${removed.length} 条（已从内容文件中移除）: ${removed.join(', ')}`);
  }
  const after = countBySource();
  console.log(`[import] 新增 ${stats.inserted} 条，更新 ${stats.updated} 条`);
  console.log(`[import] 写入后：本文件管理 ${after.import} 条，用户提交 ${after.user} 条`);

  closeDb();
}

main();
