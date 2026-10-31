import { Form, Input, InputNumber, Typography } from 'antd';
import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { JAEGER_URL, TRACE_ID_HEADER } from '@/api/kong';
import { HEADER_PATTERN, isHttpUrl } from '../../utils/validation';
import { FeatureSection, ToggleRow } from './Section';

const { Link } = Typography;

/** Ways to follow one request across the gateway and the services behind it. */
export function TracingTab() {
  const { t } = useTranslation();
  const ruleName = Form.useWatch('name') as string | undefined;
  const recordsDetails = Form.useWatch(['tracing', 'details']) as boolean | undefined;

  return (
    <div className="space-y-(--c-spacing)">
      <FeatureSection
        toggle={['requestId', 'enabled']}
        title={t('gateway.requestId')}
        hint={t('gateway.requestIdHint')}
      >
        <div className="space-y-(--c-spacing-sm)">
          <Form.Item
            name={['requestId', 'header']}
            label={t('gateway.headerName')}
            className="mb-0!"
            rules={[
              { required: true, whitespace: true, message: t('gateway.headerRequired') },
              { pattern: HEADER_PATTERN, message: t('gateway.headerInvalid') },
            ]}
          >
            <Input placeholder="X-Request-Id" />
          </Form.Item>
          <ToggleRow
            name={['requestId', 'echo']}
            label={t('gateway.requestIdEcho')}
            hint={t('gateway.requestIdEchoHint')}
          />
        </div>
      </FeatureSection>

      <FeatureSection toggle={['tracing', 'enabled']} title={t('gateway.tracing')} hint={t('gateway.tracingHint')}>
        <div className="space-y-(--c-spacing-sm)">
          <Form.Item
            name={['tracing', 'endpoint']}
            label={t('gateway.tracingEndpoint')}
            extra={t('gateway.tracingEndpointHint')}
            className="mb-0!"
            rules={[
              { required: true, whitespace: true, message: t('gateway.tracingEndpointRequired') },
              {
                validator: (_, value?: string) =>
                  !value?.trim() || isHttpUrl(value.trim())
                    ? Promise.resolve()
                    : Promise.reject(new Error(t('gateway.destinationInvalid'))),
              },
            ]}
          >
            <Input placeholder="http://jaeger:4318/v1/traces" />
          </Form.Item>

          <div className="grid gap-x-(--c-spacing-sm) sm:grid-cols-2">
            <Form.Item
              name={['tracing', 'serviceName']}
              label={t('gateway.tracingService')}
              extra={t('gateway.tracingServiceHint')}
              className="mb-0!"
            >
              <Input allowClear placeholder={ruleName || 'orders-api'} />
            </Form.Item>
            <Form.Item
              name={['tracing', 'samplingPercent']}
              label={t('gateway.tracingSampling')}
              extra={t('gateway.tracingSamplingHint')}
              className="mb-0!"
              rules={[{ required: true, message: t('gateway.tracingSamplingRequired') }]}
            >
              <InputNumber min={1} max={100} precision={0} suffix="%" className="w-full!" />
            </Form.Item>
          </div>

          <ToggleRow
            name={['tracing', 'details']}
            label={t('gateway.tracingDetails')}
            hint={t('gateway.tracingDetailsHint')}
          />
          {recordsDetails && (
            <ToggleRow
              name={['tracing', 'body']}
              label={t('gateway.tracingBody')}
              hint={t('gateway.tracingBodyHint')}
            />
          )}

          <div className="text-(length:--c-font-size-sm) text-subtle">
            {recordsDetails && `${t('gateway.tracingWhere')} `}
            {t('gateway.tracingAdds', { header: TRACE_ID_HEADER })}{' '}
            <Link href={JAEGER_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1">
              {t('gateway.openJaeger')}
              <ExternalLink size={12} />
            </Link>
          </div>
        </div>
      </FeatureSection>
    </div>
  );
}
