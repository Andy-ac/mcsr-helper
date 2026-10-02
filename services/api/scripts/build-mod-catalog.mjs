#!/usr/bin/env node
/*
 * mod 目录的生成器外壳。
 *
 * 用法（从 services/api 目录，或经 package.json 的脚本）：
 *   node --import tsx scripts/build-mod-catalog.mjs --refresh   # 抓上游 → 覆盖快照
 *   node --import tsx scripts/build-mod-catalog.mjs --check     # 重新生成并与仓库里的字节比
 *   node --import tsx scripts/build-mod-catalog.mjs --write     # 重新生成并写入仓库
 *   node --import tsx scripts/build-mod-catalog.mjs --stats     # 打印 spec §3.1 那张表的读数
 *
 * 退出码：0 = 通过；1 = 不一致（真的漂了）；2 = 这条检查**自己没跑成**（读不懂输入）——
 *         与 `deploy/verify-file-catalog.sh` 同一套话术：**别把"没跑"读成"通过"**。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, catalogBytes } from '../src/modCatalogBuild.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = resolve(HERE, '..');
const ROOT = resolve(API, '../..');
const SNAPSHOT = join(ROOT, 'content', 'upstream');
const CATALOG = join(ROOT, 'content', 'mod-catalog.json');
const OVERRIDES = join(ROOT, 'content', 'mod-overrides.json');

const SOURCES = {
  mods: 'https://meta.mc.sr/schema-7/mods.json',
  extra: 'https://meta.mc.sr/schema-7/extra.json',
};

function fail(message, code = 2) {
  console.error('');
  console.error(`✗ ${message}`);
  console.error('');
  process.exit(code);
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function refresh() {
  mkdirSync(SNAPSHOT, { recursive: true });
  for (const [name, url] of Object.entries(SOURCES)) {
    const res = await fetch(url);
    if (!res.ok) fail(`抓 ${url} 失败：HTTP ${res.status}`, 1);
    // ⚠️ **逐字节**保存响应体：这样"上游改了什么"能直接 git diff 看出来，
    //    而不是被我们重新格式化之后混在一起。
    const body = await res.text();
    writeFileSync(join(SNAPSHOT, `${name}.json`), body);
    console.log(`  快照 ${name}.json  ${body.length} 字节  sha256=${sha256(body).slice(0, 16)}…`);
  }
}

function readSnapshot(name) {
  const file = join(SNAPSHOT, `${name}.json`);
  if (!existsSync(file)) fail(`快照不在：${file}（先跑 --refresh）`);
  return readFileSync(file, 'utf8');
}

function build() {
  if (!existsSync(OVERRIDES)) fail(`人工配置不在：${OVERRIDES}`);
  const rawMods = readSnapshot('mods');
  const rawExtra = readSnapshot('extra');
  const catalog = buildCatalog({
    modsRaw: JSON.parse(rawMods),
    extraRaw: JSON.parse(rawExtra),
    overrides: JSON.parse(readFileSync(OVERRIDES, 'utf8')),
    sha256: { mods: sha256(rawMods), extra: sha256(rawExtra) },
  });
  return catalogBytes(catalog);
}

function stats(bytes) {
  const catalog = JSON.parse(bytes);
  const hosts = new Map();
  const pairs = new Map();
  for (const release of catalog.releases) {
    const host = new URL(release.url).host;
    hosts.set(host, (hosts.get(host) ?? 0) + 1);
    for (const gv of release.targetVersions) {
      const key = `${release.modid}|${gv}`;
      pairs.set(key, [...(pairs.get(key) ?? []), release.version]);
    }
  }
  console.log(`  mods            ${catalog.mods.length}  (legal ${catalog.mods.filter((m) => m.list === 'legal').length} / extra ${catalog.mods.filter((m) => m.list === 'extra').length})`);
  console.log(`  releases        ${catalog.releases.length}`);
  console.log(`  (modid, 版本) 对 ${pairs.size}`);
  console.log(`  游戏版本        ${new Set(catalog.releases.flatMap((r) => r.targetVersions)).size}`);
  console.log(`  下载主机        ${[...hosts].sort().map(([h, n]) => `${h}=${n}`).join('  ')}`);
  console.log(`  1.16.1 的 release ${catalog.releases.filter((r) => r.targetVersions.includes('1.16.1')).length}`);
  const dupes = [...pairs].filter(([, v]) => v.length > 1);
  console.log(`  重复键          ${dupes.length === 0 ? '无' : dupes.map(([k, v]) => `${k} -> ${v.join(' | ')}`).join('；')}`);
}

const argv = process.argv.slice(2);
const want = (flag) => argv.includes(flag);

try {
  if (want('--refresh')) await refresh();
  const bytes = build();
  if (want('--stats')) stats(bytes);

  if (want('--write')) {
    writeFileSync(CATALOG, bytes);
    console.log(`  已写入 ${CATALOG}（${bytes.length} 字节）`);
    process.exit(0);
  }

  if (want('--check')) {
    if (!existsSync(CATALOG)) fail(`仓库里没有 ${CATALOG}（先跑 --write）`, 1);
    const committed = readFileSync(CATALOG, 'utf8');
    if (committed === bytes) {
      console.log('  ✓ 目录与快照 + 人工配置一致（逐字节）');
      process.exit(0);
    }
    console.error('');
    console.error('✗ 目录**漂了**：重新生成的字节与 content/mod-catalog.json 不一致。');
    console.error('  要么跑 --write 把它更新掉（并提交），要么把改动撤掉。');
    console.error('  ⚠️ 若你刚跑过 --refresh，先看 git diff content/upstream/ —— 上游真的改了什么。');
    console.error('');
    process.exit(1);
  }

  process.exit(0);
} catch (error) {
  fail(`生成器自己出错了（这一趟什么都没验）：${error.message}`);
}
