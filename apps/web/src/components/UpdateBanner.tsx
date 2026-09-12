import { desktopBridge, type UpdateStatus } from '@mcsr/shared/desktop';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * 自动更新的应用内提示条。
 *
 * ---------------------------------------------------------------------------
 * 为什么是网页里的一个组件，而不是主进程弹原生对话框
 * ---------------------------------------------------------------------------
 * 桌面壳加载的是**远程网页**（https://mcsrhelper.com），所以更新提示有两种做法：
 *
 *   A. 主进程用 dialog.showMessageBox 弹原生窗口
 *   B. 主进程把状态推给网页，网页渲染一个条
 *
 * 选了 B。理由是**改文案和样式不需要重新发版**：
 * 选 A 的话，"发现新版本"这句话、按钮上的字、甚至提示出现的位置，
 * 全都固化在已经装到用户机器上的那个 exe 里 —— 想改一个错别字都要发版，
 * 而用户还得先更新才能看到改好的更新提示（自举问题）。
 *
 * 代价：提示依赖网页能加载出来。但整个应用本来就依赖这一点
 * （M3 的设计就是"必须联网"，见 main.ts 的文件头），所以没有新增依赖。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 浏览器里必须安全地什么都不做
 * ---------------------------------------------------------------------------
 * 同一个 bundle 既跑在 Electron 里，也跑在浏览器里。
 * `window.mcsr` 在浏览器里是 undefined，所以**必须先判断再访问** ——
 * 直接读 `window.mcsr.update` 会抛 TypeError，而那是渲染期错误，
 * 后果是整页白屏（而不会只影响这个提示条）。
 */
export function UpdateBanner() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  /** 用户点了"稍后"，这次会话里就不再打扰他 */
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;

    const unsubscribe = bridge.update.onStatus(setStatus);

    /*
     * ⚠️ 订阅之后**立刻拉一次**当前状态。
     *
     * 主进程在应用启动时就开始检查更新，而这个组件要等远程网页加载完才挂载。
     * 检查早于挂载时那一次推送没有任何人收到 —— 不补这一拉的话，
     * 表现就是"明明有新版本却从不提示"，而且完全不报错。
     */
    void bridge.update
      .getStatus()
      .then(setStatus)
      .catch(() => {
        /* 拉不到就算了，后续推送仍然有效 */
      });

    return unsubscribe;
  }, []);

  const bridge = desktopBridge();
  if (!bridge || !status || dismissed) return null;

  // 没有可展示内容的几个状态直接不渲染，避免出现一条空白的横条
  if (status.state === 'idle' || status.state === 'unsupported') return null;

  let text: string;
  let action: { label: string; onClick: () => void } | null = null;
  let tone: 'info' | 'ok' | 'bad' = 'info';

  switch (status.state) {
    case 'checking':
      text = t('update.checking');
      break;

    case 'available':
      text = t('update.available', { version: status.version });
      action = { label: t('update.download'), onClick: () => bridge.update.download() };
      break;

    case 'downloading':
      // 源站没给 Content-Length 时 percent 是 null —— 显示成"正在下载…"
      // 而不是 "NaN%"。实测自己的 VPS 上有时候确实拿不到长度。
      text =
        status.percent === null
          ? t('update.downloadingNoPercent', { version: status.version })
          : t('update.downloading', {
              version: status.version,
              percent: String(Math.round(status.percent)),
            });
      break;

    case 'ready':
      text = t('update.ready', { version: status.version });
      tone = 'ok';
      action = { label: t('update.restart'), onClick: () => bridge.update.install() };
      break;

    case 'none':
      text = t('update.none');
      tone = 'ok';
      break;

    case 'error':
      text = t('update.error', { message: status.message });
      tone = 'bad';
      action = { label: t('update.retry'), onClick: () => bridge.update.check() };
      break;
  }

  return (
    <div className={`updatebar updatebar--${tone}`} role="status">
      <span className="updatebar__text">{text}</span>
      {action ? (
        <button type="button" className="updatebar__action" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
      <button
        type="button"
        className="updatebar__close"
        onClick={() => setDismissed(true)}
        aria-label={t('update.dismiss')}
        title={t('update.dismiss')}
      >
        ×
      </button>
    </div>
  );
}
