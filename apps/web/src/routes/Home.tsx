import { Button } from '@mcsr/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { fetchHealth, type HealthResponse } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';

type Health =
  | { state: 'loading' }
  | { state: 'ok'; data: HealthResponse }
  | { state: 'down'; error: string };

export function Home() {
  const { t } = useTranslation();
  const [reloadKey, setReloadKey] = useState(0);
  const health = useAsync<HealthResponse>((signal) => fetchHealth(signal), [reloadKey]);

  return (
    <>
      <section className="hero">
        <h1 className="hero__title">{t('home.tagline')}</h1>
        <p className="hero__sub">{t('home.subtitle')}</p>
        <p className="hero__actions">
          <Link to="/resources" className="cta">
            {t('resources.title')} →
          </Link>
        </p>
      </section>

      <section className="cards">
        <article className="card">
          <h2 className="card__title">API</h2>
          <HealthPill health={health} />
          <p className="card__meta">
            <code>GET /api/health</code>
          </p>
          <Button size="sm" variant="ghost" onClick={() => setReloadKey((k) => k + 1)}>
            {t('common.retry')}
          </Button>
        </article>

        <article className="card card--muted">
          <h2 className="card__title">M1</h2>
          <ul className="planlist">
            <li>
              <b>已完成</b> 资源库（浏览 / 搜索 / 筛选）
            </li>
            <li>
              <b>M2</b> 用户系统 + 邮箱验证 + 提交与审核
            </li>
            <li>
              <b>M3</b> Electron 桌面壳 + 自动更新
            </li>
            <li>
              <b>M4</b> 日历 + 视频 + 种子分享
            </li>
          </ul>
        </article>
      </section>
    </>
  );
}

function HealthPill({ health }: { health: ReturnType<typeof useAsync<HealthResponse>> }) {
  const { t } = useTranslation();
  if (health.status === 'loading') {
    return <span className="pill pill--wait">{t('common.loading')}</span>;
  }
  if (health.status === 'error') {
    return (
      <span className="pill pill--bad" title={health.error}>
        {t('common.error')}: {health.error}
      </span>
    );
  }
  return (
    <span className="pill pill--ok">
      {health.data.status} · v{health.data.version} ·{' '}
      {new Date(health.data.time).toLocaleTimeString()}
    </span>
  );
}
