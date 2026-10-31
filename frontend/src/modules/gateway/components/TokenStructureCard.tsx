import { useState } from 'react';
import { Button, Card, Tag, Typography } from 'antd';
import { ScanText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Hint } from '@/components/Hint';
import type { TokenField } from '@/types/gateway.types';
import { fieldsOf } from '../utils/token';
import { SampleTokenInput } from './form/SampleTokenInput';

const { Text } = Typography;

function FieldTags({ fields }: { fields: TokenField[] }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap gap-(--c-spacing-xxs)">
      {fields.map((field) => (
        <Tag key={field.path} className="me-0!">
          <span className="font-mono">{field.path}</span>{' '}
          <Text type="secondary" className="text-xs!">
            {t(`gateway.fieldTypes.${field.type}`)}
          </Text>
        </Tag>
      ))}
    </div>
  );
}

interface TokenStructureCardProps {
  /** What the project's tokens are known to carry. */
  fields: TokenField[];
  saving: boolean;
  /** Called with the fields of a newly pasted sample, to become the project's. */
  onSave: (fields: TokenField[]) => Promise<void>;
}

/**
 * The shape of a project's tokens: what its works can pick fields from. Read
 * off a sample token, and read again whenever the tokens change shape.
 */
export function TokenStructureCard({ fields, saving, onSave }: TokenStructureCardProps) {
  const { t } = useTranslation();
  const [isAsking, setIsAsking] = useState(false);
  // The fields of the sample pasted just now, until saved or dropped.
  const [found, setFound] = useState<TokenField[]>();

  const close = () => {
    setIsAsking(false);
    setFound(undefined);
  };

  const save = async () => {
    if (!found) return;
    await onSave(found);
    close();
  };

  return (
    <Card
      className="border-line-soft! bg-container! shadow-(--c-box-shadow-card)!"
      styles={{ body: { padding: 16 } }}
    >
      <div className="flex flex-wrap items-center justify-between gap-(--c-spacing-sm)">
        <div className="flex min-w-0 items-center gap-(--c-spacing-xs)">
          <h2 className="m-0 text-sm font-semibold">{t('projects.structure')}</h2>
          <Hint text={t('projects.structureHint')} />
        </div>
        {!isAsking && (
          <Button icon={<ScanText size={14} />} onClick={() => setIsAsking(true)}>
            {fields.length > 0 ? t('gateway.sampleChange') : t('projects.structureAdd')}
          </Button>
        )}
      </div>

      <div className="mt-(--c-spacing-sm)">
        {fields.length > 0 ? (
          <FieldTags fields={fields} />
        ) : (
          <Text type="secondary">{t('projects.structureEmpty')}</Text>
        )}
      </div>

      {isAsking && (
        <div className="mt-(--c-spacing-sm) space-y-(--c-spacing-xs)">
          <SampleTokenInput onRead={(payload) => setFound(fieldsOf(payload))} />

          {found && (
            <div>
              <Text type="secondary" className="mb-(--c-spacing-xxs) block text-(length:--c-font-size-sm)!">
                {t('projects.structureFound')}
              </Text>
              <FieldTags fields={found} />
            </div>
          )}

          <div className="flex gap-(--c-spacing-xs)">
            <Button type="primary" disabled={!found} loading={saving} onClick={save}>
              {t('projects.save')}
            </Button>
            <Button onClick={close}>{t('projects.cancel')}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
