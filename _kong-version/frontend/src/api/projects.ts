import type { Project, TokenField } from '@/types/gateway.types';
import { kongAdmin } from './kongAdmin';

// Kong's generated endpoints for the jwt-claim-forward plugin's projects table
// (gateway/plugins/…/daos.lua).
const COLLECTION = '/konggate_projects';

interface KongProject {
  id: string;
  name: string;
  token_fields: TokenField[] | null;
  /** Unix seconds. */
  created_at: number;
}

interface KongPage<T> {
  data: T[];
  offset?: string | null;
}

function toProject(project: KongProject): Project {
  return {
    id: project.id,
    name: project.name,
    tokenFields: project.token_fields ?? [],
    createdAt: new Date(project.created_at * 1000).toISOString(),
  };
}

export async function fetchProjects(): Promise<Project[]> {
  const projects: Project[] = [];
  let offset: string | undefined;

  do {
    const { data } = await kongAdmin.get<KongPage<KongProject>>(COLLECTION, { params: { size: 1000, offset } });
    projects.push(...data.data.map(toProject));
    offset = data.offset ?? undefined;
  } while (offset);

  return projects.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function createProject(name: string): Promise<Project> {
  const { data } = await kongAdmin.post<KongProject>(COLLECTION, { name });
  return toProject(data);
}

/** Changes what is given and leaves the rest. */
export async function updateProject(
  id: string,
  changes: { name?: string; tokenFields?: TokenField[] },
): Promise<void> {
  await kongAdmin.patch(`${COLLECTION}/${id}`, {
    ...(changes.name !== undefined ? { name: changes.name } : {}),
    ...(changes.tokenFields !== undefined ? { token_fields: changes.tokenFields } : {}),
  });
}

/** The project only: its rules have to be gone first, or nothing would list them any more. */
export async function deleteProject(id: string): Promise<void> {
  await kongAdmin.delete(`${COLLECTION}/${id}`);
}
