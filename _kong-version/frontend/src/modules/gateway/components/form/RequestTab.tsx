import { useRef, useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Select, message } from 'antd';
import type { InputRef } from 'antd';
import { LocateFixed, Plus, Server, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { HTTP_METHODS } from '@/types/gateway.types';
import type { GatewayRule, HttpMethod } from '@/types/gateway.types';
import {
  SAME_MACHINE,
  asSeenFromGateway,
  detectMyAddress,
  gatewayMachineAddress,
  isAddress,
  isGatewayMachineUrl,
  rememberAddress,
  rememberedAddress,
  withHost,
} from '../../utils/myAddress';
import { HEADER_PATTERN, NAME_PATTERN, PATH_PATTERN, isBaseUrl, isLoopbackUrl } from '../../utils/validation';
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
  const [isLocating, setIsLocating] = useState(false);
  // Set while the user is being asked for their address: what they have typed.
  const [askedAddress, setAskedAddress] = useState<string>();
  const gatewayPc = gatewayMachineAddress();

  // Puts the address in place of the destination's host and leaves the cursor
  // at the end, where the port goes.
  const pointAt = (address: string) => {
    form.setFieldValue('destination', withHost(form.getFieldValue('destination') ?? '', address));
    void form.validateFields(['destination']).catch(() => undefined);
    // The dialog that may have asked for the address takes the focus back as it closes.
    setTimeout(() => destinationInput.current?.focus({ cursor: 'end' }), 100);
  };

  const askAddress = () => {
    messageApi.destroy(MY_IP_MESSAGE);
    // Only another computer's address is something to start typing from.
    const remembered = asSeenFromGateway(rememberedAddress());
    setAskedAddress(remembered === SAME_MACHINE ? '' : remembered);
  };

  // Fills the address in and says which one; an address taken from an earlier
  // answer comes with a way to give another.
  const fill = (given: string, isRemembered = false) => {
    // The gateway computer's own address included: one remembered from before
    // the app knew better, or one the server could see for itself.
    const address = asSeenFromGateway(given);
    pointAt(address);

    const said = address === SAME_MACHINE ? t('gateway.myIpSameMachine') : t('gateway.myIpFilled', { address });
    messageApi.info({
      key: MY_IP_MESSAGE,
      duration: 6,
      content: isRemembered ? (
        <>
          {said}{' '}
          <Button type="link" size="small" className="h-auto! p-0!" onClick={askAddress}>
            {t('gateway.myIpChange')}
          </Button>
        </>
      ) : (
        said
      ),
    });
  };

  const fillMyAddress = async () => {
    setIsLocating(true);
    const detected = await detectMyAddress();
    setIsLocating(false);

    if (detected) {
      fill(detected);
      return;
    }

    // Only the user knows it: go by what they said last time, or ask.
    const remembered = rememberedAddress();
    if (remembered) fill(remembered, true);
    else setAskedAddress('');
  };

  const answerWith = (address: string) => {
    rememberAddress(address);
    setAskedAddress(undefined);
    fill(address);
  };

  const confirmAskedAddress = () => {
    const address = askedAddress?.trim() ?? '';
    if (isAddress(address)) answerWith(address);
  };

  // What a warning about the destination's host offers to do about it.
  const dockerNameFix = (
    <Button type="link" size="small" className="h-auto! p-0!" onClick={() => pointAt(SAME_MACHINE)}>
      {t('gateway.destinationUseDockerName')}
    </Button>
  );

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
          extra={t('gateway.destinationExtra')}
          rules={[
            { required: true, whitespace: true, message: t('gateway.destinationRequired') },
            {
              validator: (_, value?: string) =>
                !value?.trim() || isBaseUrl(value.trim())
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('gateway.destinationInvalid'))),
            },
            {
              // Saved all the same: it only looks like a mistake.
              warningOnly: true,
              message: (
                <span>
                  {t('gateway.destinationLoopback')} {dockerNameFix}
                </span>
              ),
              validator: (_, value?: string) =>
                value && isLoopbackUrl(value.trim()) ? Promise.reject(new Error('loopback')) : Promise.resolve(),
            },
            {
              // Works on some computers and times out on others, which the
              // name Docker gives that computer never does.
              warningOnly: true,
              message: (
                <span>
                  {t('gateway.destinationOwnPc')} {dockerNameFix}
                </span>
              ),
              validator: (_, value?: string) =>
                value && isGatewayMachineUrl(value.trim()) ? Promise.reject(new Error('own')) : Promise.resolve(),
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
                loading={isLocating}
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
        title={t('gateway.myIpAskTitle')}
        open={askedAddress !== undefined}
        okText={t('gateway.myIpAskOk')}
        cancelText={t('gateway.cancel')}
        okButtonProps={{ disabled: !isAddress(askedAddress?.trim() ?? '') }}
        onOk={confirmAskedAddress}
        onCancel={() => setAskedAddress(undefined)}
        destroyOnHidden
      >
        <p className="mb-(--c-spacing-sm) mt-0 text-subtle">{t('gateway.myIpAskText')}</p>
        <Button block icon={<Server size={14} />} onClick={() => answerWith(SAME_MACHINE)}>
          {[t('gateway.myIpAskSame'), gatewayPc && `(${gatewayPc})`].filter(Boolean).join(' ')}
        </Button>
        <p className="mb-(--c-spacing-xs) mt-(--c-spacing) text-subtle">{t('gateway.myIpAskOther')}</p>
        <Input
          autoFocus
          value={askedAddress}
          onChange={(event) => setAskedAddress(event.target.value)}
          onPressEnter={confirmAskedAddress}
          placeholder="192.168.1.50"
          aria-label={t('gateway.myIpAskTitle')}
        />
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
