import { Button, Form, Input, InputNumber, Select, Typography, message } from 'antd';
import type { NamePath } from 'antd/es/form/interface';
import { Copy, KeyRound, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ApiKeyRow, BasicUserRow, PluginDefinition, PluginField } from '@/types/gateway.types';
import { copyText } from '../../utils/copy';
import { generateKey } from '../../utils/plugins';
import { HEADER_PATTERN } from '../../utils/validation';
import { ToggleRow } from './Section';

const { Text } = Typography;

const PAIR_GRID = 'grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_32px] items-start gap-(--c-spacing-xs)';
const MIN_KEY = 16;
const MIN_PASSWORD = 8;

interface FieldTexts {
  label: string;
  hint?: string;
  option: (value: string) => string;
}

/** A field's texts: a built-in plugin's in the app's language, a custom one's as its file says. */
function useFieldTexts(definition: PluginDefinition) {
  const { t } = useTranslation();
  return (field: PluginField): FieldTexts => {
    if (!definition.builtIn) {
      return { label: field.label, hint: field.help || undefined, option: (value) => value };
    }
    const at = `plugins.builtIn.${definition.name}.fields.${field.key}`;
    const hint = t(`${at}Hint`, { defaultValue: field.help });
    return {
      label: t(at, { defaultValue: field.label }),
      hint: hint || undefined,
      option: (value) => t(`plugins.builtIn.${definition.name}.options.${field.key}.${value}`, { defaultValue: value }),
    };
  };
}

// --- API keys ---------------------------------------------------------------------

interface KeysEditorProps {
  value?: ApiKeyRow[];
  onChange?: (rows: ApiKeyRow[]) => void;
}

/**
 * The API keys of a work. A new key is made here, shown until the work is
 * saved, and then never again: the app keeps only its hash.
 */
function KeysEditor({ value = [], onChange }: KeysEditorProps) {
  const { t } = useTranslation();
  const [messageApi, contextHolder] = message.useMessage();
  const change = (index: number, row: ApiKeyRow) => onChange?.(value.map((each, at) => (at === index ? row : each)));

  const copy = async (key: string) => {
    if (await copyText(key)) messageApi.success(t('plugins.keyCopied'));
    else messageApi.error(t('gateway.copyFailed'));
  };

  return (
    <div className="flex flex-col gap-(--c-spacing-xs)">
      {contextHolder}
      {value.map((row, index) => (
        // Rows have no id of their own until saved; their place is what tells them apart.
        <div key={index} className="flex flex-wrap items-center gap-(--c-spacing-xs)">
          <Input
            value={row.name}
            onChange={(event) => change(index, { ...row, name: event.target.value })}
            placeholder={t('plugins.keyNamePlaceholder')}
            aria-label={t('plugins.keyName')}
            status={row.name.trim() ? undefined : 'error'}
            className="w-40!"
          />
          {row.key !== undefined ? (
            <>
              <Input
                value={row.key}
                onChange={(event) => change(index, { ...row, key: event.target.value })}
                aria-label={t('plugins.key')}
                status={row.key.trim().length >= MIN_KEY && !/\s/.test(row.key.trim()) ? undefined : 'error'}
                className="min-w-56! flex-1 font-mono"
              />
              <Button icon={<Copy size={14} />} onClick={() => void copy(row.key ?? '')} aria-label={t('plugins.copyKey')} />
            </>
          ) : (
            <>
              <Text code className="flex-1">
                •••• {row.hint}
              </Text>
              <Button
                size="small"
                icon={<RefreshCw size={14} />}
                onClick={() => change(index, { name: row.name, key: generateKey() })}
              >
                {t('plugins.replaceKey')}
              </Button>
            </>
          )}
          <Button
            type="text"
            danger
            aria-label={t('gateway.remove')}
            icon={<Trash2 size={14} />}
            onClick={() => onChange?.(value.filter((_, at) => at !== index))}
          />
        </div>
      ))}
      {value.some((row) => row.key !== undefined) && (
        <Text type="warning" className="text-xs!">
          {t('plugins.keyShownOnce')}
        </Text>
      )}
      <Button
        type="dashed"
        size="small"
        icon={<KeyRound size={14} />}
        onClick={() => onChange?.([...value, { name: '', key: generateKey() }])}
        className="self-start"
      >
        {t('plugins.addKey')}
      </Button>
    </div>
  );
}

function checkKeys(t: (key: string, options?: Record<string, unknown>) => string) {
  return (_: unknown, rows: ApiKeyRow[] = []) => {
    const names = rows.map((row) => row.name.trim());
    if (names.some((name) => !name)) return Promise.reject(new Error(t('plugins.keyNameRequired')));
    if (new Set(names).size !== names.length) return Promise.reject(new Error(t('plugins.keyNameTwice')));
    const short = rows.find((row) => row.key !== undefined && (row.key.trim().length < MIN_KEY || /\s/.test(row.key.trim())));
    if (short) return Promise.reject(new Error(t('plugins.keyTooShort', { n: MIN_KEY })));
    return Promise.resolve();
  };
}

// --- users for basic sign-in ------------------------------------------------------

interface UsersEditorProps {
  value?: BasicUserRow[];
  onChange?: (rows: BasicUserRow[]) => void;
}

/** Users and passwords. A password is kept as a hash: one already set is only ever replaced. */
function UsersEditor({ value = [], onChange }: UsersEditorProps) {
  const { t } = useTranslation();
  const change = (index: number, row: BasicUserRow) => onChange?.(value.map((each, at) => (at === index ? row : each)));

  return (
    <div className="flex flex-col gap-(--c-spacing-xs)">
      {value.map((row, index) => (
        <div key={index} className="flex flex-wrap items-center gap-(--c-spacing-xs)">
          <Input
            value={row.username}
            onChange={(event) => change(index, { ...row, username: event.target.value })}
            placeholder={t('plugins.username')}
            aria-label={t('plugins.username')}
            status={row.username.trim() && !row.username.includes(':') ? undefined : 'error'}
            className="w-40!"
          />
          {row.password !== undefined || !row.hash ? (
            <Input.Password
              value={row.password ?? ''}
              onChange={(event) => change(index, { ...row, password: event.target.value })}
              placeholder={t('plugins.password')}
              aria-label={t('plugins.password')}
              autoComplete="new-password"
              status={(row.password ?? '').length >= MIN_PASSWORD ? undefined : 'error'}
              className="min-w-48! flex-1"
            />
          ) : (
            <>
              <Text type="secondary" className="flex-1">
                {t('plugins.passwordSet')}
              </Text>
              <Button size="small" onClick={() => change(index, { ...row, password: '' })}>
                {t('plugins.changePassword')}
              </Button>
            </>
          )}
          <Button
            type="text"
            danger
            aria-label={t('gateway.remove')}
            icon={<Trash2 size={14} />}
            onClick={() => onChange?.(value.filter((_, at) => at !== index))}
          />
        </div>
      ))}
      <Button
        type="dashed"
        size="small"
        icon={<Plus size={14} />}
        onClick={() => onChange?.([...value, { username: '', password: '' }])}
        className="self-start"
      >
        {t('plugins.addUser')}
      </Button>
    </div>
  );
}

function checkUsers(t: (key: string, options?: Record<string, unknown>) => string) {
  return (_: unknown, rows: BasicUserRow[] = []) => {
    const names = rows.map((row) => row.username.trim());
    if (names.some((name) => !name || name.includes(':'))) return Promise.reject(new Error(t('plugins.usernameRequired')));
    if (new Set(names).size !== names.length) return Promise.reject(new Error(t('plugins.usernameTwice')));
    const weak = rows.find((row) => (row.password !== undefined || !row.hash) && (row.password ?? '').length < MIN_PASSWORD);
    if (weak) return Promise.reject(new Error(t('plugins.passwordTooShort', { n: MIN_PASSWORD })));
    return Promise.resolve();
  };
}

// --- one field --------------------------------------------------------------------

interface FieldProps {
  field: PluginField;
  name: NamePath;
  texts: FieldTexts;
}

function PairsField({ field, name, texts }: FieldProps) {
  const { t } = useTranslation();
  const headerRules = field.header ? [{ pattern: HEADER_PATTERN, message: t('gateway.headerInvalid') }] : [];

  return (
    <div>
      <div className="mb-(--c-spacing-xs) flex items-center gap-(--c-spacing-xs)">
        <span>{texts.label}</span>
        {texts.hint && <Text type="secondary" className="text-xs!">{texts.hint}</Text>}
      </div>
      <Form.List name={name as (string | number)[]}>
        {(rows, { add, remove }) => (
          <div className="flex flex-col gap-(--c-spacing-xs)">
            {rows.map((row) => (
              <div key={row.key} className={PAIR_GRID}>
                <Form.Item
                  name={[row.name, 'name']}
                  className="mb-0!"
                  rules={[{ required: true, whitespace: true, message: t('plugins.fieldRequired') }, ...headerRules]}
                >
                  <Input placeholder={field.header ? 'X-Source' : 'name'} aria-label={t('plugins.pairName')} />
                </Form.Item>
                <Form.Item
                  name={[row.name, 'value']}
                  className="mb-0!"
                  rules={[{ required: true, whitespace: true, message: t('plugins.fieldRequired') }]}
                >
                  <Input aria-label={t('plugins.pairValue')} />
                </Form.Item>
                <Button
                  type="text"
                  danger
                  aria-label={t('gateway.remove')}
                  icon={<Trash2 size={14} />}
                  onClick={() => remove(row.name)}
                />
              </div>
            ))}
            <Button
              type="dashed"
              size="small"
              icon={<Plus size={14} />}
              onClick={() => add({ name: '', value: '' })}
              className="self-start"
            >
              {t('plugins.addRow')}
            </Button>
          </div>
        )}
      </Form.List>
    </div>
  );
}

function OneField({ field, name, texts }: FieldProps) {
  const { t } = useTranslation();
  const required = field.required ? [{ required: true, whitespace: true, message: t('plugins.fieldRequired') }] : [];

  switch (field.type) {
    case 'boolean':
      return <ToggleRow name={name} label={texts.label} hint={texts.hint} />;

    case 'string':
      return (
        <Form.Item
          name={name}
          label={texts.label}
          tooltip={texts.hint}
          className="mb-0!"
          rules={[...required, ...(field.header ? [{ pattern: HEADER_PATTERN, message: t('gateway.headerInvalid') }] : [])]}
        >
          <Input placeholder={field.placeholder} allowClear={!field.required} />
        </Form.Item>
      );

    case 'number':
      return (
        <Form.Item
          name={name}
          label={texts.label}
          tooltip={texts.hint}
          className="mb-0!"
          rules={[{ required: true, message: t('plugins.fieldRequired') }]}
        >
          <InputNumber min={field.min} max={field.max} className="w-48!" />
        </Form.Item>
      );

    case 'select':
      return (
        <Form.Item name={name} label={texts.label} tooltip={texts.hint} className="mb-0!">
          <Select options={(field.options ?? []).map((value) => ({ value, label: texts.option(value) }))} className="max-w-sm" />
        </Form.Item>
      );

    case 'list':
      return (
        <Form.Item
          name={name}
          label={texts.label}
          tooltip={texts.hint}
          className="mb-0!"
          rules={[
            ...(field.required ? [{ required: true, type: 'array' as const, min: 1, message: t('plugins.fieldRequired') }] : []),
            ...(field.header
              ? [{
                  validator: (_: unknown, values: string[] = []) =>
                    values.every((value) => HEADER_PATTERN.test(value))
                      ? Promise.resolve()
                      : Promise.reject(new Error(t('gateway.headerInvalid'))),
                }]
              : []),
          ]}
        >
          <Select
            mode="tags"
            // Values are typed, not chosen: nothing to list until then.
            notFoundContent={null}
            tokenSeparators={[',', ' ']}
            placeholder={field.placeholder ?? t('plugins.listPlaceholder')}
          />
        </Form.Item>
      );

    case 'pairs':
      return <PairsField field={field} name={name} texts={texts} />;

    case 'keys':
      return (
        <Form.Item name={name} label={texts.label} tooltip={texts.hint} className="mb-0!" rules={[{ validator: checkKeys(t) }]}>
          <KeysEditor />
        </Form.Item>
      );

    case 'users':
      return (
        <Form.Item name={name} label={texts.label} tooltip={texts.hint} className="mb-0!" rules={[{ validator: checkUsers(t) }]}>
          <UsersEditor />
        </Form.Item>
      );

    default:
      return null;
  }
}

interface PluginFieldsProps {
  definition: PluginDefinition;
  /** Where the plugin's settings are in the form: ['plugins', index, 'config']. */
  base: (string | number)[];
}

/** A plugin's settings as a form, drawn from the fields the plugin describes. */
export function PluginFields({ definition, base }: PluginFieldsProps) {
  const { t } = useTranslation();
  const textsOf = useFieldTexts(definition);
  // Preserved: a field hidden by `when` keeps its value.
  const config = (Form.useWatch(base, { preserve: true }) ?? {}) as Record<string, unknown>;

  if (definition.fields.length === 0) {
    return <Text type="secondary">{t('plugins.noSettings')}</Text>;
  }

  const isShown = (field: PluginField) =>
    !field.when || Object.entries(field.when).every(([other, values]) => values.includes(String(config[other] ?? '')));

  return (
    <div className="flex flex-col gap-(--c-spacing-sm)">
      {definition.fields.filter(isShown).map((field) => (
        <OneField key={field.key} field={field} name={[...base, field.key]} texts={textsOf(field)} />
      ))}
    </div>
  );
}
