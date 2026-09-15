import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { emText } from '@/components/Emphasis';
import { Notice } from '@/components/Form';
import { emptyDraft, ResourceForm } from '@/components/ResourceForm';
import { createResourceDirect, type SubmissionResult, submitResource } from '@/lib/api';
import { useApiErrorText, useAuth } from '@/lib/auth';
import { useCan } from '@/lib/capabilities';
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
  const navigate = useNavigate();
  /*
   * 需求②：只有 `content.author`（editor / admin / owner）才给「直接发布」。
   * ⚠️ 能力名从矩阵读，页面里不写"谁是编辑"——理由见 permissions.ts 的头注释。
   */
  const canAuthor = useCan('content.author');

  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<SubmissionErrorInfo | null>(null);
  const [done, setDone] = useState<SubmissionResult | null>(null);
  /**
   * 直编的结果提示（需求②）。与 `failure` **分开存**：两者可能同时存在
   * （一次直编失败不影响上一次提审失败的提示），合成一个会被静默覆盖。
   */
  const [directNotice, setDirectNotice] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(input: Parameters<typeof submitResource>[0]) {
    setFailure(null);
    setDirectNotice(null);
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

  /**
   * 「直接发布」（需求②）—— 新条目**直接上架**，不进审核队列。
   *
   * ⚠️ 成功后**不留在这个页面**：这里与提审不同 —— 提审完要去「我的提交」看进度，
   *    而直编已经生效了，用户下一步是去看那一条。留在原表单上会让人以为没提交成功。
   */
  async function onSubmitDirect(input: Parameters<typeof createResourceDirect>[0]) {
    setFailure(null);
    setDirectNotice(null);
    setBusy(true);
    try {
      const result = await createResourceDirect(input);
      setDirectNotice({ ok: true, text: t('authoring.published') });
      /*
       * 直编新建一律已上架（spec D2.8），所以下一步是去看那一条。
       * ⚠️ 用 `useNavigate` 而不是 `location.assign`：后者会**整页重载**，
       *    而这个应用是 SPA（整页重载会丢掉一次会话内的所有状态，也绕过了
       *    路由的视图过渡）。延迟 800ms 是为了让上面那句"已直接发布"能被读到 ——
       *    立刻跳走的话用户只看到页面闪了一下。
       */
      globalThis.setTimeout(() => {
        navigate(`/resources/${encodeURIComponent(result.id)}`);
      }, 800);
    } catch (err) {
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
      {directNotice ? (
        <Notice kind={directNotice.ok ? 'ok' : 'bad'}>{directNotice.text}</Notice>
      ) : null}

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
        /*
         * 「直接发布」（需求②）：只有 `content.author`（editor / admin / owner）看得到。
         * ⚠️ 它在这个页面上的意义是**跳过整条审核队列** —— 所以按钮文案里带着
         *    "（不审核）"，而且 `title` 用的是 `authoring.directHint`（把后果说全）。
         *    普通用户拿到的 `secondaryAction` 是 `undefined` ⇒ 按钮**根本不存在**，
         *    不是一个灰掉的按钮。
         * ⚠️ 这个页面上的判据就是 `content.author` 本身（新建内容还没有"这条的贡献者"
         *    可言 —— 贡献者是**逐条**的数据，得先有那一条），所以这里给
         *    `authoring.directHint` 是无条件正确的；编辑页那两句话之间要挑，
         *    因为它那里的按钮对贡献者也会出现。
         */
        secondaryAction={
          canAuthor
            ? {
                label: t('authoring.directPublish'),
                busyLabel: t('submit.submitting'),
                title: emText(t('authoring.directHint')),
                onSubmit: (s) => void onSubmitDirect(s),
              }
            : undefined
        }
      />
    </>
  );
}
