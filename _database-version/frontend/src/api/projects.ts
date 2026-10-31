import type { Project, TokenField } from '@/types/gateway.types';
import { engine } from './engine';

export async function fetchProjects(): Promise<Project[]> {
  const { data } = await engine.get<Project[]>('/projects');
  return data;
}

export async function createProject(name: string): Promise<Project> {
  const { data } = await engine.post<Project>('/projects', { name });
  return data;
}

/** Changes what is given and leaves the rest. */
export async function updateProject(
  id: string,
  changes: { name?: string; tokenFields?: TokenField[] },
): Promise<void> {
  await engine.patch(`/projects/${id}`, changes);
}

export async function deleteProject(id: string): Promise<void> {
  await engine.delete(`/projects/${id}`);
}
