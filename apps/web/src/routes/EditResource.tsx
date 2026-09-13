import type { EditableResource, ResourceDetail } from '@mcsr/shared/resources';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { em } from '@/components/Emphasis';
import { Notice } from '@/components/Form';
import { draftFromResource, ResourceForm } from '@/components/ResourceForm';
import {
  ApiError,
  deleteResourceDirect,
  fetchResource,
  fetchResourceForEdit,
  type SubmissionResult,
  saveResourceDirect,
  updateResource,
} from '@/lib/api';
import { useApiErrorText, useAuth } from '@/lib/auth';
import { useCan, useCanHardDelete } from '@/lib/capabilities';
import { directWriteNotice } from '@/lib/directWriteNotice';
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
  /*
   * 需求②：只有 `content.author`（editor / admin / owner）才给「直接保存」。
   * ⚠️ 能力名从矩阵读，**不在页面里写"谁是编辑"** —— 那样服务端放宽/收紧时
   *    界面不会跟着动，而漂移的两个方向都有害（详见 permissions.ts 的头注释）。
   */
  const canAuthor = useCan('content.author');
  /*
   * owner 专属：能跳过"先下架"直接真删（见下方删除区的注释）。
   * ⚠️ 它走**谓词**（`useCanHardDelete`）而不是 `useCan('content.hardDelete')` ——
   *    后者已经不存在了：shared 把"谁能真删"改成了写死在函数体里的谓词，
   *    理由是能力**可以被一行编辑授予出去**（加进 admin 那行看起来完全合理），
   *    而那样"只有 owner"会静默失效、测试还全绿。见 permissions.ts 的长注释。
   */
  const canHardDeleteNow = useCanHardDelete();

  const [draft, setDraft] = useState<ReturnType<typeof draftFromResource> | null>(null);
  /** 现在这一条有没有别人提的、还在等审核的改动 */
  const [pendingRevision, setPendingRevision] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<SubmissionErrorInfo | null>(null);
  const [done, setDone] = useState<SubmissionResult | null>(null);
  /**
   * 直编（需求②）的结果提示。
   *
   * ⚠️ 与 `failure` **分开存**：两者可能同时存在（比如刚被直编拒绝，
   *    但页面上还挂着上一次提审失败的提示），合成一个 state 会让后者被静默覆盖。
   */
  const [directNotice, setDirectNotice] = useState<{ ok: boolean; text: string } | null>(null);
  /** 删除区的行内两步确认（和 LiveManagePanel / VideoCard 同一条约定：不用 window.confirm） */
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
    setDirectNotice(null);
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

  /**
   * 「直接保存」（需求②）—— 写线上行、不进审核队列。
   *
   * ⚠️ 结果文案**读服务端的 `liveRevisionUnchanged`**，不按"我调的是直编端点"去推：
   *    同一个端点在"已发布"与"草稿/待审"两种条目上结果不同，推出来的那一种
   *    会对用户撒谎（把一条还没上线的草稿说成"已即时上线"）。
   */
  async function onSubmitDirect(input: Parameters<typeof saveResourceDirect>[1]) {
    setFailure(null);
    setDirectNotice(null);
    setBusy(true);
    try {
      const result = await saveResourceDirect(id, input);
      /*
       * ⚠️ 文案的判据抽在 `lib/directWriteNotice.ts` —— **不是为了复用，是为了能被断言**。
       *
       * 这一段原来写在这里的行内三元里，而且**写反了**：直编路径的
       * `liveRevisionUnchanged` 必然是 `false`（服务端创建与改写两处都返回 `false`），
       * 所以两个分支里只有一支可达，而它显示的是「已直接发布，线上已可见」——
       * 对一条**被下架**的条目就是假话（用户会因此不去点「恢复上架」）。
       *
       * 抽成纯函数之后，两个组合都真的被断言过（`scripts/authoringNotice.ts`），
       * 而那正是"看起来有两档、实际只有一档"这种错唯一能被抓住的方式。
       */
      setDirectNotice({ ok: true, text: directWriteNotice(result, t) });
    } catch (err) {
      const info = describeSubmissionError(err, t, errorText);
      setFailure(info);
      /*
       * ⚠️ 409 `already_pending` 时**额外说一句**（`authoring.alreadyPending`）：
       *    服务端拒绝直编的理由是"那条待审快照被批准时会静默回滚你这次的改动"，
       *    而通用文案只说"已经有人在改" —— 用户不知道该先干什么。
       */
      if (err instanceof ApiError && err.code === 'already_pending') {
        setDirectNotice({ ok: false, text: t('authoring.alreadyPending') });
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setConfirmingDelete(false);
    setDeleting(true);
    setFailure(null);
    setDirectNotice(null);
    try {
      await deleteResourceDirect(id);
      // 删掉之后这一页已经没有内容了 —— 回资源库，而不是留一个"找不到这条"的页面
      navigate('/resources', { replace: true });
    } catch (err) {
      setFailure(describeSubmissionError(err, t, errorText));
    } finally {
      setDeleting(false);
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
      <p className="submitnote">{em(t('edit.liveUnchanged'))}</p>

      {/*
        直编提示（需求②）。放在表单**上方**：它是"上一次操作的结果"，
        和下面的失败提示同一层级；放在表单下方会被长表单挤到屏幕外。
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
        initial={draft!}
        actionLabel={t('edit.action')}
        busyLabel={t('edit.submitting')}
        busy={busy}
        serverError={null}
        onSubmit={onSubmit}
        /*
         * 「直接保存」**只对 `content.author` 传下去**（需求②）。
         * ⚠️ 定义成 `undefined` 而不是"传一个 disabled 的按钮"：
         *    看不见比看得见点不动好，这是本仓一贯的立场（见 Layout.tsx 的注释）。
         */
        secondaryAction={
          canAuthor
            ? {
                label: t('authoring.directSave'),
                // 复用既有词条：不为一个忙碌态新造 key（§7.6 是最小集合）
                busyLabel: t('edit.submitting'),
                onSubmit: (s) => void onSubmitDirect(s),
              }
            : undefined
        }
      />

      {/*
        ======================================================================
        危险区：真删（需求②）—— **两档**（spec §3.2c / §7.4 的最终口径 (b)）
        ======================================================================

        ⚠️ 两档的分界**不在前端**，而是两类角色走**同一个端点**、由服务端按身份给不同结果：
          · **owner**（共享谓词 `canHardDelete(role)`，经 `useCanHardDelete()`）：
            路由传 `force: true` ⇒ **任何 status 都能一键真删**（不经过"先下架"）；
          · **editor / admin**（有 `content.author`）：路由传 `force: false` ⇒
            **内容还在线上**时回 **409 `invalid_state` + `reason: 'must_hide_first'`**，
            界面据此说"先下架，再删除"；**下架之后**同一个按钮就会成功。
          · 其它角色（含 reviewer / 普通用户）：**没有入口**（服务端 403）——
            按本仓一贯的立场：**看不见**比看得见点不动好。

        ⚠️ **不要**改回"只有 owner 能删"（那是我一度写错的版本）：需求② 的原话是
           「资料/视频/赛事/种子」的「修改/添加/删除」，把删除只留给 owner 等于
           把"editor 能删"整条削掉 —— spec `:780` 专门警告过这个读法。
           ⚠️ 写这句时**别在注释里连打 `*` 和 `/`**（比如"加粗的赛事斜体"那种写法会在
              JSX 注释里凑出一个提前闭合的 `*` + `/`，把整块 JSX 变成语法错 —— 我这次
              就是这么把文件写坏的，`tsc` 报的是"Invalid character"，指到第 365 行）。

        ⚠️ 为什么**不做**本地 `status === 'published'` 预判：那道"先下架"的前置检查
           能不能被跳过**只在服务端判断**。前端复制一份就会漂移，而漂移的两个方向
           分别是"界面禁用了但服务端其实放行"和"点了必然失败"。
           所以 editor 这一档**照常给按钮**，失败了就把服务端那句话显示出来
           （`must_hide_first` → `authoring.mustHideFirst`，见 submissionErrors.ts）。

        ⚠️ 确认文案用 `authoring.deleteImpact`：这是一次**不可逆**的动作，
           而且连带给删掉的是**别人**写的收藏、备注与评分 —— 一句没有信息量的
           "你确定吗"不足以让人意识到这一点。owner 与 editor 都要经过它。
      */}
      {canHardDeleteNow || canAuthor ? (
        <section className="dangerzone">
          <h2 className="dangerzone__title">{t('authoring.deleteTitle')}</h2>
          <p className="dangerzone__impact">{em(t('authoring.deleteImpact'))}</p>

          {/*
            ⚠️ 这一句**只对 editor/admin 那一档**出现（owner 走的是一键真删，不需要它）。
               它是"下一步该做什么"的说明，而不是一句拒绝 —— 差别参见 submissionErrors.ts
               里 `must_hide_first` 的注释：只被告知"不行"的编辑会反复重试。
          */}
          {!canHardDeleteNow ? (
            <p className="dangerzone__hint">{t('authoring.mustHideFirst')}</p>
          ) : null}

          {confirmingDelete ? (
            <div className="dangerzone__confirm">
              <button
                type="button"
                className="dangerbtn"
                disabled={deleting}
                onClick={() => void remove()}
              >
                {t('authoring.deleteConfirmYes')}
              </button>
              <button
                type="button"
                className="ghostbtn"
                disabled={deleting}
                onClick={() => setConfirmingDelete(false)}
              >
                {t('authoring.deleteConfirmNo')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="dangerbtn"
              disabled={busy || deleting}
              onClick={() => setConfirmingDelete(true)}
            >
              {t('authoring.deleteAction')}
            </button>
          )}
        </section>
      ) : null}

      <p className="submitgate">
        <button type="button" className="authform__link" onClick={() => navigate(-1)}>
          {t('common.cancel')}
        </button>
      </p>
    </>
  );
}
