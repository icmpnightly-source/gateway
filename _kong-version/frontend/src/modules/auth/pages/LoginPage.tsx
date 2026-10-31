import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Card, message } from 'antd';
import { ArrowLeft, Lock } from 'lucide-react';
import { kongErrorStatus } from '@/api/kongAdmin';
import { signIn } from '@/api/secrets';
import { useAppDispatch } from '@/store';
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

// Why the gateway turned a sign-in down, by its status.
const SIGN_IN_ERRORS: Record<number, string> = {
  401: 'login.wrongPassword',
  429: 'login.tooManyAttempts',
  503: 'login.noAdminPassword',
};

export function LoginPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [messageApi, contextHolder] = message.useMessage();
  const [isSigningIn, setIsSigningIn] = useState(false);

  const onFinish = async ({ password }: { password: string }) => {
    setIsSigningIn(true);
    try {
      // The gateway is what checks the password. The session it answers with
      // is what lets an administrator manage the JWT secrets.
      const token = await signIn(password);
      dispatch(login({ user: { ...ADMIN }, token }));
      // AuthLayout takes a signed-in user back to the app on its own.
    } catch (error) {
      messageApi.error(t(SIGN_IN_ERRORS[kongErrorStatus(error) ?? 0] ?? 'login.gatewayUnreachable'));
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <>
      {contextHolder}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          {t('login.title')}
        </h1>
        <p className="text-sm text-subtle">{t('login.subtitle')}</p>
      </div>

      <Card
        className="shadow-(--c-box-shadow-card) p-(--c-spacing-xl)"
      >
        <Form<{ password: string }>
          layout="vertical"
          onFinish={onFinish}
          size="middle"
          requiredMark={false}
        >
          <Form.Item
            name="password"
            label={t('login.password')}
            rules={[{ required: true, message: t('login.passwordRequired') }]}
          >
            <Input.Password
              autoFocus
              prefix={<Lock size={16} className="text-subtle" />}
              placeholder={t('login.passwordPlaceholder')}
            />
          </Form.Item>

          <Form.Item className="mb-0 mt-6">
            <Button type="primary" htmlType="submit" block loading={isSigningIn}>
              {t('login.submit')}
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <div className="mt-(--c-spacing) text-center">
        <Button type="link" icon={<ArrowLeft size={14} />} onClick={() => navigate(ROUTES.HOME)}>
          {t('login.back')}
        </Button>
      </div>
    </>
  );
}
