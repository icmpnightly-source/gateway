import { Link as RouterLink } from 'react-router-dom';
import { Form, InputNumber } from 'antd';
import { ScrollText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { requestsPath } from '@/router/routes';
import { FeatureSection, ToggleRow } from './Section';

interface TracingTabProps {
  /** Id of the rule being changed, for the link to its requests; unset for a new one. */
  ruleId?: string;
}

/** The requests log: what each request looked like coming in and going out. */
export function TracingTab({ ruleId }: TracingTabProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-(--c-spacing)">
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
