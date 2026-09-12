/**
 * 邮件发送管道。
 *
 * ---------------------------------------------------------------------------
 * 为什么自己写几十行，而不是装 nodemailer
 * ---------------------------------------------------------------------------
 * 主选方案（Resend）是一个**普通的 HTTPS JSON 接口** —— 用内置 fetch 就够了。
 * nodemailer 解决的是"直接说 SMTP"，而我们不走那条路：
 * docs/v1-plan.md §9.2 已经排除自建 SMTP（云厂商默认封 25 端口，且有权永久封禁）。
 * 为了一个 HTTP POST 引入一个完整邮件栈，只会让单文件打包多背几十 KB。
 *
 * 而且用 fetch 之后，这个模块**没有额外依赖**，esbuild 打包不会有任何问题。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 失败时的行为：**不能拖垮注册流程**
 * ---------------------------------------------------------------------------
 * 发信失败（额度用完、密钥过期、对方网关抖动）时，注册本身必须成功 ——
 * 账号已经建好了，用户可以去"重发验证邮件"。
 * 反过来如果让发信失败导致注册回滚，用户会看到一个 500，
 * 然后反复重试，每次都留下一个新账号，情况只会更糟。
 *
 * 所以 sendMail **总是**返回结果对象而不抛异常，调用方自己决定要不要记日志。
 *
 * ---------------------------------------------------------------------------
 * 关于 Sender = From
 * ---------------------------------------------------------------------------
 * §9.2 里有一条硬要求："Sender 必须等于 From —— 否则网易直接 554 DT:SUM 退信"。
 * 在 Resend 这类 ESP 上，From 由请求里的 `from` 字段决定，
 * 而信封发件人（MAIL FROM / Return-Path）由**在 ESP 后台配置的发信域名**决定，
 * 不是代码能设的。所以这条要求的落地方式是配置约束，见下面的 checkMailConfig。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface MailMessage {
  to: string;
  subject: string;
  /** 纯文本正文。**必填** —— 见下面对 QQ 邮箱的说明。 */
  text: string;
  /** 可选的 HTML 正文。必须保留一个真正的文字链接。 */
  html?: string;
}

export type MailResult =
  | { ok: true; driver: string; id?: string }
  | { ok: false; driver: string; error: string };

export type MailDriver = 'resend' | 'file' | 'console';

interface MailConfig {
  driver: MailDriver;
  from: string;
  fromName: string;
  fileDir: string;
  resendKey: string;
}

function readConfig(): MailConfig {
  const raw = (process.env.MCSR_MAIL_DRIVER ?? '').trim().toLowerCase();
  const driver: MailDriver =
    raw === 'resend' || raw === 'file' || raw === 'console' ? (raw as MailDriver) : 'console';

  return {
    driver,
    from: process.env.MCSR_MAIL_FROM ?? 'noreply@localhost',
    // 显示名单独拿出来：`From: 名字 <地址>` 里的地址必须与发信域名一致，
    // 而名字可以是中文。有的 ESP 对非 ASCII 显示名要求 MIME 编码，交给它处理。
    fromName: process.env.MCSR_MAIL_FROM_NAME ?? 'MCSR Helper',
    fileDir: process.env.MCSR_MAIL_DIR ?? './data/mail',
    resendKey: process.env.RESEND_API_KEY ?? '',
  };
}

/**
 * 配置自检。**在启动时跑**，把问题暴露在部署日志里，
 * 而不是等第一个用户注册时才在菜鸟上发现。
 */
export function checkMailConfig(): string[] {
  const cfg = readConfig();
  const problems: string[] = [];

  if (cfg.driver === 'resend') {
    if (!cfg.resendKey) problems.push('MCSR_MAIL_DRIVER=resend 但没有设置 RESEND_API_KEY');
    if (!process.env.MCSR_MAIL_FROM) {
      problems.push('MCSR_MAIL_DRIVER=resend 但没有设置 MCSR_MAIL_FROM（发信地址）');
    }
    // §9.2：发信必须走独立子域，把邮件声誉与站点声誉解耦。
    const domain = cfg.from.split('@')[1] ?? '';
    if (domain && !domain.startsWith('mail.')) {
      problems.push(
        `发信域名是 ${domain}，而不是 mail.<你的域名> 的子域 —— ` +
          'docs/v1-plan.md §9.2 要求发信走独立子域，把邮件声誉和站点声誉解耦',
      );
    }
    if (domain.endsWith('cloud-ip.cc')) {
      problems.push(
        '⚠️ cloud-ip.cc 在 Spamhaus DBL 上被列名为 phishing + botnet C&C，' +
          '绝不能用作发信域名。测投递率必须换一个干净域名（§9.2）',
      );
    }
  }

  if (cfg.driver === 'console') {
    problems.push(
      'MCSR_MAIL_DRIVER 没设置，邮件只会打到日志里，不会真的发出去。' +
        '开发时这是有意的；生产环境必须设置。',
    );
  }

  return problems;
}

/** `名字 <地址>` 的组合，处理掉显示名里的引号。 */
function formatFrom(cfg: MailConfig): string {
  const safeName = cfg.fromName.replace(/["<>]/g, '');
  return `${safeName} <${cfg.from}>`;
}

/**
 * 发一封信。**不抛异常**（见文件头）。
 */
export async function sendMail(message: MailMessage): Promise<MailResult> {
  const cfg = readConfig();

  try {
    switch (cfg.driver) {
      case 'resend':
        return await sendViaResend(cfg, message);
      case 'file':
        return sendToFile(cfg, message);
      default:
        return sendToConsole(cfg, message);
    }
  } catch (error) {
    return {
      ok: false,
      driver: cfg.driver,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// 驱动：Resend（生产）
// ---------------------------------------------------------------------------

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

async function sendViaResend(cfg: MailConfig, message: MailMessage): Promise<MailResult> {
  // 加超时。没有超时的 fetch 会一直挂着，
  // 而它是在用户注册的请求路径上 —— 一个卡住的发信请求就是一个卡住的注册请求。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: formatFrom(cfg),
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        // 我们自己管回复地址，不让 ESP 代收 —— 事务邮件本来就不需要回复。
        // 留空反而更好：Reply-To 缺失时用户回信会给到 From，而 From 是 noreply。
      }),
      signal: controller.signal,
    });

    const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };

    if (!response.ok) {
      return {
        ok: false,
        driver: 'resend',
        error: `HTTP ${response.status}: ${body.message ?? '未知错误'}`,
      };
    }
    return { ok: true, driver: 'resend', id: body.id };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// 驱动：文件（开发）
// ---------------------------------------------------------------------------

/**
 * 把邮件写成 .eml 文件。
 *
 * 为什么用文件而不是只打日志：日志里混着访问日志，
 * 而验证链接是一长串 base64，粘出来很容易少几个字符 —— 然后你会去查
 * "为什么令牌无效"，而真正的原因只是复制少了一位。
 * 写成一个文件，链接是完整、可复制的。
 *
 * ⚠️ 这个驱动**只用于开发**。生产环境如果误配成它，邮件不会真的发出去，
 * 而注册接口会返回成功 —— 用户永远收不到验证信。
 * 所以 checkMailConfig 对 console 驱动报警，运维时能一眼看到。
 */
function sendToFile(cfg: MailConfig, message: MailMessage): MailResult {
  mkdirSync(cfg.fileDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(cfg.fileDir, `${stamp}-${message.to.replace(/[^a-zA-Z0-9]/g, '_')}.eml`);

  const headers = [
    `From: ${formatFrom(cfg)}`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
  ];

  let body: string;
  if (message.html) {
    const boundary = 'mcsr-boundary';
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      message.text,
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      message.html,
      `--${boundary}--`,
    ].join('\r\n');
  } else {
    headers.push('Content-Type: text/plain; charset=utf-8');
    body = message.text;
  }

  writeFileSync(file, `${headers.join('\r\n')}\r\n\r\n${body}\r\n`, 'utf8');
  return { ok: true, driver: 'file', id: file };
}

// ---------------------------------------------------------------------------
// 驱动：控制台（兜底）
// ---------------------------------------------------------------------------

function sendToConsole(cfg: MailConfig, message: MailMessage): MailResult {
  console.log(
    [
      '',
      '────────── 邮件（未真正发送，MCSR_MAIL_DRIVER 未配置）──────────',
      `  From : ${formatFrom(cfg)}`,
      `  To   : ${message.to}`,
      `  主题 : ${message.subject}`,
      '',
      message.text,
      '──────────────────────────────────────────────────────────',
      '',
    ].join('\n'),
  );
  return { ok: true, driver: 'console' };
}

/** 当前驱动名，供 /api/health 之类的地方显示状态。 */
export function mailDriverName(): MailDriver {
  return readConfig().driver;
}
