import { Form, Select } from 'antd';
import type { NamePath } from 'antd/es/form/interface';
import { useTranslation } from 'react-i18next';
import { isOrigin } from '../../utils/validation';
import { ToggleRow } from './Section';

/** The CORS plugin's settings: which web pages may call the work from a browser. */
export function CorsSettings({ base }: { base: (string | number)[] }) {
  const { t } = useTranslation();
  const form = Form.useFormInstance();
  const at = (...path: string[]): NamePath => [...base, ...path];

  return (
    <div className="flex flex-col gap-(--c-spacing-sm)">
      <Form.Item
        name={at('origins')}
        label={t('gateway.corsOrigins')}
        tooltip={t('gateway.corsOriginsHint')}
        className="mb-0!"
        // Browsers refuse "any origin" together with credentials.
        dependencies={[at('credentials')]}
        rules={[
          {
            validator: (_, origins: string[] = []) => {
              if (origins.length === 0) return Promise.reject(new Error(t('gateway.corsOriginsRequired')));
              if (!origins.every(isOrigin)) return Promise.reject(new Error(t('gateway.corsOriginsInvalid')));
              if (origins.includes('*') && form.getFieldValue(at('credentials'))) {
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
      <ToggleRow name={at('credentials')} label={t('gateway.corsCredentials')} hint={t('gateway.corsCredentialsHint')} />
    </div>
  );
}
