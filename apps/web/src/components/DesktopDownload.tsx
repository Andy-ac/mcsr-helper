import { desktopBridge } from '@mcsr/shared/desktop';
import { useTranslation } from 'react-i18next';
import { useAsync } from '@/lib/useAsync';

interface ReleaseInfo {
  available: boolean;
  version?: string;
  file?: string;
  size?: number;
  releasedAt?: string | null;
}

/**
 * 桌面客户端的下载入口。
 *
 * ---------------------------------------------------------------------------
 * 三个"什么时候不显示"的判断，每一个都对应一种实际会发生的尴尬
 * ---------------------------------------------------------------------------
 *   1. **已经在桌面端里** —— 用户已经装好了，再劝他下载是纯噪音。
 *      判断依据是 preload 暴露的 window.mcsr（见 shared/desktop.ts）。
 *   2. **接口 404（还没发布过安装包）** —— 那是正常状态，不是错误。
 *      所以这里静默不渲染，而不是显示一个红色的"加载失败"。
 *   3. **加载中** —— 也不渲染。这个卡片在首页，先闪出一个空框再填内容
 *      比晚半秒出现更难看。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 为什么要主动提 SmartScreen
 * ---------------------------------------------------------------------------
 * 我们没有买代码签名证书（计划 §8 明确接受这个代价），所以用户第一次运行
 * 安装包时 Windows 会弹「Windows 已保护你的电脑 / 未知发布者」。
 *
 * 不提前说明的话，绝大多数人的反应是**关掉不装** —— 那是完全合理的反应，
 * 因为我们确实看起来像一个可疑程序。提前说清楚"会看到这个提示、点哪里"，
 * 是唯一能把这件事的影响降到最低的做法。
 */
export function DesktopDownload() {
  const { t } = useTranslation();
  const state = useAsync<ReleaseInfo>(
    (signal) =>
      fetch('/api/desktop/release', { signal }).then((r) => r.json() as Promise<ReleaseInfo>),
    [],
  );

  // 已经在桌面壳里就不用再劝他下载了
  if (desktopBridge()) return null;
  if (state.status !== 'ok' || !state.data.available) return null;

  const { version = '', file = '', size = 0 } = state.data;
  const href = `/installer/${encodeURIComponent(file)}`;
  const mb = size > 0 ? `${(size / 1024 / 1024).toFixed(0)} MB` : '';

  return (
    <section className="dlcard">
      <div className="dlcard__head">
        <h2 className="dlcard__title">{t('download.title')}</h2>
        <span className="dlcard__ver">v{version}</span>
      </div>

      <p className="dlcard__desc">{t('download.desc')}</p>

      <div className="dlcard__actions">
        <a className="cta" href={href} download>
          {t('download.action')}
          {mb ? <span className="dlcard__size">{mb}</span> : null}
        </a>
      </div>

      {/*
        ⚠️ 这一段不是"温馨提示"，是必需品。
        没有代码签名证书时 Windows 一定会拦，而用户不知道原因就会放弃安装。
      */}
      <details className="dlcard__note">
        <summary>{t('download.smartScreenSummary')}</summary>
        <p>{t('download.smartScreenBody')}</p>
      </details>
    </section>
  );
}
