import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Button, Input, Segmented, Select, Tabs, Tag, Tooltip, Typography, message } from 'antd';
import { Braces, Copy, ScrollText, Send, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { engineErrorMessage } from '@/api/engine';
import { TRACE_ID_HEADER, sendRequest } from '@/api/works';
import { Hint } from '@/components/Hint';
import { requestsPath } from '@/router/routes';
import { useGatewayUrl } from '@/store';
import type { GatewayRule, HttpMethod, SendResult, SendVia, SentHeader } from '@/types/gateway.types';
import { copyText } from '../../utils/copy';
import { joinPath, upstreamUrl } from '../../utils/request';
import {
  canMakeSample,
  defaultTokenMode,
  formBody,
  formatSize,
  loadDraft,
  methodsOf,
  queryOf,
  saveDraft,
  splitQuery,
  toCurl,
  usedRows,
} from '../../utils/run';
import type { BodyKind, RunDraft, TokenMode } from '../../utils/run';
import { parseJsonObject, unsignedToken } from '../../utils/token';
import { KeyValueRows } from './KeyValueRows';

const { Text } = Typography;

const CODE_BOX =
  'content-scrollbar m-0 overflow-auto rounded-(--c-border-radius) border border-line-soft bg-layout p-(--c-spacing-sm) font-mono text-xs leading-relaxed';

// Why no answer came, or why the gateway gave its own: each has a few words
// on what to check.
const EXPLAINED = [
  'connect_timeout',
  'response_timeout',
  'refused',
  'unreachable',
  'unknown_host',
  'closed',
  'not_http',
  'tls',
  'failed',
  'no_work',
  'bad_destination',
  'gateway_down',
];

/** The reason in an answer that is the gateway's own, if the body is one. */
function gatewayReason(body: string | undefined): string | undefined {
  try {
    const { reason } = JSON.parse(body ?? '') as { reason?: unknown };
    return typeof reason === 'string' ? reason : undefined;
  } catch {
    return undefined;
  }
}

function isJson(text: string) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** JSON laid out to be read; anything else as it is. */
function pretty(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

const statusColor = (status: number) => (status < 300 ? 'success' : status < 400 ? 'processing' : status < 500 ? 'warning' : 'error');

interface AnswerProps {
  result: SendResult;
  onCopy: (text: string) => void;
}

/** What came back: how it went, then the body and the headers. */
function Answer({ result, onCopy }: AnswerProps) {
  const { t } = useTranslation();
  const { status, statusText, headers = [], body, failed } = result;

  const reason = failed?.reason ?? gatewayReason(body?.text);
  const why = reason && EXPLAINED.includes(reason) ? t(`gateway.tester.why.${reason}`) : failed?.message;
  const traceId = headers.find(([name]) => name.toLowerCase() === TRACE_ID_HEADER.toLowerCase())?.[1];
  const shown = body?.kind === 'text' ? pretty(body.text ?? '') : undefined;

  return (
    <div className="flex flex-col gap-(--c-spacing-xs)">
      <div className="flex flex-wrap items-center gap-(--c-spacing-xs)">
        <Text strong>{t('gateway.tester.response')}</Text>
        {status !== undefined && (
          <Tag color={statusColor(status)} className="me-0!">
            {status} {statusText}
          </Tag>
        )}
        <Text type="secondary" className="text-(length:--c-font-size-sm)!">
          {result.ms} ms
        </Text>
        {body && body.size > 0 && (
          <Text type="secondary" className="text-(length:--c-font-size-sm)!">
            {formatSize(body.size)}
          </Text>
        )}
        {traceId && (
          <RouterLink to={requestsPath({ open: traceId })} className="ms-auto inline-flex items-center gap-1">
            <ScrollText size={14} />
            {t('gateway.openLog')}
          </RouterLink>
        )}
      </div>

      {why && <Alert type="warning" showIcon title={why} />}

      {status !== undefined && (
        <Tabs
          size="small"
          tabBarExtraContent={
            shown !== undefined && (
              <Tooltip title={t('gateway.tester.copyBody')}>
                <Button
                  type="text"
                  size="small"
                  aria-label={t('gateway.tester.copyBody')}
                  icon={<Copy size={14} />}
                  onClick={() => onCopy(shown)}
                />
              </Tooltip>
            )
          }
          items={[
            {
              key: 'body',
              label: t('gateway.tester.body'),
              children: (
                <>
                  <pre className={`${CODE_BOX} max-h-[28rem]`}>
                    {shown ??
                      (body?.kind === 'binary'
                        ? t('gateway.tester.binary', { size: formatSize(body.size) })
                        : t('gateway.tester.emptyBody'))}
                  </pre>
                  {body?.truncated && (
                    <Text type="secondary" className="text-(length:--c-font-size-sm)!">
                      {t('gateway.tester.truncated')}
                    </Text>
                  )}
                </>
              ),
            },
            {
              key: 'headers',
              label: `${t('gateway.tester.headers')} (${headers.length})`,
              children: (
                <div className={`${CODE_BOX} max-h-[28rem]`}>
                  {headers.map(([name, value], index) => (
                    // A header may come more than once, so its name alone is no key.
                    <div key={`${index}:${name}`} className="break-all">
                      <span className="text-subtle">{name}:</span> {value}
                    </div>
                  ))}
                </div>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}

interface WorkRunnerProps {
  /** The work as it is saved: that is what the gateway runs. */
  rule: GatewayRule;
}

/**
 * Sends a request to the work as any API client would, and shows what came
 * back: its parameters, headers, body and token are all there to set.
 */
export function WorkRunner({ rule }: WorkRunnerProps) {
  const { t } = useTranslation();
  const gatewayUrl = useGatewayUrl();
  const [messageApi, contextHolder] = message.useMessage();

  const [draft, setDraft] = useState<RunDraft>(() => loadDraft(rule));
  // Never kept: a real token stays in the field for as long as the page is open.
  const [customToken, setCustomToken] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<SendResult>();

  useEffect(() => saveDraft(rule.id, draft), [rule.id, draft]);
  const change = (changes: Partial<RunDraft>) => setDraft((current) => ({ ...current, ...changes }));

  // The work may have been changed since the request was built: what it no
  // longer allows gives way to what it does.
  const methods = methodsOf(rule);
  const method = methods.includes(draft.method) ? draft.method : methods[0];
  const mayMakeSample = canMakeSample(rule);
  const tokenMode: TokenMode = draft.tokenMode === 'sample' && !mayMakeSample ? defaultTokenMode(rule) : draft.tokenMode;

  const payload = parseJsonObject(draft.payloadText);
  let token = '';
  if (tokenMode === 'sample' && payload) token = unsignedToken(payload);
  if (tokenMode === 'custom') token = customToken.trim().replace(/^bearer\s+/i, '');

  // A query may be typed, or pasted, straight after the path: it counts as
  // parameters at once, and becomes rows of them when the field is left.
  const typed = splitQuery(draft.rest);
  const rest = typed.rest.trim();
  const params = [...draft.params, ...typed.params];
  const query = queryOf(params);
  const path = joinPath(rule.path, rest) + query;
  // What a client would call, or where the gateway would send it on.
  const address = draft.via === 'direct' ? upstreamUrl(rule, rest) + query : gatewayUrl + path;

  let body: string | undefined;
  let contentType: string | undefined;
  if (draft.bodyKind === 'form') {
    body = formBody(draft.form) || undefined;
    contentType = 'application/x-www-form-urlencoded';
  } else if (draft.bodyKind !== 'none' && draft.bodyText !== '') {
    body = draft.bodyText;
    contentType = draft.bodyKind === 'json' ? 'application/json' : 'text/plain';
  }

  // The headers typed in, then the ones the token and the body bring, unless
  // one by the same name was typed.
  const headers: SentHeader[] = usedRows(draft.headers).map((row) => ({ name: row.name.trim(), value: row.value }));
  const isTyped = (name: string) => headers.some((header) => header.name.toLowerCase() === name.toLowerCase());
  if (token && !isTyped(rule.token.header)) {
    const isBearer = rule.token.header.toLowerCase() === 'authorization';
    headers.push({ name: rule.token.header, value: isBearer ? `Bearer ${token}` : token });
  }
  if (body !== undefined && contentType && !isTyped('Content-Type')) headers.push({ name: 'Content-Type', value: contentType });

  const cannotSend = tokenMode === 'sample' && !payload;

  const send = async () => {
    if (cannotSend) return;
    setIsSending(true);
    try {
      setResult(await sendRequest(rule.id, { via: draft.via, method, path, headers, body }));
    } catch (error) {
      messageApi.error(engineErrorMessage(error) || t('gateway.tester.failed'));
    } finally {
      setIsSending(false);
    }
  };

  const copy = async (text: string, done: string) => {
    if (await copyText(text)) messageApi.success(done);
    else messageApi.error(t('gateway.copyFailed'));
  };

  const settleRest = () => {
    if (draft.rest.includes('?')) change({ rest: typed.rest, params });
  };

  const counted = (label: string, count: number) => (count > 0 ? `${label} (${count})` : label);
  const isBodyJsonBad = draft.bodyKind === 'json' && draft.bodyText.trim() !== '' && !isJson(draft.bodyText);

  return (
    <div className="flex flex-col gap-(--c-spacing)">
      {contextHolder}

      <div className="flex flex-col gap-(--c-spacing-xxs)">
        <div className="flex gap-(--c-spacing-xs)">
          <Select<HttpMethod>
            value={method}
            onChange={(value) => change({ method: value })}
            options={methods.map((value) => ({ value, label: value }))}
            aria-label={t('gateway.methods')}
            className="w-28 shrink-0"
          />
          <Input
            value={draft.rest}
            onChange={(event) => change({ rest: event.target.value })}
            onBlur={settleRest}
            onPressEnter={send}
            prefix={<span className="text-subtle">{rule.path.endsWith('/') ? rule.path : `${rule.path}/`}</span>}
            placeholder={t('gateway.tester.restPlaceholder')}
            aria-label={t('gateway.path')}
          />
          <Button type="primary" icon={<Send size={14} />} loading={isSending} disabled={cannotSend} onClick={send}>
            {t('gateway.tester.send')}
          </Button>
          <Tooltip title={t('gateway.tester.copyCurl')}>
            <Button
              aria-label={t('gateway.tester.copyCurl')}
              icon={<Terminal size={16} />}
              onClick={() => copy(toCurl({ method, url: address, headers, body }), t('gateway.tester.curlCopied'))}
            />
          </Tooltip>
        </div>

        <div className="flex flex-wrap items-center gap-(--c-spacing-xs)">
          <Segmented<SendVia>
            size="small"
            value={draft.via}
            onChange={(via) => change({ via })}
            options={[
              { value: 'gateway', label: t('gateway.tester.viaGateway') },
              { value: 'direct', label: t('gateway.tester.viaDirect') },
            ]}
          />
          <Hint text={t('gateway.tester.viaHint')} />
          <Text type="secondary" className="min-w-0 font-mono text-xs! break-all">
            {method} {address}
          </Text>
        </div>
      </div>

      <Tabs
        size="small"
        items={[
          {
            key: 'params',
            label: counted(t('gateway.tester.params'), usedRows(params).length),
            children: <KeyValueRows rows={draft.params} onChange={(params) => change({ params })} />,
          },
          {
            key: 'headers',
            label: counted(t('gateway.tester.headers'), usedRows(draft.headers).length),
            children: (
              <KeyValueRows rows={draft.headers} onChange={(next) => change({ headers: next })} namePlaceholder="X-Source" />
            ),
          },
          {
            key: 'body',
            label: draft.bodyKind === 'none' ? t('gateway.tester.body') : `${t('gateway.tester.body')} •`,
            children: (
              <div className="flex flex-col gap-(--c-spacing-xs)">
                <div className="flex flex-wrap items-center gap-(--c-spacing-xs)">
                  <Segmented<BodyKind>
                    size="small"
                    value={draft.bodyKind}
                    onChange={(bodyKind) => change({ bodyKind })}
                    options={[
                      { value: 'none', label: t('gateway.tester.bodyNone') },
                      { value: 'json', label: 'JSON' },
                      { value: 'text', label: t('gateway.tester.bodyText') },
                      { value: 'form', label: t('gateway.tester.bodyForm') },
                    ]}
                  />
                  {draft.bodyKind === 'json' && (
                    <Button
                      size="small"
                      icon={<Braces size={14} />}
                      disabled={!isJson(draft.bodyText)}
                      onClick={() => change({ bodyText: pretty(draft.bodyText) })}
                    >
                      {t('gateway.tester.format')}
                    </Button>
                  )}
                  {isBodyJsonBad && (
                    <Text type="warning" className="text-(length:--c-font-size-sm)!">
                      {t('gateway.tester.jsonInvalid')}
                    </Text>
                  )}
                </div>

                {(draft.bodyKind === 'json' || draft.bodyKind === 'text') && (
                  <Input.TextArea
                    value={draft.bodyText}
                    onChange={(event) => change({ bodyText: event.target.value })}
                    autoSize={{ minRows: 5, maxRows: 16 }}
                    placeholder={draft.bodyKind === 'json' ? '{\n  "name": "…"\n}' : undefined}
                    aria-label={t('gateway.tester.body')}
                    spellCheck={false}
                    className="font-mono! text-xs!"
                  />
                )}
                {draft.bodyKind === 'form' && <KeyValueRows rows={draft.form} onChange={(form) => change({ form })} />}
              </div>
            ),
          },
          {
            key: 'token',
            label: tokenMode === 'none' ? t('gateway.tester.token') : `${t('gateway.tester.token')} •`,
            children: (
              <div className="flex flex-col gap-(--c-spacing-xs)">
                <Segmented<TokenMode>
                  size="small"
                  className="self-start"
                  value={tokenMode}
                  onChange={(next) => change({ tokenMode: next })}
                  options={[
                    ...(rule.token.enabled
                      ? [{ value: 'sample' as const, label: t('gateway.tester.sampleToken'), disabled: !mayMakeSample }]
                      : []),
                    { value: 'custom', label: t('gateway.tester.customToken') },
                    { value: 'none', label: t('gateway.tester.noToken') },
                  ]}
                />

                {rule.token.enabled && !mayMakeSample && (
                  <Text type="secondary" className="text-(length:--c-font-size-sm)!">
                    {t('gateway.tester.signatureNeeded')}
                  </Text>
                )}

                {tokenMode === 'sample' && (
                  <>
                    <Input.TextArea
                      value={draft.payloadText}
                      onChange={(event) => change({ payloadText: event.target.value })}
                      autoSize={{ minRows: 3, maxRows: 10 }}
                      status={payload ? undefined : 'error'}
                      aria-label={t('gateway.tester.payload')}
                      spellCheck={false}
                      className="font-mono! text-xs!"
                    />
                    {!payload && (
                      <Text type="danger" className="text-(length:--c-font-size-sm)!">
                        {t('gateway.tester.payloadInvalid')}
                      </Text>
                    )}
                  </>
                )}

                {tokenMode === 'custom' && (
                  <Input.TextArea
                    value={customToken}
                    onChange={(event) => setCustomToken(event.target.value)}
                    autoSize={{ minRows: 3, maxRows: 6 }}
                    placeholder="eyJhbGciOi…"
                    aria-label={t('gateway.tester.customToken')}
                    spellCheck={false}
                    className="font-mono! text-xs!"
                  />
                )}
              </div>
            ),
          },
        ]}
      />

      {result && <Answer result={result} onCopy={(text) => copy(text, t('gateway.tester.bodyCopied'))} />}
    </div>
  );
}
