import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Notice } from '@/components/Form';
import { emptyDraft, ResourceForm } from '@/components/ResourceForm';
import { type SubmissionResult, submitResource } from '@/lib/api';
import { useApiErrorText, useAuth } from '@/lib/auth';
import { describeSubmissionError, type SubmissionErrorInfo } from '@/lib/submissionErrors';

/**
 * 提交资源库条目 —— `/resources/submit`。
 *
 * ⚠️ 路径挂在 `/resources` 下面，而不是做一个统一的 `/submit`。
 *
 *    提交表单是**功能自己的**一部分：它知道这个功能要哪些字段、该怎么校验。
 *    做成 `/submit?type=resource` 这种统一入口，就等于把所有类型的表单
 *    塞进一个组件里按类型分支 —— 加一类内容就要动公共页面，
 *    而公共页面上一个手滑影响的是全部类型。
 *
 *    通用的那一半是**审核**（审核员面对的是"所有待审内容"，
 *    见 /review），不是提交。两者通用性不同，所以路由结构也不同。
 *
 * 三道闸门在服务端（requireCapability 一次判完未登录/无权限/未验证），
 * 但界面必须在**用户开始填之前**就说清楚 —— 填完 3000 字才被拒是最糟的体验。
 * 所以这里先判一遍，判据和服务端同一份权限矩阵。
 */
export function SubmitResource() {
  const { t } = useTranslation();
  const auth = useAuth();
  const errorText = useApiErrorText();

  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<SubmissionErrorInfo | null>(null);
  const [done, setDone] = useState<SubmissionResult | null>(null);

  async function onSubmit(input: Parameters<typeof submitResource>[0]) {
    setFailure(null);
    setBusy(true);
    try {
      setDone(await submitResource(input));
    } catch (err) {
      /*
       * ⚠️ 这里**只**做"把错误翻译成人话"，不做任何判断。
       *
       *    "这个链接属于哪一种情况"由服务端算好随响应返回 —— 前端再判断一次
       *    就等于有了第二份规则，而两份规则分叉时不会有任何报错。
       *    （这里曾经判断过一个 `duplicate_url`，而服务端返回的是
       *      `url_exists`，结果所有情况都掉进兜底文案。见 submissionErrors.ts。）
       */
      setFailure(describeSubmissionError(err, t, errorText));
    } finally {
      setBusy(false);
    }
  }

  if (auth.loading) return <p className="state">{t('common.loading')}</p>;

  if (!auth.user) {
    return (
      <>
        <header className="pagehead">
          <h1 className="pagehead__title">{t('submit.pageTitle')}</h1>
        </header>
        <Notice kind="info">{t('submit.needLogin')}</Notice>
        <p className="submitgate">
          <Link className="cta" to={`/login?next=${encodeURIComponent('/resources/submit')}`}>
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
          <h1 className="pagehead__title">{t('submit.pageTitle')}</h1>
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

  if (done) {
    return (
      <>
        <header className="pagehead">
          <h1 className="pagehead__title">{t('submit.doneTitle')}</h1>
          <p className="pagehead__sub">{t('submit.doneSub')}</p>
        </header>
        <Notice kind="ok">{t('submit.doneRevision', { revision: done.revision })}</Notice>
        <div className="submitdone">
          <button type="button" className="cta" onClick={() => setDone(null)}>
            {t('submit.submitAnother')}
          </button>
          <Link className="authform__link" to="/me/submissions">
            {t('submit.viewMine')}
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="pagehead">
        <h1 className="pagehead__title">{t('submit.pageTitle')}</h1>
        <p className="pagehead__sub">{t('submit.subtitle')}</p>
      </header>

      {/* 说清楚"提交后不会立刻上线"，否则用户会以为提交失败又提交一遍。 */}
      <p className="submitnote">{t('submit.flowNote')}</p>

      {/*
        失败的提示**放在表单上方**，而且带一个能点的下一步。
        ⚠️ 只给一句"出错了"是不够的：用户唯一的反应是再点一次提交，
           然后再失败一次（这正是"经常出现红框"那次 bug 的样子）。
      */}
      {failure ? (
        <Notice kind="bad">
          {failure.message}
          {failure.action ? (
            <>
              {' '}
              <Link to={failure.action.to}>{t(failure.action.labelKey)}</Link>
            </>
          ) : null}
        </Notice>
      ) : null}

      <ResourceForm
        initial={emptyDraft()}
        actionLabel={t('submit.action')}
        busyLabel={t('submit.submitting')}
        busy={busy}
        serverError={null}
        onSubmit={onSubmit}
      />
    </>
  );
}
