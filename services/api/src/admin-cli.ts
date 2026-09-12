/**
 * 身份组管理命令行 —— **在服务器上跑，不经 HTTP**。
 *
 *     node dist/admin.js list                     列出所有用户
 *     node dist/admin.js show <email>             看某个用户
 *     node dist/admin.js role <email> <role> <理由>  改角色
 *
 * ---------------------------------------------------------------------------
 * 为什么需要它（两个都真实存在的问题）
 * ---------------------------------------------------------------------------
 *
 * **① 第一个管理员从哪来。**
 *    改角色的接口本身需要 admin 权限 —— 而系统里一个 admin 都没有时，
 *    那个接口谁也调不了。这是一个标准的先有鸡还是先有蛋问题，
 *    任何权限系统都必须显式回答它。答案不可能是"再写一个接口"，
 *    因为那个接口又需要权限。**只能有一条不经过权限系统的路**，
 *    而它的门槛就是"能登录服务器"。
 *
 * **② 把自己锁在门外之后的恢复手段。**
 *    HTTP 接口里有"不能降级最后一个管理员"的保护，但保护不是万能的：
 *    账号被停用、邮箱丢了登不进来、或者那次保护本身有 bug。
 *    有一条不依赖 web 层的路，这类事故才是可恢复的。
 *
 * ---------------------------------------------------------------------------
 * 为什么它不是"后门"
 * ---------------------------------------------------------------------------
 * 它不监听任何端口、不接受网络输入、只能由能在服务器上执行命令的人运行 ——
 * 而那个人本来就能直接改 SQLite 文件。所以它没有引入任何新的信任边界，
 * 只是把"改数据库"这件本来就可能的事**变得可审计、不易出错**。
 *
 * ⚠️ 它做的每一次改动都会写 audit_log，actor_id 记为 NULL
 *    （没有对应的用户），reason 里会带上命令行给的理由。
 */

import { DISPLAY_NAME_MAX, DISPLAY_NAME_MIN, PASSWORD_MAX, PASSWORD_MIN } from '@mcsr/shared/auth';
import { USER_ROLES, type UserRole } from '@mcsr/shared/permissions';
import { hashPassword } from './auth/password';
import { closeDb, dbPath } from './db';
import {
  countAdmins,
  createUser,
  findUserByEmail,
  listUsers,
  markEmailVerified,
  setUserRole,
  writeAudit,
} from './users';

function usage(): never {
  /*
   * ⚠️ 路径写的是**部署之后**的样子：deploy.sh 把 dist 里的内容直接解到
   *    /srv/mcsr-helper/api/ 下（不是 .../api/dist/）。
   *    第一版这里写的是 "node dist/admin.js"，照着敲会得到
   *    "Cannot find module '/srv/mcsr-helper/api/dist/admin.js'" ——
   *    而那个错误看起来像"文件没部署上去"，会让人跑去查部署脚本。
   */
  const self = '/srv/mcsr-helper/api/admin.js';
  console.error(
    [
      '身份组管理（在服务器上运行）',
      '',
      '用法：',
      `  node ${self} list`,
      `  node ${self} show <邮箱>`,
      `  node ${self} role <邮箱> <角色> <理由>`,
      `  node ${self} create <邮箱> <密码> <昵称> [角色]`,
      '',
      `可用角色：${USER_ROLES.join(' / ')}`,
      '',
      '例：',
      `  node ${self} role me@example.com admin "项目发起人，需要管理审核员"`,
      `  node ${self} create friend@example.com '一个足够长的密码' '朋友的昵称' user`,
      '',
      'create 会**直接建一个已验证的账号**，不走注册接口、不发任何邮件。',
      '只在你确实需要它的时候用（测试账号、对方收不到验证信）；',
      '正常注册仍然走网页，那条路有邮箱验证这道闸门。',
      '',
      '本地开发时把路径换成 dist/admin.js。',
      '',
      '为什么需要一条不走 HTTP 的路（第一个管理员从哪来、把自己锁在门外怎么办），',
      '见 services/api/src/admin-cli.ts 的文件头。',
    ].join('\n'),
  );
  process.exit(1);
}

function fmtTime(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

const [, , command, ...args] = process.argv;

console.log(`[admin] 数据库: ${dbPath()}`);

switch (command) {
  case 'list': {
    const { items, total } = listUsers(500, 0);
    console.log(`[admin] 共 ${String(total)} 个用户\n`);
    const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
    console.log(`  ${pad('角色', 10)}${pad('邮箱', 32)}${pad('昵称', 16)}验证  注册时间`);
    console.log(`  ${'-'.repeat(84)}`);
    for (const u of items) {
      console.log(
        `  ${pad(u.role, 10)}${pad(u.email, 32)}${pad(u.display_name, 16)}` +
          `${u.email_verified_at ? '是  ' : '否  '}  ${fmtTime(u.created_at)}`,
      );
    }
    break;
  }

  case 'show': {
    const email = args[0];
    if (!email) usage();
    const user = findUserByEmail(email);
    if (!user) {
      console.error(`✗ 找不到用户: ${email}`);
      process.exit(1);
    }
    console.log(
      [
        `  id       ${user.id}`,
        `  邮箱     ${user.email}`,
        `  昵称     ${user.display_name}`,
        `  角色     ${user.role}`,
        `  状态     ${user.status}`,
        `  已验证   ${user.email_verified_at ? `是（${fmtTime(user.email_verified_at)}）` : '否'}`,
        `  注册于   ${fmtTime(user.created_at)}`,
      ].join('\n'),
    );
    break;
  }

  case 'role': {
    const [email, role, reason] = args;
    if (!email || !role || !reason) usage();

    if (!(USER_ROLES as readonly string[]).includes(role)) {
      console.error(`✗ 未知角色「${role}」。可用：${USER_ROLES.join(' / ')}`);
      process.exit(1);
    }

    const user = findUserByEmail(email);
    if (!user) {
      console.error(`✗ 找不到用户: ${email}`);
      process.exit(1);
    }
    if (user.role === role) {
      console.log(`[admin] ${email} 已经是 ${role}，无需改动`);
      break;
    }

    /*
     * ⚠️ 这条 CLI 是"最后一个管理员"保护存在时**唯一能绕过它**的地方，
     *    而且这是刻意的 —— 它的存在意义就是"当保护把你锁在门外时的出路"。
     *    但它仍然要警告：降级最后一个管理员会让 web 界面彻底失去管理能力，
     *    之后要恢复还是得回到这个命令。
     */
    if (user.role === 'admin' && role !== 'admin' && countAdmins() <= 1) {
      console.warn(
        [
          '',
          '  ⚠️  这是最后一个管理员。降级之后，网页端将没有任何人能改角色，',
          '      要恢复只能再跑一次这条命令。',
          '',
        ].join('\n'),
      );
    }

    const now = Date.now();
    setUserRole(user.id, role as UserRole, now);
    writeAudit({
      actorId: null,
      action: 'user.role_change',
      entityType: 'user',
      entityId: user.id,
      reason: `${user.role} -> ${role}｜(CLI) ${reason}`,
      ip: null,
      now,
    });

    console.log(`[admin] ${email}: ${user.role} -> ${role}`);
    console.log('[admin] 已写入审计记录');
    break;
  }

  case 'create': {
    /*
     * 直接建一个**已验证**的账号，不经注册接口。
     *
     * -----------------------------------------------------------------------
     * 为什么需要它
     * -----------------------------------------------------------------------
     * 注册接口的路径是"发一封验证邮件 → 用户点链接"，这在两种情况下走不通：
     *
     *   1. **测试账号**。`@example.test` 是 RFC 6761 保留域名，
     *      根本收不到信 —— 而注册接口会**真的**让发信服务往那里投递，
     *      退信会算在发信域名的声誉上。为了造两个测试账号去损伤
     *      mcsrhelper.com 的投递声誉，是明显不划算的。
     *   2. **帮别人开账号**。对方邮箱暂时收不到信时，
     *      有一条不依赖邮件投递的路。
     *
     * ⚠️ 它和注册接口**不冲突**：注册接口仍然会给邮箱发信、仍然不能自动验证。
     *    这条路要求"能登录服务器"，和上面改角色那条是同一个门槛。
     */
    const [email, password, displayName, role = 'user'] = args;
    if (!email || !password || !displayName) usage();

    for (const [label, value, min, max] of [
      ['邮箱', email, 3, 254],
      ['密码', password, PASSWORD_MIN, PASSWORD_MAX],
      ['昵称', displayName, DISPLAY_NAME_MIN, DISPLAY_NAME_MAX],
    ] as const) {
      if (value.length < min || value.length > max) {
        console.error(`✗ ${label}长度必须在 ${String(min)}–${String(max)} 之间`);
        process.exit(1);
      }
    }
    if (!(USER_ROLES as readonly string[]).includes(role)) {
      console.error(`✗ 未知角色「${role}」。可用：${USER_ROLES.join(' / ')}`);
      process.exit(1);
    }
    if (findUserByEmail(email)) {
      console.error(`✗ ${email} 已经存在。要改密码请用 passwd，要改角色请用 role。`);
      process.exit(1);
    }

    const now = Date.now();
    const passwordHash = await hashPassword(password);
    const user = createUser({
      email,
      passwordHash,
      displayName,
      // 测试账号一律中文界面。这个字段用户自己能在账号页改。
      locale: 'zh-CN',
      now,
    });

    if (role !== 'user') setUserRole(user.id, role as UserRole, now);
    // 已验证：不这样做的话，author 这类账号连提交都会被挡在门外，
    // 而它永远收不到那封验证信。
    markEmailVerified(user.id, now);

    writeAudit({
      actorId: null,
      action: 'user.create',
      entityType: 'user',
      entityId: user.id,
      reason: `(CLI) 直接创建 role=${role} verified=yes`,
      ip: null,
      now,
    });

    console.log(`[admin] 已创建 ${email}（${displayName}）角色=${role} 邮箱=已验证`);
    console.log('[admin] 已写入审计记录');
    console.log(`[admin] 提醒：这个密码只有你知道，密码本身不会写进审计日志`);
    break;
  }

  default:
    usage();
}

closeDb();
