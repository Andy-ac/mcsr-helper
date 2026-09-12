/**
 * 发信驱动的边界行为。
 *
 * 唯一一件事：**真实发信时不许往保留域名投递**。
 *
 * ---------------------------------------------------------------------------
 * 为什么这条值得单独写测试
 * ---------------------------------------------------------------------------
 * 生产上要加两个测试账号（`author@example.invalid` 之类），它们根本收不到信。
 * 如果不管，每一次"批准/驳回"都会让 Resend 真往那里投递一次、然后退信 ——
 * 而退信率是发信域名声誉的一部分。为了测试账号去损伤
 * mcsrhelper.com 的投递声誉，是明显不划算的，而且**损伤是慢慢累积的**：
 * 不会有人报错，只会在某天发现验证邮件开始进垃圾箱。
 *
 * ⚠️ 这条保护必须**只在真实驱动上**生效。console / file 是开发与测试用的，
 *    把它们一起拦掉的话，测的就不是真实代码路径了。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { sendMail } = await import('./transport');

const message = {
  to: 'author@example.invalid',
  subject: '测试',
  text: '正文',
  html: '<p>正文</p>',
};

describe('★ 发信：保留域名', () => {
  it('resend 驱动下跳过保留域名，不做任何网络请求', async () => {
    const before = process.env.MCSR_MAIL_DRIVER;
    const beforeKey = process.env.RESEND_API_KEY;
    try {
      process.env.MCSR_MAIL_DRIVER = 'resend';
      // 给一个假 key：万一保护失效，这次调用会真的打到 api.resend.com
      // 并返回 401（ok:false）—— 断言就会失败，而不是静默地发出去。
      process.env.RESEND_API_KEY = 're_test_key_should_never_be_used';

      const result = await sendMail(message);
      assert.equal(result.ok, true);
      assert.equal(result.driver, 'skipped');
    } finally {
      if (before === undefined) delete process.env.MCSR_MAIL_DRIVER;
      else process.env.MCSR_MAIL_DRIVER = before;
      if (beforeKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = beforeKey;
    }
  });

  it('各种保留域名都被认出来', async () => {
    const before = process.env.MCSR_MAIL_DRIVER;
    try {
      process.env.MCSR_MAIL_DRIVER = 'resend';
      process.env.RESEND_API_KEY = 're_test_key_should_never_be_used';

      for (const to of [
        'a@example.test',
        'a@sub.example.test',
        'a@example.com',
        'a@example.org',
        'a@something.invalid',
        'a@localhost',
      ]) {
        const result = await sendMail({ ...message, to });
        assert.equal(result.driver, 'skipped', `${to} 应当被跳过`);
      }
    } finally {
      if (before === undefined) delete process.env.MCSR_MAIL_DRIVER;
      else process.env.MCSR_MAIL_DRIVER = before;
      delete process.env.RESEND_API_KEY;
    }
  });

  it('正常域名不会被跳过 —— 保护不能误伤真实用户', async () => {
    const before = process.env.MCSR_MAIL_DRIVER;
    try {
      // 用 file 驱动：既不会真的发信，也能验证"没有走跳过分支"
      process.env.MCSR_MAIL_DRIVER = 'file';
      process.env.MCSR_MAIL_DIR = 'data/mail-test';

      const result = await sendMail({ ...message, to: 'someone@qq.com' });
      assert.equal(result.ok, true);
      assert.equal(result.driver, 'file', '真实域名必须照常投递');
    } finally {
      if (before === undefined) delete process.env.MCSR_MAIL_DRIVER;
      else process.env.MCSR_MAIL_DRIVER = before;
      delete process.env.MCSR_MAIL_DIR;
    }
  });

  it('开发驱动下不拦截（否则测的就不是真实路径）', async () => {
    const before = process.env.MCSR_MAIL_DRIVER;
    try {
      process.env.MCSR_MAIL_DRIVER = 'file';
      process.env.MCSR_MAIL_DIR = 'data/mail-test';

      const result = await sendMail(message); // to=author@example.invalid
      assert.equal(result.driver, 'file');
    } finally {
      if (before === undefined) delete process.env.MCSR_MAIL_DRIVER;
      else process.env.MCSR_MAIL_DRIVER = before;
      delete process.env.MCSR_MAIL_DIR;
    }
  });
});
