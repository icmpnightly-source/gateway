import { Card, Typography, Table, Tag } from 'antd';
import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';

const { Title, Text } = Typography;

interface UserRecord {
  key: string;
  username: string;
  email: string;
  role: string;
  status: 'active' | 'inactive';
}

const mockData: UserRecord[] = [
  { key: '1', username: 'admin', email: 'admin@example.com', role: 'ADMIN', status: 'active' },
  { key: '2', username: 'manager', email: 'manager@example.com', role: 'MANAGER', status: 'active' },
  { key: '3', username: 'user', email: 'user@example.com', role: 'USER', status: 'active' },
  { key: '4', username: 'guest', email: 'guest@example.com', role: 'USER', status: 'inactive' },
];

const columns: ColumnsType<UserRecord> = [
  {
    title: 'Username',
    dataIndex: 'username',
    key: 'username',
    render: (text: string) => <Text strong>{text}</Text>,
  },
  {
    title: 'Email',
    dataIndex: 'email',
    key: 'email',
  },
  {
    title: 'Role',
    dataIndex: 'role',
    key: 'role',
    render: (role: string) => {
      const colorMap: Record<string, string> = {
        ADMIN: 'red',
        MANAGER: 'blue',
        USER: 'green',
      };
      return <Tag color={colorMap[role] ?? 'default'}>{role}</Tag>;
    },
  },
  {
    title: 'Status',
    dataIndex: 'status',
    key: 'status',
    render: (status: string) => (
      <Tag color={status === 'active' ? 'success' : 'default'}>{status}</Tag>
    ),
  },
];

export function AdminPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-(--c-spacing-lg)">
      <div className="flex items-center gap-(--c-spacing-sm)">
        <div className="w-10 h-10 rounded-(--c-border-radius-xl) bg-error/10 flex items-center justify-center">
          <ShieldCheck size={22} className="text-error" />
        </div>
        <div>
          <Title level={3} className="mb-0!">
            {t('admin.title')}
          </Title>
          <Text type="secondary">{t('admin.subtitle')}</Text>
        </div>
      </div>

      <Card className="border-line-soft! bg-container! shadow-(--c-box-shadow-card)! overflow-hidden" styles={{ body: { padding: 0 } }}>
        <Table<UserRecord>
          columns={columns}
          dataSource={mockData}
          pagination={false}
        />
      </Card>
    </div>
  );
}
