import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Card, Spin, message } from 'antd';
import { ArrowLeft, Lock } from 'lucide-react';
import { engineErrorStatus } from '@/api/engine';
import { hasAdminPassword, setAdminPassword, signIn } from '@/api/secrets';
import { useAppDispatch, useAppSelector } from '@/store';
import { login } from '@/store/slices/authSlice';
import { Role } from '@/types/auth.types';
import { ROUTES } from '@/router/routes';
import { useTranslation } from 'react-i18next';

// The one account there is. Everyone else uses the app without signing in.
const ADMIN = {
  id: 'admin',
  username: 'admin',
  email: '',
  role: Role.ADMIN,
} as const;

const MIN_PASSWORD = 8;

// Why a sign-in was turned down, by its status.
const SIGN_IN_ERRORS: Record<number, string> = {
  401: 'login.wrongPassword',
  409: 'login.noAdminPassword',
  429: 'login.tooManyAttempts',
  503: 'login.noDatabase',
};

interface LoginForm {
  password: string;
  repeat?: string;
}

export function LoginPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [messageApi, contextHolder] = message.useMessage();
  const [isSigningIn, setIsSigningIn] = useState(false);
  // The password is kept where the secrets are: for everyone, or for this computer.
  const isShared = useAppSelector((state) => state.system.status?.database.used) ?? false;
  // Until somebody sets the first password there is nothing to sign in with:
  // whoever comes first chooses it.
  const [passwordExists, setPasswordExists] = useState<boolean>();

  useEffect(() => {
    let isCurrent = true;
    hasAdminPassword()
      .then((exists) => isCurrent && setPasswordExists(exists))
      // Not reachable right now: offer the plain sign-in, which will say why.
      .catch(() => isCurrent && setPasswordExists(true));
    return () => {
      isCurrent = false;
    };
  }, []);

  const isFirst = passwordExists === false;

  const onFinish = async ({ password }: LoginForm) => {
    setIsSigningIn(true);
    try {
      if (isFirst) {
        try {
          await setAdminPassword(password);
        } catch (error) {
          // Someone on another computer was quicker; theirs is the password now.
          if ([401, 409].includes(engineErrorStatus(error) ?? 0)) {
            setPasswordExists(true);
            messageApi.warning(t('login.passwordAlreadySet'));
            return;
          }
          throw error;
        }
      }

      // The engine is what checks the password. The session it answers with
      // is what lets an administrator manage the JWT secrets.
      const token = await signIn(password);
      dispatch(login({ user: { ...ADMIN }, token }));
      // AuthLayout takes a signed-in user back to the app on its own.
    } catch (error) {
      messageApi.error(t(SIGN_IN_ERRORS[engineErrorStatus(error) ?? 0] ?? 'login.gatewayUnreachable'));
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <>
      {contextHolder}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          {isFirst ? t('login.setTitle') : t('login.title')}
        </h1>
        <p className="text-sm text-subtle">{!isFirst ? t('login.subtitle') : isShared ? t('login.setSubtitleShared') : t('login.setSubtitle')}</p>
      </div>

      <Card
        className="shadow-(--c-box-shadow-card) p-(--c-spacing-xl)"
      >
        {passwordExists === undefined ? (
          <div className="flex justify-center py-(--c-spacing-lg)">
            <Spin />
          </div>
        ) : (
          <Form<LoginForm>
            // The two forms share nothing: a half-typed password is not carried over.
            key={isFirst ? 'first' : 'sign-in'}
            layout="vertical"
            onFinish={onFinish}
            size="middle"
            requiredMark={false}
          >
            <Form.Item
              name="password"
              label={isFirst ? t('login.newPassword') : t('login.password')}
              rules={
                isFirst
                  ? [{ required: true, min: MIN_PASSWORD, message: t('login.passwordTooShort') }]
                  : [{ required: true, message: t('login.passwordRequired') }]
              }
            >
              <Input.Password
                autoFocus
                prefix={<Lock size={16} className="text-subtle" />}
                placeholder={t('login.passwordPlaceholder')}
                autoComplete={isFirst ? 'new-password' : 'current-password'}
              />
            </Form.Item>

            {isFirst && (
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
                <Input.Password
                  prefix={<Lock size={16} className="text-subtle" />}
                  placeholder={t('login.repeatPassword')}
                  autoComplete="new-password"
                />
              </Form.Item>
            )}

            <Form.Item className="mb-0 mt-6">
              <Button type="primary" htmlType="submit" block loading={isSigningIn}>
                {isFirst ? t('login.setSubmit') : t('login.submit')}
              </Button>
            </Form.Item>
          </Form>
        )}
      </Card>

      <div className="mt-(--c-spacing) text-center">
        <Button type="link" icon={<ArrowLeft size={14} />} onClick={() => navigate(ROUTES.HOME)}>
          {t('login.back')}
        </Button>
      </div>
    </>
  );
}
