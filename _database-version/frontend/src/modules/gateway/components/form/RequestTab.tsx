import { useRef, useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Select, message } from 'antd';
import type { InputRef } from 'antd';
import { LocateFixed, Network, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ECHO_PATH } from '@/api/works';
import { useAppSelector } from '@/store';
import { HTTP_METHODS } from '@/types/gateway.types';
import type { GatewayRule, HttpMethod } from '@/types/gateway.types';
import { rememberAddress, rememberedAddress, withHost } from '../../utils/myAddress';
import { HEADER_PATTERN, NAME_PATTERN, PATH_PATTERN, isBaseUrl } from '../../utils/validation';
import { Section, ToggleRow } from './Section';

const METHOD_OPTIONS = HTTP_METHODS.map((method) => ({ value: method, label: method }));

// One message at a time about the address the "my IP" button filled in.
const MY_IP_MESSAGE = 'my-ip';

interface RequestTabProps {
  /** Every other rule on the gateway: no two may answer the same path. */
  others: GatewayRule[];
  /** The other rules of the same project: no two may share a name. */
  siblings: GatewayRule[];
}

/** What comes in, where it goes, and what is always sent along. */
export function RequestTab({ others, siblings }: RequestTabProps) {
  const { t } = useTranslation();
  const form = Form.useFormInstance();
  const [messageApi, contextHolder] = message.useMessage();
  const destinationInput = useRef<InputRef>(null);
  // This computer's addresses on its networks, the likeliest first.
  const addresses = useAppSelector((state) => state.system.status?.addresses);
  const appPort = useAppSelector((state) => state.system.status?.app.port) ?? 8101;
  // Open while the user picks which of several addresses is theirs.
  const [isChoosing, setIsChoosing] = useState(false);

  // Puts the address in place of the destination's host and leaves the cursor
  // at the end, where the port goes.
  const pointAt = (address: string) => {
    form.setFieldValue('destination', withHost(form.getFieldValue('destination') ?? '', address));
    void form.validateFields(['destination']).catch(() => undefined);
    // The dialog that may have asked for the address takes the focus back as it closes.
    setTimeout(() => destinationInput.current?.focus({ cursor: 'end' }), 100);
  };

  // Fills the address in and says which one; where there was a choice, it
  // comes with a way to choose again.
  const fill = (address: string, hadChoice: boolean) => {
    pointAt(address);

    const said = t('gateway.myIpFilled', { address });
    messageApi.info({
      key: MY_IP_MESSAGE,
      duration: 6,
      content: hadChoice ? (
        <>
          {said}{' '}
          <Button
            type="link"
            size="small"
            className="h-auto! p-0!"
            onClick={() => {
              messageApi.destroy(MY_IP_MESSAGE);
              setIsChoosing(true);
            }}
          >
            {t('gateway.myIpChange')}
          </Button>
        </>
      ) : (
        said
      ),
    });
  };

  const fillMyAddress = () => {
    if (!addresses?.length) {
      messageApi.warning(t('gateway.myIpNone'));
      return;
    }
    // One real network, whatever virtual ones there are besides: no question to ask.
    const real = addresses.filter(({ virtual }) => !virtual);
    const only = addresses.length === 1 ? addresses[0] : real.length === 1 ? real[0] : undefined;
    if (only) {
      fill(only.address, false);
      return;
    }

    // Several networks: go by what was chosen last time, if it is still there.
    const remembered = rememberedAddress();
    if (addresses.some(({ address }) => address === remembered)) fill(remembered, true);
    else setIsChoosing(true);
  };

  const choose = (address: string) => {
    rememberAddress(address);
    setIsChoosing(false);
    fill(address, true);
  };

  // Two rules on one path only coexist when their methods never overlap.
  const pathClashes = (path: string) => {
    const methods: HttpMethod[] = form.getFieldValue('methods') ?? [];
    return others.some(
      (other) =>
        other.path === path &&
        (methods.length === 0 ||
          other.methods.length === 0 ||
          other.methods.some((method) => methods.includes(method))),
    );
  };

  return (
    <div className="space-y-(--c-spacing)">
      {contextHolder}

      <Form.Item
        name="name"
        label={t('gateway.name')}
        className="mb-0!"
        rules={[
          { required: true, whitespace: true, message: t('gateway.nameRequired') },
          { pattern: NAME_PATTERN, message: t('gateway.nameInvalid') },
          {
            validator: (_, value?: string) =>
              siblings.some((sibling) => sibling.name === value?.trim())
                ? Promise.reject(new Error(t('gateway.nameTaken')))
                : Promise.resolve(),
          },
        ]}
      >
        <Input autoFocus placeholder={t('gateway.namePlaceholder')} />
      </Form.Item>

      <Section title={t('gateway.incoming')} hint={t('gateway.incomingHint')}>
        <div className="grid gap-x-(--c-spacing-sm) sm:grid-cols-2">
          <Form.Item name="methods" label={t('gateway.methods')} className="mb-0!">
            <Select
              mode="multiple"
              allowClear
              maxTagCount="responsive"
              options={METHOD_OPTIONS}
              placeholder={t('gateway.anyMethod')}
            />
          </Form.Item>
          <Form.Item
            name="path"
            label={t('gateway.path')}
            className="mb-0!"
            // The clash check reads the methods, so rerun it when they change.
            dependencies={['methods']}
            rules={[
              { required: true, whitespace: true, message: t('gateway.pathRequired') },
              { pattern: PATH_PATTERN, message: t('gateway.pathInvalid') },
              {
                validator: (_, value?: string) =>
                  value && pathClashes(value.trim())
                    ? Promise.reject(new Error(t('gateway.pathTaken')))
                    : Promise.resolve(),
              },
            ]}
          >
            <Input placeholder="/orders" />
          </Form.Item>
        </div>
      </Section>

      <Section title={t('gateway.destination')} hint={t('gateway.destinationHint')}>
        <Form.Item
          name="destination"
          label={t('gateway.destinationUrl')}
          extra={t('gateway.destinationExtra', { echo: `http://127.0.0.1:${appPort}${ECHO_PATH}` })}
          rules={[
            { required: true, whitespace: true, message: t('gateway.destinationRequired') },
            {
              validator: (_, value?: string) =>
                !value?.trim() || isBaseUrl(value.trim())
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('gateway.destinationInvalid'))),
            },
          ]}
        >
          <Input
            ref={destinationInput}
            placeholder="http://192.168.1.50:8000"
            suffix={
              <Button
                type="link"
                size="small"
                icon={<LocateFixed size={14} />}
                onClick={fillMyAddress}
                className="-me-(--c-spacing-xxs)"
              >
                {t('gateway.myIp')}
              </Button>
            }
          />
        </Form.Item>
        <Form.Item
          name="timeoutSeconds"
          label={t('gateway.timeout')}
          extra={t('gateway.timeoutHint')}
          rules={[{ required: true, message: t('gateway.timeoutRequired') }]}
        >
          <InputNumber min={1} max={600} precision={0} className="w-40!" />
        </Form.Item>
        <ToggleRow name="stripPath" label={t('gateway.stripPath')} hint={t('gateway.stripPathHint')} />
      </Section>

      <Modal
        title={t('gateway.myIpChooseTitle')}
        open={isChoosing}
        footer={null}
        onCancel={() => setIsChoosing(false)}
        destroyOnHidden
      >
        <p className="mb-(--c-spacing-sm) mt-0 text-subtle">{t('gateway.myIpChooseText')}</p>
        <div className="flex flex-col gap-(--c-spacing-xs)">
          {addresses?.map(({ address, adapter }) => (
            <Button key={address} block icon={<Network size={14} />} onClick={() => choose(address)}>
              <span className="font-mono">{address}</span>
              <span className="text-subtle">{adapter}</span>
            </Button>
          ))}
        </div>
      </Modal>

      <Section title={t('gateway.headers')} hint={t('gateway.headersHint')}>
        <Form.List name="headers">
          {(fields, { add, remove }) => (
            <div className="space-y-(--c-spacing-xs)">
              {fields.map((field) => (
                <div
                  key={field.key}
                  className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_32px] items-start gap-(--c-spacing-xs)"
                >
                  <Form.Item
                    name={[field.name, 'name']}
                    className="mb-0!"
                    rules={[
                      { required: true, whitespace: true, message: t('gateway.headerRequired') },
                      { pattern: HEADER_PATTERN, message: t('gateway.headerInvalid') },
                    ]}
                  >
                    <Input placeholder="X-Source" aria-label={t('gateway.headerName')} />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, 'value']}
                    className="mb-0!"
                    rules={[{ required: true, whitespace: true, message: t('gateway.headerValueRequired') }]}
                  >
                    <Input placeholder="gateway" aria-label={t('gateway.headerValue')} />
                  </Form.Item>
                  <Button
                    type="text"
                    danger
                    aria-label={t('gateway.remove')}
                    icon={<Trash2 size={14} />}
                    onClick={() => remove(field.name)}
                  />
                </div>
              ))}
              <Button type="dashed" size="small" icon={<Plus size={14} />} onClick={() => add({ name: '', value: '' })}>
                {t('gateway.addHeader')}
              </Button>
            </div>
          )}
        </Form.List>
      </Section>
    </div>
  );
}
