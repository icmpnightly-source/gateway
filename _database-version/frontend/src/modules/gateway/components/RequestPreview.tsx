import { Typography } from 'antd';
import { ArrowDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppSelector, useGatewayUrl } from '@/store';
import type { GatewayRulePayload } from '@/types/gateway.types';
import { joinPath, upstreamUrl } from '../utils/request';

const { Text } = Typography;

// Stands for whatever follows the rule's path in a real request.
const REST = '…';

interface Line {
  text: string;
  /** Set on the lines the gateway adds or fills in itself. */
  added?: boolean;
}

function RequestBlock({ title, lines }: { title: string; lines: Line[] }) {
  return (
    <div>
      <Text type="secondary" className="mb-(--c-spacing-xxs) block text-(length:--c-font-size-sm)!">
        {title}
      </Text>
      <pre className="m-0 overflow-x-auto rounded-(--c-border-radius) border border-line-soft bg-layout p-(--c-spacing-sm) font-mono text-xs leading-relaxed">
        {lines.map((line, index) => (
          // Two fields may be mapped onto one header, so the text alone isn't unique.
          <div key={`${index}:${line.text}`} className={line.added ? 'font-semibold text-brand' : undefined}>
            {line.text}
          </div>
        ))}
      </pre>
    </div>
  );
}

interface RequestPreviewProps {
  /** The form's values as typed so far: any row may still be half-filled. */
  rule: GatewayRulePayload;
}

/** Shows a request as the client sends it, and as the destination receives it. */
export function RequestPreview({ rule }: RequestPreviewProps) {
  const { t } = useTranslation();
  const secrets = useAppSelector((state) => state.secrets.items);
  const gatewayUrl = useGatewayUrl();
  const { token, requestId, rateLimit } = rule;

  // A cleared input leaves its field empty or unset, never just a valid value.
  const method = rule.methods?.[0] ?? 'GET';
  const path = rule.path?.trim() || '/';
  const destination = rule.destination?.trim() || 'http://…';

  const tokenHeader = token.header?.trim() || 'Authorization';
  const tokenLine =
    tokenHeader.toLowerCase() === 'authorization' ? 'Authorization: Bearer <JWT>' : `${tokenHeader}: <JWT>`;

  const incoming: Line[] = [{ text: `${method} ${gatewayUrl}${joinPath(path, REST)}` }, { text: tokenLine }];

  const outgoing: Line[] = [
    { text: `${method} ${upstreamUrl({ destination, path, stripPath: rule.stripPath }, REST)}` },
  ];
  if (!token.enabled || token.forwardToken) outgoing.push({ text: tokenLine });

  if (token.enabled) {
    for (const mapping of token.claims) {
      if (mapping?.claim && mapping.header) {
        outgoing.push({ text: `${mapping.header}: <${mapping.claim}>`, added: true });
      }
    }
    if (token.payloadHeader) {
      outgoing.push({ text: `${token.payloadHeader}: <payload, base64>`, added: true });
    }
  }
  for (const header of rule.headers) {
    if (header?.name && header.value) outgoing.push({ text: `${header.name}: ${header.value}`, added: true });
  }
  if (requestId.enabled && requestId.header) outgoing.push({ text: `${requestId.header}: <uuid>`, added: true });

  const notes: string[] = [];
  if (!token.enabled) {
    notes.push(t('gateway.previewPassThrough'));
  } else {
    const secret = secrets.find((candidate) => candidate.id === token.verify.secretId);
    if (!token.verify.enabled) notes.push(t('gateway.previewUnverified'));
    else if (secret) notes.push(t('gateway.previewVerified', { name: secret.name, algorithm: secret.algorithm }));
    else notes.push(t('gateway.previewNoSecret'));
    notes.push(token.strict ? t('gateway.previewStrict') : t('gateway.previewLenient'));
    for (const condition of token.conditions) {
      if (condition?.claim && condition.values?.length) {
        notes.push(t('gateway.previewCondition', { claim: condition.claim, values: condition.values.join(', ') }));
      }
    }
  }
  if (rule.timeoutSeconds) notes.push(t('gateway.previewTimeout', { n: rule.timeoutSeconds }));
  if (rateLimit.enabled && rateLimit.perMinute) notes.push(t('gateway.previewRateLimit', { n: rateLimit.perMinute }));

  return (
    <div className="space-y-(--c-spacing-xs)">
      <RequestBlock title={t('gateway.clientSends')} lines={incoming} />
      <div className="flex justify-center text-subtle">
        <ArrowDown size={16} />
      </div>
      <RequestBlock title={t('gateway.destinationReceives')} lines={outgoing} />
      <ul className="m-0 list-disc space-y-(--c-spacing-xxs) ps-(--c-spacing) text-(length:--c-font-size-sm) text-subtle">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  );
}
