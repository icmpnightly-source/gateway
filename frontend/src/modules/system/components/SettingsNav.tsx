import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SETTINGS_PARAM, settingsPath, settingsSection } from '@/router/routes';
import type { SettingsSection } from '@/router/routes';
import { useAppSelector } from '@/store';
import { SETTINGS_ITEMS } from '../sections';

// As a row of the projects' tree looks: only its colours change under the pointer.
const ROW =
  'flex h-9 w-full cursor-pointer items-center gap-(--c-spacing-xs) rounded-(--c-border-radius) border-0 px-(--c-spacing-xs) text-start outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-inset';

/** The settings' sections down the side: one is open at a time. */
export function SettingsNav() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const status = useAppSelector((state) => state.system.status);

  const hasWindow = status?.hasWindow ?? false;
  const current = settingsSection(searchParams.get(SETTINGS_PARAM), hasWindow);

  // What is wrong, or right, with a section is seen before it is opened.
  const isUp: Partial<Record<SettingsSection, boolean>> = {};
  if (status) isUp.gateway = status.gateway.running;
  if (status?.database.used) isUp.database = status.database.connected;

  return (
    <aside className="flex h-dvh w-64 shrink-0 flex-col border-r border-line-soft bg-container">
      <div className="flex h-14 shrink-0 items-center px-(--c-spacing)">
        <span className="text-base font-semibold">{t('system.title')}</span>
      </div>

      <nav aria-label={t('system.title')} className="flex flex-col gap-0.5 px-(--c-spacing-xs)">
        {SETTINGS_ITEMS.filter(({ id }) => id !== 'window' || hasWindow).map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            aria-current={id === current ? 'page' : undefined}
            onClick={() => navigate(settingsPath(id))}
            className={`${ROW} ${id === current ? 'bg-brand/10 font-medium text-brand' : 'bg-transparent text-body hover:bg-layout'}`}
          >
            <Icon size={16} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t(label)}</span>
            {id in isUp && (
              <span className={`size-2 shrink-0 rounded-full ${isUp[id] ? 'bg-success' : 'bg-error'}`} aria-hidden />
            )}
          </button>
        ))}
      </nav>
    </aside>
  );
}
