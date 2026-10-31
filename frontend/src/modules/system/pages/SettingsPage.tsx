import { Children, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, Form, Input, InputNumber, Popconfirm, Segmented, Switch, Tag, Typography, message } from 'antd';
import { KeyRound, PlugZap, Save, Unplug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { engineErrorMessage, engineErrorStatus } from '@/api/engine';
import { hasAdminPassword, setAdminPassword } from '@/api/secrets';
import { fetchSettings, saveSettings, testDatabase } from '@/api/system';
import type { DatabaseInput } from '@/api/system';
import { AppearanceControls } from '@/components/AppearanceControls';
import { Hint } from '@/components/Hint';
import { ROUTES, SETTINGS_PARAM, settingsSection } from '@/router/routes';
import { useAppDispatch, useAppSelector } from '@/store';
import { logout } from '@/store/slices/authSlice';
import { statusChanged } from '@/store/slices/systemSlice';
import type { ConnectionError, OnClose } from '@/types/system.types';

const { Title, Text } = Typography;

const MIN_PASSWORD = 8;

interface GatewayForm {
  port: number;
  public: boolean;
}

interface DatabaseForm {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  ssl: boolean;
}

interface PasswordForm {
  current: string;
  password: string;
  repeat: string;
}

interface PanelProps {
  /** Whether this is the section that is open. */
  shown: boolean;
  title: string;
  /** How the section's thing is doing, beside the title. */
  badge?: ReactNode;
  /** One line on what the section is for. */
  hint?: string;
  /** What there is to set; a section may have nothing but its line. */
  children?: ReactNode;
}

/**
 * One section of the settings. The ones that are not open stay on the page,
 * out of sight: what was typed into their forms is still there on coming back.
 */
function Panel({ shown, title, badge, hint, children }: PanelProps) {
  return (
    <section className={shown ? 'flex flex-col gap-(--c-spacing)' : 'hidden'}>
      <div>
        <div className="flex flex-wrap items-center gap-(--c-spacing-xs)">
          <Title level={3} className="mb-0!">
            {title}
          </Title>
          {badge}
        </div>
        {hint && <Text type="secondary">{hint}</Text>}
      </div>
      {/* Counted, as "nothing" may come as a list of nothings. */}
      {Children.toArray(children).length > 0 && (
        <Card className="border-line-soft! bg-container! shadow-(--c-box-shadow-card)!">{children}</Card>
      )}
    </section>
  );
}

/** A yes/no setting on one line, explained on request. */
function Toggle({ name, label, hint }: { name: string; label: string; hint: string }) {
  return (
    <div className="flex items-center justify-between gap-(--c-spacing)">
      <div className="flex items-center gap-(--c-spacing-xs)">
        <span>{label}</span>
        <Hint text={hint} />
      </div>
      <Form.Item name={name} valuePropName="checked" noStyle>
        <Switch aria-label={label} />
      </Form.Item>
    </div>
  );
}

/**
 * How the app runs on this computer, a section at a time: the gateway's port,
 * how the app looks, its window, the shared database the secrets come from,
 * where the projects are, the administrator's password.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const status = useAppSelector((state) => state.system.status);

  const [gatewayForm] = Form.useForm<GatewayForm>();
  const [databaseForm] = Form.useForm<DatabaseForm>();
  const [passwordForm] = Form.useForm<PasswordForm>();
  const [messageApi, contextHolder] = message.useMessage();

  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [hasDatabasePassword, setHasDatabasePassword] = useState(false);
  // What the window's close button does; unset until the settings are read.
  const [onClose, setOnClose] = useState<OnClose>();
  // What the last test of the database connection said.
  const [tested, setTested] = useState<{ ok: boolean; error?: ConnectionError | null }>();
  // Unknown until asked; there is nothing to change before the first one is set.
  const [passwordExists, setPasswordExists] = useState<boolean>();

  const database = status?.database;
  const usesDatabase = database?.used ?? false;
  const isConnected = database?.connected ?? false;
  const hasWindow = status?.hasWindow ?? false;
  const section = settingsSection(searchParams.get(SETTINGS_PARAM), hasWindow);

  useEffect(() => {
    let isCurrent = true;
    void fetchSettings().then((settings) => {
      if (!isCurrent) return;
      gatewayForm.setFieldsValue(settings.gateway);
      setOnClose(settings.window.onClose);
      setHasDatabasePassword(settings.database.hasPassword);
      databaseForm.setFieldsValue({
        host: settings.database.host,
        port: settings.database.port,
        database: settings.database.database,
        user: settings.database.user,
        ssl: settings.database.ssl,
      });
    });
    return () => {
      isCurrent = false;
    };
  }, [gatewayForm, databaseForm]);

  // The administrator's password is kept where the secrets are, so which one
  // there is to change depends on that.
  useEffect(() => {
    let isCurrent = true;
    hasAdminPassword()
      .then((exists) => isCurrent && setPasswordExists(exists))
      .catch(() => isCurrent && setPasswordExists(undefined));
    return () => {
      isCurrent = false;
    };
  }, [usesDatabase, isConnected]);

  // The engine explains in English; where there is a translation, it is used.
  const explain = (error?: ConnectionError | null) =>
    error ? t(`system.errors.${error.reason}`, { defaultValue: error.message }) : '';

  const saveGateway = async (values: GatewayForm) => {
    setIsSaving(true);
    try {
      const next = await saveSettings({ gateway: values });
      dispatch(statusChanged(next));
      // A port that could not be taken is explained on the card itself.
      if (next.gateway.running) messageApi.success(t('system.saved'));
    } catch (error) {
      messageApi.error(engineErrorMessage(error) || t('gateway.requestFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  // Applied as it is chosen: there is nothing else to fill in beside it.
  const chooseOnClose = async (choice: OnClose) => {
    const before = onClose;
    setOnClose(choice);
    try {
      await saveSettings({ window: { onClose: choice } });
    } catch (error) {
      setOnClose(before);
      messageApi.error(engineErrorMessage(error) || t('gateway.requestFailed'));
    }
  };

  const databaseOf = (values: DatabaseForm): DatabaseInput => ({
    host: values.host.trim(),
    port: values.port,
    database: values.database.trim(),
    user: values.user.trim(),
    ssl: values.ssl,
    // Left out when nothing was typed: the saved one stays.
    ...(values.password ? { password: values.password } : {}),
  });

  const testConnection = async () => {
    const values = await databaseForm.validateFields();
    setIsTesting(true);
    try {
      setTested(await testDatabase(databaseOf(values)));
    } catch {
      messageApi.error(t('gateway.requestFailed'));
    } finally {
      setIsTesting(false);
    }
  };

  // Connects to the database, or (with nothing given) goes back to this
  // computer's file. Either way the secrets, and the administrator, change.
  const keepSecretsIn = async (values?: DatabaseForm) => {
    setIsConnecting(true);
    try {
      const next = await saveSettings({ database: values ? databaseOf(values) : null });
      dispatch(statusChanged(next));
      dispatch(logout());
      setTested(undefined);

      if (!values) {
        setHasDatabasePassword(false);
        databaseForm.setFieldValue('host', '');
        messageApi.success(t('system.disconnected'));
      } else {
        if (values.password) setHasDatabasePassword(true);
        databaseForm.setFieldValue('password', undefined);
        if (next.database.connected) messageApi.success(t('system.connectedNow'));
      }
    } catch (error) {
      messageApi.error(engineErrorMessage(error) || t('gateway.requestFailed'));
    } finally {
      setIsConnecting(false);
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

  const gateway = status?.gateway;
  // Where clients can call the gateway as it runs now: by this computer's
  // network addresses if it is open to the network, and always from here.
  const callAt = gateway?.running
    ? [
        ...(gateway.public ? (status?.addresses ?? []).filter(({ virtual }) => !virtual).map(({ address }) => address) : []),
        'localhost',
      ].map((host) => `http://${host}:${gateway.port}`)
    : [];

  return (
    <div className="max-w-2xl">
      {contextHolder}

      <Panel
        shown={section === 'gateway'}
        title={t('system.gateway')}
        badge={
          gateway && (
            <Tag color={gateway.running ? 'success' : 'error'} className="me-0!">
              {gateway.running ? t('system.gatewayRunning') : t('system.gatewayStopped')}
            </Tag>
          )
        }
      >
        <Form<GatewayForm>
          form={gatewayForm}
          // Named, so its fields and the other forms' are told apart.
          name="gateway"
          layout="vertical"
          requiredMark={false}
          onFinish={saveGateway}
          initialValues={{ port: 8100, public: true }}
        >
          <Form.Item
            name="port"
            label={t('system.gatewayPort')}
            tooltip={t('system.gatewayHint')}
            rules={[{ required: true, message: t('system.portRequired') }]}
          >
            <InputNumber min={1} max={65535} precision={0} className="w-40!" />
          </Form.Item>

          <Toggle name="public" label={t('system.gatewayPublic')} hint={t('system.gatewayPublicHint')} />

          {gateway?.error && (
            <Alert className="mt-(--c-spacing)!" type="error" showIcon title={explain(gateway.error)} />
          )}

          {callAt.length > 0 && (
            <div className="mt-(--c-spacing) flex flex-col gap-(--c-spacing-xxs)">
              <Text type="secondary">{t('system.callAt')}</Text>
              <div className="flex flex-wrap gap-(--c-spacing-xs)">
                {callAt.map((url) => (
                  <Text key={url} code copyable>
                    {url}
                  </Text>
                ))}
              </div>
            </div>
          )}

          <div className="mt-(--c-spacing) flex justify-end">
            <Button type="primary" htmlType="submit" icon={<Save size={16} />} loading={isSaving}>
              {t('system.save')}
            </Button>
          </div>
        </Form>
      </Panel>

      <Panel shown={section === 'appearance'} title={t('system.appearance')}>
        <AppearanceControls />
      </Panel>

      {hasWindow && onClose && (
        <Panel shown={section === 'window'} title={t('system.window')}>
          <div className="mb-(--c-spacing-xs)">{t('system.onClose')}</div>
          <Segmented<OnClose>
            value={onClose}
            onChange={chooseOnClose}
            options={[
              { value: 'ask', label: t('system.onCloseAsk') },
              { value: 'tray', label: t('system.onCloseTray') },
              { value: 'quit', label: t('system.onCloseQuit') },
            ]}
          />
          <Text type="secondary" className="mt-(--c-spacing-xs) block text-(length:--c-font-size-sm)!">
            {t(`system.onCloseHint.${onClose}`)}
          </Text>
        </Panel>
      )}

      <Panel
        shown={section === 'database'}
        title={t('system.secretsDb')}
        hint={t('system.secretsDbHint')}
        badge={
          database && (
            <Tag color={!usesDatabase ? 'default' : isConnected ? 'success' : 'error'} className="me-0!">
              {!usesDatabase ? t('system.dbUnused') : isConnected ? t('system.connected') : t('system.notConnected')}
            </Tag>
          )
        }
      >
        <Form<DatabaseForm>
          form={databaseForm}
          name="database"
          layout="vertical"
          requiredMark={false}
          onFinish={(values) => keepSecretsIn(values)}
          initialValues={{ port: 5432, database: 'konggate', user: 'konggate', ssl: false }}
        >
          <div className="grid gap-x-(--c-spacing-sm) sm:grid-cols-[minmax(0,1fr)_140px]">
            <Form.Item
              name="host"
              label={t('system.host')}
              rules={[{ required: true, whitespace: true, message: t('system.hostRequired') }]}
            >
              <Input placeholder="192.168.1.10" />
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
              rules={[{ required: !hasDatabasePassword, message: t('system.fieldRequired') }]}
            >
              <Input.Password
                placeholder={hasDatabasePassword ? t('system.passwordKeep') : undefined}
                autoComplete="off"
              />
            </Form.Item>
          </div>

          <Toggle name="ssl" label={t('system.ssl')} hint={t('system.sslHint')} />

          {tested && (
            <Alert
              className="mt-(--c-spacing)!"
              type={tested.ok ? 'success' : 'error'}
              showIcon
              title={tested.ok ? t('system.testOk') : explain(tested.error) || t('system.notConnected')}
            />
          )}
          {!tested && usesDatabase && !isConnected && database?.error && (
            <Alert className="mt-(--c-spacing)!" type="error" showIcon title={explain(database.error)} />
          )}

          <div className="mt-(--c-spacing) flex flex-wrap justify-end gap-(--c-spacing-xs)">
            {usesDatabase && (
              <Popconfirm
                title={t('system.disconnectConfirm')}
                okText={t('system.disconnect')}
                cancelText={t('gateway.cancel')}
                onConfirm={() => keepSecretsIn()}
              >
                <Button danger icon={<Unplug size={16} />} className="me-auto">
                  {t('system.disconnect')}
                </Button>
              </Popconfirm>
            )}
            <Button icon={<PlugZap size={16} />} loading={isTesting} onClick={testConnection}>
              {t('system.test')}
            </Button>
            <Button type="primary" htmlType="submit" icon={<Save size={16} />} loading={isConnecting}>
              {t('system.connect')}
            </Button>
          </div>
        </Form>
      </Panel>

      <Panel shown={section === 'data'} title={t('system.data')} hint={t('system.dataHint')}>
        {status?.dataFile && (
          <Text code copyable className="block break-all">
            {status.dataFile}
          </Text>
        )}
      </Panel>

      <Panel
        shown={section === 'admin'}
        title={t('system.adminPassword')}
        hint={
          passwordExists === false
            ? t('system.adminPasswordNone')
            : usesDatabase
              ? t('system.adminPasswordHintShared')
              : t('system.adminPasswordHint')
        }
      >
        {passwordExists && (
          <Form<PasswordForm>
            form={passwordForm}
            name="admin-password"
            layout="vertical"
            requiredMark={false}
            onFinish={changePassword}
          >
            <Form.Item
              name="current"
              label={t('system.currentPassword')}
              rules={[{ required: true, message: t('system.fieldRequired') }]}
            >
              <Input.Password autoComplete="off" />
            </Form.Item>
            <div className="grid gap-x-(--c-spacing-sm) sm:grid-cols-2">
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
              <Button type="primary" htmlType="submit" loading={isChangingPassword}>
                {t('system.changePassword')}
              </Button>
            </div>
          </Form>
        )}
        {/* The first password is set where the administrator signs in. */}
        {passwordExists === false && (
          <Button type="primary" icon={<KeyRound size={16} />} onClick={() => navigate(ROUTES.LOGIN)}>
            {t('login.setTitle')}
          </Button>
        )}
      </Panel>
    </div>
  );
}
