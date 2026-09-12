import type { EditableResource, ResourceDetail } from '@mcsr/shared/resources';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { Notice } from '@/components/Form';
import { draftFromResource, ResourceForm } from '@/components/ResourceForm';
import {
  ApiError,
  fetchResource,
  fetchResourceForEdit,
  type SubmissionResult,
  updateResource,
} from '@/lib/api';
import { useApiErrorText, useAuth } from '@/lib/auth';
import { useCan } from '@/lib/capabilities';
import { describeSubmissionError, type SubmissionErrorInfo } from '@/lib/submissionErrors';

/**
 * 修改一个已有条目 —— `/resources/:id/edit`。
 *
 * ---------------------------------------------------------------------------
 * 两条取内容路径，按"你凭什么看这条"分开
 * ---------------------------------------------------------------------------
 *   · `GET /api/resources/:id/edit` —— **作者本人**（任何状态）
 *     或**有 editUnpublished 的人**（editor / admin）。
 *     被驳回、还没过审的条目只有这条路拿得到内容，
 *     而"改一下重新提交"恰恰是从这里开始的。
 *   · 公开的 `GET /api/resources/:id` —— 已上架的条目。
 *     wiki 式编辑靠它：任何登录用户都能改已上架的内容
 *     （导入的 9 条老条目也是这么变成可维护的）。
 *
 * ⚠️ 顺序不能反：先试私有那条。反过来的话，作者会被公开接口的 404 挡住，
 *    看不到自己被驳回的原稿 —— 而那是他唯一的起点。
 */
export function EditResource() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const errorText = useApiErrorText();
  // 有审核权的人能从"有人在改"的提示里直接跳到那一份待审内容
  const canReview = useCan('resource.review');

  const [draft, setDraft] = useState<ReturnType<typeof draftFromResource> | null>(null);
  /** 现在这一条有没有别人提的、还在等审核的改动 */
  const [pendingRevision, setPendingRevision] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<SubmissionErrorInfo | null>(null);
  const [done, setDone] = useState<SubmissionResult | null>(null);

  useEffect(() => {
    if (auth.loading) return;
    const controller = new AbortController();
    let active = true;

    (async () => {
      try {
        /*
         * ⚠️ 顺序：先试"可编辑的内容"，再退回公开接口。
         *    反过来的话，作者会被公开接口的 404 挡住，看不到自己被驳回的原稿。
         */
        /*
         * ⚠️ 两个接口返回的**不是同一个类型**：编辑接口多一个 pendingRevision。
         *    写成一个联合类型即可 —— 后面只用到共同字段，外加那个可选的待审版本号。
         */
        type Editable = EditableResource | ResourceDetail;
        const editable: Editable | null = await fetchResourceForEdit(id, controller.signal).catch(
          () => null,
        );
        const resource = editable ?? (await fetchResource(id, controller.signal));
        if (!active) return;
        setDraft(draftFromResource(resource));
        /*
         * ⚠️ 待审状态必须在**打开页面时**就知道。
         *
         * 服务端本来就有一条规则："一条内容同时只允许一份待审修改"
         * （否则审核队列里会出现同一个条目的多条待审快照，批准了一条之后
         * 另一条算什么就说不清了）。但那条规则以前只在**提交时**才生效 ——
         * 第二个人会把整张表单填完、点提交，然后拿到 409，工作全白做。
         *
         * 现在它变成打开页面就看到的一句话。
         */
        setPendingRevision(
          editable && 'pendingRevision' in editable
            ? (editable as EditableResource).pendingRevision
            : null,
        );
      } catch (err) {
        if (!active) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLoadError(
          err instanceof ApiError && err.status === 404 ? t('edit.notFound') : t('edit.loadFailed'),
        );
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [id, auth.loading, t]);

  async function onSubmit(input: Parameters<typeof updateResource>[1]) {
    setFailure(null);
    setBusy(true);
    try {
      const result = await updateResource(id, input);
      setDone(result);
    } catch (err) {
      setFailure(describeSubmissionError(err, t, errorText));
    } finally {
      setBusy(false);
    }
  }

  /*
   * ★ 有人已经提了一份改动在等审核 —— **不要让他填表**。
   *
   * 这是"两个人同时改一条内容"在界面上的答案：
   *   · 服务端的规则是"一条内容同时只允许一份待审修改"（先到先得）；
   *   · 界面的责任是让第二个人**在动手之前**知道，
   *     而不是让他填完三百个字再被 409 拒绝。
   *
   * 为什么不做合并：两份对同一段正文的改动没有安全的自动合并方式，
   * 而"先到先得 + 让后来者看见前面那份"是唯一不会产生错误内容的做法。
   * 代价是后来者的输入会丢 —— 所以他更该在开始之前就知道。
   */
  if (pendingRevision !== null) {
    return (
      <>
        <header className="pagehead">
          <Link className="detail__back" to={`/resources/${encodeURIComponent(id)}`}>
            ← {t('resources.backToList')}
          </Link>
          <h1 className="pagehead__title">{t('edit.title')}</h1>
        </header>

        <Notice kind="info">{t('edit.busyNotice', { revision: pendingRevision })}</Notice>

        {/*
          有审核权的人（editor / admin）能直接看到那一份待审内容 ——
          这样"先到先得"就不是一句打发人的话，他至少能判断
          "要不要等"还是"我改完再批"。
        */}
        {canReview ? (
          <p className="submitgate">
            <Link className="cta" to={`/review/resource/${encodeURIComponent(id)}`}>
              {t('edit.busyGoReview')}
            </Link>
          </p>
        ) : null}

        <p className="submitgate">
          <Link className="authform__link" to={`/resources/${encodeURIComponent(id)}`}>
            {t('mine.openItem')}
          </Link>
        </p>
      </>
    );
  }

  if (auth.loading || (!draft && !loadError)) {
    return <p className="state">{t('common.loading')}</p>;
  }

  if (loadError) {
    return (
      <>
        <header className="pagehead">
          <h1 className="pagehead__title">{t('edit.title')}</h1>
        </header>
        <Notice kind="bad">{loadError}</Notice>
        <p className="submitgate">
          <Link className="cta" to="/resources">
            {t('resources.backToList')}
          </Link>
        </p>
      </>
    );
  }

  if (done) {
    return (
      <>
        <header className="pagehead">
          <h1 className="pagehead__title">{t('edit.doneTitle')}</h1>
          <p className="pagehead__sub">{t('edit.doneSub')}</p>
        </header>
        <Notice kind="ok">{t('submit.doneRevision', { revision: done.revision })}</Notice>
        <div className="submitdone">
          <Link className="cta" to="/me/submissions">
            {t('submit.viewMine')}
          </Link>
          <Link className="authform__link" to={`/resources/${encodeURIComponent(id)}`}>
            {t('mine.openItem')}
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="pagehead">
        <Link className="detail__back" to={`/resources/${encodeURIComponent(id)}`}>
          ← {t('resources.backToList')}
        </Link>
        <h1 className="pagehead__title">{t('edit.title')}</h1>
        <p className="pagehead__sub">{t('edit.subtitle')}</p>
      </header>

      {/*
        最该说清楚的一句话：改完之后**线上还是旧版**。
        不说的话，用户会以为自己的修改已经生效了 —— 然后发现页面上没变，
        于是再改一遍，然后得到 409。
      */}
      <p className="submitnote">{t('edit.liveUnchanged')}</p>

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
        initial={draft!}
        actionLabel={t('edit.action')}
        busyLabel={t('edit.submitting')}
        busy={busy}
        serverError={null}
        onSubmit={onSubmit}
      />

      <p className="submitgate">
        <button type="button" className="authform__link" onClick={() => navigate(-1)}>
          {t('common.cancel')}
        </button>
      </p>
    </>
  );
}
