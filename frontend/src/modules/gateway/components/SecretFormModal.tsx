import { Alert, Checkbox, Form, Input, Modal, Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { JWT_ALGORITHMS } from '@/types/gateway.types';
import type { GatewaySecret, SecretPayload } from '@/types/gateway.types';
import { isHmac } from '../utils/token';
import { NAME_PATTERN } from '../utils/validation';

// Ties the dialog's Save button to the form, which lives in a child component.
const FORM_ID = 'gateway-secret-form';

const PEM_PATTERN = /-----BEGIN [A-Z ]*PUBLIC KEY-----[\s\S]+-----END [A-Z ]*PUBLIC KEY-----/;

const toOptions = (algorithms: readonly string[]) => algorithms.map((value) => ({ value, label: value }));

interface SecretFormProps {
  secret?: GatewaySecret;
  others: GatewaySecret[];
  onSubmit: (payload: SecretPayload) => void;
}

function SecretForm({ secret, others, onSubmit }: SecretFormProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<SecretPayload>();
  const algorithm = Form.useWatch('algorithm', form) ?? secret?.algorithm ?? 'HS256';

  const usesSecret = isHmac(algorithm);
  // The value an existing secret holds can stay, unless the new algorithm
  // needs the other kind of key. One that came by name with an imported
  // project holds none yet.
  const mayKeepValue = secret !== undefined && secret.hasValue && isHmac(secret.algorithm) === usesSecret;

  return (
    <Form<SecretPayload>
      id={FORM_ID}
      form={form}
      layout="vertical"
      initialValues={{
        name: secret?.name ?? '',
        algorithm: secret?.algorithm ?? 'HS256',
        value: '',
        valueIsBase64: false,
      }}
      onFinish={(values) => onSubmit({ ...values, name: values.name.trim(), value: values.value ?? '' })}
    >
      <Form.Item
        name="name"
        label={t('secrets.name')}
        tooltip={t('secrets.nameHint')}
        rules={[
          { required: true, whitespace: true, message: t('secrets.nameRequired') },
          { max: 64, pattern: NAME_PATTERN, message: t('secrets.nameInvalid') },
          {
            validator: (_, value?: string) =>
              others.some((other) => other.name === value?.trim())
                ? Promise.reject(new Error(t('secrets.nameTaken')))
                : Promise.resolve(),
          },
        ]}
      >
        <Input autoFocus placeholder={t('secrets.namePlaceholder')} />
      </Form.Item>

      <Form.Item name="algorithm" label={t('secrets.algorithm')}>
        <Select
          options={[
            { label: t('secrets.kindSecret'), options: toOptions(JWT_ALGORITHMS.filter(isHmac)) },
            { label: t('secrets.kindKey'), options: toOptions(JWT_ALGORITHMS.filter((name) => !isHmac(name))) },
          ]}
        />
      </Form.Item>

      {usesSecret ? (
        <>
          <Form.Item
            name="value"
            label={t('secrets.value')}
            extra={mayKeepValue ? t('secrets.valueKeep') : undefined}
            className="mb-(--c-spacing-xxs)!"
            rules={[{ required: !mayKeepValue, message: t('secrets.valueRequired') }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="valueIsBase64" valuePropName="checked">
            <Checkbox>{t('secrets.valueIsBase64')}</Checkbox>
          </Form.Item>
        </>
      ) : (
        <Form.Item
          name="value"
          label={t('secrets.publicKey')}
          extra={mayKeepValue ? t('secrets.valueKeep') : undefined}
          rules={[
            { required: !mayKeepValue, whitespace: true, message: t('secrets.valueRequired') },
            { pattern: PEM_PATTERN, message: t('secrets.publicKeyInvalid') },
          ]}
        >
          <Input.TextArea
            rows={6}
            placeholder={'-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----'}
            className="font-mono text-xs!"
          />
        </Form.Item>
      )}

      <Alert type="info" showIcon title={t('secrets.writeOnly')} />
    </Form>
  );
}

interface SecretFormModalProps {
  open: boolean;
  /** The secret being changed; unset to add one. */
  secret?: GatewaySecret;
  /** Every existing secret, to keep names from clashing. */
  secrets: GatewaySecret[];
  saving: boolean;
  onSubmit: (payload: SecretPayload) => void;
  onCancel: () => void;
}

/** Where an administrator names a key and enters its value. The value is never shown again. */
export function SecretFormModal({ open, secret, secrets, saving, onSubmit, onCancel }: SecretFormModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      title={secret ? t('secrets.editTitle') : t('secrets.newTitle')}
      open={open}
      okText={t('secrets.save')}
      cancelText={t('secrets.cancel')}
      confirmLoading={saving}
      okButtonProps={{ htmlType: 'submit', form: FORM_ID }}
      onCancel={onCancel}
      // The form is remounted per target, so a typed value never lingers.
      destroyOnHidden
    >
      <SecretForm
        secret={secret}
        others={secrets.filter((other) => other.id !== secret?.id)}
        onSubmit={onSubmit}
      />
    </Modal>
  );
}
