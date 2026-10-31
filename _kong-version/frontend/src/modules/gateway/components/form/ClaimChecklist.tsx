import { Button, Checkbox, Input, Typography } from 'antd';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ClaimMapping, TokenField } from '@/types/gateway.types';
import { suggestHeader, valueAt } from '../../utils/token';
import { HEADER_PATTERN } from '../../utils/validation';

const { Text } = Typography;

const PREVIEW_LENGTH = 24;

function preview(value: unknown) {
  const text = JSON.stringify(value) ?? '';
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text;
}

const ROW = 'flex flex-wrap items-center gap-x-(--c-spacing-xs) gap-y-(--c-spacing-xxs) py-(--c-spacing-xxs)';

interface TargetProps {
  mapping: ClaimMapping;
  onChange: (mapping: ClaimMapping) => void;
}

/** Where a chosen field goes: the header it is sent in, and whether a token must have it. */
function Target({ mapping, onChange }: TargetProps) {
  const { t } = useTranslation();

  return (
    <>
      <ArrowRight size={16} className="shrink-0 text-subtle" />
      <Input
        value={mapping.header}
        onChange={(event) => onChange({ ...mapping, header: event.target.value })}
        status={HEADER_PATTERN.test(mapping.header.trim()) ? undefined : 'error'}
        placeholder="X-User-Id"
        aria-label={t('gateway.header')}
        className="w-44!"
      />
      <Checkbox
        checked={mapping.required}
        onChange={(event) => onChange({ ...mapping, required: event.target.checked })}
      >
        {t('gateway.claimIsRequired')}
      </Checkbox>
    </>
  );
}

interface ClaimChecklistProps {
  /** The fields tokens are known to carry, to pick from. */
  fields: TokenField[];
  /** The payload of a token pasted just now: its values are shown next to the fields. */
  sample?: Record<string, unknown>;
  // Supplied by the Form.Item this sits in.
  value?: ClaimMapping[];
  onChange?: (value: ClaimMapping[]) => void;
}

/**
 * Which token fields the destination gets: tick the ones to send. Fields the
 * sample doesn't have can still be added by name.
 */
export function ClaimChecklist({ fields, sample, value = [], onChange }: ClaimChecklistProps) {
  const { t } = useTranslation();

  const known = new Set(fields.map((field) => field.path));
  const replace = (index: number, mapping: ClaimMapping) =>
    onChange?.(value.map((current, at) => (at === index ? mapping : current)));
  const remove = (index: number) => onChange?.(value.filter((_, at) => at !== index));

  return (
    <div>
      {fields.map((field) => {
        const index = value.findIndex((mapping) => mapping.claim === field.path);
        const mapping = value[index];

        return (
          <div key={field.path} className={ROW}>
            <Checkbox
              checked={mapping !== undefined}
              onChange={(event) =>
                event.target.checked
                  ? onChange?.([...value, { claim: field.path, header: suggestHeader(field.path), required: false }])
                  : remove(index)
              }
              className="min-w-0 flex-1"
            >
              <span className="font-mono">{field.path}</span>{' '}
              <Text type="secondary" className="font-mono text-xs!">
                {sample ? preview(valueAt(sample, field.path)) : t(`gateway.fieldTypes.${field.type}`)}
              </Text>
            </Checkbox>
            {mapping && <Target mapping={mapping} onChange={(next) => replace(index, next)} />}
          </div>
        );
      })}

      {/* Fields added by name: the sample doesn't have them, a real token may. */}
      {value.map((mapping, index) =>
        known.has(mapping.claim) ? null : (
          // Keyed by position: the name is what is being typed.
          <div key={index} className={ROW}>
            <Input
              value={mapping.claim}
              onChange={(event) => replace(index, { ...mapping, claim: event.target.value })}
              status={mapping.claim.trim() ? undefined : 'error'}
              placeholder="user.email"
              aria-label={t('gateway.claim')}
              className="min-w-0 flex-1 font-mono"
            />
            <Target mapping={mapping} onChange={(next) => replace(index, next)} />
            <Button
              type="text"
              danger
              aria-label={t('gateway.remove')}
              icon={<Trash2 size={14} />}
              onClick={() => remove(index)}
            />
          </div>
        ),
      )}

      <Button
        type="dashed"
        size="small"
        icon={<Plus size={14} />}
        onClick={() => onChange?.([...value, { claim: '', header: '', required: false }])}
        className="mt-(--c-spacing-xxs)"
      >
        {t('gateway.addClaim')}
      </Button>
    </div>
  );
}
