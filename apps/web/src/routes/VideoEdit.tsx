import type { Video, VideoInput } from '@mcsr/shared/videos';
import { VideoInputSchema } from '@mcsr/shared/videos';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { Field, Notice } from '@/components/Form';
import { fetchMyVideos, fetchVideos, saveVideoDirect } from '@/lib/api';
import { useApiErrorText, useAuth } from '@/lib/auth';
import { directWriteNotice } from '@/lib/directWriteNotice';

/**
 * 改一条已贴的视频 —— `/videos/:id/edit`（需求②，t14）。
 *
 * ---------------------------------------------------------------------------
 * 为什么这是"改"而不是"绕过审核"
 * ---------------------------------------------------------------------------
 * 视频墙本来就不审核（Q6：贴了就可见）。所以这里没有"直编 vs 提审"的分叉，
 * 界面上也**不该**出现 `authoring.directSave` 那种带"（不审核）"的措辞 ——
 * 那会让人以为视频平时是要审的。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 取数据只有两条路，而且都不完美（这是服务端的形状决定的，不是选择）
 * ---------------------------------------------------------------------------
 * 全仓**没有**"按 id 取单条视频"的端点（只有 `/api/videos` 列表与 `/api/videos/mine`）。
 * 所以本页按顺序试：
 *   1. `GET /api/videos/mine` —— 含被隐藏的、作者自己的（默认 24 条足够）；
 *   2. 退到 `GET /api/videos?pageSize=100` 在**当页**里找那个 id
 *      —— 覆盖"editor 改别人贴的"（他们有 `content.author`）。
 * ⚠️ 第 2 步**只能看到第一页**（`/api/videos` 分页上限 100）。也就是说：
 *    **视频墙上第 100 条之后、且不是自己贴的**，这一页改不了 —— 它会显示"找不到"。
 *    这是**已知限制**，写在这里而不是假装支持：真正的修法是加一个
 *    `GET /api/videos/:id`，那属于服务端（不在本任务 inScope）。
 */
export function VideoEdit() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const errorText = useApiErrorText();

  const [video, setVideo] = useState<Video | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ url: '', title: '', startOffsetSec: '' });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (auth.loading) return;
    const controller = new AbortController();
    let active = true;

    (async () => {
      try {
        // 1) 先试"我贴的"（含被隐藏的）
        const mine = auth.user ? await fetchMyVideos(controller.signal).catch(() => null) : null;
        let found = mine?.items.find((v) => v.id === id) ?? null;

        // 2) 再退到公开列表（覆盖 editor 改别人贴的）
        if (!found) {
          const page = await fetchVideos({ pageSize: 100 }, controller.signal);
          found = page.items.find((v) => v.id === id) ?? null;
        }

        if (!active) return;
        if (!found) {
          /*
           * ⚠️⚠️ 这里是 captain 记在账上的那条**端点缺口**，别把它当成"提示写得不好"：
           *
           *   全仓**没有**"按 id 取单条视频、且对 `content.author` 开放（含隐藏行）"的端点：
           *     · `GET /api/videos`       —— 公开列表，**只含 `visible`**，而且只取得到前 100 条；
           *     · `GET /api/videos/mine`  —— 自己的（含隐藏）。
           *   ⇒ 于是有一个**窄缺口**：**别人隐藏的视频**（被治理者下架、又不是你自己贴的）
           *     **在这里加载不出来** —— 即使你有 `content.author`。
           *
           *   真正修法是加 `GET /api/videos/:id`（对 `content.author` 返回含隐藏行，与
           *   `/api/admin/...` 的既有范式一致）。⚠️ **本轮记账、不做**：那要改
           *   `services/api`（不在 `apps/web/` 的 inScope），而且 t21 正在动那一带。
           *
           * ⚠️ 文案现状：复用 `videos.loadFailed`。**它不够具体**（captain 的条件②要的是
           *   "这条视频现在不在公开列表里，也不是你贴的"），而那需要**一个新词条**；
           *   本仓的词条是**中英成对**且由 shared 侧维护，页面里造键会让界面冒原始 key。
           *   ⇒ 我**不自行造键**，把它列为"等 shared 加一条文案"的待办（见本任务 output）。
           */
          setLoadError(t('videos.loadFailed'));
          return;
        }
        setVideo(found);
        setDraft({
          url: videoUrlOf(found),
          title: found.title,
          startOffsetSec: found.startOffsetSec === null ? '' : String(found.startOffsetSec),
        });
      } catch (err) {
        if (!active) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLoadError(errorText(err));
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [id, auth.loading, auth.user, t, errorText]);

  async function save() {
    const offsetRaw = draft.startOffsetSec.trim();
    const payload: VideoInput = {
      url: draft.url.trim(),
      title: draft.title.trim(),
      startOffsetSec: offsetRaw === '' ? null : Number(offsetRaw),
    };

    /*
     * ⚠️ 用**共享 schema** 校验，不在界面里手写一遍「什么算合法链接」：
     *    手写一份就会与服务端漂移（界面放行、服务端拒绝，或者反过来）。
     *    字段级错误按 `path[0]` 归到对应输入框下面。
     */
    const parsed = VideoInputSchema.safeParse(payload);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? '');
        /*
         * ⚠️ 这里**不能**自己编一句"链接不合法"：
         *    本仓的词条是**中英成对**且由 shared 侧维护（`i18n-keys.test.ts` 守着对齐），
         *    在页面里造键会让界面上出现原始 key。
         *    所以字段级文案复用**既有的**那三句（`shared/videos.ts` 的 message 是中文写死的，
         *    直接用会在英文界面冒中文 —— 见 `lib/auth.tsx` 里那套映射存在的理由）。
         */
        if (field === 'title') next[field] = t('videos.errTitleRequired');
        else if (field === 'startOffsetSec') next[field] = t('videos.errStartOffset');
        else next[field] = t('videos.errUrlRequired');
      }
      setFieldErrors(next);
      return;
    }

    setFieldErrors({});
    setFailure(null);
    setBusy(true);
    try {
      const result = await saveVideoDirect(id, parsed.data);
      /*
       * ⚠️ 视频**没有审核**，所以 `liveRevisionUnchanged` 恒为 `false`。
       *    但**不能**因此只写一句"已更新"：视频有自己的可见性（`visible` / `hidden`），
       *    改一条**被隐藏**的视频时改动确实生效了、可它**仍然不在墙上** ——
       *    只说"已更新"会让作者以为它已经回到墙上了。
       *    所以把服务端**回读那一行的真实 `status`** 交给 `directWriteNotice`
       *    （判据只有那一处：`hidden` 时它会同时说"已生效 + 仍不在站上"）。
       *
       * ⚠️ 这里**直接传整个返回值**，而不是拼一个 `{ status: result.video.status, … }`：
       *    服务端已把 `status` 提到**顶层**（`routes/authoring.ts` 的 `PATCH /videos/:id`，
       *    与资源/日历两条直编改写同形），所以视频这条路径**不需要破例**。
       *    破例的写法会在这个文件里留下第二处"视频要特殊读 `video.status`"的知识，
       *    而下一个人改动响应形状时**只会去改另外两条**（那两条是同形的）。
       */
      setFlash(directWriteNotice(result, t));
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  if (auth.loading) return <p className="state">{t('common.loading')}</p>;

  /*
   * ⚠️ **故意没有** `useCan('content.author')` 的页面级拦截（captain 的条件①）：
   *    "谁能不能改这一条"只在服务端判（`PATCH /api/authoring/videos/:id` 挂着
   *    `requireCapability('content.author')`）。在页面里再判一次就是**第二份真相** ——
   *    服务端哪天收紧/放宽，界面不会跟着动，而漂移的两个方向都坏：
   *    "界面放行但服务端拒绝"（用户白填一遍）和"界面挡了但接口其实开着"。
   *    这里只拦**未登录**（那是"状态"不是"权限"，而且要给登录入口）。
   */
  if (!auth.user) {
    return (
      <>
        <header className="pagehead">
          <h1 className="pagehead__title">{t('edit.modifyAction')}</h1>
        </header>
        <Notice kind="info">{t('videos.mineNeedLogin')}</Notice>
        <p className="submitgate">
          <Link className="cta" to={`/login?next=${encodeURIComponent(`/videos/${id}/edit`)}`}>
            {t('nav.login')}
          </Link>
        </p>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <header className="pagehead">
          <h1 className="pagehead__title">{t('edit.modifyAction')}</h1>
        </header>
        <Notice kind="bad">{loadError}</Notice>
        <p className="submitgate">
          <Link className="cta" to="/videos">
            {t('videos.title')}
          </Link>
        </p>
      </>
    );
  }

  if (!video) return <p className="state">{t('common.loading')}</p>;

  return (
    <>
      <header className="pagehead">
        <Link className="detail__back" to="/videos">
          ← {t('videos.title')}
        </Link>
        <h1 className="pagehead__title">{t('edit.modifyAction')}</h1>
      </header>

      {flash ? <Notice kind="ok">{flash}</Notice> : null}
      {failure ? <Notice kind="bad">{failure}</Notice> : null}

      <Field
        id="ve-url"
        label={t('videos.url')}
        hint={fieldErrors.url ?? t('videos.errUrlRequired')}
      >
        <input
          id="ve-url"
          className="mcsr-field__input"
          value={draft.url}
          onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
        />
      </Field>

      <Field
        id="ve-title"
        label={t('videos.titleLabel')}
        hint={fieldErrors.title ?? t('videos.hintTitle')}
      >
        <input
          id="ve-title"
          className="mcsr-field__input"
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        />
      </Field>

      <Field
        id="ve-offset"
        label={t('videos.startOffset')}
        hint={fieldErrors.startOffsetSec ?? t('videos.hintStartOffset')}
      >
        <input
          id="ve-offset"
          className="mcsr-field__input"
          inputMode="numeric"
          placeholder={t('videos.startOffsetPlaceholder')}
          value={draft.startOffsetSec}
          onChange={(e) => setDraft((d) => ({ ...d, startOffsetSec: e.target.value }))}
        />
      </Field>

      <div className="authform__actions">
        <button type="button" className="cta" disabled={busy} onClick={() => void save()}>
          {busy ? t('videos.submitting') : t('common.save')}
        </button>
        <button
          type="button"
          className="ghostbtn"
          disabled={busy}
          onClick={() => void navigate('/videos')}
        >
          {t('common.cancel')}
        </button>
      </div>
    </>
  );
}

/**
 * 把一条视频还原成"用户当初贴的那种链接"。
 *
 * ⚠️ 这里**自己拼 URL** 是不得已的：接口只给 `platform` + `videoId`，没给原始链接
 *    （用户贴的那串不落库）。所以表单里显示的是**规范形式**，不是他当初粘的那串 ——
 *    用户改完保存后，存回去的也是这个规范形式。这一点在 `videos.hintUrl` 里说明了。
 * ⚠️ 各平台的规范形式与 `shared/videos.ts` 的 `buildEmbedUrl` 同源（那三个路径段是
 *    平台的公开约定）：B站 `video/BV…`、YouTube `watch?v=`、Twitch `videos/<数字>`。
 */
function videoUrlOf(video: Video): string {
  switch (video.platform) {
    case 'bilibili':
      return `https://www.bilibili.com/video/${video.videoId}`;
    case 'youtube':
      return `https://www.youtube.com/watch?v=${video.videoId}`;
    default:
      return `https://www.twitch.tv/videos/${video.videoId}`;
  }
}
