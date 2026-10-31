import { Link as RouterLink, useNavigate, useOutletContext } from 'react-router-dom';
import { Alert, Button, Card, Empty, Spin, Typography } from 'antd';
import { Folder, FolderPlus, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MainLayoutContext } from '@/layouts/MainLayout';
import { ROUTES, projectPath } from '@/router/routes';
import { useAppDispatch, useAppSelector, useGatewayUrl } from '@/store';
import { loadProjects } from '@/store/slices/projectsSlice';

const { Title, Text } = Typography;

/** Every project on this computer, and the way in for one that someone else exported. */
export function ProjectsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { openCreateProject, startImport } = useOutletContext<MainLayoutContext>();
  const { items: projects, status } = useAppSelector((state) => state.projects);
  const rules = useAppSelector((state) => state.gateway.items);
  const gatewayUrl = useGatewayUrl();

  const createButton = (
    <Button type="primary" icon={<FolderPlus size={16} />} disabled={status === 'failed'} onClick={openCreateProject}>
      {t('sidebar.createProject')}
    </Button>
  );
  const importButton = (
    <Button icon={<Upload size={16} />} disabled={status === 'failed'} onClick={startImport}>
      {t('projects.import')}
    </Button>
  );

  return (
    <div className="space-y-(--c-spacing-lg)">
      <div className="flex flex-wrap items-center justify-between gap-(--c-spacing-sm)">
        <div>
          <Title level={3} className="mb-0!">
            {t('projects.title')}
          </Title>
          <div className="flex flex-wrap items-center gap-x-(--c-spacing-sm)">
            <Text type="secondary">
              {t('gateway.address')}: <Text code copyable>{gatewayUrl}</Text>
            </Text>
            <RouterLink to={ROUTES.SETTINGS}>{t('gateway.changePort')}</RouterLink>
          </div>
        </div>
        <div className="flex items-center gap-(--c-spacing-xs)">
          {importButton}
          {createButton}
        </div>
      </div>

      {status === 'failed' && (
        <Alert
          type="error"
          showIcon
          title={t('gateway.unreachable')}
          description={t('gateway.unreachableHint')}
          action={<Button onClick={() => dispatch(loadProjects())}>{t('gateway.retry')}</Button>}
        />
      )}

      {status !== 'failed' && status !== 'ready' && (
        <div className="flex justify-center py-(--c-spacing-xl)">
          <Spin />
        </div>
      )}

      {status === 'ready' && projects.length === 0 && (
        <Empty description={t('projects.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE}>
          <div className="flex justify-center gap-(--c-spacing-xs)">
            {importButton}
            {createButton}
          </div>
        </Empty>
      )}

      {status === 'ready' && projects.length > 0 && (
        <div className="grid gap-(--c-spacing) sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <Card
              key={project.id}
              hoverable
              className="border-line-soft! bg-container! shadow-(--c-box-shadow-card)!"
              styles={{ body: { padding: 16 } }}
              onClick={() => navigate(projectPath(project.id))}
            >
              <div className="flex items-center gap-(--c-spacing-sm)">
                <Folder size={20} className="shrink-0 text-brand" />
                <div className="min-w-0">
                  <div className="truncate font-semibold">{project.name}</div>
                  <Text type="secondary" className="text-(length:--c-font-size-sm)!">
                    {t('projects.worksCount', {
                      n: rules.filter((rule) => rule.projectId === project.id).length,
                    })}
                  </Text>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
