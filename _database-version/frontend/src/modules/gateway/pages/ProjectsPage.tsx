import { useNavigate, useOutletContext } from 'react-router-dom';
import { Alert, Button, Card, Empty, Spin, Typography } from 'antd';
import { Folder, FolderPlus, LayoutGrid } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MainLayoutContext } from '@/layouts/MainLayout';
import { projectPath } from '@/router/routes';
import { useAppDispatch, useAppSelector } from '@/store';
import { loadProjects } from '@/store/slices/projectsSlice';

const { Title, Text } = Typography;

/** Every project there is; anyone can open any of them. */
export function ProjectsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { openCreateProject } = useOutletContext<MainLayoutContext>();
  const { items: projects, status } = useAppSelector((state) => state.projects);
  const rules = useAppSelector((state) => state.gateway.items);

  const createButton = (
    <Button type="primary" icon={<FolderPlus size={16} />} disabled={status === 'failed'} onClick={openCreateProject}>
      {t('sidebar.createProject')}
    </Button>
  );

  return (
    <div className="space-y-(--c-spacing-lg)">
      <div className="flex flex-wrap items-center justify-between gap-(--c-spacing-sm)">
        <div className="flex items-center gap-(--c-spacing-sm)">
          <div className="w-10 h-10 rounded-(--c-border-radius-xl) bg-brand/10 flex items-center justify-center">
            <LayoutGrid size={22} className="text-brand" />
          </div>
          <div>
            <Title level={3} className="mb-0!">
              {t('projects.title')}
            </Title>
            <Text type="secondary">{t('projects.subtitle')}</Text>
          </div>
        </div>
        {createButton}
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
          {createButton}
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
