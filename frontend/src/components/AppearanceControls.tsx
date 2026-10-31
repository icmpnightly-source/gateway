import type { ReactNode } from 'react';
import { Segmented, Tooltip } from 'antd';
import { Check, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/useTheme';
import type { ThemeMode } from '@/hooks/useTheme';

const LANGUAGES = [
  { value: 'uz', label: "O'zbekcha" },
  { value: 'ru', label: 'Русский' },
];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-(--c-spacing)">
      <span className="text-muted">{label}</span>
      {children}
    </div>
  );
}

/** How the app looks to whoever is at this computer: its language, light or dark, and its colour. */
export function AppearanceControls() {
  const { t, i18n } = useTranslation();
  const { mode, color, setMode, changeColor, themeOptions } = useTheme();

  const changeLanguage = (language: string) => {
    void i18n.changeLanguage(language);
    localStorage.setItem('lang', language);
  };

  return (
    <div className="flex flex-col gap-(--c-spacing-sm)">
      <Row label={t('appearance.language')}>
        <Segmented size="small" value={i18n.resolvedLanguage ?? i18n.language} onChange={changeLanguage} options={LANGUAGES} />
      </Row>

      <Row label={t('appearance.mode')}>
        <Segmented<ThemeMode>
          size="small"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'light', icon: <Sun size={14} className="align-[-2px]" />, label: t('appearance.light') },
            { value: 'dark', icon: <Moon size={14} className="align-[-2px]" />, label: t('appearance.dark') },
          ]}
        />
      </Row>

      <Row label={t('appearance.color')}>
        <div className="flex gap-(--c-spacing-xs)" role="radiogroup" aria-label={t('appearance.color')}>
          {themeOptions.map(({ value, label }) => (
            <Tooltip key={value} title={label}>
              <button
                type="button"
                role="radio"
                aria-checked={value === color}
                aria-label={label}
                onClick={() => changeColor(value)}
                // The theme's own class on the button, so that its colour is the one shown.
                className={`${value} flex size-6 cursor-pointer items-center justify-center rounded-full border-0 p-0 text-white outline-offset-2 focus-visible:outline-2 focus-visible:outline-(--c-color-primary)`}
                style={{ background: 'var(--c-color-primary)' }}
              >
                {value === color && <Check size={14} strokeWidth={3} />}
              </button>
            </Tooltip>
          ))}
        </div>
      </Row>
    </div>
  );
}
