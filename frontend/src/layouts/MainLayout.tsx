import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Breadcrumb, Button, Modal, message } from 'antd';
import { KeyRound, LayoutGrid, ScrollText, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { engineErrorMessage } from '@/api/engine';
import { importProject } from '@/api/projects';
import { ProjectFormModal } from '@/modules/gateway/components/ProjectFormModal';
import { ProjectTree } from '@/modules/gateway/components/ProjectTree';
import { SettingsNav } from '@/modules/system/components/SettingsNav';
import { ROUTES, WORK_PARAM, projectPath, settingsPath } from '@/router/routes';
import { useAppDispatch, useAppSelector } from '@/store';
import { loadRules } from '@/store/slices/gatewaySlice';
import { addProject, loadProjects } from '@/store/slices/projectsSlice';
import { loadSecrets } from '@/store/slices/secretsSlice';
import { loadStatus } from '@/store/slices/systemSlice';
import { Role } from '@/types/auth.types';
import type { ImportResult } from '@/types/gateway.types';
import { HeaderMenu } from './HeaderMenu';

// How often this computer's status is asked for.
const STATUS_EVERY_MS = 4000;

/** What the pages inside the layout can ask of it. */
export interface MainLayoutContext {
  openCreateProject: () => void;
  /** Lets the user pick a project file and adds the project it holds. */
  startImport: () => void;
}

// The app's sections, down the left edge. The secrets are the administrator's
// alone: a user picks one by its name in a work, and has no page of them.
const SECTIONS = [
  { path: ROUTES.HOME, icon: LayoutGrid, label: 'rail.projects', adminOnly: false },
  { path: ROUTES.SECRETS, icon: KeyRound, label: 'rail.secrets', adminOnly: true },
  { path: ROUTES.REQUESTS, icon: ScrollText, label: 'rail.requests', adminOnly: false },
  { path: ROUTES.SETTINGS, icon: Settings, label: 'rail.settings', adminOnly: false },
] as const;

export function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const [messageApi, contextHolder] = message.useMessage();

  const projects = useAppSelector((state) => state.projects.items);
  const rules = useAppSelector((state) => state.gateway.items);
  const status = useAppSelector((state) => state.system.status);
  const revision = status?.revision;
  // Whoever has not signed in is a user; the one who has is the administrator.
  const isAdmin = useAppSelector((state) => state.auth.role) === Role.ADMIN;
  const sections = SECTIONS.filter(({ adminOnly }) => isAdmin || !adminOnly);

  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // What the last import came to, shown until it is closed.
  const [imported, setImported] = useState<ImportResult>();

  // The projects' section is the list of all of them and any one of them.
  const inProjects = location.pathname === ROUTES.HOME || location.pathname.startsWith('/projects/');
  const onSettings = location.pathname === ROUTES.SETTINGS;
  const isIn = (path: string) => (path === ROUTES.HOME ? inProjects : location.pathname === path);

  // How the gateway is doing, asked every few seconds.
  useEffect(() => {
    void dispatch(loadStatus());
    const timer = setInterval(() => void dispatch(loadStatus()), STATUS_EVERY_MS);
    return () => clearInterval(timer);
  }, [dispatch]);

  // Everything the tree and the pages show: read at the start, and again
  // whenever something changed (here, or a secret on another computer).
  useEffect(() => {
    void dispatch(loadProjects());
    void dispatch(loadRules());
    void dispatch(loadSecrets());
  }, [dispatch, revision]);

  const handleCreateProject = async (name: string) => {
    setIsSavingProject(true);
    try {
      const project = await dispatch(addProject(name)).unwrap();
      setIsCreatingProject(false);
      navigate(projectPath(project.id));
    } catch (reason) {
      messageApi.error((typeof reason === 'string' && reason) || t('gateway.requestFailed'));
    } finally {
      setIsSavingProject(false);
    }
  };

  const importFile = async (file: File) => {
    let content: unknown;
    try {
      content = JSON.parse(await file.text());
    } catch {
      messageApi.error(t('projects.importNotJson'));
      return;
    }

    try {
      const result = await importProject(content);
      // The project came with works, and maybe with secrets to fill in.
      await Promise.all([dispatch(loadProjects()), dispatch(loadRules()), dispatch(loadSecrets())]);
      setImported(result);
    } catch (error) {
      const detail = engineErrorMessage(error);
      messageApi.error(detail ? `${t('projects.importFailed')}: ${detail}` : t('projects.importFailed'), 8);
    }
  };

  const openCreateProject = () => setIsCreatingProject(true);
  const startImport = () => fileInput.current?.click();

  // Where the page is: the section's name, or inside a project the project
  // and the work open in it (the section is lit on the left edge as it is).
  const section = SECTIONS.find(({ path }) => isIn(path));
  const projectId = location.pathname.startsWith('/projects/') ? location.pathname.split('/')[2] : undefined;
  const project = projects.find((candidate) => candidate.id === projectId);
  const work = searchParams.get(WORK_PARAM);
  const workName = work === 'new' ? t('gateway.new') : rules.find((rule) => rule.id === work)?.name;
  const crumbs = project
    ? [
        { title: workName ? <Link to={projectPath(project.id)}>{project.name}</Link> : project.name },
        ...(workName ? [{ title: workName }] : []),
      ]
    : section
      ? [{ title: t(section.label) }]
      : [];

  return (
    <div className="flex h-dvh overflow-hidden bg-layout">
      {contextHolder}
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Emptied, so that choosing the same file again is noticed.
          event.target.value = '';
          if (file) void importFile(file);
        }}
      />

      <nav
        aria-label={t('appName')}
        className="flex h-dvh w-[76px] shrink-0 flex-col items-center gap-(--c-spacing-xxs) border-r border-line-soft bg-container py-(--c-spacing-sm)"
      >
        <button
          type="button"
          aria-label={t('appName')}
          onClick={() => navigate(ROUTES.HOME)}
          className="mb-(--c-spacing-sm) flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-(--c-border-radius-lg) border-0 bg-brand text-lg font-bold text-(--c-color-on-primary) shadow-sm"
        >
          K
        </button>

        {sections.map(({ path, icon: Icon, label }) => (
          <button
            key={path}
            type="button"
            aria-current={isIn(path) ? 'page' : undefined}
            onClick={() => navigate(path)}
            // Only the colours change with the pointer or the page: nothing moves.
            className={`flex w-16 cursor-pointer flex-col items-center gap-1 rounded-(--c-border-radius-lg) border-0 px-1 py-2 text-[11px] leading-tight transition-colors ${
              isIn(path) ? 'bg-brand/10 font-medium text-brand' : 'bg-transparent text-muted hover:bg-layout hover:text-body'
            }`}
          >
            <Icon size={20} />
            <span className="text-center">{t(label)}</span>
          </button>
        ))}

        {status?.version && (
          <span className="mt-auto flex flex-col items-center text-[10px] leading-tight text-subtle">
            <span>v{status.version}</span>
            {status.buildDate && <span>{status.buildDate}</span>}
          </span>
        )}
      </nav>

      {/* Beside the sections, what the open one holds: the projects' tree, or the settings' parts. */}
      {inProjects && <ProjectTree onCreateProject={openCreateProject} onImport={startImport} />}
      {onSettings && <SettingsNav />}

      <div className="flex h-dvh min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-(--c-spacing) border-b border-line-soft bg-container px-(--c-spacing-lg)">
          {/* One line whatever the names: with no room, each is cut short instead of wrapping. */}
          <Breadcrumb
            items={crumbs}
            className="min-w-0 flex-1 [&_li]:min-w-0 [&_li]:truncate [&_li.ant-breadcrumb-separator]:shrink-0 [&_ol]:flex-nowrap!"
          />

          <HeaderMenu />
        </header>

        <main className="content-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {/* A container: what is inside lays itself out by the room left beside the tree, not by the window. */}
          <div className="@container min-h-full p-(--c-spacing) lg:p-(--c-spacing-lg)">
            {status && !onSettings && (
              <div className="mb-(--c-spacing) flex flex-col gap-(--c-spacing-xs) empty:hidden">
                {status.database.used && !status.database.connected && (
                  <Alert
                    type="error"
                    showIcon
                    title={t('system.bannerNoDb')}
                    description={
                      status.database.error &&
                      t(`system.errors.${status.database.error.reason}`, { defaultValue: status.database.error.message })
                    }
                    action={<Button onClick={() => navigate(settingsPath('database'))}>{t('system.openSettings')}</Button>}
                  />
                )}
                {!status.gateway.running && (
                  <Alert
                    type="warning"
                    showIcon
                    title={t('system.bannerGateway', { port: status.gateway.port })}
                    action={<Button onClick={() => navigate(settingsPath('gateway'))}>{t('system.openSettings')}</Button>}
                  />
                )}
              </div>
            )}
            <Outlet context={{ openCreateProject, startImport } satisfies MainLayoutContext} />
          </div>
        </main>
      </div>

      <ProjectFormModal
        open={isCreatingProject}
        projects={projects}
        saving={isSavingProject}
        onSubmit={handleCreateProject}
        onCancel={() => setIsCreatingProject(false)}
      />

      <Modal
        title={t('projects.importedTitle')}
        open={Boolean(imported)}
        okText={t('projects.importedOpen')}
        cancelText={t('projects.importedClose')}
        onOk={() => {
          if (imported) navigate(projectPath(imported.project.id));
          setImported(undefined);
        }}
        onCancel={() => setImported(undefined)}
        destroyOnHidden
      >
        {imported && (
          <div className="flex flex-col gap-(--c-spacing-sm)">
            <span>{t('projects.importedText', { name: imported.project.name, n: imported.works })}</span>

            {imported.missingSecrets.length > 0 && (
              <Alert
                type="warning"
                showIcon
                title={t('projects.importedSecrets')}
                description={
                  <>
                    {imported.missingSecrets.map((secret) => `${secret.name} (${secret.algorithm})`).join(', ')}
                    {isAdmin && (
                      <div className="mt-(--c-spacing-xxs)">
                        <Link to={ROUTES.SECRETS} onClick={() => setImported(undefined)}>
                          {t('sidebar.secrets')}
                        </Link>
                      </div>
                    )}
                  </>
                }
              />
            )}

            {imported.clashes.length > 0 && (
              <Alert
                type="warning"
                showIcon
                title={t('projects.importedClashes')}
                description={
                  <ul className="m-0 ps-(--c-spacing)">
                    {imported.clashes.map((item) => (
                      <li key={`${item.work}:${item.with}`}>
                        <code>{item.path}</code> {item.work} ↔ {item.with}
                      </li>
                    ))}
                  </ul>
                }
              />
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
