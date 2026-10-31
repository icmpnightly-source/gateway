import { Form, Input, InputNumber, Select, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '@/store';
import type { TokenVerification } from '@/types/gateway.types';
import { FeatureSection, ToggleRow } from './Section';

const { Text } = Typography;

const FIELD = ['token', 'verify'] as const;

/**
 * Whether a token's signature is checked, and against which secret. Secrets
 * are picked by name: their values are an administrator's to enter and
 * nobody's to see.
 */
export function VerificationSection() {
  const { t } = useTranslation();
  const secrets = useAppSelector((state) => state.secrets.items);
  // Preserved: the fields below aren't rendered while verification is off.
  const verify = Form.useWatch([...FIELD], { preserve: true }) as TokenVerification | undefined;

  return (
    <FeatureSection toggle={[...FIELD, 'enabled']} title={t('gateway.verify')} hint={t('gateway.verifyHint')}>
      <div className="space-y-(--c-spacing-sm)">
        <Form.Item
          name={[...FIELD, 'secretId']}
          label={t('gateway.verifySecret')}
          extra={secrets.length > 0 ? t('gateway.verifySecretHint') : t('gateway.noSecrets')}
          className="mb-0!"
          // "None yet" is kept as an empty string; the Select wants no value at all.
          getValueProps={(value?: string) => ({ value: value || undefined })}
          rules={[
            { required: true, message: t('gateway.verifySecretRequired') },
            {
              // The rule may still point at a secret that has since been deleted.
              validator: (_, value?: string) =>
                !value || secrets.some((secret) => secret.id === value)
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('gateway.verifySecretGone'))),
            },
          ]}
        >
          <Select
            placeholder={t('gateway.verifySecretPlaceholder')}
            notFoundContent={t('gateway.noSecrets')}
            options={secrets.map((secret) => ({
              value: secret.id,
              label: (
                <span className="flex items-center justify-between gap-(--c-spacing-xs)">
                  {secret.name}
                  <Text type="secondary" className="text-xs!">
                    {secret.algorithm}
                  </Text>
                </span>
              ),
            }))}
          />
        </Form.Item>

        <ToggleRow
          name={[...FIELD, 'checkExpiry']}
          label={t('gateway.checkExpiry')}
          hint={t('gateway.checkExpiryHint')}
        />
        {verify?.checkExpiry && (
          <Form.Item
            name={[...FIELD, 'leeway']}
            label={t('gateway.leeway')}
            extra={t('gateway.leewayHint')}
            className="mb-0!"
            rules={[{ required: true, message: t('gateway.leewayRequired') }]}
          >
            <InputNumber min={0} max={3600} precision={0} className="w-40!" />
          </Form.Item>
        )}

        <div className="grid gap-x-(--c-spacing-sm) sm:grid-cols-2">
          <Form.Item
            name={[...FIELD, 'issuer']}
            label={t('gateway.issuer')}
            extra={t('gateway.issuerHint')}
            className="mb-0!"
          >
            <Input allowClear placeholder="https://auth.example.com" />
          </Form.Item>
          <Form.Item
            name={[...FIELD, 'audience']}
            label={t('gateway.audience')}
            extra={t('gateway.audienceHint')}
            className="mb-0!"
          >
            <Input allowClear placeholder="orders-api" />
          </Form.Item>
        </div>
      </div>
    </FeatureSection>
  );
}
