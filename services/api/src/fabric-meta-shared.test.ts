import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseFabricModJson } from '@mcsr/shared/fabricMeta';

/*
 * ★★ 这一条钉的是**真实现场**（2026-10-04 实测，用户那个 1.16.1 排位实例的 mods 目录）：
 *    `sodium-2.5.0+1.16.1.jar` 与 `krypton-1.16.1-backport-0.1.3-SNAPSHOT+2021-02-20.jar`
 *    的 `fabric.mod.json` 里有一个**裸换行落在字符串字面量内部** ⇒ 严格 JSON 抛
 *    `Bad control character in string literal in JSON` ⇒ 扫描记成 `modid: null`
 *    ⇒ 界面上它们出现在"认不出"那一栏，而 id / version 写得清清楚楚。
 *
 * ⚠️★ 夹具必须是**一个真的 zip**（不是一段裸文本）：产品那条路是
 *    `readJarMeta`（`readFileSync` → `unzipSync` 取 `fabric.mod.json` → 解码 → 解析），
 *    而这一支要钉的正是"**从 zip 里取出来的那段字节**"这一形态 —— 一段手写的文本
 *    证明不了"字节从 zip 出来之后还是这样"。所以这里**自己造 zip**、再**自己解 zip**。
 *
 * ⚠️★ 为什么 fflate 是这样拿的（`createRequire` 指向 `apps/desktop/package.json`）：
 *    `readJarMeta` 在 `apps/desktop/src/file-updates.ts` 里，而那个文件 `import 'electron'`
 *    ⇒ 从 api 的测试进程里**根本 import 不动它**（本仓的规矩是纯逻辑搬进 `@mcsr/shared`，
 *    断言留在这里）。于是在"造/解 zip"这一步上，这份测试站在**产品用的那一个库**上：
 *    fflate 是 `apps/desktop` 的运行时依赖（本包没有它）⇒ 按那个包的 package.json 解析。
 *    `apps/desktop/scripts/verify-mod-folders.mjs` 用的是同一种拿法（它的文件头写着
 *    探针"能拿它来**自己造**真 zip"），`.cache/diag-recognition.mjs` 也是。
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, '../../../apps/desktop/package.json'));
const fflate = require('fflate') as {
  zipSync: (files: Record<string, Uint8Array>) => Uint8Array;
  unzipSync: (
    data: Uint8Array,
    opts: { filter: (f: { name: string }) => boolean },
  ) => Record<string, Uint8Array>;
  strToU8: (text: string) => Uint8Array;
  strFromU8: (bytes: Uint8Array) => string;
};

/** 造一个只装 `fabric.mod.json` 的 jar，并**按产品那条路**把它读回来（解出来的文本）。 */
function metaTextInJar(metaJson: string): string {
  const jar = fflate.zipSync({ 'fabric.mod.json': fflate.strToU8(metaJson) });
  const files = fflate.unzipSync(jar, { filter: (f) => f.name === 'fabric.mod.json' });
  const raw = files['fabric.mod.json'];
  assert.ok(raw, 'zip 里必须有 fabric.mod.json（夹具自己坏了的话，下面的断言都不作数）');
  return fflate.strFromU8(raw);
}

describe('fabric.mod.json 的解析（严格快路径 + 裸控制字符的重试）', () => {
  it('★★ 裸换行落在字符串内部的那一枚 jar（zip 夹具）⇒ 照旧读出 id / version', () => {
    /*
     * ⚠️ 下面这串里的 `\n` 是**真的换行字节**（在 `description` 的字符串内部）——
     *    这正是 sodium / krypton 那一枚 jar 的形状。它不是"手滑写错"：
     *    宽松解析器（JSON5）吃得下、严格 JSON 吃不下，而作者用的是前者。
     */
    const text = metaTextInJar(
      '{\n  "schemaVersion": 1,\n  "id": "sodium",\n  "version": "2.5.0+1.16.1",\n  "description": "line one\nline two"\n}\n',
    );

    // ★ 先证明夹具**真的**是严格 JSON 解不开的：否则这一条什么都没测（§5.32 的第 ④ 类）。
    assert.throws(() => JSON.parse(text), /Bad control character in string literal/);
    assert.deepEqual(parseFabricModJson(text), { id: 'sodium', version: '2.5.0+1.16.1' });
  });

  it('★ 别的裸控制字符（0x01）同样按"字符串内部"处理（没有短转义的就写 \\uXXXX）', () => {
    const text = metaTextInJar('{"id":"krypton","version":"0.1.3","description":"a\u0001b"}');
    assert.throws(() => JSON.parse(text));
    assert.deepEqual(parseFabricModJson(text), { id: 'krypton', version: '0.1.3' });
  });

  it('★ 扫描器必须认 `\\` 转义：字符串里带 `\\"` 时不许把字符串提前关掉', () => {
    /*
     * 这一段是**这一支自己的负向证明**：`so\"dium` 里的 `\"` 是转义引号。
     * 一个不认转义、见到 `"` 就切换状态的扫描器会在那里**提前关上字符串**，
     * 于是后面那个 raw 换行落在"字符串外面"、不被修，重试照样失败 ⇒ 这一条红。
     * 而且它把结论放在**返回值**上（id 是 `so"dium`，看得见），不靠内部实现自证。
     */
    const text = metaTextInJar('{"id":"so\\"dium","version":"1.0","description":"x\ny"}');
    assert.throws(() => JSON.parse(text), /Bad control character in string literal/);
    assert.deepEqual(parseFabricModJson(text), { id: 'so"dium', version: '1.0' });
  });

  it('★ 字符串**外面**的裸控制字符一个都不动 ⇒ 还是解不开，抛的仍是①那个原始错误', () => {
    // `\u0001` 落在两个成员之间（不是字符串内部）：那不是 JSON，也不该被"修好"。
    const text = '{"id":"sodium",\u0001"version":"1.0"}';
    const strictMessage = (() => {
      try {
        JSON.parse(text);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      throw new Error('夹具本身不成立：这段文本居然能被严格 JSON 解析');
    })();
    assert.throws(
      () => parseFabricModJson(text),
      (error: unknown) => error instanceof SyntaxError && error.message === strictMessage,
    );
  });

  it('★ 快路径：干净的 JSON 照样读得出（严格解析就是那条路）', () => {
    const text = metaTextInJar('{"id":"lithium","version":"1.0+backport-0.6.7+1.16.1"}');
    assert.doesNotThrow(() => JSON.parse(text));
    assert.deepEqual(parseFabricModJson(text), {
      id: 'lithium',
      version: '1.0+backport-0.6.7+1.16.1',
    });
  });

  it('★ 缺 id / version 仍然抛那句固定文案（**不猜**一个 id 出来）；坏 JSON 仍是 SyntaxError', () => {
    for (const text of ['{"id":"sodium"}', '{"version":"1.0"}', 'null', '"sodium"', '[]']) {
      assert.throws(() => parseFabricModJson(text), /fabric\.mod\.json 里没有 id \/ version/);
    }
    assert.throws(() => parseFabricModJson('{'), SyntaxError);
    // 反向：两个字段都在（类型对）就绝不抛。
    assert.deepEqual(parseFabricModJson('{"id":"a","version":"1"}'), { id: 'a', version: '1' });
  });
});
