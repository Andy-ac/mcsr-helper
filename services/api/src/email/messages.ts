/**
 * 事务邮件的正文。
 *
 * ---------------------------------------------------------------------------
 * 🔴 两条来自 docs/v1-plan.md §9.2 的硬约束，直接决定这里怎么写
 * ---------------------------------------------------------------------------
 *
 * ① **CTA 必须是文字链接，绝不能做成图片按钮。**
 *    QQ 邮箱默认不显示图片，也不显示图片上的链接。做成图片按钮的后果是：
 *    邮件投递成功了、用户也打开了、但**点不动**——
 *    而我们这边看到的是一封"发送成功"的邮件，没有任何错误。
 *    微软的 China 指南独立描述了同一个症状："delivered emails with unclickable links"。
 *
 * ② **链接的文字就是那条 URL 本身**，不是"点此验证"。
 *    这样即使客户端把锚点样式剥掉了，用户仍然看得到完整地址、能手动复制。
 *    反过来，"点此验证"在剥掉链接之后就是一句无用的话。
 *    顺带：以 URL 为链接文字也更不容易被内容过滤器判为钓鱼。
 *
 * 因此这里的 HTML 刻意做得极其朴素：只有段落和裸的 <a>。
 * 没有表格布局、没有内联样式背景、没有按钮、没有跟踪像素。
 * 这不是偷懒 —— 每加一样东西，被某个邮箱客户端吃掉的可能性就多一分，
 * 而这是一个**用户必须点到才能用**的链接。
 */

import type { Locale } from '@mcsr/shared';
import { SITE } from '@mcsr/shared';
import type { MailMessage } from './transport';

/** 站点对外地址。邮件里的链接必须指向它。 */
function publicOrigin(): string {
  return (process.env.MCSR_PUBLIC_ORIGIN ?? SITE.productionOrigin).replace(/\/+$/, '');
}

export function verifyUrl(token: string): string {
  return `${publicOrigin()}/verify-email?token=${encodeURIComponent(token)}`;
}

export function resetUrl(token: string): string {
  return `${publicOrigin()}/reset-password?token=${encodeURIComponent(token)}`;
}

/** HTML 转义。链接是拼进去的，虽然 token 是 base64url、不会有特殊字符，但不能依赖这一点。 */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 把"段落 + 一条链接"组装成 text/html 两份正文。
 *
 * 两份正文由同一个函数产出，是为了避免它们写着写着就不一致了 ——
 * 比如改了措辞却只改了 HTML。那样纯文本客户端的用户会看到过期的话术。
 */
function compose(options: {
  paragraphs: string[];
  linkLabel: string;
  url: string;
  footer: string[];
}): { text: string; html: string } {
  const { paragraphs, linkLabel, url, footer } = options;

  const text = [...paragraphs, '', linkLabel, url, '', ...footer].join('\n');

  const html = [
    ...paragraphs.map((p) => `<p>${esc(p)}</p>`),
    `<p>${esc(linkLabel)}<br><a href="${esc(url)}">${esc(url)}</a></p>`,
    ...footer.map((f) => `<p style="color:#666;font-size:13px">${esc(f)}</p>`),
  ].join('\n');

  return { text, html };
}

// ---------------------------------------------------------------------------
// 模板
// ---------------------------------------------------------------------------

export interface RenderedMail extends MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export function buildVerifyMail(input: {
  to: string;
  token: string;
  locale: Locale;
}): RenderedMail {
  const url = verifyUrl(input.token);

  if (input.locale === 'en') {
    const { text, html } = compose({
      paragraphs: [
        'Hi,',
        'Someone (hopefully you) signed up for MCSR Helper with this email address.',
        'Open the link below to confirm this address. You can browse the site without confirming; confirming is what lets you submit resources, seeds and events.',
      ],
      linkLabel: 'Confirm this email address:',
      url,
      footer: [
        'The link is valid for 24 hours.',
        'If this was not you, you can ignore this email — nothing was confirmed and no content was submitted.',
        'This is an automated message; replies are not monitored.',
      ],
    });
    return { to: input.to, subject: 'Confirm your MCSR Helper email address', text, html };
  }

  const { text, html } = compose({
    paragraphs: [
      '你好，',
      '有人（希望是你）用这个邮箱注册了 MCSR Helper。',
      '点开下面的链接即可确认这个邮箱地址。不确认也可以正常浏览全站；确认之后才能提交资源、种子和赛事。',
    ],
    linkLabel: '确认这个邮箱地址：',
    url,
    footer: [
      '链接 24 小时内有效。',
      '如果不是你本人操作，忽略这封邮件即可 —— 不会发生任何事，也没有任何内容被提交。',
      '这是一封系统邮件，回复不会被查看。',
    ],
  });
  return { to: input.to, subject: '确认你的 MCSR Helper 邮箱地址', text, html };
}

/**
 * 审核结果通知。
 *
 * ---------------------------------------------------------------------------
 * 为什么这封邮件值得发
 * ---------------------------------------------------------------------------
 * 提交之后，用户不会每天回站里看"我那条怎么样了"。没有邮件的话，
 * 审核结果就只存在于一个他不会再打开的页面里 —— 而审核员为了写出那个结果
 * 花掉的注意力，也就白费了。
 *
 * ⚠️ 驳回的那封必须**带上理由**，而且要有"去改一下"的入口。
 *    只说"被驳回了"的邮件比不发更糟：用户知道自己失败了却不知道下一步，
 *    唯一的反应是原样再交一次。
 *
 * ⚠️ 链接指向的是**我自己的提交列表**（/me/submissions），不是条目的公开页 ——
 *    被驳回的条目在公开页上根本不存在（404）。
 */
export function buildReviewResultMail(input: {
  to: string;
  locale: Locale;
  approved: boolean;
  title: string;
  /** 驳回理由。approved 为 false 时必须有值。 */
  reason?: string | null;
}): RenderedMail {
  const url = `${publicOrigin()}/me/submissions`;

  if (input.locale === 'en') {
    const { text, html } = compose({
      paragraphs: input.approved
        ? [
            'Hi,',
            `Your submission "${input.title}" has been approved and is now live on MCSR Helper.`,
            'Thanks for contributing.',
          ]
        : [
            'Hi,',
            `Your submission "${input.title}" was not accepted this time.`,
            `Reviewer's note: ${input.reason ?? '(no reason given)'}`,
            'You can edit it and submit it again — the note above is what to fix.',
          ],
      linkLabel: 'Your submissions:',
      url,
      footer: ['This is an automated message; replies are not monitored.'],
    });
    return {
      to: input.to,
      subject: input.approved ? `Approved: ${input.title}` : `Needs changes: ${input.title}`,
      text,
      html,
    };
  }

  const { text, html } = compose({
    paragraphs: input.approved
      ? ['你好，', `你提交的「${input.title}」已经通过审核，正式上线了。`, '谢谢你的贡献。']
      : [
          '你好，',
          `你提交的「${input.title}」这次没有通过审核。`,
          `审核员的说明：${input.reason ?? '（没有填写理由）'}`,
          '你可以按上面的说明修改之后重新提交 —— 修改会重新进入审核队列。',
        ],
    linkLabel: '你的提交记录：',
    url,
    footer: ['这是一封系统邮件，回复不会被查看。'],
  });
  return {
    to: input.to,
    subject: input.approved ? `已通过：${input.title}` : `需要修改：${input.title}`,
    text,
    html,
  };
}

export function buildResetMail(input: { to: string; token: string; locale: Locale }): RenderedMail {
  const url = resetUrl(input.token);

  if (input.locale === 'en') {
    const { text, html } = compose({
      paragraphs: [
        'Hi,',
        'Someone asked to reset the password for this MCSR Helper account.',
        'Open the link below to choose a new password.',
      ],
      linkLabel: 'Choose a new password:',
      url,
      footer: [
        'The link is valid for 1 hour — shorter than the confirmation link, because it grants access to your account.',
        'Your current password still works until you finish. If you did not ask for this, nothing is wrong with your account and you can ignore this email.',
        'This is an automated message; replies are not monitored.',
      ],
    });
    return { to: input.to, subject: 'Reset your MCSR Helper password', text, html };
  }

  const { text, html } = compose({
    paragraphs: [
      '你好，',
      '有人请求重置这个 MCSR Helper 账号的密码。',
      '点开下面的链接即可设置新密码。',
    ],
    linkLabel: '设置新密码：',
    url,
    footer: [
      '链接 1 小时内有效 —— 比验证链接短得多，因为它等同于一次登录。',
      '在你完成之前，原密码仍然可用。如果不是你发起的，你的账号没有出任何问题，忽略这封邮件即可。',
      '这是一封系统邮件，回复不会被查看。',
    ],
  });
  return { to: input.to, subject: '重置你的 MCSR Helper 密码', text, html };
}
