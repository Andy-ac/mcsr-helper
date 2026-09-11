import { SITE } from '@mcsr/shared';
import { Button, SeedInput } from '@mcsr/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setLocale } from '@/i18n';
import { fetchHealth, type HealthResponse } from '@/lib/api';

type Health =
  | { state: 'loading' }
  | { state: 'ok'; data: HealthResponse }
  | { state: 'down'; error: string };

const NAV = [
  { key: 'nav.resources', milestone: 'M2' },
  { key: 'nav.calendar', milestone: 'M4' },
  { key: 'nav.seeds', milestone: 'M4' },
  { key: 'nav.videos', milestone: 'M4' },
  { key: 'nav.profile', milestone: 'M5' },
] as const;

export default function App() {
  const { t, i18n } = useTranslation();
  const [health, setHealth] = useState<Health>({ state: 'loading' });
  const [seed, setSeed] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal)
      .then((data) => setHealth({ state: 'ok', data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setHealth({ state: 'down', error: error instanceof Error ? error.message : String(error) });
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__mark" aria-hidden="true" />
          <span className="topbar__name">{t('common.appName')}</span>
          <span className="topbar__stage">M0</span>
        </div>

        <nav className="topbar__nav" aria-label="main">
          {NAV.map((item) => (
            <span
              key={item.key}
              className="navlink"
              aria-disabled="true"
              title={`${item.milestone}`}
            >
              {t(item.key)}
              <sup>{item.milestone}</sup>
            </span>
          ))}
        </nav>

        <div className="topbar__right">
          <fieldset className="langswitch">
            <legend className="sr-only">{t('nav.language')}</legend>
            <button
              type="button"
              className={i18n.language === 'zh-CN' ? 'is-active' : ''}
              onClick={() => setLocale('zh-CN')}
            >
              中文
            </button>
            <button
              type="button"
              className={i18n.language === 'en' ? 'is-active' : ''}
              onClick={() => setLocale('en')}
            >
              EN
            </button>
          </fieldset>
          <Button size="sm" variant="secondary" disabled>
            {t('nav.login')}
          </Button>
        </div>
      </header>

      <main className="main">
        <section className="hero">
          <h1 className="hero__title">{t('home.tagline')}</h1>
          <p className="hero__sub">{t('home.subtitle')}</p>
          <p className="hero__note">{t('home.comingSoon')}</p>
        </section>

        <section className="cards">
          <article className="card">
            <h2 className="card__title">API</h2>
            <HealthPill health={health} />
            <p className="card__meta">
              <code>GET /api/health</code>
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setHealth({ state: 'loading' });
                fetchHealth()
                  .then((data) => setHealth({ state: 'ok', data }))
                  .catch((error: unknown) =>
                    setHealth({
                      state: 'down',
                      error: error instanceof Error ? error.message : String(error),
                    }),
                  );
              }}
            >
              {t('common.retry')}
            </Button>
          </article>

          <article className="card">
            <h2 className="card__title">{t('seed.label')}</h2>
            <SeedInput
              label={t('seed.label')}
              value={seed}
              onChange={setSeed}
              placeholder={t('seed.placeholder')}
              hint={t('seed.hint')}
              invalidMessage={t('seed.invalid')}
            />
          </article>

          <article className="card card--muted">
            <h2 className="card__title">v1 plan</h2>
            <ul className="planlist">
              <li>
                <b>M1</b> users + email verification
              </li>
              <li>
                <b>M2</b> UGC pipeline + resource library
              </li>
              <li>
                <b>M3</b> Electron shell + auto-update
              </li>
              <li>
                <b>M4</b> calendar + videos + seed sharing
              </li>
              <li>
                <b>M5</b> profiles + follows + MC binding
              </li>
              <li>
                <b>M6</b> launch buffer
              </li>
            </ul>
            <p className="card__meta">
              <a href={`${SITE.productionOrigin}`} rel="noreferrer noopener" target="_blank">
                docs/v1-plan.md
              </a>
            </p>
          </article>
        </section>
      </main>

      <footer className="footer">
        <span>
          {t('common.appName')} · M0 skeleton · {new Date().getFullYear()}
        </span>
      </footer>
    </div>
  );
}

function HealthPill({ health }: { health: Health }) {
  const { t } = useTranslation();
  if (health.state === 'loading') {
    return <span className="pill pill--wait">{t('common.loading')}</span>;
  }
  if (health.state === 'down') {
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
