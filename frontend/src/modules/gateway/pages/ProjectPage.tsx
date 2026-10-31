import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, Empty, Popconfirm, Spin, Table, Tabs, Tag, Tooltip, Typography, message } from 'antd';
import { ArrowRight, Play, Plus, ScrollText, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import { ROUTES, WORK_PARAM, projectPath, requestsPath, workPath } from '@/router/routes';
import { useAppDispatch, useAppSelector, useGatewayUrl } from '@/store';
import { loadRules, removeGatewayRule } from '@/store/slices/gatewaySlice';
import { changeProject } from '@/store/slices/projectsSlice';
import type { GatewayRule, TokenField } from '@/types/gateway.types';
import { MethodBadge } from '../components/MethodBadge';
import { TokenStructureCard } from '../components/TokenStructureCard';
import { WorkEditor } from '../components/WorkEditor';
import { copyText } from '../utils/copy';

const { Title, Text } = Typography;

// Mappings shown per work in the table before the rest collapse into "+N".
const MAX_CLAIM_TAGS = 3;

const TAG_ROW = 'flex flex-wrap gap-(--c-spacing-xxs)';

/** One project: its works and the shape of its tokens; or, with a work chosen, that work. */
export function ProjectPage() {
  const { t } = useTranslation();
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const dispatch = useAppDispatch();

  const { items: projects, status: projectsStatus } = useAppSelector((state) => state.projects);
  const { items: allRules, status, error } = useAppSelector((state) => state.gateway);
  const secrets = useAppSelector((state) => state.secrets.items);
  const gatewayUrl = useGatewayUrl();

  const project = projects.find((candidate) => candidate.id === projectId);
  const rules = allRules.filter((rule) => rule.projectId === projectId);

  // Which work is open is part of the address, so the tree can link straight
  // to one: its id, or "new" for a blank one.
  const work = searchParams.get(WORK_PARAM);
  const editing = rules.find((rule) => rule.id === work);

  const [messageApi, contextHolder] = message.useMessage();
  const [isSavingProject, setIsSavingProject] = useState(false);

  const waiting = (
    <div className="flex justify-center py-(--c-spacing-xl)">
      <Spin />
    </div>
  );

  if (!project) {
    // Either the list hasn't arrived yet, or the address names no project.
    return projectsStatus === 'ready' ? (
      <Empty description={t('projects.notFound')} image={Empty.PRESENTED_IMAGE_SIMPLE}>
        <RouterLink to={ROUTES.HOME}>{t('projects.title')}</RouterLink>
      </Empty>
    ) : (
      waiting
    );
  }

  if (work === 'new' || editing) {
    return (
      <WorkEditor
        // A form of its own for each work: nothing typed for one carries over to another.
        key={editing?.id ?? 'new'}
        project={project}
        rule={editing}
        onCreated={(created) => navigate(workPath(project.id, created.id), { replace: true })}
        onLeave={() => navigate(projectPath(project.id))}
      />
    );
  }

  if (work) {
    // The address names a work that is gone, or one that hasn't arrived yet.
    return status === 'ready' ? (
      <Empty description={t('gateway.notFound')} image={Empty.PRESENTED_IMAGE_SIMPLE}>
        <RouterLink to={projectPath(project.id)}>{project.name}</RouterLink>
      </Empty>
    ) : (
      waiting
    );
  }

  // Thunks reject with the engine's own message, which says more than we could.
  const showFailure = (reason: unknown) => {
    messageApi.error((typeof reason === 'string' && reason) || t('gateway.requestFailed'));
  };

  const handleDelete = async (rule: GatewayRule) => {
    try {
      await dispatch(removeGatewayRule(rule)).unwrap();
      messageApi.success(t('gateway.deleted'));
    } catch (reason) {
      showFailure(reason);
    }
  };

  const saveTokenFields = async (tokenFields: TokenField[]) => {
    setIsSavingProject(true);
    try {
      await dispatch(changeProject({ id: project.id, tokenFields })).unwrap();
      messageApi.success(t('projects.updated'));
    } catch (reason) {
      showFailure(reason);
    } finally {
      setIsSavingProject(false);
    }
  };

  // The whole address a client calls the work at, ready to paste elsewhere.
  const copyAddress = async (path: string) => {
    const url = gatewayUrl + path;
    if (await copyText(url)) messageApi.success(t('gateway.copied', { url }));
    else messageApi.error(t('gateway.copyFailed'));
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

  const newWork = () => navigate(workPath(project.id, 'new'));

  const columns: ColumnsType<GatewayRule> = [
    {
      title: t('gateway.name'),
      key: 'name',
      render: (_, rule) => (
        <div className="flex items-center gap-(--c-spacing-xs)">
          <MethodBadge methods={rule.methods} />
          <Text strong>{rule.name}</Text>
        </div>
      ),
    },
    {
      title: t('gateway.path'),
      dataIndex: 'path',
      key: 'path',
      render: (path: string) => (
        <Tooltip title={t('gateway.copyUrl')}>
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0"
            onClick={(event) => {
              // The path's own click: the row is not opened by it.
              event.stopPropagation();
              void copyAddress(path);
            }}
          >
            <Text code>{path}</Text>
          </button>
        </Tooltip>
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
      responsive: ['xl'],
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
      width: 100,
      render: (_, rule) => (
        // The buttons act on their own; a click anywhere else in the row opens the work.
        <div className="flex justify-end gap-(--c-spacing-xxs)" onClick={(event) => event.stopPropagation()}>
          <Tooltip title={t('gateway.test')}>
            <Button
              type="text"
              size="small"
              aria-label={t('gateway.test')}
              icon={<Play size={14} />}
              onClick={() => navigate(workPath(project.id, rule.id, 'run'))}
            />
          </Tooltip>
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

  const works =
    status === 'failed' ? (
      <Alert
        type="error"
        showIcon
        title={t('gateway.unreachable')}
        description={error || t('gateway.unreachableHint')}
        action={<Button onClick={() => dispatch(loadRules())}>{t('gateway.retry')}</Button>}
      />
    ) : (
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
          onRow={(rule) => ({
            className: 'cursor-pointer',
            onClick: () => navigate(workPath(project.id, rule.id)),
          })}
          locale={{
            emptyText: (
              <Empty description={t('gateway.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE}>
                <Button type="primary" icon={<Plus size={16} />} onClick={newWork}>
                  {t('gateway.new')}
                </Button>
              </Empty>
            ),
          }}
        />
      </Card>
    );

  return (
    <div className="flex flex-col gap-(--c-spacing-sm)">
      {contextHolder}

      <div className="flex flex-wrap items-center justify-between gap-(--c-spacing-sm)">
        <div className="min-w-0">
          <Title level={3} className="mb-0! truncate">
            {project.name}
          </Title>
          <div className="flex flex-wrap items-center gap-x-(--c-spacing-sm)">
            <Text type="secondary">
              {t('gateway.address')}: <Text code copyable>{gatewayUrl}</Text>
            </Text>
            <RouterLink to={ROUTES.SETTINGS}>{t('gateway.changePort')}</RouterLink>
          </div>
        </div>

        {/* Renaming, exporting and deleting the project are in its menu in the tree. */}
        <Button type="primary" icon={<Plus size={16} />} disabled={status === 'failed'} onClick={newWork}>
          {t('gateway.new')}
        </Button>
      </div>

      <Tabs
        items={[
          { key: 'works', label: `${t('projects.tabWorks')} (${rules.length})`, children: works },
          {
            key: 'token',
            label: t('projects.tabToken'),
            children: (
              <TokenStructureCard
                fields={project.tokenFields}
                saving={isSavingProject}
                onSave={saveTokenFields}
              />
            ),
          },
        ]}
        tabBarExtraContent={
          <RouterLink to={requestsPath({ projectId: project.id })} className="inline-flex items-center gap-1">
            <ScrollText size={14} />
            {t('gateway.openLog')}
          </RouterLink>
        }
      />


    </div>
  );
}
