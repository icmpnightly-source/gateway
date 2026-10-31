import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Card, Select, message } from 'antd';
import { Lock, UserRound } from 'lucide-react';
import { useAppDispatch } from '@/store';
import { login } from '@/store/slices/authSlice';
import { Role } from '@/types/auth.types';
import type { LoginPayload } from '@/types/auth.types';
import { ROUTES } from '@/router/routes';
import { useTranslation } from 'react-i18next';

const MOCK_USERS = {
  admin: {
    id: '1',
    username: 'admin',
    email: 'admin@example.com',
    role: Role.ADMIN,
  },
  manager: {
    id: '2',
    username: 'manager',
    email: 'manager@example.com',
    role: Role.MANAGER,
  },
  user: {
    id: '3',
    username: 'user',
    email: 'user@example.com',
    role: Role.USER,
  },
} as const;

type MockUserKey = keyof typeof MOCK_USERS;

interface LoginFormValues extends LoginPayload {
  role: MockUserKey;
}

export function LoginPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [messageApi, contextHolder] = message.useMessage();

  const onFinish = (values: LoginFormValues) => {
    const mockUser = MOCK_USERS[values.role];
    const token = `mock-jwt-token-${Date.now()}`;

    dispatch(
      login({
        user: { ...mockUser },
        token,
      }),
    );

    messageApi.success(t('login.success'));

    setTimeout(() => {
      navigate(ROUTES.DASHBOARD);
    }, 500);
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
        <Form<LoginFormValues>
          layout="vertical"
          onFinish={onFinish}
          initialValues={{ role: 'admin' }}
          size="middle"
          requiredMark={false}
        >
          <Form.Item
            name="username"
            label={t('login.username')}
            rules={[{ required: true, message: t('login.usernameRequired') }]}
          >
            <Input
              prefix={<UserRound size={16} className="text-subtle" />}
              placeholder={t('login.usernamePlaceholder')}
            />
          </Form.Item>

          <Form.Item
            name="password"
            label={t('login.password')}
            rules={[{ required: true, message: t('login.passwordRequired') }]}
          >
            <Input.Password
              prefix={<Lock size={16} className="text-subtle" />}
              placeholder={t('login.passwordPlaceholder')}
            />
          </Form.Item>

          <Form.Item
            name="role"
            label={t('login.role')}
          >
            <Select
              options={[
                { value: 'admin', label: 'Admin' },
                { value: 'manager', label: 'Manager' },
                { value: 'user', label: 'User' },
              ]}
            />
          </Form.Item>

          <Form.Item className="mb-0 mt-6">
            <Button type="primary" htmlType="submit" block>
              {t('login.submit')}
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </>
  );
}
