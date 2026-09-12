/**
 * 审核结果通知。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 发信失败**绝不能让审核动作失败**
 * ---------------------------------------------------------------------------
 * 审核员点了"批准"，事情就已经发生了（数据库已经改了）。
 * 这时候如果因为邮件服务抽风而返回 500，他会以为没成功、再点一次 ——
 * 第二次会得到 409 "已经被处理"，然后他会开始怀疑整个系统。
 *
 * 所以这里的策略和注册邮件一致：**失败了就记日志，不往上抛**。
 * 代价是"审核成功但作者没收到信"，这个代价明显小于上面那个。
 */
import type { Locale } from '@mcsr/shared';
import { findUserById } from '../users';
import { buildReviewResultMail } from './messages';
import { sendMail } from './transport';

export async function notifyReviewResult(input: {
  editorId: string | null;
  title: string;
  approved: boolean;
  reason?: string | null;
}): Promise<void> {
  // 导入的条目没有提交者 —— 没人可通知，这不是错误
  if (!input.editorId) return;

  let to: string | null = null;
  let locale: Locale = 'zh-CN';
  try {
    const user = findUserById(input.editorId);
    if (!user) return;
    to = user.email;
    locale = user.locale as Locale;
  } catch (error) {
    console.error('[review] 查不到提交者，通知跳过:', error);
    return;
  }

  try {
    const mail = buildReviewResultMail({
      to,
      locale,
      approved: input.approved,
      title: input.title,
      reason: input.reason ?? null,
    });
    const result = await sendMail(mail);
    if (!result.ok) {
      console.error(`[review] 审核结果邮件发送失败 to=${to}:`, result.error);
      return;
    }
    if (result.driver === 'skipped') {
      // 保留域名（比如测试账号用的 @example.test）。
      // 这**不是**错误 —— transport 那边已经打过一行说明为什么跳过。
      console.log(`[review] 收件人是保留域名，未真实发送 to=${to} approved=${input.approved}`);
      return;
    }
    console.log(`[review] 审核结果邮件已交给 ${result.driver} to=${to} approved=${input.approved}`);
  } catch (error) {
    console.error('[review] 审核结果邮件异常:', error);
  }
}
