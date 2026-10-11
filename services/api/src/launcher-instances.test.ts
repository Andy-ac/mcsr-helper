import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyOverride,
  instanceKeyOf,
  type LauncherFs,
  listInstances,
  parseInstanceMeta,
} from '@mcsr/shared/launcherInstances';

/** 只读的假文件系统：给一组"存在的目录/文件"与"目录内容"，其余一律不存在。 */
function fakeFs(
  dirs: Record<string, readonly string[]>,
  files: Record<string, string> = {},
): LauncherFs {
  return {
    listDir: (dir) => dirs[dir] ?? [],
    exists: (p) => p in dirs || p in files,
    readFile: (p) => files[p] ?? null,
  };
}

describe('★ D1 纯规则：启动器实例枚举与 mods/saves 解析', () => {
  it('① MultiMC：枚举 instances\\*，mods/saves 落在实例内的 .minecraft 下', () => {
    const fs = fakeFs({
      'D:\\MultiMC\\instances': ['1.16.1 - Ranked#1', '1.12.2'],
      'D:\\MultiMC\\instances\\1.16.1 - Ranked#1\\.minecraft': [],
      'D:\\MultiMC\\instances\\1.12.2\\.minecraft': [],
    });
    const list = listInstances(fs, 'multimc', 'D:\\MultiMC');
    assert.deepEqual(list.map((i) => i.name).sort(), ['1.12.2', '1.16.1 - Ranked#1']);
    const one = list.find((i) => i.name === '1.16.1 - Ranked#1')!;
    assert.equal(one.modsDir, 'D:\\MultiMC\\instances\\1.16.1 - Ranked#1\\.minecraft\\mods');
    assert.equal(one.savesDir, 'D:\\MultiMC\\instances\\1.16.1 - Ranked#1\\.minecraft\\saves');
    assert.equal(one.needsConfirm, false, 'MultiMC 天然隔离 ⇒ 不需要"待确认"');
    assert.equal(
      one.key,
      'multimc:instances/1.16.1 - Ranked#1',
      'key 必须是"类型 + 相对根的路径"（跨平台用 /）',
    );
  });

  it('② PCL2：有 versions\\<名>\\mods ⇒ 隔离；否则共享 .minecraft\\mods', () => {
    const fs = fakeFs({
      'D:\\PCL2\\.minecraft\\versions': ['1.16.1-Fabric 0.17.3', '1.20.1-Fabric 0.16.13'],
      // 只有第一个版本自己有 mods（= 版本隔离），第二个没有
      'D:\\PCL2\\.minecraft\\versions\\1.16.1-Fabric 0.17.3\\mods': [],
      'D:\\PCL2\\.minecraft\\mods': [],
    });
    const list = listInstances(fs, 'pcl2', 'D:\\PCL2');
    const iso = list.find((i) => i.name === '1.16.1-Fabric 0.17.3')!;
    const shared = list.find((i) => i.name === '1.20.1-Fabric 0.16.13')!;
    assert.equal(iso.modsDir, 'D:\\PCL2\\.minecraft\\versions\\1.16.1-Fabric 0.17.3\\mods');
    assert.equal(iso.needsConfirm, false);
    assert.equal(shared.modsDir, 'D:\\PCL2\\.minecraft\\mods', '没有版本自己的 mods ⇒ 用共享那份');
    assert.equal(shared.savesDir, 'D:\\PCL2\\.minecraft\\saves');
  });

  it('③ PCL2：两处都不存在 ⇒ 按隔离算并标"待确认"（不静默按共享）', () => {
    const fs = fakeFs({ 'D:\\PCL2\\.minecraft\\versions': ['1.16.1-Fabric 0.18.4'] });
    const only = listInstances(fs, 'pcl2', 'D:\\PCL2')[0]!;
    assert.equal(only.modsDir, 'D:\\PCL2\\.minecraft\\versions\\1.16.1-Fabric 0.18.4\\mods');
    assert.equal(only.needsConfirm, true);
  });

  it('④ 官方：一律共享（<根>\\mods），instancePath 是 versions\\<名>', () => {
    const fs = fakeFs({
      '%APPDATA%\\.minecraft\\versions': ['1.16.1'],
      '%APPDATA%\\.minecraft\\mods': [],
    });
    const one = listInstances(fs, 'official', '%APPDATA%\\.minecraft')[0]!;
    assert.equal(one.instancePath, '%APPDATA%\\.minecraft\\versions\\1.16.1');
    assert.equal(one.modsDir, '%APPDATA%\\.minecraft\\mods');
    assert.equal(one.needsConfirm, false, '官方从来不隔离 ⇒ 共享是确定事实，不是猜');
  });

  it('⑤ 根路径不存在 ⇒ 空列表（不抛；界面那一块自己报错）', () => {
    assert.deepEqual(listInstances(fakeFs({}), 'multimc', 'Z:\\nope'), []);
  });

  /*
   * ★★ ⑥–⑪ 是 **T1 评审**（Needs fixes）逼出来的：它实测"删掉 `resolveDirs` 里那两个
   *    `|| fs.exists(*Saves)` 仍然 5 pass"✗ ⇒ 那半条件**没有任何判据**；
   *    以及"把 `isPerInstance` 砍到只剩 multimc 仍 5 pass"✗ ⇒ prism / hmcl / mcsr 三个分支零覆盖。
   *    ⇒ 下面每一条都各自压住一处（拔掉对应的实现就会红 ✓）。
   */
  it('⑥ ★ saves-only 仍是隔离（隔离是**整目录**级别的；这半条件此前无判据）', () => {
    const fs = fakeFs({
      'D:\\PCL2\\.minecraft\\versions': ['1.16.1-Fabric 0.19.0'],
      'D:\\PCL2\\.minecraft\\versions\\1.16.1-Fabric 0.19.0\\saves': [],
    });
    const one = listInstances(fs, 'pcl2', 'D:\\PCL2')[0]!;
    assert.equal(
      one.modsDir,
      'D:\\PCL2\\.minecraft\\versions\\1.16.1-Fabric 0.19.0\\mods',
      'saves 在 ⇒ 隔离开着 ⇒ 目标就是实例自己那份 mods（哪怕它还没被建出来）',
    );
    assert.equal(one.needsConfirm, false, '有证据 ⇒ 不是"待确认"');
  });

  it('⑦ Prism：与 MultiMC 同形（instances\\* + 实例内 .minecraft）', () => {
    const fs = fakeFs({
      'E:\\PrismLauncher\\instances': ['1.16.1'],
      'E:\\PrismLauncher\\instances\\1.16.1\\.minecraft': [],
    });
    const one = listInstances(fs, 'prism', 'E:\\PrismLauncher')[0]!;
    assert.equal(one.modsDir, 'E:\\PrismLauncher\\instances\\1.16.1\\.minecraft\\mods');
    assert.equal(one.key, 'prism:instances/1.16.1');
    assert.equal(one.needsConfirm, false);
  });

  it('⑧ HMCL：versions\\*，隔离与共享各一种（与 PCL2 同规则）', () => {
    const fs = fakeFs({
      'D:\\HMCL\\.minecraft\\versions': ['iso', 'shared'],
      'D:\\HMCL\\.minecraft\\versions\\iso\\mods': [],
      'D:\\HMCL\\.minecraft\\mods': [],
    });
    const list = listInstances(fs, 'hmcl', 'D:\\HMCL');
    assert.equal(
      list.find((i) => i.name === 'iso')!.modsDir,
      'D:\\HMCL\\.minecraft\\versions\\iso\\mods',
    );
    assert.equal(list.find((i) => i.name === 'shared')!.modsDir, 'D:\\HMCL\\.minecraft\\mods');
  });

  it('⑨ MCSR Launcher：按 MultiMC 系枚举（布局**已核实**同形，spec §13.1；元数据是 `instance.json`）', () => {
    /* ⚠️★ 标题在 T12 修复轮改准：原来写"真实布局**未核实**，spec §13" —— 而 spec §13.1
       2026-10-11 已经**源码实证**过了（实例形状与我们猜的一致 ⇒ 这一条的断言一字没变、
       只是措辞过期）。元数据那一格的真值见 ㉖。 */
    const fs = fakeFs({
      'D:\\MCSRLauncher\\instances': ['1.16.1'],
      'D:\\MCSRLauncher\\instances\\1.16.1\\.minecraft': [],
    });
    const one = listInstances(fs, 'mcsr', 'D:\\MCSRLauncher')[0]!;
    assert.equal(one.modsDir, 'D:\\MCSRLauncher\\instances\\1.16.1\\.minecraft\\mods');
    assert.equal(one.key, 'mcsr:instances/1.16.1');
  });

  it('⑩ 根路径尾部分隔符要归一化（`D:\\PCL2\\` 与 `D:\\PCL2` 同结果）', () => {
    const dirs = {
      'D:\\PCL2\\.minecraft\\versions': ['v1'],
      'D:\\PCL2\\.minecraft\\mods': [],
    };
    const a = listInstances(fakeFs(dirs), 'pcl2', 'D:\\PCL2')[0]!;
    const b = listInstances(fakeFs(dirs), 'pcl2', 'D:\\PCL2\\')[0]!;
    assert.deepEqual(b, a, '尾部多一个 \\ 不该改变任何一格（含 key 与 modsDir）');
  });

  it('⑪ `instanceKeyOf` 按**分隔符边界**裁根（兄弟前缀根不许裁错）', () => {
    assert.equal(
      instanceKeyOf('multimc', 'D:\\MultiMC', 'D:\\MultiMC\\instances\\x'),
      'multimc:instances/x',
    );
    assert.equal(
      instanceKeyOf('multimc', 'D:\\MultiMC', 'D:\\MultiMC2\\instances\\x'),
      'multimc:D:/MultiMC2/instances/x',
      'D:\\MultiMC2 不在 D:\\MultiMC 里 ⇒ 不裁（原来的 startsWith 会裁成 2/instances/x ✗）',
    );
  });

  /*
   * ★★ ⑫–⑱ 是 **T2：实例元数据（游戏版本 + loader）与"路径覆盖优先"**（spec A11/A12/A13）。
   *    ⚠️ 计划 Task 2 的 Step 1 把这三条编成 ⑥⑦⑧ —— 那个号段**已经被 T1 的评审占用**了
   *    （现在的 ⑥–⑪ 就是那一批）⇒ 这里接着 ⑪ 往下编，内容逐字是计划那三条 + 补上
   *    它在实现里写了却**没有判据**的那几个分支（⑮–⑱）。
   *    判据纪律同 ⑥–⑪：每条都各自压住一处，拔掉对应的实现就会红 ✓。
   */
  it('⑫ MultiMC：从 mmc-pack.json 读 MC 版本与 loader（`listInstances` 自己也填那两格）', () => {
    const pack = JSON.stringify({
      components: [
        { uid: 'net.minecraft', version: '1.16.1' },
        { uid: 'net.fabricmc.fabric-loader', version: '0.17.3' },
      ],
    });
    const fs = fakeFs(
      {
        'D:\\MultiMC\\instances': ['1.16.1 - Ranked#1'],
        'D:\\MultiMC\\instances\\1.16.1 - Ranked#1\\.minecraft': [],
      },
      { 'D:\\MultiMC\\instances\\1.16.1 - Ranked#1\\mmc-pack.json': pack },
    );
    const list = listInstances(fs, 'multimc', 'D:\\MultiMC');
    const meta = parseInstanceMeta(fs, list[0]!);
    assert.equal(meta.gameVersion, '1.16.1');
    assert.equal(meta.loader, 'fabric 0.17.3');
    assert.equal(
      list[0]!.gameVersion,
      '1.16.1',
      '枚举出来的那一格就得是填好的（不能只留给调用方自己再调一次）',
    );
    assert.equal(list[0]!.loader, 'fabric 0.17.3');
  });

  it('⑬ 元数据读不出来 ⇒ 两格都 null（**不猜**）', () => {
    const fs = fakeFs({
      'D:\\MultiMC\\instances': ['x'],
      'D:\\MultiMC\\instances\\x\\.minecraft': [],
    });
    const one = listInstances(fs, 'multimc', 'D:\\MultiMC')[0]!;
    assert.deepEqual(parseInstanceMeta(fs, one), { gameVersion: null, loader: null });
    assert.equal(one.gameVersion, null);
    assert.equal(one.loader, null);
  });

  it('⑭ 手改的路径**优先于**探测结果（A12）', () => {
    const fs = fakeFs({
      'D:\\MultiMC\\instances': ['x'],
      'D:\\MultiMC\\instances\\x\\.minecraft': [],
    });
    const one = listInstances(fs, 'multimc', 'D:\\MultiMC')[0]!;
    const over = applyOverride(one, { modsDir: 'E:\\my\\mods' });
    assert.equal(over.modsDir, 'E:\\my\\mods');
    assert.equal(over.savesDir, one.savesDir, '只覆盖给出来的那一格');
    assert.equal(over.needsConfirm, false, '手改过的实例不再需要确认');
  });

  it('⑮ Prism / MCSR 也读 mmc-pack.json（forge 记法；没有 loader 组件 ⇒ 留 null 不猜）', () => {
    /* ⚠️ mcsr 这一半是**兜底**那条路：它自己的真值是 `<实例>\instance.json`（见 ㉖），
       只有那份读不到（或什么也没给出）时才退到 `mmc-pack.json` —— 从 Prism/MultiMC 整合包
       导入来的实例就是这种形状。 */
    const forgePack = JSON.stringify({
      components: [
        { uid: 'net.minecraft', version: '1.12.2' },
        { uid: 'net.minecraftforge', version: '14.23.5.2860' },
      ],
    });
    const barePack = JSON.stringify({ components: [{ uid: 'net.minecraft', version: '1.16.1' }] });
    const fs = fakeFs(
      {
        'E:\\PrismLauncher\\instances': ['forge'],
        'E:\\PrismLauncher\\instances\\forge\\.minecraft': [],
        'D:\\MCSRLauncher\\instances': ['bare'],
        'D:\\MCSRLauncher\\instances\\bare\\.minecraft': [],
      },
      {
        'E:\\PrismLauncher\\instances\\forge\\mmc-pack.json': forgePack,
        'D:\\MCSRLauncher\\instances\\bare\\mmc-pack.json': barePack,
      },
    );
    const prism = listInstances(fs, 'prism', 'E:\\PrismLauncher')[0]!;
    assert.equal(prism.gameVersion, '1.12.2');
    assert.equal(prism.loader, 'forge 14.23.5.2860');
    const mcsr = listInstances(fs, 'mcsr', 'D:\\MCSRLauncher')[0]!;
    assert.equal(
      mcsr.gameVersion,
      '1.16.1',
      'mcsr 没有 `instance.json` ⇒ 退回 `mmc-pack.json`（兜底）',
    );
    assert.equal(mcsr.loader, null, '只有 net.minecraft ⇒ loader 留空（不猜 fabric / forge）');
  });

  it('⑯ PCL2：版本 json 的 `inheritsFrom` 是版本那一格；没有 `libraries` 线索 ⇒ loader 留 null', () => {
    const name = '1.16.1-Fabric 0.17.3';
    const fs = fakeFs(
      { 'D:\\PCL2\\.minecraft\\versions': [name] },
      {
        [`D:\\PCL2\\.minecraft\\versions\\${name}\\${name}.json`]: JSON.stringify({
          id: name,
          inheritsFrom: '1.16.1',
        }),
      },
    );
    const one = listInstances(fs, 'pcl2', 'D:\\PCL2')[0]!;
    assert.equal(one.gameVersion, '1.16.1', '`inheritsFrom` 比 `id` 准（id 里带着 loader 串）');
    assert.equal(
      one.loader,
      null,
      '这份夹具的版本 json **没有 `libraries`**、共享 `libraries\\` 也不存在 ⇒ 留空（不猜）',
    );
    assert.deepEqual(
      parseInstanceMeta(fs, one),
      { gameVersion: '1.16.1', loader: null },
      '单独调它必须与枚举时填的那两格一致（**只读实例自己那份** ⇒ 兜底不在这里）',
    );
  });

  it('⑰ 官方：版本从 `versions\\<名>\\<名>.json` 读；JSON 坏 ⇒ 两格 null（与缺文件同结果）', () => {
    const root = '%APPDATA%\\.minecraft';
    const fs = fakeFs(
      { [`${root}\\versions`]: ['1.16.1', 'broken'] },
      {
        [`${root}\\versions\\1.16.1\\1.16.1.json`]: JSON.stringify({ id: '1.16.1' }),
        [`${root}\\versions\\broken\\broken.json`]: '{ 这不是 JSON',
      },
    );
    const list = listInstances(fs, 'official', root);
    const ok = list.find((i) => i.name === '1.16.1')!;
    assert.equal(ok.gameVersion, '1.16.1', '没有 inheritsFrom ⇒ 用 id');
    assert.equal(ok.loader, null, '这份夹具既没有 `libraries` 也没有共享 `libraries\\` ⇒ 留 null');
    const broken = list.find((i) => i.name === 'broken')!;
    assert.deepEqual(
      parseInstanceMeta(fs, broken),
      { gameVersion: null, loader: null },
      '坏文件不许让整块抛出去，也不许猜一个值',
    );
  });

  it('⑱ `applyOverride`：没给 / 空覆盖 ⇒ 逐字不动（含 needsConfirm）；只给一格 ⇒ 另一格不动', () => {
    const fs = fakeFs({ 'D:\\PCL2\\.minecraft\\versions': ['1.16.1'] });
    const one = listInstances(fs, 'pcl2', 'D:\\PCL2')[0]!;
    assert.equal(one.needsConfirm, true, '夹具前提：实例自己那份与共享那份都不存在 ⇒ 待确认');
    assert.deepEqual(applyOverride(one, undefined), one, '没给覆盖 ⇒ 一格都不许动');
    assert.deepEqual(
      applyOverride(one, {}),
      one,
      '空覆盖 ⇒ 逐字不动（needsConfirm 不许被顺手清掉）',
    );
    const savesOnly = applyOverride(one, { savesDir: 'E:\\my\\saves' });
    assert.equal(savesOnly.modsDir, one.modsDir);
    assert.equal(savesOnly.savesDir, 'E:\\my\\saves');
    assert.equal(savesOnly.needsConfirm, false, '手改过 ⇒ 不再待确认');
    assert.equal(one.needsConfirm, true, '`applyOverride` 是纯的：原对象不许被改');
  });

  it('⑲ ★ 真机形状：PCL2 的版本 json **没有** `inheritsFrom`，版本在 `clientVersion` 上', () => {
    /* 证据（2026-10-11 本机实测 `D:\PCL2\.minecraft\versions`）：那 6 份 `<名>.json`
       **全部**带 `clientVersion`（= `1.16.1` / `1.20.1` …）、**0 份**带 `inheritsFrom`，
       而 `id` 是 `1.16.1-Fabric 0.17.3` 这种带 loader 串的 ⇒ 少了 `clientVersion` 这一格，
       版本那格就会变成 `id`（**错的**值，比留空更坏）。 */
    const name = '1.16.1-Fabric 0.17.3';
    const fs = fakeFs(
      { 'D:\\PCL2\\.minecraft\\versions': [name] },
      {
        [`D:\\PCL2\\.minecraft\\versions\\${name}\\${name}.json`]: JSON.stringify({
          id: name,
          clientVersion: '1.16.1',
        }),
      },
    );
    const one = listInstances(fs, 'pcl2', 'D:\\PCL2')[0]!;
    assert.equal(one.gameVersion, '1.16.1', '`clientVersion` 必须压过 `id`');
    assert.equal(one.loader, null, '这份夹具里没有 `libraries` 线索 ⇒ 留 null（不猜）');
  });

  /*
   * ★★ ⑳–㉖ 是 **T12：实例 loader 的真值**（spec A7 / A11 / A12）。
   *    背景：T2 的实现者真机核实发现 PCL2 / HMCL / 官方的版本 json **都没有 `inheritsFrom`**
   *    ⇒ loader 那一家会整列空白；T2 的评审又实测出"两条顺序没有判据"（刀 I / 刀 K）。
   *    判据纪律同 ⑥–⑲：每条都各自压住一处，拔掉对应的实现就会红 ✓。
   */
  it('⑳ ★ 真机形状：PCL2 的 loader 在**实例自己那份版本 json 的 `libraries`** 里', () => {
    /* 证据（2026-10-11 本机实测 `D:\PCL2\.minecraft\versions`）：6 份 `<名>.json` 全部带
       `clientVersion`、**0 份**带 `inheritsFrom`，而**每一份**都带 `libraries` 且里面有一条
       `net.fabricmc:fabric-loader:<版本>`（名字里的串与它对得上）。 */
    const name = '1.16.1-Fabric 0.17.3';
    const fs = fakeFs(
      { 'D:\\PCL2\\.minecraft\\versions': [name] },
      {
        [`D:\\PCL2\\.minecraft\\versions\\${name}\\${name}.json`]: JSON.stringify({
          id: name,
          clientVersion: '1.16.1',
          libraries: [{ name: 'net.fabricmc:fabric-loader:0.17.3' }],
        }),
      },
    );
    const one = listInstances(fs, 'pcl2', 'D:\\PCL2')[0]!;
    assert.equal(one.gameVersion, '1.16.1');
    assert.equal(
      one.loader,
      'fabric 0.17.3',
      'loader 来自这一份 json 自己的 libraries（零新增 I/O）',
    );
  });

  it('㉑ 四处都没有 loader 线索 ⇒ `null`（**不猜**成 vanilla）', () => {
    const fs = fakeFs({ 'D:\\PCL2\\.minecraft\\versions': ['v1'] });
    assert.equal(listInstances(fs, 'pcl2', 'D:\\PCL2')[0]!.loader, null);
  });

  it('㉒ ★ 刀 I：`clientVersion` 必须压过 `inheritsFrom`（两格都在、且**值不同**时才有判据）', () => {
    const name = 'v1';
    const fs = fakeFs(
      { 'D:\\PCL2\\.minecraft\\versions': [name] },
      {
        [`D:\\PCL2\\.minecraft\\versions\\${name}\\${name}.json`]: JSON.stringify({
          id: 'v1',
          clientVersion: '1.16.1',
          inheritsFrom: '1.16.1-Forge',
        }),
      },
    );
    assert.equal(
      listInstances(fs, 'pcl2', 'D:\\PCL2')[0]!.gameVersion,
      '1.16.1',
      '对调那两格的顺序 ⇒ 这一条必须红（T2 评审的刀 I 全绿，就是缺这条判据）',
    );
  });

  it('㉓ ★ 刀 K：两样都在时，**以 `libraries` 数组里先出现的那条为准**（不额外偏袒谁）', () => {
    const mk = (libs: readonly { name: string }[]) => {
      const name = 'v1';
      return fakeFs(
        { 'D:\\PCL2\\.minecraft\\versions': [name] },
        {
          [`D:\\PCL2\\.minecraft\\versions\\${name}\\${name}.json`]: JSON.stringify({
            id: name,
            clientVersion: '1.16.1',
            libraries: libs,
          }),
        },
      );
    };
    const fabricFirst = [
      { name: 'net.fabricmc:fabric-loader:0.17.3' },
      { name: 'net.minecraftforge:forge:1.16.1-36.2.0' },
    ];
    const forgeFirst = [...fabricFirst].reverse();
    assert.equal(listInstances(mk(fabricFirst), 'pcl2', 'D:\\PCL2')[0]!.loader, 'fabric 0.17.3');
    assert.equal(
      listInstances(mk(forgeFirst), 'pcl2', 'D:\\PCL2')[0]!.loader,
      'forge 1.16.1-36.2.0',
      '写死"forge 优先"或"fabric 优先"都过不了这一条（T2 评审的刀 K 全绿，就是缺它）',
    );
  });

  it('㉔ 兜底（共享 `libraries\\`）：**只有唯一候选**才报；两样都在 ⇒ `null`（不猜）', () => {
    const only = fakeFs({
      'D:\\PCL2\\.minecraft\\versions': ['v1'],
      'D:\\PCL2\\.minecraft\\libraries\\net\\fabricmc\\fabric-loader': ['0.17.3'],
    });
    assert.equal(listInstances(only, 'pcl2', 'D:\\PCL2')[0]!.loader, 'fabric 0.17.3');
    const both = fakeFs({
      'D:\\PCL2\\.minecraft\\versions': ['v1'],
      'D:\\PCL2\\.minecraft\\libraries\\net\\fabricmc\\fabric-loader': ['0.17.3', '0.18.6'],
      'D:\\PCL2\\.minecraft\\libraries\\net\\minecraftforge\\forge': ['1.16.1-36.2.0'],
    });
    assert.equal(
      listInstances(both, 'pcl2', 'D:\\PCL2')[0]!.loader,
      null,
      '共享目录是跨版本的 ⇒ 多个候选时**任何**选择都是猜（8 个 fabric 版本也是同理）',
    );
  });

  it('㉕ ★ A12 的手改口：`applyOverride` 认 `loader`，但**不**因此清掉"待确认"', () => {
    const fs = fakeFs({ 'D:\\PCL2\\.minecraft\\versions': ['v1'] });
    const one = listInstances(fs, 'pcl2', 'D:\\PCL2')[0]!;
    assert.equal(one.needsConfirm, true, '夹具前提：两处 mods 都不存在 ⇒ 待确认');
    assert.equal(applyOverride(one, { loader: 'fabric 0.17.3' }).loader, 'fabric 0.17.3');
    assert.equal(
      applyOverride(one, { loader: 'fabric 0.17.3' }).needsConfirm,
      true,
      '"待确认"说的是**路径**是猜的 ⇒ 只改 loader 不算确认了路径（T8 有显式的确认动作）',
    );
    assert.equal(applyOverride(one, undefined).loader, one.loader, '没给覆盖 ⇒ 一格都不动');
  });

  it('㉖ ★ MCSR Launcher：版本与 loader 从 `<实例>\\instance.json` 读（`mmc-pack.json` 只是兜底）', () => {
    /* 源码实证（2026-10-11，`MCSRLauncher/Launcher` 的 `BasicInstance.kt`）：
       它的实例元数据是 `instance.json`，字段名是 `minecraftVersion` 与
       `fabricVersion.loaderVersion` —— 它**不写** `mmc-pack.json`。 */
    const root = 'D:\\MCSRLauncher\\launcher';
    const fs = fakeFs(
      { [`${root}\\instances`]: ['ranked'], [`${root}\\instances\\ranked\\.minecraft`]: [] },
      {
        [`${root}\\instances\\ranked\\instance.json`]: JSON.stringify({
          minecraftVersion: '1.16.1',
          fabricVersion: { loaderVersion: '0.17.3' },
        }),
      },
    );
    const one = listInstances(fs, 'mcsr', root)[0]!;
    assert.equal(one.gameVersion, '1.16.1');
    assert.equal(one.loader, 'fabric 0.17.3', '字段名就是 fabricVersion.loaderVersion');
    assert.equal(
      one.modsDir,
      `${root}\\instances\\ranked\\.minecraft\\mods`,
      '实例形状不变（实测同形 ✓）',
    );
  });

  it('㉗ ★ 兜底**只**给"元数据带不到 loader"的三家（pcl2/hmcl/official）；MultiMC 系不兜底', () => {
    /* ★★ 2026-10-11 控制器裁定（T12 修复轮）：MultiMC / Prism / **MCSR Launcher** 的根下**本来就有
       共享的 `libraries\`**（MultiMC/Prism 的库目录；MCSR Launcher 也有一份 —— spec §6 那段源码实证）
       ⇒ 如果对它们也跑兜底，一个**原版**实例（`mmc-pack.json` 里只有 `net.minecraft`）会在
       "根下 fabric-loader **恰好只有一个**版本"（很常见）时被报成 `fabric <那个版本>` ✗ ——
       把一个原版实例说成 fabric，**填了一个错的值，比留空更坏**（Global Constraints 的"不猜"）。
       那三家的元数据（`mmc-pack.json` / `instance.json`）**是权威且完整的** ⇒ 它们不做兜底；
       兜底只对"实例自己那份 json 可能带不到 loader"的 pcl2 / hmcl / official 生效。
       ⚠️ 两个夹具必须同在：只有第一个的话，"把兜底整个删掉"也能过 ✗。 */
    const vanillaPack = JSON.stringify({
      components: [{ uid: 'net.minecraft', version: '1.16.1' }],
    });
    const multimcRoot = 'D:\\MultiMC';
    const multimc = fakeFs(
      {
        [`${multimcRoot}\\instances`]: ['vanilla'],
        [`${multimcRoot}\\instances\\vanilla\\.minecraft`]: [],
        /* 根下这份共享库里**恰好一个** fabric-loader（本机很常见的形状） */
        [`${multimcRoot}\\libraries\\net\\fabricmc\\fabric-loader`]: ['0.17.3'],
      },
      { [`${multimcRoot}\\instances\\vanilla\\mmc-pack.json`]: vanillaPack },
    );
    const mmc = listInstances(multimc, 'multimc', multimcRoot)[0]!;
    assert.equal(mmc.gameVersion, '1.16.1');
    assert.equal(
      mmc.loader,
      null,
      '权威元数据说"没有 loader 组件" ⇒ 留空；共享 libraries 是跨版本的 ⇒ **不许**据此报 fabric',
    );

    const pcl2Root = 'D:\\PCL2';
    const pcl2 = fakeFs(
      {
        [`${pcl2Root}\\.minecraft\\versions`]: ['v1'],
        [`${pcl2Root}\\.minecraft\\libraries\\net\\fabricmc\\fabric-loader`]: ['0.17.3'],
      },
      {
        [`${pcl2Root}\\.minecraft\\versions\\v1\\v1.json`]: JSON.stringify({
          id: 'v1',
          clientVersion: '1.16.1',
        }),
      },
    );
    assert.equal(
      listInstances(pcl2, 'pcl2', pcl2Root)[0]!.loader,
      'fabric 0.17.3',
      '同一形状换成 PCL2 ⇒ 兜底**仍然有效**（这条路不许被这道守卫一起砍掉）',
    );
  });

  it('㉘ ★★ 实例自己那份**压过**共享 `libraries\\`（两条路都在、且**值不同**时才有判据）', () => {
    /* ★ T12 评审的刀 G（Critical）：⑳/㉓ 只给"实例自己那份"、㉔ 只给"共享那份"
       ⇒ **没有任何一条用例**让两条路同时有值 ⇒ "先读实例自己那份"这个**顺序本身**零判据：
       把 `meta.loader ?? loaderFromSharedLibraries(...)` 两项对调 ⇒ 26 条全绿 ✗
       （而对调之后会**静默换版本**）。这条就是给那个顺序补的判据。 */
    const root = 'D:\\PCL2';
    const fs = fakeFs(
      {
        'D:\\PCL2\\.minecraft\\versions': ['v1'],
        /* 共享那份**只有一个**候选（㉔ 那种"多候选 ⇒ null"的情形不在这里）⇒ 兜底**会**给出一个值，
           所以"拿到哪个"完全取决于两条路的先后 —— 值必须与实例自己那份**不同**。 */
        'D:\\PCL2\\.minecraft\\libraries\\net\\fabricmc\\fabric-loader': ['0.18.6'],
      },
      {
        'D:\\PCL2\\.minecraft\\versions\\v1\\v1.json': JSON.stringify({
          id: 'v1',
          clientVersion: '1.16.1',
          libraries: [{ name: 'net.fabricmc:fabric-loader:0.17.3' }],
        }),
      },
    );
    assert.equal(
      listInstances(fs, 'pcl2', root)[0]!.loader,
      'fabric 0.17.3',
      '实例自己那份 json 里的 `libraries` 是**每实例一份**的真值 ⇒ 必须压过共享那份（0.18.6）',
    );
  });

  it('㉙ ★ `libraries` 里的坏元素 ⇒ 跳过它（不抛）；跳过之后**继续往后找**', () => {
    /* ★ T12 评审的刀 H（Important）：`if (typeof name !== 'string') continue;` 这一行删掉 ⇒ 26 条全绿，
       但 `[{name:123}]` ⇒ `THREW: name.startsWith is not a function`、`[{}]` ⇒ `THREW: Cannot read
       properties of undefined`。而调用方（`mod-folders.ts`）是**逐块 try/catch** ⇒
       一个坏元素会让**整个启动器块**消失（与 spec §7"绝不因一个实例坏掉就整页空"相反）。 */
    const mk = (libs: readonly unknown[]) => {
      const root = 'D:\\PCL2';
      const fs = fakeFs(
        { 'D:\\PCL2\\.minecraft\\versions': ['v1'] },
        {
          'D:\\PCL2\\.minecraft\\versions\\v1\\v1.json': JSON.stringify({
            id: 'v1',
            clientVersion: '1.16.1',
            libraries: libs,
          }),
        },
      );
      return listInstances(fs, 'pcl2', root)[0]!;
    };
    assert.equal(mk([{ name: 123 }, {}]).loader, null, '坏元素一律跳过 ⇒ 读不出就留 null（不抛）');
    assert.equal(
      mk([{ name: 123 }, { name: 'net.fabricmc:fabric-loader:0.17.3' }]).loader,
      'fabric 0.17.3',
      '跳过坏元素之后要**继续往后找** —— 一个坏元素不许把这一份 json 里的真值一起废掉',
    );
  });

  it('㉚ ★ 兜底的**第一处**根（`<根>\\libraries`）也要生效 —— 官方那一家的根本身就是 `.minecraft`', () => {
    /* ★ T12 评审的 I-3：㉔ 的两个夹具都只用到第二处（`<根>\.minecraft\libraries`）
       ⇒ `roots` 数组的**第一处**零覆盖（删掉它 ⇒ 全绿）。官方（`official`）的根**就是**
       `.minecraft` ⇒ 它的共享库在 `<根>\libraries` ⇒ 正好命中第一处。 */
    const root = '%APPDATA%\\.minecraft';
    const fs = fakeFs(
      {
        [`${root}\\versions`]: ['1.16.1'],
        [`${root}\\libraries\\net\\fabricmc\\fabric-loader`]: ['0.17.3'],
      },
      { [`${root}\\versions\\1.16.1\\1.16.1.json`]: JSON.stringify({ id: '1.16.1' }) },
    );
    assert.equal(
      listInstances(fs, 'official', root)[0]!.loader,
      'fabric 0.17.3',
      '命中 `<根>\\libraries` 那一处 —— 删掉 roots 的第一项 ⇒ 这一条必须红',
    );
  });

  it('㉛ ★ 兜底那条路上**读不动**（fs 会抛）⇒ 这一格留空，不许把它抛出去（A14）', () => {
    /* ★ T12 评审的 I-4：真实 `fs.listDir` 只吞 ENOENT/ENOTDIR，别的错**会抛**；
       而兜底那条路新增了 4 次 `listDir` ⇒ 一次 EACCES 就会带着整个启动器块一起死
       （逐块 catch 兜得住，但"这一格留空"显然比"整块消失"好）。 */
    const root = 'D:\\PCL2';
    const fs: LauncherFs = {
      listDir: (dir) => {
        if (dir.includes('libraries')) throw new Error('EACCES: permission denied');
        return dir === `${root}\\.minecraft\\versions` ? ['v1'] : [];
      },
      exists: () => false,
      readFile: () =>
        JSON.stringify({
          id: 'v1',
          clientVersion: '1.16.1',
        }) /* 这份 json **没有** libraries 线索 */,
    };
    const list = listInstances(fs, 'pcl2', root);
    assert.equal(list.length, 1, '枚举本身不许被这一次读失败带走');
    assert.equal(list[0]!.gameVersion, '1.16.1', '别的格照旧填上');
    assert.equal(list[0]!.loader, null, '读不动 ⇒ 这一格留空（不猜、也不抛）');
  });
});
