import { useEffect, useState } from 'react';
import { Form, Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import { newRule } from '@/api/works';
import type { GatewayRule, GatewayRulePayload, JwtConfig, PluginInstance, Project, TokenField } from '@/types/gateway.types';
import { PluginsTab } from './form/PluginsTab';
import { RequestTab } from './form/RequestTab';
import { TracingTab } from './form/TracingTab';
import { RequestPreview } from './RequestPreview';
import { fieldsOf } from '../utils/token';

/** Ties a Save button elsewhere on the page to the form: give it `form={RULE_FORM_ID}`. */
export const RULE_FORM_ID = 'gateway-rule-form';

type TabKey = 'request' | 'plugins' | 'tracing';

// The tab each top-level form field is on; the rest are on the first.
const TAB_OF_FIELD: Record<string, TabKey> = {
  plugins: 'plugins',
  tracing: 'tracing',
};

/** The JWT plugin's settings, text trimmed and half-filled rows dropped. */
function jwtPayload(config: JwtConfig): JwtConfig {
  return {
    header: (config.header ?? '').trim(),
    claims: (config.claims ?? [])
      .filter((mapping) => mapping?.claim?.trim() && mapping.header?.trim())
      .map((mapping) => ({
        claim: mapping.claim.trim(),
        header: mapping.header.trim(),
        required: Boolean(mapping.required),
      })),
    payloadHeader: (config.payloadHeader ?? '').trim(),
    forwardToken: Boolean(config.forwardToken),
    strict: Boolean(config.strict),
    conditions: (config.conditions ?? [])
      .map((condition) => ({
        claim: condition?.claim?.trim() ?? '',
        values: (condition?.values ?? []).map((value) => value.trim()).filter(Boolean),
      }))
      .filter((condition) => condition.claim && condition.values.length > 0),
    verify: {
      enabled: Boolean(config.verify?.enabled),
      secretId: config.verify?.secretId ?? '',
      checkExpiry: Boolean(config.verify?.checkExpiry),
      leeway: config.verify?.leeway ?? 0,
      issuer: (config.verify?.issuer ?? '').trim(),
      audience: (config.verify?.audience ?? '').trim(),
    },
  };
}

/**
 * The rule the form's values describe: text trimmed, and rows left half-filled
 * dropped (inside a switched-off section they were never validated).
 */
function toPayload(values: GatewayRulePayload): GatewayRulePayload {
  const { tracing } = values;

  return {
    name: values.name.trim(),
    path: values.path.trim(),
    methods: values.methods,
    destination: values.destination.trim(),
    stripPath: values.stripPath,
    timeoutSeconds: values.timeoutSeconds ?? 30,
    tracing: { enabled: tracing.enabled, samplingPercent: tracing.samplingPercent ?? 100, body: tracing.body },
    plugins: (values.plugins ?? []).filter(Boolean).map(
      (plugin): PluginInstance => ({
        name: plugin.name,
        enabled: Boolean(plugin.enabled),
        config:
          plugin.name === 'jwt'
            ? (jwtPayload(plugin.config as unknown as JwtConfig) as unknown as Record<string, unknown>)
            : plugin.config,
      }),
    ),
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

/** A rule's settings on three tabs, beside a preview of what they come to. */
export function RuleForm({ rule, project, others, onSubmit }: RuleFormProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<GatewayRulePayload>();
  const [activeTab, setActiveTab] = useState<TabKey>('request');
  // A plugin whose settings saving found fault with, to be opened.
  const [reveal, setReveal] = useState<{ index: number; at: number }>();
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
        const [field, index] = errorFields[0]?.name ?? [];
        setActiveTab(TAB_OF_FIELD[String(field)] ?? 'request');
        if (field === 'plugins' && typeof index === 'number') setReveal({ index, at: Date.now() });
      }}
    >
      {/* The preview is about the request; the log's settings have nothing to show in it. */}
      <div
        className={`grid gap-(--c-spacing) ${activeTab === 'tracing' ? '' : '@3xl:grid-cols-[minmax(0,1fr)_340px]'}`}
      >
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
              key: 'plugins',
              label: `${t('plugins.tab')} (${(values.plugins ?? []).length})`,
              forceRender: true,
              children: (
                <PluginsTab
                  tokenFields={sampleFields ?? project.tokenFields}
                  sample={sample}
                  onSample={setSample}
                  reveal={reveal}
                />
              ),
            },
            {
              key: 'tracing',
              label: t('gateway.tabLog'),
              forceRender: true,
              children: <TracingTab ruleId={rule?.id} />,
            },
          ]}
        />

        {/* Stays in view while the form scrolls past it. */}
        {activeTab !== 'tracing' && (
          <aside className="@3xl:sticky @3xl:top-(--c-spacing) @3xl:self-start">
            <h3 className="m-0 mb-(--c-spacing-sm) text-sm font-semibold">{t('gateway.preview')}</h3>
            <RequestPreview rule={values} />
          </aside>
        )}
      </div>
    </Form>
  );
}
