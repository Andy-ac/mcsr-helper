import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="state state--empty">
      <p className="state__title">{t('resources.notFound')}</p>
      <p>{t('resources.notFoundHint')}</p>
      <Link className="cta" to="/">
        {t('common.backHome')}
      </Link>
    </div>
  );
}
