import { Button, Checkbox, Input } from 'antd';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Row } from '../../utils/run';

const SPARE: Row = { on: true, name: '', value: '' };

interface KeyValueRowsProps {
  rows: Row[];
  onChange: (rows: Row[]) => void;
  namePlaceholder?: string;
  valuePlaceholder?: string;
}

/**
 * Names and values, a row each: parameters, headers, a form's fields. There
 * is always an empty row at the end; typing into it adds it to the list.
 */
export function KeyValueRows({ rows, onChange, namePlaceholder, valuePlaceholder }: KeyValueRowsProps) {
  const { t } = useTranslation();
  const shown = [...rows, SPARE];

  const change = (index: number, changes: Partial<Row>) => {
    const next = shown.map((row, at) => (at === index ? { ...row, ...changes } : row));
    // The spare row is not one of the list until something is typed into it.
    onChange(next.filter((row, at) => at < rows.length || row.name !== '' || row.value !== ''));
  };

  return (
    <div className="flex flex-col gap-(--c-spacing-xs)">
      {shown.map((row, index) => {
        const isSpare = index === rows.length;

        return (
          // Keyed by place: a row has nothing else of its own, and the spare
          // one must stay the same field as it turns into a row.
          <div key={index} className="grid grid-cols-[24px_minmax(0,2fr)_minmax(0,3fr)_32px] items-center gap-(--c-spacing-xs)">
            <Checkbox
              checked={row.on}
              disabled={isSpare}
              aria-label={t('gateway.tester.rowOn')}
              onChange={(event) => change(index, { on: event.target.checked })}
            />
            <Input
              value={row.name}
              placeholder={namePlaceholder ?? t('gateway.tester.rowName')}
              aria-label={t('gateway.tester.rowName')}
              onChange={(event) => change(index, { name: event.target.value })}
            />
            <Input
              value={row.value}
              placeholder={valuePlaceholder ?? t('gateway.tester.rowValue')}
              aria-label={t('gateway.tester.rowValue')}
              onChange={(event) => change(index, { value: event.target.value })}
            />
            {!isSpare && (
              <Button
                type="text"
                danger
                aria-label={t('gateway.remove')}
                icon={<Trash2 size={14} />}
                onClick={() => onChange(rows.filter((_, at) => at !== index))}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
