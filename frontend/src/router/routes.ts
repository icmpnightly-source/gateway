export const ROUTES = {
  LOGIN: '/login',
  HOME: '/',
  PROJECT: '/projects/:projectId',
  SECRETS: '/secrets',
  REQUESTS: '/requests',
  SETTINGS: '/settings',
  FORBIDDEN: '/403',
  SERVER_ERROR: '/500',
} as const;

export const projectPath = (projectId: string) => `/projects/${projectId}`;

/** A project's page with one of its rules open for editing, or `new` for a blank one. */
export const WORK_PARAM = 'work';
/** An open work shows its settings, or the place where a request is sent to it. */
export const WORK_VIEW_PARAM = 'view';
export type WorkView = 'settings' | 'run';
export const workPath = (projectId: string, work: string, view: WorkView = 'settings') =>
  `${projectPath(projectId)}?${WORK_PARAM}=${work}${view === 'run' ? `&${WORK_VIEW_PARAM}=run` : ''}`;

/** The settings page shows one section at a time; which one is part of the address. */
export const SETTINGS_PARAM = 'section';
export const SETTINGS_SECTIONS = ['gateway', 'appearance', 'window', 'database', 'data', 'admin'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export const settingsPath = (section: SettingsSection) => `${ROUTES.SETTINGS}?${SETTINGS_PARAM}=${section}`;

/** The section an address names: the first one when it names none, or one that isn't there. */
export function settingsSection(named: string | null, hasWindow: boolean): SettingsSection {
  const section = SETTINGS_SECTIONS.find((id) => id === named) ?? 'gateway';
  // Run without a window of its own (konggate serve), the app has no window to set up.
  return section === 'window' && !hasWindow ? 'gateway' : section;
}

/** The requests log: narrowed to a project or a work, or with one request open. */
export const REQUEST_PARAMS = { project: 'project', work: 'work', open: 'id' } as const;
export function requestsPath(filter: { projectId?: string; workId?: string; open?: string } = {}) {
  const query = new URLSearchParams();
  if (filter.projectId) query.set(REQUEST_PARAMS.project, filter.projectId);
  if (filter.workId) query.set(REQUEST_PARAMS.work, filter.workId);
  if (filter.open) query.set(REQUEST_PARAMS.open, filter.open);

  const text = query.toString();
  return text ? `${ROUTES.REQUESTS}?${text}` : ROUTES.REQUESTS;
}
