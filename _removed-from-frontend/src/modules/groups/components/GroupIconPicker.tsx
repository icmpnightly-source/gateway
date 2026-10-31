import { GROUP_ICON_KEYS, GROUP_ICONS } from '../constants/groupIcons';

interface GroupIconPickerProps {
  /** Injected by Form.Item. */
  value?: string;
  onChange?: (icon: string) => void;
  color: string;
}

export function GroupIconPicker({ value, onChange, color }: GroupIconPickerProps) {
  return (
    <div className="grid grid-cols-8 gap-(--c-spacing-xxs) max-h-40 overflow-y-auto p-(--c-spacing-xxs) rounded-(--c-border-radius-lg) border border-line-soft">
      {GROUP_ICON_KEYS.map((key) => {
        const Icon = GROUP_ICONS[key];
        const selected = value === key;

        return (
          <button
            key={key}
            type="button"
            aria-label={key}
            aria-pressed={selected}
            onClick={() => onChange?.(key)}
            className="h-9 w-9 flex items-center justify-center rounded-(--c-border-radius-lg) transition-colors cursor-pointer"
            style={{
              backgroundColor: selected ? `${color}1f` : 'transparent',
              border: `1px solid ${selected ? color : 'transparent'}`,
            }}
          >
            <Icon size={18} color={selected ? color : undefined} />
          </button>
        );
      })}
    </div>
  );
}
