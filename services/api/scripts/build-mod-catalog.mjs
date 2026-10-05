#!/usr/bin/env node
/*
 * mod 目录的生成器外壳。
 *
 * 用法（从 services/api 目录，或经 package.json 的脚本）：
 *   node --import tsx scripts/build-mod-catalog.mjs --refresh   # 抓上游 → 覆盖快照
 *   node --import tsx scripts/build-mod-catalog.mjs --check     # 重新生成并与仓库里的字节比
 *   node --import tsx scripts/build-mod-catalog.mjs --write     # 重新生成并写入仓库
 *   node --import tsx scripts/build-mod-catalog.mjs --stats     # 打印 spec §3.1 那张表的读数
 *   （`--refresh` / `--stats` 可与其他模式组合；`--write` 与 `--check` **互斥**。）
 *
 * ⚠️★ `--refresh` 抓的是**三样**上游，落在 `content/upstream/` 下：
 *   `mods.json` / `extra.json`（mc.sr 那两份，见 SOURCES）与
 *   `modrinth-versions-<project>.json`（Modrinth 的版本列表，project 清单来自
 *   `content/mod-overrides.json` 的 `modrinthLatest` —— 见 MODRINTH_API 上面那段）。
 *
 * 退出码：0 = 通过；1 = 不一致（真的漂了）；2 = 这条检查**自己没跑成**（读不懂输入、参数不对）——
 *         与 `deploy/verify-file-catalog.sh` 同一套话术：**别把"没跑"读成"通过"**。
 *
 * ★ 参数契约（评审 Important 2）：这个文件**不在任何门禁的覆盖里**（biome 的 include 只列了
 *   ts / tsx / json，`.mjs` 一个都不查；`services/api/tsconfig.json` 的 include 也不含
 *   `scripts/`），所以它自己的契约只能由它自己执行 —— 否则"拼错一个旗标"就会静默地
 *   "什么都没做，退出 0"：
 *   · 不认识的旗标 ⇒ 2；
 *   · 一个模式旗标都没给 ⇒ 2（至少要 `--refresh` / `--write` / `--check` / `--stats` 之一）；
 *   · `--write` 与 `--check` 同时给 ⇒ 2（一个要写产物、一个要拿产物比字节；同时给只会得到一个
 *     **恒真**的"检查"）；
 *   · 给了 `--check` ⇒ **它的裁决就是进程退出码**（0/1），`--stats` 只打读数、不改退出码。
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

/*
 * ★★ 第三样上游：**Modrinth 的版本列表**（2026-10-04 用户钉的判据）。
 *
 * 抓哪些 project：`content/mod-overrides.json` 的 `modrinthLatest`（键是 modid、
 * 值是 `{ project, reason }`）—— 也就是"这个 mod 的 release 只取 Modrinth 最新那一条"。
 * 存哪儿：`content/upstream/modrinth-versions-<project>.json`，**逐字节**保存响应体
 * （与那两份 mc.sr 快照同一条纪律：`git diff content/upstream/` 要能直接看出上游改了什么）。
 * 抓不到就**失败退出**（不是"跳过这一条"）：快照宁可保持上一次成功的读数，
 * 也不该让"这次没抓到"变成"目录里那条 release 悄悄没了"。
 */
const MODRINTH_API = 'https://api.modrinth.com/v2/project';
const MODRINTH_UA = 'mcsr-helper-catalog-refresh/1.0 (+https://mcsrhelper.com)';

const MODES = ['--refresh', '--write', '--check', '--stats'];

function fail(message, code = 2) {
  console.error('');
  console.error(`✗ ${message}`);
  console.error('');
  process.exit(code);
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/*
 * ⚠️★ 抓上游**只读进内存**，先一个字节都不落盘（评审 M1）：两份都抓成了、而且 `build()`
 *    也成功了，才去写快照（见下面的 `writeSnapshots`）。否则"第二份抓失败"或"build 失败"
 *    这两种情况下，第一份快照已经被改掉了 —— 工作树脏了，只能靠 git 找回。
 */
async function fetchSources() {
  const texts = {};
  for (const [name, url] of Object.entries(SOURCES)) {
    const res = await fetch(url);
    if (!res.ok) fail(`抓 ${url} 失败：HTTP ${res.status}`, 1);
    const body = await res.text();
    texts[name] = body;
    console.log(`  抓到 ${name}.json  ${body.length} 字节  sha256=${sha256(body).slice(0, 16)}…`);
  }
  return texts;
}

function writeSnapshots(texts) {
  mkdirSync(SNAPSHOT, { recursive: true });
  // ⚠️ **逐字节**保存响应体：这样"上游改了什么"能直接 git diff 看出来，
  //    而不是被我们重新格式化之后混在一起。
  // ⚠️ 只写 `SOURCES` 里那几个键：`texts` 现在还有一个 `modrinth`（它是按 project 分的另一组），
  //    照 `Object.entries(texts)` 写会多出一个 `modrinth.json`（内容是对象，不是响应体）。
  for (const name of Object.keys(SOURCES)) {
    const body = texts[name];
    writeFileSync(join(SNAPSHOT, `${name}.json`), body);
    console.log(
      `  快照 ${name}.json 已更新（${body.length} 字节  sha256=${sha256(body).slice(0, 16)}…）`,
    );
  }
}

function readSnapshot(name) {
  const file = join(SNAPSHOT, `${name}.json`);
  if (!existsSync(file)) fail(`快照不在：${file}（先跑 --refresh）`);
  return readFileSync(file, 'utf8');
}

/** Modrinth 那些 project —— 来自人工配置（`modrinthLatest`），排序后返回（同一份输入同一份顺序）。 */
function modrinthProjects() {
  if (!existsSync(OVERRIDES)) fail(`人工配置不在：${OVERRIDES}`);
  const overrides = JSON.parse(readFileSync(OVERRIDES, 'utf8'));
  const projects = Object.values(overrides.modrinthLatest ?? {}).map((entry) => entry.project);
  return [...new Set(projects)].sort();
}

const modrinthSnapshotName = (project) => `modrinth-versions-${project}.json`;

/** 每个 project 抓一次 `/version`（**只读进内存**，落盘在 build 成功之后 —— 见上面 M1 那段）。 */
async function fetchModrinth(projects) {
  const texts = {};
  for (const project of projects) {
    const url = `${MODRINTH_API}/${encodeURIComponent(project)}/version`;
    const res = await fetch(url, { headers: { 'user-agent': MODRINTH_UA } });
    if (!res.ok) fail(`抓 ${url} 失败：HTTP ${res.status}`, 1);
    const body = await res.text();
    texts[project] = body;
    console.log(
      `  抓到 modrinth ${project}  ${body.length} 字节  sha256=${sha256(body).slice(0, 16)}…`,
    );
  }
  return texts;
}

function writeModrinthSnapshots(texts) {
  mkdirSync(SNAPSHOT, { recursive: true });
  for (const [project, body] of Object.entries(texts)) {
    writeFileSync(join(SNAPSHOT, modrinthSnapshotName(project)), body);
    console.log(
      `  快照 ${modrinthSnapshotName(project)} 已更新（${body.length} 字节  sha256=${sha256(body).slice(0, 16)}…）`,
    );
  }
}

function readModrinthSnapshot(project) {
  const file = join(SNAPSHOT, modrinthSnapshotName(project));
  if (!existsSync(file)) fail(`快照不在：${file}（先跑 --refresh）`);
  return readFileSync(file, 'utf8');
}

function build(texts) {
  if (!existsSync(OVERRIDES)) fail(`人工配置不在：${OVERRIDES}`);
  const catalog = buildCatalog({
    modsRaw: JSON.parse(texts.mods),
    extraRaw: JSON.parse(texts.extra),
    overrides: JSON.parse(readFileSync(OVERRIDES, 'utf8')),
    sha256: { mods: sha256(texts.mods), extra: sha256(texts.extra) },
    modrinthVersionsRaw: Object.fromEntries(
      Object.entries(texts.modrinth).map(([project, body]) => [project, JSON.parse(body)]),
    ),
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

const unknown = argv.filter((flag) => !MODES.includes(flag));
if (unknown.length > 0) {
  fail(`不认识的参数：${unknown.join(' ')}（只认 ${MODES.join(' / ')}）`);
}
if (!MODES.some(want)) {
  fail(`一个模式都没给：至少要 ${MODES.join(' / ')} 之一（这条防的是"什么都没跑，却退出 0"）`);
}
if (want('--write') && want('--check')) {
  fail('--write 与 --check 互斥：一个要把产物写掉、一个要拿产物比字节，同时给只会得到一个恒真的检查');
}

try {
  const projects = modrinthProjects();
  const fetched = want('--refresh')
    ? { ...(await fetchSources()), modrinth: await fetchModrinth(projects) }
    : null;
  const texts =
    fetched ??
    {
      mods: readSnapshot('mods'),
      extra: readSnapshot('extra'),
      modrinth: Object.fromEntries(projects.map((p) => [p, readModrinthSnapshot(p)])),
    };
  // ★ 先把字节算出来（build 会抛就什么都不写），**成功了才落盘快照** —— 见 fetchSources 上面那段。
  const bytes = build(texts);
  if (fetched !== null) {
    writeSnapshots(fetched);
    writeModrinthSnapshots(fetched.modrinth);
  }
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
