import { useState } from 'react';
import { Alert, Button, Card, Empty, Popconfirm, Table, Tag, Tooltip, Typography, message } from 'antd';
import { KeyRound, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import { useAppDispatch, useAppSelector } from '@/store';
import { loadSecrets, removeSecret, saveSecret } from '@/store/slices/secretsSlice';
import type { SecretsRejection } from '@/store/slices/secretsSlice';
import { Role } from '@/types/auth.types';
import type { GatewaySecret, SecretPayload } from '@/types/gateway.types';
import { SecretFormModal } from '../components/SecretFormModal';
import { isHmac } from '../utils/token';

const { Title, Text } = Typography;

export function SecretsPage() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const { items: secrets, status } = useAppSelector((state) => state.secrets);
  // The rules say which secrets are in use. (The layout loads both lists.)
  const rules = useAppSelector((state) => state.gateway.items);
  // Everyone sees the names; only an administrator changes anything, and the
  // gateway checks that itself from the session they signed in with.
  const isAdmin = useAppSelector((state) => state.auth.role) === Role.ADMIN;
  const session = useAppSelector((state) => state.auth.token) ?? '';

  const [messageApi, contextHolder] = message.useMessage();
  // Open with no secret to add one; with a secret to change it.
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<GatewaySecret>();
  const [isSaving, setIsSaving] = useState(false);

  const openCreate = () => {
    setEditing(undefined);
    setIsFormOpen(true);
  };

  const openEdit = (secret: GatewaySecret) => {
    setEditing(secret);
    setIsFormOpen(true);
  };

  const showFailure = (reason: unknown) => {
    const { status: code, message: explanation } = (reason ?? {}) as Partial<SecretsRejection>;
    messageApi.error(code === 401 ? t('secrets.sessionExpired') : explanation || t('secrets.requestFailed'));
  };

  const handleSubmit = async (payload: SecretPayload) => {
    setIsSaving(true);
    try {
      await dispatch(saveSecret({ payload, existing: editing, session })).unwrap();
      messageApi.success(editing ? t('secrets.updated') : t('secrets.created'));
      setIsFormOpen(false);
    } catch (reason) {
      showFailure(reason);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (secret: GatewaySecret) => {
    try {
      await dispatch(removeSecret({ secret, session })).unwrap();
      messageApi.success(t('secrets.deleted'));
    } catch (reason) {
      showFailure(reason);
    }
  };

  const usesOf = (secret: GatewaySecret) =>
    rules.filter((rule) => rule.token.enabled && rule.token.verify.enabled && rule.token.verify.secretId === secret.id)
      .length;

  // All in digits: browsers don't all know the month names of every language here.
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { year: 'numeric', month: '2-digit', day: '2-digit' });

  const columns: ColumnsType<GatewaySecret> = [
    {
      title: t('secrets.name'),
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: t('secrets.type'),
      key: 'type',
      render: (_, secret) => (
        <div className="flex flex-wrap items-center gap-(--c-spacing-xs)">
          <Tag className="me-0!">{secret.algorithm}</Tag>
          <Text type="secondary">{isHmac(secret.algorithm) ? t('secrets.kindSecret') : t('secrets.kindKey')}</Text>
        </div>
      ),
    },
    {
      title: t('secrets.usedBy'),
      key: 'usedBy',
      render: (_, secret) => {
        const uses = usesOf(secret);
        return uses > 0 ? (
          <Tag color="processing" className="me-0!">
            {t('secrets.usedByCount', { n: uses })}
          </Tag>
        ) : (
          <Text type="secondary">{t('secrets.unused')}</Text>
        );
      },
    },
    {
      title: t('secrets.createdAt'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      responsive: ['md'],
      render: formatDate,
    },
  ];

  if (isAdmin) {
    columns.push({
      title: t('secrets.actions'),
      key: 'actions',
      align: 'right',
      width: 110,
      render: (_, secret) => {
        const isUsed = usesOf(secret) > 0;
        return (
          <div className="flex justify-end gap-(--c-spacing-xxs)">
            <Button
              type="text"
              size="small"
              aria-label={t('secrets.edit')}
              icon={<Pencil size={14} />}
              onClick={() => openEdit(secret)}
            />
            <Tooltip title={isUsed ? t('secrets.deleteInUse') : undefined}>
              <Popconfirm
                title={t('secrets.deleteConfirm', { name: secret.name })}
                okText={t('secrets.delete')}
                cancelText={t('secrets.cancel')}
                okButtonProps={{ danger: true }}
                disabled={isUsed}
                onConfirm={() => handleDelete(secret)}
              >
                <Button
                  type="text"
                  size="small"
                  danger
                  disabled={isUsed}
                  aria-label={t('secrets.delete')}
                  icon={<Trash2 size={14} />}
                />
              </Popconfirm>
            </Tooltip>
          </div>
        );
      },
    });
  }

  return (
    <div className="space-y-(--c-spacing-lg)">
      {contextHolder}

      <div className="flex flex-wrap items-center justify-between gap-(--c-spacing-sm)">
        <div className="flex items-center gap-(--c-spacing-sm)">
          <div className="w-10 h-10 rounded-(--c-border-radius-xl) bg-brand/10 flex items-center justify-center">
            <KeyRound size={22} className="text-brand" />
          </div>
          <div>
            <Title level={3} className="mb-0!">
              {t('secrets.title')}
            </Title>
            <Text type="secondary">{t('secrets.subtitle')}</Text>
          </div>
        </div>

        <div className="flex items-center gap-(--c-spacing-xs)">
          <Tooltip title={t('secrets.refresh')}>
            <Button
              aria-label={t('secrets.refresh')}
              icon={<RefreshCw size={16} />}
              onClick={() => dispatch(loadSecrets())}
            />
          </Tooltip>
          {isAdmin && (
            <Button type="primary" icon={<Plus size={16} />} disabled={status === 'failed'} onClick={openCreate}>
              {t('secrets.new')}
            </Button>
          )}
        </div>
      </div>

      {status === 'failed' ? (
        <Alert
          type="error"
          showIcon
          title={t('gateway.unreachable')}
          description={t('gateway.unreachableHint')}
          action={<Button onClick={() => dispatch(loadSecrets())}>{t('gateway.retry')}</Button>}
        />
      ) : (
        <>
          <Text type="secondary" className="block">
            {t('secrets.notice')} {!isAdmin && t('secrets.adminNotice')}
          </Text>

          <Card
            className="border-line-soft! bg-container! shadow-(--c-box-shadow-card)! overflow-hidden"
            styles={{ body: { padding: 0 } }}
          >
            <Table<GatewaySecret>
              rowKey="id"
              columns={columns}
              dataSource={secrets}
              loading={status !== 'ready'}
              pagination={false}
              locale={{
                emptyText: (
                  <Empty description={t('secrets.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE}>
                    {isAdmin && (
                      <Button type="primary" icon={<Plus size={16} />} onClick={openCreate}>
                        {t('secrets.new')}
                      </Button>
                    )}
                  </Empty>
                ),
              }}
            />
          </Card>
        </>
      )}

      <SecretFormModal
        open={isFormOpen}
        secret={editing}
        secrets={secrets}
        saving={isSaving}
        onSubmit={handleSubmit}
        onCancel={() => setIsFormOpen(false)}
      />
    </div>
  );
}
