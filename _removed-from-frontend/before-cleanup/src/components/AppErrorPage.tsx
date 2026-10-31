import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ErrorPage } from 'common-ui-theme';
import type { ErrorPageProps } from 'common-ui-theme';
import { ROUTES } from '@/router/routes';

/**
 * Wraps the design-system ErrorPage so it picks up the app locale and stays on
 * the client-side router instead of triggering a full page reload.
 */
export function AppErrorPage({ code }: Pick<ErrorPageProps, 'code'>) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <ErrorPage
      code={code}
      title={t(`errors.${code}.title`)}
      message={t(`errors.${code}.message`)}
      buttonText={t('errors.goHome')}
      onGoHome={() => navigate(ROUTES.DASHBOARD)}
    />
  );
}
