import { exportProject } from '@/api/projects';
import type { Project } from '@/types/gateway.types';

/**
 * Saves a project and its works as a file, for someone else to import.
 * Secrets go in it by name only.
 */
export async function downloadProject(project: Project) {
  const file = await exportProject(project.id);

  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([`${JSON.stringify(file, null, 2)}\n`], { type: 'application/json' }));
  // A name any file system takes.
  link.download = `${project.name.replace(/[\\/:*?"<>|]+/g, '-')}.konggate.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}
