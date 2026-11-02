import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Button, Dropdown, Empty, Form, Modal, Switch, Tag, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Ellipsis, Plus, Puzzle, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Hint } from '@/components/Hint';
import { settingsPath } from '@/router/routes';
import { useAppDispatch, useAppSelector } from '@/store';
import { loadPlugins } from '@/store/slices/pluginsSlice';
import type { PluginDefinition, PluginInstance, TokenField } from '@/types/gateway.types';
import { insertionIndex, newInstance, pluginDescription, pluginTitle } from '../../utils/plugins';
import { CorsSettings } from './CorsSettings';
import { JwtSettings } from './JwtSettings';
import { PluginFields } from './PluginFields';
import { FlatSections } from './Section';

const { Text } = Typography;

// The built-in plugins by what they are for, in the order "Add" lists them.
// One not named here (a newer built-in one) goes under "other".
const GROUPS: { key: string; names: string[] }[] = [
  { key: 'access', names: ['jwt', 'key-auth', 'basic-auth', 'ip-restriction'] },
  { key: 'protect', names: ['rate-limit', 'request-size-limit', 'cors'] },
  { key: 'change', names: ['request-transformer', 'response-transformer', 'request-id'] },
  { key: 'speed', names: ['proxy-cache'] },
];

interface PluginSettingsProps {
  instance: PluginInstance;
  index: number;
  definition?: PluginDefinition;
  tokenFields: TokenField[];
  sample?: Record<string, unknown>;
  onSample: (payload: Record<string, unknown>) => void;
}

/** One plugin's settings: a form of its own for JWT and CORS, the one its fields describe for the rest. */
function PluginSettings({ instance, index, definition, tokenFields, sample, onSample }: PluginSettingsProps) {
  const { t } = useTranslation();
  const base = ['plugins', index, 'config'];

  if (!definition) {
    return (
      <div className="flex flex-col gap-(--c-spacing-xs)">
        <Alert type="error" showIcon title={t('plugins.notInstalled', { name: instance.name })} />
        <pre className="m-0 overflow-x-auto rounded-(--c-border-radius) bg-layout p-(--c-spacing-sm) font-mono text-xs">
          {JSON.stringify(instance.config, null, 2)}
        </pre>
      </div>
    );
  }
  if (definition.builtIn && definition.name === 'jwt') {
    return <JwtSettings base={base} fields={tokenFields} sample={sample} onSample={onSample} />;
  }
  if (definition.builtIn && definition.name === 'cors') return <CorsSettings base={base} />;
  return <PluginFields definition={definition} base={base} />;
}

interface PluginsTabProps {
  /** The fields tokens are known to carry, for the JWT plugin's form. */
  tokenFields: TokenField[];
  sample?: Record<string, unknown>;
  onSample: (payload: Record<string, unknown>) => void;
  /** A plugin to open, as saving found something wrong in it. */
  reveal?: { index: number; at: number };
}

/**
 * What the gateway does with a request to the work: its plugins, in the order
 * they run. Each can be switched off, moved, opened to change its settings,
 * or taken off the work; "Add" offers the ones the work does not have yet.
 */
export function PluginsTab({ tokenFields, sample, onSample, reveal }: PluginsTabProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const form = Form.useFormInstance();
  const { info, status } = useAppSelector((state) => state.plugins);
  const definitions = info?.plugins ?? [];
  const plugins = (Form.useWatch('plugins', { preserve: true }) ?? []) as PluginInstance[];
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);
  const [modal, modalHolder] = Modal.useModal();

  useEffect(() => {
    if (status === 'idle') void dispatch(loadPlugins());
  }, [dispatch, status]);

  // Saving found a mistake in a plugin's settings: that one is opened.
  useEffect(() => {
    const name = reveal && plugins[reveal.index]?.name;
    if (name) setOpen((current) => new Set(current).add(name));
    // Only a new request to reveal opens anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.at]);

  const definitionOf = (name: string) => definitions.find((definition) => definition.name === name);
  const current = () => (form.getFieldValue('plugins') ?? []) as PluginInstance[];
  const toggleOpen = (name: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const move = (from: number, to: number) => {
    const next = [...current()];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    form.setFieldValue('plugins', next);
  };
  const remove = (index: number) => form.setFieldValue('plugins', current().filter((_, at) => at !== index));
  const add = (definition: PluginDefinition) => {
    const next = [...current()];
    next.splice(insertionIndex(next, definition.priority, definitions), 0, newInstance(definition));
    form.setFieldValue('plugins', next);
    setOpen((was) => new Set(was).add(definition.name));
    setIsAdding(false);
  };

  const available = definitions.filter((definition) => !plugins.some((plugin) => plugin?.name === definition.name));
  // What "Add" offers, by purpose; the computer's own plugins last.
  const grouped = new Set(GROUPS.flatMap((group) => group.names));
  const groups = [
    ...GROUPS.map((group) => ({
      key: group.key,
      definitions: group.names.flatMap((name) => definitions.filter((definition) => definition.builtIn && definition.name === name)),
    })),
    { key: 'other', definitions: definitions.filter((definition) => definition.builtIn && !grouped.has(definition.name)) },
    { key: 'custom', definitions: definitions.filter((definition) => !definition.builtIn) },
  ].filter((group) => group.definitions.length > 0);

  return (
    <div className="flex flex-col gap-(--c-spacing-sm)">
      <div className="flex flex-wrap items-center justify-between gap-(--c-spacing-xs)">
        <div className="flex items-center gap-(--c-spacing-xs)">
          <Text type="secondary">{t('plugins.tabIntro')}</Text>
          <Hint text={t('plugins.tabIntroHint')} />
        </div>
        <Button
          type="primary"
          icon={<Plus size={14} />}
          onClick={() => setIsAdding(true)}
          disabled={available.length === 0}
        >
          {t('plugins.add')}
        </Button>
      </div>

      {plugins.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('plugins.none')} />}

      {plugins.map((instance, index) => {
        if (!instance) return null;
        const definition = definitionOf(instance.name);
        const isOpen = open.has(instance.name);
        const title = pluginTitle(t, instance.name, definition);
        const description = definition ? pluginDescription(t, definition) : t('plugins.notInstalledShort');

        // Rare, and one of them destructive: kept in a menu, out of the way of the switch.
        const actions: MenuProps['items'] = [
          { key: 'up', icon: <ArrowUp size={14} />, label: t('plugins.moveUp'), disabled: index === 0 },
          {
            key: 'down',
            icon: <ArrowDown size={14} />,
            label: t('plugins.moveDown'),
            disabled: index === plugins.length - 1,
          },
          { type: 'divider' },
          { key: 'remove', icon: <Trash2 size={14} />, label: t('plugins.remove'), danger: true },
        ];
        const act: MenuProps['onClick'] = ({ key }) => {
          if (key === 'up') move(index, index - 1);
          if (key === 'down') move(index, index + 1);
          if (key === 'remove') {
            modal.confirm({
              title: t('plugins.removeConfirm', { name: title }),
              content: t('plugins.removeConfirmText'),
              okText: t('plugins.remove'),
              okButtonProps: { danger: true },
              cancelText: t('gateway.cancel'),
              onOk: () => remove(index),
            });
          }
        };

        return (
          <section
            key={instance.name}
            // A plugin switched off is drawn dashed: it is there, doing nothing.
            className={`rounded-(--c-border-radius-lg) border border-line-soft bg-container ${instance.enabled ? '' : 'border-dashed'}`}
          >
            <div className="flex items-start gap-(--c-spacing-xs) p-(--c-spacing-sm)">
              <button
                type="button"
                onClick={() => toggleOpen(instance.name)}
                aria-expanded={isOpen}
                className="flex min-w-0 flex-1 cursor-pointer items-start gap-(--c-spacing-xs) border-0 bg-transparent p-0 text-start"
              >
                <span className="mt-0.5 shrink-0 text-subtle">
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </span>
                <span className="mt-px inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-layout text-xs text-subtle">
                  {index + 1}
                </span>
                <span className={`flex min-w-0 flex-col ${instance.enabled ? '' : 'opacity-60'}`}>
                  <span className="flex min-w-0 flex-wrap items-center gap-(--c-spacing-xs)">
                    <span className="font-semibold">{title}</span>
                    {definition && !definition.builtIn && <Tag className="me-0!">{t('plugins.custom')}</Tag>}
                    {!definition && status === 'ready' && (
                      <Tag color="error" className="me-0!">
                        {t('plugins.missingTag')}
                      </Tag>
                    )}
                    {!instance.enabled && <Tag className="me-0!">{t('plugins.off')}</Tag>}
                  </span>
                  {/* What it does, in a line: read at a glance instead of behind a "?". */}
                  <Text type="secondary" className={`text-xs! ${isOpen ? '' : 'line-clamp-1'}`}>
                    {description}
                  </Text>
                </span>
              </button>
              <Form.Item name={['plugins', index, 'enabled']} valuePropName="checked" noStyle>
                <Switch size="small" className="mt-0.5" aria-label={t('plugins.enabled', { name: title })} />
              </Form.Item>
              <Dropdown menu={{ items: actions, onClick: act }} trigger={['click']} placement="bottomRight">
                <Button
                  type="text"
                  size="small"
                  icon={<Ellipsis size={16} />}
                  aria-label={t('plugins.actions', { name: title })}
                />
              </Dropdown>
            </div>
            {/* Rendered while closed too, so that saving checks every plugin's settings. */}
            <div className={isOpen ? 'border-t border-line-soft p-(--c-spacing)' : 'hidden'}>
              <FlatSections.Provider value>
                <PluginSettings
                  instance={instance}
                  index={index}
                  definition={definition}
                  tokenFields={tokenFields}
                  sample={sample}
                  onSample={onSample}
                />
              </FlatSections.Provider>
            </div>
          </section>
        );
      })}

      <Modal
        title={t('plugins.addTitle')}
        open={isAdding}
        footer={null}
        width={760}
        onCancel={() => setIsAdding(false)}
        destroyOnHidden
      >
        <div className="flex max-h-[65vh] flex-col gap-(--c-spacing) overflow-y-auto pe-1">
          {groups.map((group) => (
            <div key={group.key} className="flex flex-col gap-(--c-spacing-xs)">
              <Text strong>{t(`plugins.groups.${group.key}`)}</Text>
              <div className="grid gap-(--c-spacing-xs) sm:grid-cols-2">
                {group.definitions.map((definition) => {
                  const isOnWork = plugins.some((plugin) => plugin?.name === definition.name);
                  return (
                    <button
                      key={definition.name}
                      type="button"
                      disabled={isOnWork}
                      onClick={() => add(definition)}
                      className={`flex flex-col items-start gap-1 rounded-(--c-border-radius) border border-line-soft bg-transparent p-(--c-spacing-sm) text-start ${
                        isOnWork ? 'cursor-default opacity-60' : 'cursor-pointer hover:border-brand'
                      }`}
                    >
                      <span className="flex flex-wrap items-center gap-(--c-spacing-xs) font-semibold">
                        <Puzzle size={14} />
                        {pluginTitle(t, definition.name, definition)}
                        {isOnWork && <Tag className="me-0!">{t('plugins.alreadyAdded')}</Tag>}
                      </span>
                      <Text type="secondary" className="text-xs!">
                        {pluginDescription(t, definition)}
                      </Text>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-(--c-spacing-sm)">
          <RouterLink to={settingsPath('plugins')}>{t('plugins.ownPluginsLink')}</RouterLink>
        </div>
      </Modal>
      {modalHolder}
    </div>
  );
}
