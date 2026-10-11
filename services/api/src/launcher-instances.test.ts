import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { instanceKeyOf, type LauncherFs, listInstances } from '@mcsr/shared/launcherInstances';

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

  it('⑨ MCSR Launcher：v1 先按 MultiMC 系枚举（它的真实布局**未核实**，spec §13）', () => {
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
});
