import { useState } from 'react';
import { Alert, Button, Input, Modal, Segmented, Select, Tag, Typography } from 'antd';
import { ExternalLink, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GATEWAY_PROXY_PATH, GATEWAY_URL, JAEGER_URL, TRACE_ID_HEADER } from '@/api/kong';
import { HTTP_METHODS } from '@/types/gateway.types';
import type { GatewayRule, HttpMethod } from '@/types/gateway.types';
import { joinPath } from '../utils/request';
import { parseJsonObject, samplePayload, unsignedToken } from '../utils/token';

const { Text, Link } = Typography;

type TokenMode = 'sample' | 'custom' | 'none';

interface TestResult {
  /** Unset when the request never got an answer. */
  status?: number;
  body: string;
  ms: number;
  /** Response headers worth pointing out: the ids to follow the request by, and what is left of its limit. */
  headers: [name: string, value: string][];
  /** Translation key of what went wrong, when the gateway never reached the destination. */
  why?: string;
}

// What the gateway itself answers when it could not get an answer out of the
// destination, and the explanation that goes with each.
const GATEWAY_FAILURES: Record<string, string> = {
  'The upstream server is timing out': 'gateway.tester.whyTimeout',
  'An invalid response was received from the upstream server': 'gateway.tester.whyRefused',
  'name resolution failed': 'gateway.tester.whyUnknownHost',
  'no Route matched with those values': 'gateway.tester.whyNoRoute',
};

/** The translation key explaining a failure that is the gateway's own answer, if the body is one. */
function explain(body: string): string | undefined {
  try {
    const { message } = JSON.parse(body) as { message?: unknown };
    return typeof message === 'string' ? GATEWAY_FAILURES[message] : undefined;
  } catch {
    return undefined;
  }
}

function prettify(body: string) {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function Tester({ rule }: { rule: GatewayRule }) {
  const { t } = useTranslation();
  const { token: tokenSettings } = rule;
  const methods: readonly HttpMethod[] = rule.methods.length > 0 ? rule.methods : HTTP_METHODS;

  // A rule that verifies only accepts a signed token, and the key to sign one
  // with is not something this page (or anyone) can get at.
  const canMakeSample = !(tokenSettings.enabled && tokenSettings.verify.enabled);

  const [method, setMethod] = useState<HttpMethod>(methods[0]);
  // Whatever follows the rule's path in the request.
  const [rest, setRest] = useState('');
  const [tokenMode, setTokenMode] = useState<TokenMode>(canMakeSample ? 'sample' : 'custom');
  const [payloadText, setPayloadText] = useState(() => JSON.stringify(samplePayload(tokenSettings), null, 2));
  const [customToken, setCustomToken] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<TestResult>();

  const requestPath = joinPath(rule.path, rest.trim());
  const payload = parseJsonObject(payloadText);

  let token = '';
  if (tokenMode === 'sample' && payload) token = unsignedToken(payload);
  if (tokenMode === 'custom') token = customToken.trim().replace(/^bearer\s+/i, '');

  const send = async () => {
    setIsSending(true);
    const startedAt = performance.now();
    const elapsed = () => Math.round(performance.now() - startedAt);

    try {
      const isBearer = tokenSettings.header.toLowerCase() === 'authorization';
      // Through the dev server's proxy: calling the gateway's own address
      // from the browser would need CORS switched on for the rule.
      const response = await fetch(GATEWAY_PROXY_PATH + requestPath, {
        method,
        headers: token ? { [tokenSettings.header]: isBearer ? `Bearer ${token}` : token } : undefined,
      });
      const body = await response.text();

      const notable = [rule.requestId.header, TRACE_ID_HEADER, 'RateLimit-Remaining'];
      const headers = notable.flatMap((name): [string, string][] => {
        const value = response.headers.get(name);
        return value ? [[name, value]] : [];
      });

      setResult({ status: response.status, body: prettify(body), ms: elapsed(), headers, why: explain(body) });
    } catch {
      setResult({ body: t('gateway.tester.failed'), ms: elapsed(), headers: [] });
    } finally {
      setIsSending(false);
    }
  };

  const isSuccess = result?.status !== undefined && result.status < 400;

  return (
    <div className="space-y-(--c-spacing)">
      <div>
        <Text type="secondary" className="mb-(--c-spacing-xxs) block text-(length:--c-font-size-sm)!">
          {t('gateway.tester.request')}
        </Text>
        <div className="flex gap-(--c-spacing-xs)">
          <Select<HttpMethod>
            value={method}
            onChange={setMethod}
            options={methods.map((value) => ({ value, label: value }))}
            aria-label={t('gateway.methods')}
            className="w-28 shrink-0"
          />
          <Input
            value={rest}
            onChange={(event) => setRest(event.target.value)}
            onPressEnter={send}
            prefix={<span className="text-subtle">{rule.path.endsWith('/') ? rule.path : `${rule.path}/`}</span>}
            placeholder={t('gateway.tester.restPlaceholder')}
            aria-label={t('gateway.path')}
          />
        </div>
        <Text type="secondary" className="mt-(--c-spacing-xxs) block font-mono text-xs! break-all">
          {method} {GATEWAY_URL}
          {requestPath}
        </Text>
      </div>

      <div className="space-y-(--c-spacing-xs)">
        <Segmented<TokenMode>
          value={tokenMode}
          onChange={setTokenMode}
          options={[
            { value: 'sample', label: t('gateway.tester.sampleToken'), disabled: !canMakeSample },
            { value: 'custom', label: t('gateway.tester.customToken') },
            { value: 'none', label: t('gateway.tester.noToken') },
          ]}
        />

        {!canMakeSample && (
          <Text type="secondary" className="block text-(length:--c-font-size-sm)!">
            {t('gateway.tester.signatureNeeded')}
          </Text>
        )}

        {tokenMode === 'sample' && (
          <div>
            <Input.TextArea
              value={payloadText}
              onChange={(event) => setPayloadText(event.target.value)}
              autoSize={{ minRows: 3, maxRows: 8 }}
              status={payload ? undefined : 'error'}
              aria-label={t('gateway.tester.payload')}
              className="font-mono text-xs!"
            />
            <Text type={payload ? 'secondary' : 'danger'} className="text-(length:--c-font-size-sm)!">
              {payload ? t('gateway.tester.payloadHint') : t('gateway.tester.payloadInvalid')}
            </Text>
          </div>
        )}

        {tokenMode === 'custom' && (
          <Input.TextArea
            value={customToken}
            onChange={(event) => setCustomToken(event.target.value)}
            autoSize={{ minRows: 3, maxRows: 6 }}
            placeholder="eyJhbGciOi…"
            aria-label={t('gateway.tester.customToken')}
            className="font-mono text-xs!"
          />
        )}
      </div>

      <Button
        type="primary"
        icon={<Send size={14} />}
        loading={isSending}
        disabled={tokenMode === 'sample' && !payload}
        onClick={send}
      >
        {t('gateway.tester.send')}
      </Button>

      {result && (
        <div>
          <div className="mb-(--c-spacing-xxs) flex items-center gap-(--c-spacing-xs)">
            <Text type="secondary" className="text-(length:--c-font-size-sm)!">
              {t('gateway.tester.response')}
            </Text>
            {result.status !== undefined && <Tag color={isSuccess ? 'success' : 'error'}>{result.status}</Tag>}
            <Text type="secondary" className="text-(length:--c-font-size-sm)!">
              {result.ms} ms
            </Text>
          </div>

          {result.headers.length > 0 && (
            <div className="mb-(--c-spacing-xxs) font-mono text-xs">
              {result.headers.map(([name, value]) => (
                <div key={name} className="break-all">
                  <span className="text-subtle">{name}:</span> {value}
                  {name === TRACE_ID_HEADER && (
                    <Link
                      href={`${JAEGER_URL}/trace/${value}`}
                      target="_blank"
                      rel="noreferrer"
                      className="ms-(--c-spacing-xs) inline-flex items-center gap-1 font-sans"
                    >
                      {t('gateway.openJaeger')}
                      <ExternalLink size={12} />
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}

          {result.why && (
            <Alert type="warning" showIcon title={t(result.why)} className="mb-(--c-spacing-xs)!" />
          )}

          <pre className="content-scrollbar m-0 max-h-80 overflow-auto rounded-(--c-border-radius) border border-line-soft bg-layout p-(--c-spacing-sm) font-mono text-xs leading-relaxed">
            {result.body || t('gateway.tester.emptyBody')}
          </pre>
        </div>
      )}
    </div>
  );
}

interface RuleTesterProps {
  /** The rule to send a request through; unset keeps the dialog closed. */
  rule?: GatewayRule;
  onClose: () => void;
}

/** Sends a real request through the gateway and shows what came back. */
export function RuleTester({ rule, onClose }: RuleTesterProps) {
  const { t } = useTranslation();

  return (
    <Modal
      title={t('gateway.tester.title', { name: rule?.name })}
      open={Boolean(rule)}
      width={640}
      footer={null}
      onCancel={onClose}
      // Each rule gets a fresh tester, seeded from its own settings.
      destroyOnHidden
    >
      {rule && <Tester key={rule.id} rule={rule} />}
    </Modal>
  );
}
