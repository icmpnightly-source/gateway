import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, Empty, Popconfirm, Spin, Table, Tag, Tooltip, Typography, message } from 'antd';
import { ArrowRight, Folder, Pencil, Play, Plus, RefreshCw, ScrollText, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import { ROUTES, WORK_PARAM, requestsPath } from '@/router/routes';
import { useAppDispatch, useAppSelector, useGatewayUrl } from '@/store';
import { loadRules, removeGatewayRule, saveGatewayRule } from '@/store/slices/gatewaySlice';
import { changeProject, removeProject } from '@/store/slices/projectsSlice';
import type { GatewayRule, GatewayRulePayload, TokenField } from '@/types/gateway.types';
import { ProjectFormModal } from '../components/ProjectFormModal';
import { RuleFormModal } from '../components/RuleFormModal';
import { RuleTester } from '../components/RuleTester';
import { TokenStructureCard } from '../components/TokenStructureCard';

const { Title, Text } = Typography;

// Mappings shown per work in the table before the rest collapse into "+N".
const MAX_CLAIM_TAGS = 3;

const TAG_ROW = 'flex flex-wrap gap-(--c-spacing-xxs)';

/** One project: the shape of its tokens, and its works. */
export function ProjectPage() {
  const { t } = useTranslation();
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const dispatch = useAppDispatch();

  const { items: projects, status: projectsStatus } = useAppSelector((state) => state.projects);
  const { items: allRules, status, error } = useAppSelector((state) => state.gateway);
  const secrets = useAppSelector((state) => state.secrets.items);
  const gatewayUrl = useGatewayUrl();

  const project = projects.find((candidate) => candidate.id === projectId);
  const rules = allRules.filter((rule) => rule.projectId === projectId);

  // Which work is open for editing is part of the address, so the sidebar can
  // link straight to one: its id, or "new" for a blank one.
  const work = searchParams.get(WORK_PARAM);
  const editing = rules.find((rule) => rule.id === work);
  const isFormOpen = work === 'new' || editing !== undefined;
  const openForm = (target: string) => setSearchParams({ [WORK_PARAM]: target });
  const closeForm = () => setSearchParams({});

  const [messageApi, contextHolder] = message.useMessage();
  const [isSaving, setIsSaving] = useState(false);
  const [testing, setTesting] = useState<GatewayRule>();
  const [isRenaming, setIsRenaming] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);

  if (!project) {
    // Either the list hasn't arrived yet, or the address names no project.
    return projectsStatus === 'ready' ? (
      <Empty description={t('projects.notFound')} image={Empty.PRESENTED_IMAGE_SIMPLE}>
        <RouterLink to={ROUTES.HOME}>{t('projects.title')}</RouterLink>
      </Empty>
    ) : (
      <div className="flex justify-center py-(--c-spacing-xl)">
        <Spin />
      </div>
    );
  }

  // Thunks reject with the engine's own message, which says more than we could.
  const showFailure = (reason: unknown) => {
    messageApi.error((typeof reason === 'string' && reason) || t('gateway.requestFailed'));
  };

  const handleSubmit = async (payload: GatewayRulePayload, tokenFields?: TokenField[]) => {
    setIsSaving(true);
    try {
      await dispatch(saveGatewayRule({ payload, projectId: project.id, existing: editing })).unwrap();
      // A sample pasted while filling the form in is the project's token shape now.
      if (tokenFields) await dispatch(changeProject({ id: project.id, tokenFields })).unwrap();
      messageApi.success(editing ? t('gateway.updated') : t('gateway.created'));
      closeForm();
    } catch (reason) {
      showFailure(reason);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (rule: GatewayRule) => {
    try {
      await dispatch(removeGatewayRule(rule)).unwrap();
      messageApi.success(t('gateway.deleted'));
    } catch (reason) {
      showFailure(reason);
    }
  };

  const saveProject = async (changes: { name?: string; tokenFields?: TokenField[] }) => {
    setIsSavingProject(true);
    try {
      await dispatch(changeProject({ id: project.id, ...changes })).unwrap();
      messageApi.success(t('projects.updated'));
      setIsRenaming(false);
    } catch (reason) {
      showFailure(reason);
    } finally {
      setIsSavingProject(false);
    }
  };

  const handleDeleteProject = async () => {
    try {
      await dispatch(removeProject(project.id)).unwrap();
      navigate(ROUTES.HOME);
    } catch (reason) {
      showFailure(reason);
    }
  };

  const extrasOf = (rule: GatewayRule) => {
    const extras: string[] = [];
    if (rule.requestId.enabled) extras.push(t('gateway.requestId'));
    if (rule.tracing.enabled) extras.push(t('gateway.tracingTag'));
    if (rule.rateLimit.enabled) extras.push(t('gateway.rateLimitTag', { n: rule.rateLimit.perMinute }));
    if (rule.cors.enabled) extras.push(t('gateway.cors'));
    if (rule.headers.length > 0) extras.push(t('gateway.headersTag', { n: rule.headers.length }));
    return extras;
  };

  const columns: ColumnsType<GatewayRule> = [
    {
      title: t('gateway.name'),
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: t('gateway.incoming'),
      key: 'incoming',
      render: (_, rule) => (
        <div className="flex flex-wrap items-center gap-(--c-spacing-xxs)">
          {rule.methods.length > 0 ? (
            rule.methods.map((method) => (
              <Tag key={method} className="me-0!">
                {method}
              </Tag>
            ))
          ) : (
            <Tag className="me-0!">{t('gateway.anyMethod')}</Tag>
          )}
          <Text code>{rule.path}</Text>
        </div>
      ),
    },
    {
      title: t('gateway.destination'),
      dataIndex: 'destination',
      key: 'destination',
      render: (destination: string) => <Text code>{destination}</Text>,
    },
    {
      title: t('gateway.token'),
      key: 'token',
      responsive: ['md'],
      render: (_, { token }) => {
        if (!token.enabled) return <Text type="secondary">{t('gateway.asIs')}</Text>;

        const secret = secrets.find((candidate) => candidate.id === token.verify.secretId);
        const hidden = token.claims.length - MAX_CLAIM_TAGS;
        return (
          <div className={TAG_ROW}>
            <Tag color={token.verify.enabled ? 'success' : 'warning'} className="me-0!">
              {token.verify.enabled
                ? t('gateway.verifiedTag', { name: secret?.name ?? '?' })
                : t('gateway.unverifiedTag')}
            </Tag>
            {token.claims.slice(0, MAX_CLAIM_TAGS).map((mapping) => (
              <Tag
                key={`${mapping.claim}:${mapping.header}`}
                color="processing"
                className="me-0! inline-flex items-center gap-1"
              >
                {mapping.claim}
                <ArrowRight size={12} />
                {mapping.header}
              </Tag>
            ))}
            {hidden > 0 && <Tag className="me-0!">+{hidden}</Tag>}
            {token.conditions.length > 0 && (
              <Tag className="me-0!">{t('gateway.conditionsTag', { n: token.conditions.length })}</Tag>
            )}
          </div>
        );
      },
    },
    {
      title: t('gateway.extras'),
      key: 'extras',
      responsive: ['lg'],
      render: (_, rule) => {
        const extras = extrasOf(rule);
        if (extras.length === 0) return <Text type="secondary">—</Text>;

        return (
          <div className={TAG_ROW}>
            {extras.map((extra) => (
              <Tag key={extra} className="me-0!">
                {extra}
              </Tag>
            ))}
          </div>
        );
      },
    },
    {
      title: t('gateway.actions'),
      key: 'actions',
      align: 'right',
      width: 140,
      render: (_, rule) => (
        <div className="flex justify-end gap-(--c-spacing-xxs)">
          <Tooltip title={t('gateway.test')}>
            <Button
              type="text"
              size="small"
              aria-label={t('gateway.test')}
              icon={<Play size={14} />}
              onClick={() => setTesting(rule)}
            />
          </Tooltip>
          <Button
            type="text"
            size="small"
            aria-label={t('gateway.edit')}
            icon={<Pencil size={14} />}
            onClick={() => openForm(rule.id)}
          />
          <Popconfirm
            title={t('gateway.deleteConfirm', { name: rule.name })}
            okText={t('gateway.delete')}
            cancelText={t('gateway.cancel')}
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(rule)}
          >
            <Button type="text" size="small" danger aria-label={t('gateway.delete')} icon={<Trash2 size={14} />} />
          </Popconfirm>
        </div>
      ),
    },
  ];

  const hasWorks = rules.length > 0;

  return (
    // A gap, not space-y: antd resets the margin of a card that isn't last.
    <div className="flex flex-col gap-(--c-spacing-lg)">
      {contextHolder}

      <div className="flex flex-wrap items-center justify-between gap-(--c-spacing-sm)">
        <div className="flex min-w-0 items-center gap-(--c-spacing-sm)">
          <div className="w-10 h-10 shrink-0 rounded-(--c-border-radius-xl) bg-brand/10 flex items-center justify-center">
            <Folder size={22} className="text-brand" />
          </div>
          <div className="min-w-0">
            <Title level={3} className="mb-0! truncate">
              {project.name}
            </Title>
            <Text type="secondary">{t('projects.worksCount', { n: rules.length })}</Text>
          </div>
        </div>

        <div className="flex items-center gap-(--c-spacing-xs)">
          <Tooltip title={t('gateway.refresh')}>
            <Button
              aria-label={t('gateway.refresh')}
              icon={<RefreshCw size={16} />}
              onClick={() => dispatch(loadRules())}
            />
          </Tooltip>
          <Tooltip title={t('projects.rename')}>
            <Button aria-label={t('projects.rename')} icon={<Pencil size={16} />} onClick={() => setIsRenaming(true)} />
          </Tooltip>
          {/* A project goes only once it is empty: its works would be left with nothing to list them. */}
          <Tooltip title={hasWorks ? t('projects.deleteHasWorks') : t('projects.delete')}>
            <Popconfirm
              title={t('projects.deleteConfirm', { name: project.name })}
              okText={t('projects.delete')}
              cancelText={t('projects.cancel')}
              okButtonProps={{ danger: true }}
              disabled={hasWorks}
              onConfirm={handleDeleteProject}
            >
              <Button danger disabled={hasWorks} aria-label={t('projects.delete')} icon={<Trash2 size={16} />} />
            </Popconfirm>
          </Tooltip>
          <Button type="primary" icon={<Plus size={16} />} disabled={status === 'failed'} onClick={() => openForm('new')}>
            {t('gateway.new')}
          </Button>
        </div>
      </div>

      <TokenStructureCard
        fields={project.tokenFields}
        saving={isSavingProject}
        onSave={(tokenFields) => saveProject({ tokenFields })}
      />

      {status === 'failed' ? (
        <Alert
          type="error"
          showIcon
          title={t('gateway.unreachable')}
          description={error || t('gateway.unreachableHint')}
          action={<Button onClick={() => dispatch(loadRules())}>{t('gateway.retry')}</Button>}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-(--c-spacing-lg) gap-y-(--c-spacing-xxs)">
            <Text type="secondary">
              {t('gateway.address')}: <Text code copyable>{gatewayUrl}</Text>
            </Text>
            <RouterLink to={requestsPath({ projectId: project.id })} className="inline-flex items-center gap-1">
              <ScrollText size={14} />
              {t('gateway.openLog')}
            </RouterLink>
          </div>

          <Card
            className="border-line-soft! bg-container! shadow-(--c-box-shadow-card)! overflow-hidden"
            styles={{ body: { padding: 0 } }}
          >
            <Table<GatewayRule>
              rowKey="id"
              columns={columns}
              dataSource={rules}
              loading={status !== 'ready'}
              pagination={false}
              scroll={{ x: 'max-content' }}
              locale={{
                emptyText: (
                  <Empty description={t('gateway.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE}>
                    <Button type="primary" icon={<Plus size={16} />} onClick={() => openForm('new')}>
                      {t('gateway.new')}
                    </Button>
                  </Empty>
                ),
              }}
            />
          </Card>
        </>
      )}

      <RuleFormModal
        open={isFormOpen}
        rule={editing}
        project={project}
        rules={allRules}
        saving={isSaving}
        onSubmit={handleSubmit}
        onCancel={closeForm}
      />

      <RuleTester rule={testing} onClose={() => setTesting(undefined)} />

      <ProjectFormModal
        open={isRenaming}
        project={project}
        projects={projects}
        saving={isSavingProject}
        onSubmit={(name) => saveProject({ name })}
        onCancel={() => setIsRenaming(false)}
      />
    </div>
  );
}
