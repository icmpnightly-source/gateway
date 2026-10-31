import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Form, Input, InputNumber, Switch, Tag, Typography, message } from 'antd';
import { Database, PlugZap, Save, Waypoints } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { engineErrorMessage, engineErrorStatus } from '@/api/engine';
import { setAdminPassword } from '@/api/secrets';
import { fetchSettings, saveSettings, testDatabase } from '@/api/system';
import type { DatabaseInput } from '@/api/system';
import { ROUTES } from '@/router/routes';
import { useAppDispatch, useAppSelector } from '@/store';
import { logout } from '@/store/slices/authSlice';
import { statusChanged } from '@/store/slices/systemSlice';
import type { ConnectionError } from '@/types/system.types';

const { Title, Text } = Typography;

const CARD = 'border-line-soft! bg-container! shadow-(--c-box-shadow-card)!';
const MIN_PASSWORD = 8;

interface SettingsForm {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  ssl: boolean;
  gatewayPort: number;
  gatewayPublic: boolean;
}

interface PasswordForm {
  current: string;
  password: string;
  repeat: string;
}

/** This computer's own settings: where the shared database is, and its gateway's port. */
export function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const status = useAppSelector((state) => state.system.status);

  const [form] = Form.useForm<SettingsForm>();
  const [passwordForm] = Form.useForm<PasswordForm>();
  const [messageApi, contextHolder] = message.useMessage();
  const [hasPassword, setHasPassword] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  // What the last test or save said about the connection.
  const [outcome, setOutcome] = useState<{ ok: boolean; error?: ConnectionError | null }>();

  useEffect(() => {
    let isCurrent = true;
    void fetchSettings().then(({ database, gateway }) => {
      if (!isCurrent) return;
      setHasPassword(database.hasPassword);
      form.setFieldsValue({
        host: database.host,
        port: database.port,
        database: database.database,
        user: database.user,
        ssl: database.ssl,
        gatewayPort: gateway.port,
        gatewayPublic: gateway.public,
      });
    });
    return () => {
      isCurrent = false;
    };
  }, [form]);

  // The engine explains in English; where there is a translation, it is used.
  const explain = (error?: ConnectionError | null) =>
    error ? t(`system.errors.${error.reason}`, { defaultValue: error.message }) : '';

  const databaseOf = (values: SettingsForm): DatabaseInput => ({
    host: values.host.trim(),
    port: values.port,
    database: values.database.trim(),
    user: values.user.trim(),
    ssl: values.ssl,
    // Left out when nothing was typed: the saved one stays.
    ...(values.password ? { password: values.password } : {}),
  });

  const test = async () => {
    const values = await form.validateFields();
    setIsTesting(true);
    try {
      setOutcome(await testDatabase(databaseOf(values)));
    } catch {
      messageApi.error(t('gateway.requestFailed'));
    } finally {
      setIsTesting(false);
    }
  };

  const save = async (values: SettingsForm) => {
    setIsSaving(true);
    try {
      const wasSetUp = status?.database.connected;
      const next = await saveSettings({
        database: databaseOf(values),
        gateway: { port: values.gatewayPort, public: values.gatewayPublic },
      });
      dispatch(statusChanged(next));
      setOutcome({ ok: next.database.connected, error: next.database.error });
      if (values.password) setHasPassword(true);
      form.setFieldValue('password', undefined);

      if (next.database.connected) {
        messageApi.success(t('system.saved'));
        // The first connection is what the app was waiting for: on to the projects.
        if (!wasSetUp) navigate(ROUTES.HOME);
      }
    } catch (error) {
      messageApi.error(engineErrorMessage(error) || t('gateway.requestFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const changePassword = async ({ current, password }: PasswordForm) => {
    setIsChangingPassword(true);
    try {
      await setAdminPassword(password, current);
      passwordForm.resetFields();
      // The old password's sessions ended with it.
      dispatch(logout());
      messageApi.success(t('system.passwordChanged'));
    } catch (error) {
      const code = engineErrorStatus(error);
      if (code === 401) messageApi.error(t('login.wrongPassword'));
      else if (code === 429) messageApi.error(t('login.tooManyAttempts'));
      else messageApi.error(engineErrorMessage(error) || t('gateway.requestFailed'));
    } finally {
      setIsChangingPassword(false);
    }
  };

  const isConnected = status?.database.connected ?? false;
  const gateway = status?.gateway;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-(--c-spacing-lg)">
      {contextHolder}

      <div>
        <Title level={3} className="mb-(--c-spacing-xxs)!">
          {status?.configured === false ? t('system.setupTitle') : t('system.title')}
        </Title>
        <Text type="secondary">{status?.configured === false ? t('system.setupText') : t('system.subtitle')}</Text>
      </div>

      <Form<SettingsForm>
        form={form}
        // Named, so its password field and the other form's are told apart.
        name="settings"
        layout="vertical"
        requiredMark={false}
        onFinish={save}
        initialValues={{ port: 5432, database: 'konggate', user: 'konggate', ssl: false, gatewayPort: 8100, gatewayPublic: true }}
        className="flex flex-col gap-(--c-spacing-lg)"
      >
        <Card
          className={CARD}
          title={
            <span className="flex items-center gap-(--c-spacing-xs)">
              <Database size={18} className="text-brand" />
              {t('system.database')}
              {status?.configured && (
                <Tag color={isConnected ? 'success' : 'error'} className="ms-(--c-spacing-xs)!">
                  {isConnected ? t('system.connected') : t('system.notConnected')}
                </Tag>
              )}
            </span>
          }
        >
          <div className="grid gap-x-(--c-spacing-sm) sm:grid-cols-[minmax(0,1fr)_140px]">
            <Form.Item
              name="host"
              label={t('system.host')}
              rules={[{ required: true, whitespace: true, message: t('system.hostRequired') }]}
            >
              <Input autoFocus placeholder="192.168.1.10" />
            </Form.Item>
            <Form.Item name="port" label={t('system.port')} rules={[{ required: true, message: t('system.portRequired') }]}>
              <InputNumber min={1} max={65535} precision={0} className="w-full!" />
            </Form.Item>
          </div>

          <div className="grid gap-x-(--c-spacing-sm) sm:grid-cols-3">
            <Form.Item
              name="database"
              label={t('system.dbName')}
              rules={[{ required: true, whitespace: true, message: t('system.fieldRequired') }]}
            >
              <Input placeholder="konggate" />
            </Form.Item>
            <Form.Item
              name="user"
              label={t('system.user')}
              rules={[{ required: true, whitespace: true, message: t('system.fieldRequired') }]}
            >
              <Input placeholder="konggate" />
            </Form.Item>
            <Form.Item
              name="password"
              label={t('system.password')}
              rules={[{ required: !hasPassword, message: t('system.fieldRequired') }]}
            >
              <Input.Password placeholder={hasPassword ? t('system.passwordKeep') : undefined} autoComplete="off" />
            </Form.Item>
          </div>

          <div className="flex items-start justify-between gap-(--c-spacing)">
            <div>
              <div>{t('system.ssl')}</div>
              <Text type="secondary" className="text-(length:--c-font-size-sm)!">
                {t('system.sslHint')}
              </Text>
            </div>
            <Form.Item name="ssl" valuePropName="checked" noStyle>
              <Switch aria-label={t('system.ssl')} />
            </Form.Item>
          </div>

          {outcome && (
            <Alert
              className="mt-(--c-spacing)!"
              type={outcome.ok ? 'success' : 'error'}
              showIcon
              title={outcome.ok ? t('system.testOk') : explain(outcome.error) || t('system.notConnected')}
            />
          )}
        </Card>

        <Card
          className={CARD}
          title={
            <span className="flex items-center gap-(--c-spacing-xs)">
              <Waypoints size={18} className="text-brand" />
              {t('system.gateway')}
              {gateway && (
                <Tag color={gateway.running ? 'success' : 'error'} className="ms-(--c-spacing-xs)!">
                  {gateway.running ? t('system.gatewayRunning') : t('system.gatewayStopped')}
                </Tag>
              )}
            </span>
          }
        >
          <Form.Item
            name="gatewayPort"
            label={t('system.gatewayPort')}
            extra={t('system.gatewayHint')}
            rules={[{ required: true, message: t('system.portRequired') }]}
          >
            <InputNumber min={1} max={65535} precision={0} className="w-40!" />
          </Form.Item>

          <div className="flex items-start justify-between gap-(--c-spacing)">
            <div>
              <div>{t('system.gatewayPublic')}</div>
              <Text type="secondary" className="text-(length:--c-font-size-sm)!">
                {t('system.gatewayPublicHint')}
              </Text>
            </div>
            <Form.Item name="gatewayPublic" valuePropName="checked" noStyle>
              <Switch aria-label={t('system.gatewayPublic')} />
            </Form.Item>
          </div>

          {gateway?.error && (
            <Alert className="mt-(--c-spacing)!" type="error" showIcon title={explain(gateway.error)} />
          )}

          {status && status.addresses.length > 0 && (
            <div className="mt-(--c-spacing) text-(length:--c-font-size-sm) text-subtle">
              {t('system.addresses')}:{' '}
              {status.addresses.map(({ address, adapter }) => (
                <Text key={address} code title={adapter}>
                  {address}
                </Text>
              ))}
            </div>
          )}
        </Card>

        <div className="flex flex-wrap justify-end gap-(--c-spacing-xs)">
          <Button icon={<PlugZap size={16} />} loading={isTesting} onClick={test}>
            {t('system.test')}
          </Button>
          <Button type="primary" htmlType="submit" icon={<Save size={16} />} loading={isSaving}>
            {t('system.save')}
          </Button>
        </div>
      </Form>

      {isConnected && (
        <Card className={CARD} title={t('system.adminPassword')}>
          <Text type="secondary" className="mb-(--c-spacing) block">
            {t('system.adminPasswordHint')}
          </Text>
          <Form<PasswordForm> form={passwordForm} name="admin-password" layout="vertical" requiredMark={false} onFinish={changePassword}>
            <div className="grid gap-x-(--c-spacing-sm) sm:grid-cols-3">
              <Form.Item
                name="current"
                label={t('system.currentPassword')}
                rules={[{ required: true, message: t('system.fieldRequired') }]}
              >
                <Input.Password autoComplete="off" />
              </Form.Item>
              <Form.Item
                name="password"
                label={t('login.newPassword')}
                rules={[{ required: true, min: MIN_PASSWORD, message: t('login.passwordTooShort') }]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item
                name="repeat"
                label={t('login.repeatPassword')}
                dependencies={['password']}
                rules={[
                  ({ getFieldValue }) => ({
                    validator: (_, value?: string) =>
                      value === getFieldValue('password')
                        ? Promise.resolve()
                        : Promise.reject(new Error(t('login.passwordsDiffer'))),
                  }),
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
            </div>
            <div className="flex justify-end">
              <Button htmlType="submit" loading={isChangingPassword}>
                {t('system.changePassword')}
              </Button>
            </div>
          </Form>
        </Card>
      )}
    </div>
  );
}
