import { useState } from 'react';
import { AutoComplete, Button, Form, Input, Select, Typography } from 'antd';
import { Plus, ScanText, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ClaimMapping, TokenField } from '@/types/gateway.types';
import { HEADER_PATTERN } from '../../utils/validation';
import { ClaimChecklist } from './ClaimChecklist';
import { SampleTokenInput } from './SampleTokenInput';
import { FeatureSection, Section, ToggleRow } from './Section';
import { VerificationSection } from './VerificationSection';

const { Text } = Typography;

const CONDITION_GRID = 'grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_32px] gap-(--c-spacing-xs)';

interface TokenTabProps {
  /** The fields tokens are known to carry: the project's, or a sample's pasted just now. */
  fields: TokenField[];
  /** The payload of that sample, if one was pasted. */
  sample?: Record<string, unknown>;
  onSample: (payload: Record<string, unknown>) => void;
}

/** What the gateway reads from the token, passes on, and insists on. */
export function TokenTab({ fields, sample, onSample }: TokenTabProps) {
  const { t } = useTranslation();
  const isOn = Form.useWatch(['token', 'enabled']) as boolean | undefined;
  // With no fields known yet, a sample is what there is to start from.
  const [isAskingForSample, setIsAskingForSample] = useState(false);
  const showsSampleInput = fields.length === 0 || isAskingForSample;

  return (
    <div className="space-y-(--c-spacing)">
      <FeatureSection toggle={['token', 'enabled']} title={t('gateway.token')} hint={t('gateway.tokenHint')}>
        <div className="space-y-(--c-spacing-sm)">
          <Form.Item
            name={['token', 'header']}
            label={t('gateway.tokenHeader')}
            extra={t('gateway.tokenHeaderHint')}
            className="mb-0!"
            rules={[
              { required: true, whitespace: true, message: t('gateway.headerRequired') },
              { pattern: HEADER_PATTERN, message: t('gateway.headerInvalid') },
            ]}
          >
            <Input placeholder="Authorization" />
          </Form.Item>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-(--c-spacing-xs)">
              <div className="font-medium">{t('gateway.claims')}</div>
              {fields.length > 0 && (
                <Button
                  type={isAskingForSample ? 'primary' : 'default'}
                  size="small"
                  icon={<ScanText size={14} />}
                  onClick={() => setIsAskingForSample(!isAskingForSample)}
                >
                  {t('gateway.sampleChange')}
                </Button>
              )}
            </div>
            <Text type="secondary" className="mb-(--c-spacing-xs) block text-(length:--c-font-size-sm)!">
              {fields.length > 0 ? t('gateway.claimsHint') : t('gateway.claimsEmptyHint')}
            </Text>

            {showsSampleInput && (
              <div className="mb-(--c-spacing-xs)">
                <SampleTokenInput onRead={onSample} />
              </div>
            )}

            <Form.Item
              name={['token', 'claims']}
              className="mb-0!"
              rules={[
                {
                  validator: (_, mappings: ClaimMapping[] = []) =>
                    mappings.every(
                      (mapping) => mapping.claim.trim() && HEADER_PATTERN.test(mapping.header.trim()),
                    )
                      ? Promise.resolve()
                      : Promise.reject(new Error(t('gateway.claimsInvalid'))),
                },
              ]}
            >
              <ClaimChecklist fields={fields} sample={sample} />
            </Form.Item>
          </div>

          <Form.Item
            name={['token', 'payloadHeader']}
            label={t('gateway.payloadHeader')}
            extra={t('gateway.payloadHeaderHint')}
            className="mb-0!"
            rules={[{ pattern: HEADER_PATTERN, message: t('gateway.headerInvalid') }]}
          >
            <Input allowClear placeholder="X-Token-Payload" />
          </Form.Item>

          <ToggleRow
            name={['token', 'forwardToken']}
            label={t('gateway.forwardToken')}
            hint={t('gateway.forwardTokenHint')}
          />
          <ToggleRow name={['token', 'strict']} label={t('gateway.strict')} hint={t('gateway.strictHint')} />
        </div>
      </FeatureSection>

      {isOn && (
        <>
          <Section title={t('gateway.conditions')} hint={t('gateway.conditionsHint')}>
            <Form.List name={['token', 'conditions']}>
              {(rows, { add, remove }) => (
                <div className="space-y-(--c-spacing-xs)">
                  {rows.length > 0 && (
                    <div className={`${CONDITION_GRID} text-(length:--c-font-size-sm) text-subtle`}>
                      <span>{t('gateway.claim')}</span>
                      <span>{t('gateway.conditionValues')}</span>
                    </div>
                  )}

                  {rows.map((row) => (
                    <div key={row.key} className={`${CONDITION_GRID} items-start`}>
                      <Form.Item
                        name={[row.name, 'claim']}
                        className="mb-0!"
                        rules={[{ required: true, whitespace: true, message: t('gateway.claimRequired') }]}
                      >
                        <AutoComplete
                          options={fields.map((field) => ({ value: field.path }))}
                          placeholder="role"
                          aria-label={t('gateway.claim')}
                        />
                      </Form.Item>
                      <Form.Item
                        name={[row.name, 'values']}
                        className="mb-0!"
                        rules={[{ required: true, type: 'array', min: 1, message: t('gateway.conditionValuesRequired') }]}
                      >
                        <Select
                          mode="tags"
                          // Values are typed, not chosen: nothing to list until then.
                          notFoundContent={null}
                          tokenSeparators={[',']}
                          placeholder="admin, manager"
                          aria-label={t('gateway.conditionValues')}
                        />
                      </Form.Item>
                      <Button
                        type="text"
                        danger
                        aria-label={t('gateway.remove')}
                        icon={<Trash2 size={14} />}
                        onClick={() => remove(row.name)}
                      />
                    </div>
                  ))}

                  <Button
                    type="dashed"
                    size="small"
                    icon={<Plus size={14} />}
                    onClick={() => add({ claim: '', values: [] })}
                  >
                    {t('gateway.addCondition')}
                  </Button>
                </div>
              )}
            </Form.List>
          </Section>

          <VerificationSection />
        </>
      )}
    </div>
  );
}
