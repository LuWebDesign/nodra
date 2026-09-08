import type { ProjectMetadata } from "@nodra/persistence";

export interface DashboardProject extends ProjectMetadata {
  readonly pieceLabel: string;
}

/** Maps persisted metadata to the first-slice project card without implying a persisted piece model. */
export const dashboardProjects = (projects: readonly ProjectMetadata[]): readonly DashboardProject[] =>
  projects.map((project) => ({ ...project, pieceLabel: "Pieza 1 · concepto inicial" }));

export const projectDisplayName = (project: ProjectMetadata): string => project.name.trim() || "Proyecto sin título";

export const newProjectMetadata = (id: string, now = Date.now()): ProjectMetadata => ({
  id,
  name: "Proyecto sin título",
  updatedAt: now,
});
