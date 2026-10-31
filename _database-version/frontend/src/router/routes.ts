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
export const workPath = (projectId: string, work: string) => `${projectPath(projectId)}?${WORK_PARAM}=${work}`;

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
