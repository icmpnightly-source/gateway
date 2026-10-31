import { useEffect, useState } from 'react';
import { Form, Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import { newRule } from '@/api/works';
import type { GatewayRule, GatewayRulePayload, Project, TokenField } from '@/types/gateway.types';
import { ProtectionTab } from './form/ProtectionTab';
import { RequestTab } from './form/RequestTab';
import { TokenTab } from './form/TokenTab';
import { TracingTab } from './form/TracingTab';
import { RequestPreview } from './RequestPreview';
import { fieldsOf } from '../utils/token';

/** Ties a Save button elsewhere on the page to the form: give it `form={RULE_FORM_ID}`. */
export const RULE_FORM_ID = 'gateway-rule-form';

type TabKey = 'request' | 'token' | 'tracing' | 'protection';

// The tab each top-level form field is on; the rest are on the first.
const TAB_OF_FIELD: Record<string, TabKey> = {
  token: 'token',
  requestId: 'tracing',
  tracing: 'tracing',
  rateLimit: 'protection',
  cors: 'protection',
};

/**
 * The rule the form's values describe: text trimmed, and rows left half-filled
 * dropped (inside a switched-off section they were never validated).
 */
function toPayload(values: GatewayRulePayload): GatewayRulePayload {
  const { token, requestId, tracing, rateLimit, cors } = values;

  return {
    name: values.name.trim(),
    path: values.path.trim(),
    methods: values.methods,
    destination: values.destination.trim(),
    stripPath: values.stripPath,
    timeoutSeconds: values.timeoutSeconds ?? 30,
    headers: values.headers
      .filter((header) => header?.name?.trim() && header.value?.trim())
      .map((header) => ({ name: header.name.trim(), value: header.value.trim() })),
    token: {
      enabled: token.enabled,
      header: token.header.trim(),
      claims: token.claims
        .filter((mapping) => mapping?.claim?.trim() && mapping.header?.trim())
        .map((mapping) => ({
          claim: mapping.claim.trim(),
          header: mapping.header.trim(),
          required: Boolean(mapping.required),
        })),
      payloadHeader: (token.payloadHeader ?? '').trim(),
      forwardToken: token.forwardToken,
      strict: token.strict,
      conditions: token.conditions
        .map((condition) => ({
          claim: condition?.claim?.trim() ?? '',
          values: (condition?.values ?? []).map((value) => value.trim()).filter(Boolean),
        }))
        .filter((condition) => condition.claim && condition.values.length > 0),
      verify: {
        enabled: token.verify.enabled,
        secretId: token.verify.secretId ?? '',
        checkExpiry: token.verify.checkExpiry,
        leeway: token.verify.leeway ?? 0,
        issuer: (token.verify.issuer ?? '').trim(),
        audience: (token.verify.audience ?? '').trim(),
      },
    },
    requestId: { enabled: requestId.enabled, header: requestId.header.trim(), echo: requestId.echo },
    tracing: { enabled: tracing.enabled, samplingPercent: tracing.samplingPercent ?? 100, body: tracing.body },
    rateLimit: {
      enabled: rateLimit.enabled,
      perMinute: rateLimit.perMinute,
      by: rateLimit.by,
      header: (rateLimit.header ?? '').trim(),
    },
    cors: { enabled: cors.enabled, origins: cors.origins, credentials: cors.credentials },
  };
}

/**
 * Called with the rule, and with the fields of a sample token if one was
 * pasted while filling the form in: that is the project's token shape now.
 */
export type SubmitHandler = (payload: GatewayRulePayload, tokenFields?: TokenField[]) => void;

interface RuleFormProps {
  /** The rule being changed; unset for a new one. */
  rule?: GatewayRule;
  /** The project the rule is in, or will be. */
  project: Project;
  /** Every other rule of every project: paths must not clash anywhere on the gateway. */
  others: GatewayRule[];
  onSubmit: SubmitHandler;
}

/** A rule's settings on four tabs, beside a preview of what they come to. */
export function RuleForm({ rule, project, others, onSubmit }: RuleFormProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<GatewayRulePayload>();
  const [activeTab, setActiveTab] = useState<TabKey>('request');
  const [initialValues] = useState(() => (rule ? toPayload(rule) : newRule()));
  // The payload of a token pasted into the form, to read the fields off.
  const [sample, setSample] = useState<Record<string, unknown>>();
  // Everything in the form, shown or not: sections that are switched off
  // unmount their fields but keep their values.
  const values: GatewayRulePayload = Form.useWatch([], { form, preserve: true }) ?? initialValues;

  const sampleFields = sample && fieldsOf(sample);

  // The work can be renamed from the tree while it is open here: the field
  // follows, so that saving the form does not put the old name back.
  const savedName = rule?.name;
  useEffect(() => {
    if (savedName !== undefined) form.setFieldValue('name', savedName);
  }, [form, savedName]);

  return (
    <Form
      id={RULE_FORM_ID}
      form={form}
      layout="vertical"
      initialValues={initialValues}
      onFinish={() => onSubmit(toPayload({ ...initialValues, ...form.getFieldsValue(true) }), sampleFields)}
      // The first problem may sit on a tab that isn't open.
      onFinishFailed={({ errorFields }) => {
        const field = String(errorFields[0]?.name[0]);
        setActiveTab(TAB_OF_FIELD[field] ?? 'request');
      }}
    >
      <div className="grid gap-(--c-spacing) @3xl:grid-cols-[minmax(0,1fr)_340px]">
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as TabKey)}
          // Every tab is rendered from the start, so saving validates them all.
          items={[
            {
              key: 'request',
              label: t('gateway.tabRequest'),
              forceRender: true,
              children: (
                <RequestTab
                  others={others}
                  siblings={others.filter((other) => other.projectId === project.id)}
                  isNew={!rule}
                />
              ),
            },
            {
              key: 'token',
              label: t('gateway.tabToken'),
              forceRender: true,
              children: (
                <TokenTab fields={sampleFields ?? project.tokenFields} sample={sample} onSample={setSample} />
              ),
            },
            {
              key: 'tracing',
              label: t('gateway.tabTracing'),
              forceRender: true,
              children: <TracingTab ruleId={rule?.id} />,
            },
            {
              key: 'protection',
              label: t('gateway.tabProtection'),
              forceRender: true,
              children: <ProtectionTab />,
            },
          ]}
        />

        {/* Stays in view while the form scrolls past it. */}
        <aside className="@3xl:sticky @3xl:top-(--c-spacing) @3xl:self-start">
          <h3 className="m-0 mb-(--c-spacing-sm) text-sm font-semibold">{t('gateway.preview')}</h3>
          <RequestPreview rule={values} />
        </aside>
      </div>
    </Form>
  );
}
