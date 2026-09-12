import type { CalendarEventInput } from '@mcsr/shared/calendar';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { CalendarForm, emptyCalendarDraft } from '@/components/CalendarForm';
import { Notice } from '@/components/Form';
import { submitCalendarEvent } from '@/lib/api';
import { useApiErrorText, useAuth } from '@/lib/auth';
import { useCan } from '@/lib/capabilities';

/**
 * 提交日历活动 —— `/calendar/submit`。
 *
 * ⚠️ 路径挂在 `/calendar` 下面，而不是做一个统一的 `/submit`。
 *    理由和资源库那边一样：提交表单是**功能自己的**一部分，它知道这个功能
 *    要哪些字段、该怎么校验。做成 `/submit?type=calendar` 就等于把所有类型的
 *    表单塞进一个组件里按类型分支 —— 加一类内容就要动公共页面，
 *    而公共页面上一个手滑影响的是全部类型。
 *    （通用的那一半是**审核**，见 /review；两者通用性不同，所以路由结构也不同。）
 *
 * 三道闸门在服务端（requireAuth + requireCapability('calendar.submit') +
 * 邮箱已验证），但界面必须在**用户开始填之前**就说清楚 ——
 * 填完一整张表才被拒是最糟的体验。判据和服务端是同一份权限矩阵。
 */
export function CalendarSubmit() {
  const { t } = useTranslation();
  const auth = useAuth();
  const errorText = useApiErrorText();
  // 今天所有角色都有 calendar.submit，所以下面那条分支目前走不到。
  // 留着的理由是它是**服务端那道闸门的镜像**：能力收紧的那天，
  // 界面会自动跟着收紧，而不是让用户填完一整张表再拿到 403。
  const canSubmit = useCan('calendar.submit');

  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<{ revision: number } | null>(null);

  async function onSubmit(input: CalendarEventInput) {
    setFailure(null);
    setBusy(true);
    try {
      const result = await submitCalendarEvent(input);
      setDone({ revision: result.revision });
    } catch (error) {
      /*
       * 只做"把错误翻译成人话"，不做任何判断。
       * `already_pending` / `invalid_input` / `email_not_verified` 的区分在
       * lib/auth.tsx 的 apiErrorText 里按 `code` 分派（那是错误码契约测试守着的），
       * 这里再判一次就等于有了第二份规则，而两份规则分叉时不会有任何报错。
       */
      setFailure(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  if (auth.loading) return <p className="state">{t('common.loading')}</p>;

  if (!auth.user) {
    return (
      <>
        <header className="pagehead">
          <h1 className="pagehead__title">{t('calendar.submitTitle')}</h1>
        </header>
        <Notice kind="info">{t('submit.needLogin')}</Notice>
        <p className="submitgate">
          <Link className="cta" to={`/login?next=${encodeURIComponent('/calendar/submit')}`}>
            {t('nav.login')}
          </Link>
        </p>
      </>
    );
  }

  if (!auth.user.emailVerified) {
    return (
      <>
        <header className="pagehead">
          <h1 className="pagehead__title">{t('calendar.submitTitle')}</h1>
        </header>
        <Notice kind="bad">{t('submit.needVerify')}</Notice>
        <p className="submitgate">
          <Link className="cta" to="/me">
            {t('submit.gotoVerify')}
          </Link>
        </p>
      </>
    );
  }

  if (!canSubmit) {
    return (
      <>
        <header className="pagehead">
          <h1 className="pagehead__title">{t('calendar.submitTitle')}</h1>
        </header>
        <Notice kind="bad">{t('submit.errForbidden')}</Notice>
        <p className="submitgate">
          <Link className="authform__link" to="/calendar">
            {t('calendar.backToList')}
          </Link>
        </p>
      </>
    );
  }

  if (done) {
    return (
      <>
        <header className="pagehead">
          <h1 className="pagehead__title">{t('calendar.doneTitle')}</h1>
          <p className="pagehead__sub">{t('calendar.doneSub')}</p>
        </header>
        <Notice kind="ok">{t('submit.doneRevision', { revision: done.revision })}</Notice>
        <div className="submitdone">
          <button type="button" className="cta" onClick={() => setDone(null)}>
            {t('calendar.submitAnother')}
          </button>
          <Link className="authform__link" to="/calendar">
            {t('calendar.backToList')}
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="pagehead">
        <h1 className="pagehead__title">{t('calendar.submitTitle')}</h1>
        <p className="pagehead__sub">{t('calendar.submitSubtitle')}</p>
      </header>

      {/*
        说清楚"提交后不会立刻出现"，否则用户会以为提交失败又提交一遍。
        ⚠️ 日历这一条比资源库更要紧：日历有时间。他填的那个时间一旦到了
           而活动还没出现，看起来就像我们漏了他的条目 —— 而实际上它只是在等审核。
      */}
      <p className="submitnote">{t('calendar.submitFlowNote')}</p>

      {failure ? <Notice kind="bad">{failure}</Notice> : null}

      <CalendarForm
        initial={emptyCalendarDraft()}
        actionLabel={t('calendar.submitAction')}
        busyLabel={t('submit.submitting')}
        busy={busy}
        onSubmit={onSubmit}
      />
    </>
  );
}
