import { Link as RouterLink } from 'react-router-dom';
import { Form, Input, InputNumber } from 'antd';
import { ScrollText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { requestsPath } from '@/router/routes';
import { HEADER_PATTERN } from '../../utils/validation';
import { FeatureSection, ToggleRow } from './Section';

interface TracingTabProps {
  /** Id of the rule being changed, for the link to its requests; unset for a new one. */
  ruleId?: string;
}

/** Ways to follow one request through the gateway and the services behind it. */
export function TracingTab({ ruleId }: TracingTabProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-(--c-spacing)">
      <FeatureSection
        toggle={['requestId', 'enabled']}
        title={t('gateway.requestId')}
        hint={t('gateway.requestIdHint')}
      >
        <div className="flex flex-col gap-(--c-spacing-sm)">
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
        <div className="flex flex-col gap-(--c-spacing-sm)">
          <Form.Item
            name={['tracing', 'samplingPercent']}
            label={t('gateway.tracingSampling')}
            tooltip={t('gateway.tracingSamplingHint')}
            className="mb-0!"
            rules={[{ required: true, message: t('gateway.tracingSamplingRequired') }]}
          >
            <InputNumber min={1} max={100} precision={0} suffix="%" className="w-40!" />
          </Form.Item>

          <ToggleRow name={['tracing', 'body']} label={t('gateway.tracingBody')} hint={t('gateway.tracingBodyHint')} />

          <RouterLink to={requestsPath({ workId: ruleId })} className="inline-flex items-center gap-1 self-start">
            <ScrollText size={14} />
            {t('gateway.openLog')}
          </RouterLink>
        </div>
      </FeatureSection>
    </div>
  );
}
