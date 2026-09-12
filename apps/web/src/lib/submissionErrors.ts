/**
 * 提交类接口的错误 → 用户能看懂的一句话 + **能点的下一步**。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 按 `code` 分派，**绝不匹配 message 文本**
 * ---------------------------------------------------------------------------
 * 匹配文本的写法在这个项目里已经被证伪过一次：服务端把中文原文改成英文之后，
 * 所有分支静默失效，界面开始显示 "API 返回 HTTP 409"，
 * 而测试仍然是全绿的（它们只断言状态码）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️⚠️ 但这个文件存在的**真正原因**是下面这件事
 * ---------------------------------------------------------------------------
 * 曾经有这么一对代码：
 *
 *     服务端：  return c.json({ error: 'url_exists', ... }, 409)
 *     前端：    case 'duplicate_url': ...
 *
 * 名字对不上 → 匹配不上任何分支 → 掉进兜底文案
 * 「出错了，请稍后再试。」。
 *
 * 于是"你提交的这个链接已经收录过了"（一个**完全正常、可操作**的结果）
 * 被显示成了"服务器出错了"。用户看到红框只会再点一次提交，然后再失败一次。
 *
 * 这类 bug 的特点是：**类型检查不会报**（两边都是 string），
 * **接口测试也不会报**（服务端确实返回了 409 + 正确的 code），
 * 只有真的用一次界面才会发现 —— 而且看起来像后端挂了。
 *
 * 所以现在有两道防线：
 *   1. 这份映射（每种 code 给出准确的下一步，而不是一句通用错误）
 *   2. `services/api/src/error-codes.test.ts` —— 它把服务端真正会返回的
 *      code 集合和这里处理的集合**对起来**，任何一边改了名就红
 *
 * 判断逻辑**不在前端**：`url_exists` 到底属于哪种情况（已上架 / 自己没上架的 /
 * 别人没上架的），由服务端算好随响应一起返回（见 routes/resources.ts）。
 * 前端只负责把结论翻译成文字和链接 —— 规则只有一份。
 */
import { ApiError } from '@/lib/api';

type Translate = (key: string) => string;

export interface SubmissionErrorInfo {
  message: string;
  /** 可点的下一步。没有合适的下一步时就只显示文字。 */
  action?: { to: string; labelKey: string };
}

/**
 * 提交/编辑失败时的提示。
 *
 * `fallback` 传 useApiErrorText() 的结果 —— 它会处理那些**通用的**
 * 失败（登录失效、限流、校验、网络），这里只补上前端能给出更好答案的那些。
 */
export function describeSubmissionError(
  error: unknown,
  t: Translate,
  fallback: (error: unknown) => string,
): SubmissionErrorInfo {
  if (!(error instanceof ApiError)) {
    return { message: fallback(error) };
  }

  switch (error.code) {
    /*
     * ★ 这个链接已经有了。服务端告诉我们它属于哪一种。
     */
    case 'url_exists': {
      const id = error.existingId;

      // 自己那条还没上架（被驳回 / 待审）→ 去改它，**不要**重新提交
      if (error.existingMine && error.existingStatus !== 'published' && id) {
        return {
          message: t('submit.errUrlExistsMine'),
          action: {
            to: `/resources/${encodeURIComponent(id)}/edit`,
            labelKey: 'submit.goEditMine',
          },
        };
      }
      // 已上架的条目（不管是谁的）→ 去看那一条
      if (error.existingStatus === 'published' && id) {
        return {
          message: t('submit.errUrlExistsLive'),
          action: { to: `/resources/${encodeURIComponent(id)}`, labelKey: 'submit.openExisting' },
        };
      }
      // 别人那条没上架的：**不能**透露是谁的、更不能给链接
      return { message: t('submit.errUrlExistsOther') };
    }

    case 'already_pending':
      return { message: t('submit.errAlreadyPending') };

    /*
     * ★ 视频墙的"这个视频已经有人贴过了"。
     *
     * ⚠️ 它和上面的 url_exists 是同一个**形状**，但三种情况的分界点不同：
     *    资源库看的是 published，视频看的是 visible / hidden。
     *    判据仍然**不在前端**：服务端把 existingId / existingTitle /
     *    existingStatus / existingMine 一起返回（见 routes/videos.ts 的 409），
     *    这里只把结论翻译成文字和入口。前端自己推一次"算不算重复"
     *    就等于有第二份规则，而两份分叉时不会有任何东西报错。
     *
     * 三种情况必须分开说，因为用户接下来要做的事完全不同：
     *   · visible → 墙上真的有它，给个入口去看
     *   · hidden  → 它被隐藏了，**墙上什么都没有**。这时说"已经贴过了"
     *               是误导：用户会去墙上找，然后什么都找不到，
     *               只能得出"网站坏了"的结论
     *   · mine    → 是他自己之前贴的那一条，下一步是去「我贴的」里处理它
     */
    case 'video_exists': {
      // hidden 先判：它比"已经贴过了"更具体，而且直接改变下一步
      if (error.existingStatus === 'hidden') {
        return error.existingMine
          ? {
              message: t('videos.errExistsHidden'),
              action: { to: '/videos?view=mine', labelKey: 'videos.gotoMine' },
            }
          : // 别人那条被隐藏的：**不给入口**。作者之外的人本来就看不到它，
            // 给链接等于告诉发帖人"这里有一条你看不到的东西"。
            { message: t('videos.errExistsHidden') };
      }

      if (error.existingMine) {
        return {
          message: t('videos.errExistsMine'),
          action: { to: '/videos?view=mine', labelKey: 'videos.gotoMine' },
        };
      }

      if (error.existingId) {
        return {
          message: t('videos.errExistsVisible'),
          action: { to: '/videos', labelKey: 'videos.viewWall' },
        };
      }
      return { message: t('videos.errExistsVisible') };
    }

    case 'email_not_verified':
      return {
        message: t('submit.errNeedVerify'),
        action: { to: '/me', labelKey: 'submit.gotoVerify' },
      };

    case 'forbidden':
      return { message: t('submit.errForbidden') };

    case 'not_found':
      return { message: t('resources.notFound') };

    /*
     * 未登录（会话过期也是这个）。给登录入口 —— 而且**不能**只显示一行字，
     * 否则用户会以为是自己填错了什么。
     */
    case 'unauthorized':
      return {
        message: t('submit.errSessionExpired'),
        action: { to: '/login', labelKey: 'nav.login' },
      };

    /*
     * 跨站请求被拒。正常使用中不该出现，出现了说明前端和 API 的源不一致
     * （本地开发时改错代理最典型）。给一句能指向真正原因的话。
     */
    case 'cross_origin_rejected':
      return { message: t('submit.errCrossOrigin') };

    default:
      return { message: fallback(error) };
  }
}
