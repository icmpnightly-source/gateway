import { useState } from 'react';
import { Input, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { decodePayload } from '../../utils/token';

const { Text } = Typography;

interface SampleTokenInputProps {
  /** Called with the payload each time the text becomes a readable token. */
  onRead: (payload: Record<string, unknown>) => void;
}

/** Takes a pasted token and hands over what is inside it. The token itself goes nowhere. */
export function SampleTokenInput({ onRead }: SampleTokenInputProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');

  const isUnreadable = text.trim() !== '' && decodePayload(text) === undefined;

  const handleChange = (next: string) => {
    setText(next);
    const payload = decodePayload(next);
    if (payload) onRead(payload);
  };

  return (
    <div>
      <Input.TextArea
        value={text}
        onChange={(event) => handleChange(event.target.value)}
        autoSize={{ minRows: 2, maxRows: 4 }}
        status={isUnreadable ? 'error' : undefined}
        placeholder={t('gateway.samplePlaceholder')}
        aria-label={t('gateway.sampleToken')}
        className="font-mono text-xs!"
      />
      <Text type={isUnreadable ? 'danger' : 'secondary'} className="block text-(length:--c-font-size-sm)!">
        {isUnreadable ? t('gateway.sampleInvalid') : t('gateway.sampleHint')}
      </Text>
    </div>
  );
}
