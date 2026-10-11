import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type LauncherFs, listInstances } from '@mcsr/shared/launcherInstances';

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
});
