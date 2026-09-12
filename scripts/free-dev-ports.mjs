#!/usr/bin/env node
/**
 * 释放 dev 服务器占用的端口。
 *
 * ---------------------------------------------------------------------------
 * 为什么需要这个脚本
 * ---------------------------------------------------------------------------
 * `pnpm dev:web` 起不来时最常见的报错是：
 *
 *     Error: Port 5173 is already in use
 *     Error: listen EADDRINUSE: address already in use 127.0.0.1:3001
 *
 * 而**任务管理器里一个 node 进程都没有**，`Stop-Process -Name node` 也杀不掉 ——
 * 因为 DSH 执行命令时用的是它自己的二进制当 Node 运行时：
 *
 *     "D:\DSH Desktop\DSH Desktop.exe" --import ".../clear-env.mjs" ".../vite.js"
 *
 * 于是：
 *   · 进程列表里显示的名字是 **DSH Desktop**，不是 node；
 *   · `Get-NetTCPConnection` 报告 3001/5173 的属主也是 "DSH Desktop"，
 *     看起来像 GUI 自己占着端口；
 *   · dev server 已经"停了"（终端关掉了）但进程还在，变成孤儿。
 *
 * 所以只能**按端口找 PID，再按 PID 杀**。这个脚本就是把那两步固定下来。
 *
 *   node scripts/free-dev-ports.mjs          # 杀掉占用者
 *   node scripts/free-dev-ports.mjs --dry    # 只看是谁占着，不动手
 */

import { execFileSync } from 'node:child_process';

const PORTS = [5173, 3001];
const dry = process.argv.includes('--dry');

/**
 * 解析 `netstat -ano`。
 *
 * 用 netstat 而不是 PowerShell 的 Get-NetTCPConnection：前者在任何 Windows 上
 * 都有、输出稳定、解析起来只有几列；后者要跨 shell 调用，还会受执行策略影响。
 */
function listeners() {
  const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
  const found = [];
  for (const line of out.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    // 形如：TCP  127.0.0.1:5173  0.0.0.0:0  LISTENING  2156
    if (cols[0] !== 'TCP' || cols[3] !== 'LISTENING') continue;
    const port = Number(cols[1]?.split(':').pop());
    if (!PORTS.includes(port)) continue;
    found.push({ port, pid: Number(cols[4]) });
  }
  return found;
}

/** 单个 PID 的命令行，用来告诉用户"杀的是什么东西"。取不到就返回空串。 */
function commandLineOf(pid) {
  try {
    return execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
      ],
      { encoding: 'utf8' },
    ).trim();
  } catch {
    return '';
  }
}

const found = listeners();
if (found.length === 0) {
  console.log('✓ 5173 和 3001 都是空的 —— 直接 pnpm dev:web 就行');
  process.exit(0);
}

for (const { port, pid } of found) {
  const cmd = commandLineOf(pid);
  // 只显示真正是哪个脚本 —— 命令行的前半段永远是 DSH 的启动器，没有信息量
  const what = cmd.replace(/^.*clear-env\.mjs"?\s*/, '') || '(取不到命令行)';
  console.log(`端口 ${port} 被 pid=${pid} 占着：${what}`);

  if (dry) continue;
  try {
    execFileSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'pipe' });
    console.log(`  → 已结束 pid=${pid}`);
  } catch (error) {
    console.log(`  → 结束失败：${error.message.split('\n')[0]}`);
  }
}

if (dry) {
  console.log('\n（--dry 模式，什么都没做）');
  process.exit(0);
}

// 确认一下真的释放了。杀完就说"好了"而不复查的话，
// 下次报错的还是同一个端口，而用户会以为这个脚本没用。
const after = listeners().map((x) => x.port);
const stillUsed = after.filter((p) => PORTS.includes(p));
if (stillUsed.length === 0) {
  console.log('✓ 端口已释放，现在可以 pnpm dev:web');
} else {
  console.log(`⚠️ 这些端口仍然被占用：${stillUsed.join(', ')}`);
  console.log('  可能是别的程序（不是 dev server）。用 node scripts/free-dev-ports.mjs --dry 看是谁。');
  process.exit(1);
}
