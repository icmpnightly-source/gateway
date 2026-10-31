import { AutoComplete, Form, InputNumber, Select } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ClaimMapping, RateLimitSettings } from '@/types/gateway.types';
import { HEADER_PATTERN, isOrigin } from '../../utils/validation';
import { FeatureSection, ToggleRow } from './Section';

/** Limits on who may call the rule, and how often. */
export function ProtectionTab() {
  const { t } = useTranslation();
  const form = Form.useFormInstance();
  const limitBy = Form.useWatch(['rateLimit', 'by']) as RateLimitSettings['by'] | undefined;
  // The headers filled from the token: limiting by one of them counts per
  // token holder instead of per address. Preserved, as the list is unmounted
  // whenever the token section is off.
  const claims = (Form.useWatch(['token', 'claims'], { preserve: true }) ?? []) as (
    | Partial<ClaimMapping>
    | undefined
  )[];
  const tokenHeaders = claims.flatMap((mapping) => (mapping?.header ? [{ value: mapping.header }] : []));

  return (
    <div className="flex flex-col gap-(--c-spacing)">
      <FeatureSection
        toggle={['rateLimit', 'enabled']}
        title={t('gateway.rateLimit')}
        hint={t('gateway.rateLimitHint')}
      >
        <div className="grid gap-x-(--c-spacing-sm) gap-y-(--c-spacing-sm) sm:grid-cols-2">
          <Form.Item
            name={['rateLimit', 'perMinute']}
            label={t('gateway.rateLimitPerMinute')}
            className="mb-0!"
            rules={[{ required: true, message: t('gateway.rateLimitRequired') }]}
          >
            <InputNumber min={1} precision={0} className="w-full!" />
          </Form.Item>
          <Form.Item name={['rateLimit', 'by']} label={t('gateway.rateLimitBy')} className="mb-0!">
            <Select
              options={[
                { value: 'ip', label: t('gateway.rateLimitByIp') },
                { value: 'header', label: t('gateway.rateLimitByHeader') },
              ]}
            />
          </Form.Item>
          {limitBy === 'header' && (
            <Form.Item
              name={['rateLimit', 'header']}
              label={t('gateway.headerName')}
              tooltip={t('gateway.rateLimitHeaderHint')}
              className="mb-0! sm:col-span-2"
              rules={[
                { required: true, whitespace: true, message: t('gateway.headerRequired') },
                { pattern: HEADER_PATTERN, message: t('gateway.headerInvalid') },
              ]}
            >
              <AutoComplete options={tokenHeaders} placeholder="X-User-Id" />
            </Form.Item>
          )}
        </div>
      </FeatureSection>

      <FeatureSection toggle={['cors', 'enabled']} title={t('gateway.cors')} hint={t('gateway.corsHint')}>
        <div className="flex flex-col gap-(--c-spacing-sm)">
          <Form.Item
            name={['cors', 'origins']}
            label={t('gateway.corsOrigins')}
            tooltip={t('gateway.corsOriginsHint')}
            className="mb-0!"
            // Browsers refuse "any origin" together with credentials.
            dependencies={[['cors', 'credentials']]}
            rules={[
              {
                validator: (_, origins: string[] = []) => {
                  if (origins.length === 0) return Promise.reject(new Error(t('gateway.corsOriginsRequired')));
                  if (!origins.every(isOrigin)) return Promise.reject(new Error(t('gateway.corsOriginsInvalid')));
                  if (origins.includes('*') && form.getFieldValue(['cors', 'credentials'])) {
                    return Promise.reject(new Error(t('gateway.corsAnyWithCredentials')));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Select
              mode="tags"
              // Origins are typed, not chosen: nothing to list until then.
              notFoundContent={null}
              tokenSeparators={[',', ' ']}
              placeholder="https://app.example.com"
            />
          </Form.Item>
          <ToggleRow
            name={['cors', 'credentials']}
            label={t('gateway.corsCredentials')}
            hint={t('gateway.corsCredentialsHint')}
          />
        </div>
      </FeatureSection>
    </div>
  );
}
