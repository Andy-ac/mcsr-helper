import type { VideoPlatform } from '@mcsr/shared';
import type { Video } from '@mcsr/shared/videos';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { VideoEmbed } from '@/components/VideoEmbed';
import { deleteVideo, setVideoVisibility } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCan } from '@/lib/capabilities';

/**
 * 视频墙的一张卡片。
 *
 * ---------------------------------------------------------------------------
 * 「删除」在这张卡片上有**两种语义**，而且由身份决定
 * ---------------------------------------------------------------------------
 * 同一个 `DELETE /api/videos/:id`，返回的 `mode` 说明走的是哪一条：
 *   · 作者本人     → `deleted`，**真删**（行没了）
 *   · 有 resource.moderate 的人 → `hidden`，**隐藏**（墙上没了，作者还看得见，可恢复）
 *
 * ⚠️ 判定顺序是**先作者后治理者**，和服务端一致：管理员删自己贴的视频走真删。
 *    一个能治理全站的人，对自己那一条没有理由反而更弱。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 操作结果**不在这张卡片上显示**
 * ---------------------------------------------------------------------------
 * 一个很容易想到、而且确实错的写法：把结果（比如"已隐藏"）渲染成卡片里的一行绿字。
 * 隐藏和真删**都会让这张卡片从列表里消失**（列表紧接着会重拉），
 * 于是那句话和卡片一起被卸载掉了 —— 用户只看到一行东西不见了，没有任何解释。
 *
 * 所以结果交给页面显示（`onResult`）。页面上的提示不会随卡片一起消失，
 * 而且对"点完就没了"这种动作，一句留在页面上的话比什么都重要。
 *
 * ---------------------------------------------------------------------------
 * `changed: false` 是**成功**，不是错误
 * ---------------------------------------------------------------------------
 * 它表示"这次调用什么都没改"（已经是 hidden 了 / 这一刻它已经不在了）。
 * 服务端刻意把它做成 200 而不是 409（见数据层 setVideoVisibility 的注释）：
 * 这个接口的语义是 setter —— 用户要的结果已经达成，报错只会让界面显示一句
 * 用户无法处理的红字。所以这里也照这个意思显示"它本来就是那样"，
 * **不能**把它渲染成一个红框 —— 那正好把服务端特意避开的坑在界面上又挖了一遍。
 *
 * ---------------------------------------------------------------------------
 * 为什么删除要二次确认，而隐藏不要
 * ---------------------------------------------------------------------------
 * 删除不可撤销，而且它删掉的是"这个视频被贴上来过"这件事本身。
 * 隐藏完全可逆（恢复按钮就在旁边），为它加一道确认只会让治理动作变慢。
 * 二次确认做成**行内**的两步，不用 `window.confirm` ——
 * 那是一个原生弹窗，在 Electron 壳里的样式和整站完全无关，而且会阻塞渲染。
 */
export function VideoCard({
  video,
  onResult,
  onFilterAuthor,
  canAuthor = false,
}: {
  video: Video;
  /** 结果交给页面显示 —— 卡片自己要消失了，它说的话也会跟着消失。 */
  onResult: (ok: boolean, text: string) => void;
  /** 点作者名按作者筛选。只看自己那一片时不传（筛了也没有意义）。 */
  onFilterAuthor?: (authorId: string) => void;
  /**
   * 需求②（t14）：调用方按 `useCan('content.author')` 传进来，决定要不要给「编辑」链接。
   * ⚠️ 组件里**不判断能力**（见上面那段说明）；默认 `false` 是刻意的 ——
   *    忘了传的后果是"少一个入口"，而不是"多给一个不该有的入口"。
   */
  canAuthor?: boolean;
}) {
  const { t } = useTranslation();
  const auth = useAuth();
  const canModerate = useCan('resource.moderate');

  const [busy, setBusy] = useState<'delete' | 'restore' | null>(null);
  const [confirming, setConfirming] = useState(false);

  const isMine = Boolean(auth.user) && auth.user?.id === video.userId;
  const isHidden = video.status === 'hidden';

  async function remove() {
    setConfirming(false);
    setBusy('delete');
    try {
      const result = await deleteVideo(video.id);
      /*
       * ⚠️ 说什么由服务端的 `mode` 决定，不由前端猜身份。
       *    前端当然也能算出"我是不是作者"，但那是**第二份规则** ——
       *    它和服务端的分歧（比如作者已被删号）不会有任何东西报错，
       *    表现是"用户被告知已隐藏，实际那条已经被真删了"。
       */
      onResult(
        true,
        result.mode === 'deleted'
          ? result.changed
            ? t('videos.okDeleted')
            : t('videos.okDeleteNoop')
          : result.changed
            ? t('videos.okHidden')
            : t('videos.okHideNoop'),
      );
    } catch {
      onResult(false, t('videos.actionFailed'));
    } finally {
      setBusy(null);
    }
  }

  /**
   * 恢复。
   *
   * ⚠️ 只有恢复走 `PATCH /videos/:id/visibility`，隐藏不走这里 ——
   *    隐藏走的是 DELETE（治理者的那一条路），因为"拿掉这条内容"才是
   *    用户（和治理者）脑子里的那个动作，服务端据此把 mode 判成 hidden。
   *    而恢复没有对应的 DELETE 语义，所以它必须是一个明确的 setter：
   *    "把状态设成 visible"。
   */
  async function restore() {
    setBusy('restore');
    try {
      const result = await setVideoVisibility(video.id, 'visible');
      onResult(true, result.changed ? t('videos.okRestored') : t('videos.okRestoreNoop'));
    } catch {
      onResult(false, t('videos.actionFailed'));
    } finally {
      setBusy(null);
    }
  }

  /*
   * 主操作：自己的 → 删掉；别人的 + 有治理权 → 隐藏。
   * 两条都不满足的人什么也看不到 —— 那是纯浏览者，他没东西可管。
   */
  const primary = isMine ? (
    confirming ? (
      <>
        <span className="video-card__confirm">{t('videos.confirmDelete')}</span>
        <button
          type="button"
          className="dangerbtn"
          disabled={busy !== null}
          onClick={() => void remove()}
        >
          {busy === 'delete' ? t('videos.busyDeleting') : t('common.confirm')}
        </button>
        <button
          type="button"
          className="ghostbtn"
          disabled={busy !== null}
          onClick={() => setConfirming(false)}
        >
          {t('common.cancel')}
        </button>
      </>
    ) : (
      <button
        type="button"
        className="dangerbtn"
        disabled={busy !== null}
        onClick={() => setConfirming(true)}
      >
        {t('videos.delete')}
      </button>
    )
  ) : canModerate && !isHidden ? (
    <button
      type="button"
      className="dangerbtn"
      disabled={busy !== null}
      onClick={() => void remove()}
    >
      {busy !== null ? t('videos.busyHiding') : t('videos.hide')}
    </button>
  ) : null;

  /*
   * 「恢复」单独判一次，而不是塞进上面那条三分支里。
   *
   * ⚠️ 理由：它会和「删除」**同时出现**在一个特定的人身上 ——
   *    自己贴的视频被隐藏了、而自己又正好有 resource.moderate
   *    （editor / admin / owner）。塞进三分支的话，那一支会把恢复吞掉，
   *    于是"我自己的帖子被隐藏了"就变成一个没有出口的状态。
   *
   * ⚠️ 而普通作者**没有**这个按钮：他的能力里没有 resource.moderate，
   *    服务端会 403。给一个必然失败的按钮比不给更糟。
   */
  const restoreButton: ReactNode =
    canModerate && isHidden ? (
      <button
        type="button"
        className="ghostbtn"
        disabled={busy !== null}
        onClick={() => void restore()}
      >
        {busy === 'restore' ? t('videos.busyRestoring') : t('videos.restore')}
      </button>
    ) : null;

  return (
    <li className={`video-card${isHidden ? ' video-card--hidden' : ''}`}>
      <div className="video-card__head">
        <span className="badge badge--kind">{platformLabel(video.platform, t)}</span>
        {/*
          被隐藏的视频只会出现在「我贴的」里（公开列表根本不下发它们），
          所以这个徽章是**作者知道自己那条怎么了**的唯一线索。
          没有它，作者看到的是"我的帖子在这里但墙上没有"，只能自己猜。
        */}
        {isHidden ? <span className="badge badge--hidden">{t('videos.hiddenBadge')}</span> : null}
        {isMine ? <span className="badge badge--kind">{t('videos.mineBadge')}</span> : null}
        <h2 className="video-card__title">{video.title}</h2>
      </div>

      <div className="video-card__meta">
        {/*
          作者名是一个**筛选入口**：Q5b 要按作者筛选，而接口收的是 authorId
          （一个 UUID）。让人手输 UUID 是不现实的，所以唯一的自然入口就是
          "点这张卡上的作者名"。
        */}
        {onFilterAuthor && video.authorName ? (
          <button
            type="button"
            className="video-card__author"
            onClick={() => onFilterAuthor(video.userId)}
          >
            {video.authorName}
          </button>
        ) : (
          // 作者名可能为空（账号已注销）—— 那时的正确答案是**什么都不显示**，
          // 而不是显示一串 UUID 或者一个空的可点区域。
          <span>{video.authorName ?? ''}</span>
        )}
        <span className="video-card__date">
          {t('videos.postedAt', { date: new Date(video.createdAt).toLocaleDateString() })}
        </span>
      </div>

      <VideoEmbed video={video} />

      {primary || restoreButton || canAuthor ? (
        <div className="video-card__actions">
          {primary}
          {restoreButton}
          {/*
            「编辑」（需求②，t14）—— 只对 `content.author`（editor 及以上）出现。
            ⚠️ 视频本来就不走审核，所以这里是"改"而不是"绕过审核"（与资料/赛事不同）。
            ⚠️ 判据由调用方传进来（`useCan('content.author')`），组件里**不判断能力** ——
               组件自己写一份"谁是编辑"就是第二份真相。
            ⚠️ 文案用 `edit.modifyAction`（zh「修改」/ en「Edit」）—— 与资源详情页那个入口
               **同一个词条**。刻意不复用 `authoring.directSave`（那是"直接保存（不审核）"，
               一句话里带着"不审核"，出现在卡片上会与"视频本来就不审核"重复且更吓人）。
          */}
          {canAuthor ? (
            <Link className="ghostbtn" to={`/videos/${encodeURIComponent(video.id)}/edit`}>
              {t('edit.modifyAction')}
            </Link>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** 平台名走词条，不在组件里硬编码可见文字。 */
function platformLabel(platform: VideoPlatform, t: (key: string) => string): string {
  if (platform === 'bilibili') return t('videos.platformBilibili');
  if (platform === 'youtube') return t('videos.platformYoutube');
  return t('videos.platformTwitch');
}
