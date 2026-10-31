export const ROUTES = {
  LOGIN: '/login',
  HOME: '/',
  PROJECT: '/projects/:projectId',
  SECRETS: '/secrets',
  FORBIDDEN: '/403',
  SERVER_ERROR: '/500',
} as const;

export const projectPath = (projectId: string) => `/projects/${projectId}`;

/** A project's page with one of its rules open for editing, or `new` for a blank one. */
export const WORK_PARAM = 'work';
export const workPath = (projectId: string, work: string) => `${projectPath(projectId)}?${WORK_PARAM}=${work}`;
