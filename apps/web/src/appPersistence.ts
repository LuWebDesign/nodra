import type { ProjectSnapshot } from "@nodra/domain";
import { validateProject } from "@nodra/validation";

export const projectMirrorKey = (projectId: string) => `nodra:project-mirror:${projectId}`;
export const PROJECT_MIRROR_FORMAT = 2 as const;
export type ProjectMirror = { readonly format: typeof PROJECT_MIRROR_FORMAT; readonly project: ProjectSnapshot; readonly savedAt: number };

export type AppLocation = { readonly view: "project" | "editor" | "dashboard"; readonly mode: "design" | "prepare" };

const lastAppLocationKey = "nodra:last-app-location";
export const saveLastAppLocation = (location: AppLocation): void => {
  try { localStorage.setItem(lastAppLocationKey, JSON.stringify(location)); } catch { /* best-effort UI location */ }
};

export const collapsedPagesKey = (projectId: string) => `nodra:project-tree-collapsed:${projectId}`;
export const loadCollapsedPages = (projectId: string): Set<string> => {
  try {
    const raw = localStorage.getItem(collapsedPagesKey(projectId));
    const value = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
  } catch { return new Set(); }
};
export const saveCollapsedPages = (projectId: string, pages: Set<string>): void => {
  try { localStorage.setItem(collapsedPagesKey(projectId), JSON.stringify([...pages])); } catch { /* best-effort UI preference */ }
};

const lastOpenedProjectKey = "nodra:last-opened-project";
export type LastOpenedProjectContext = { readonly projectId: string; readonly pieceId?: string; readonly pageId?: string; readonly view?: "project" | "editor" | "dashboard"; readonly mode?: "design" | "prepare" };
export const loadLastOpenedProject = (): LastOpenedProjectContext | undefined => {
  try {
    const raw = localStorage.getItem(lastOpenedProjectKey);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<LastOpenedProjectContext>;
    return typeof value.projectId === "string" && value.projectId.length > 0 ? {
      projectId: value.projectId,
      ...(typeof value.pieceId === "string" ? { pieceId: value.pieceId } : {}),
      ...(typeof value.pageId === "string" ? { pageId: value.pageId } : {}),
      ...(value.view === "project" || value.view === "editor" || value.view === "dashboard" ? { view: value.view } : {}),
      ...(value.mode === "design" || value.mode === "prepare" ? { mode: value.mode } : {}),
    } : undefined;
  } catch { return undefined; }
};
export const saveLastOpenedProject = (context: LastOpenedProjectContext): void => {
  try { localStorage.setItem(lastOpenedProjectKey, JSON.stringify(context)); } catch { /* best-effort session context */ }
};
export const removeLastOpenedProject = (): void => {
  try { localStorage.removeItem(lastOpenedProjectKey); } catch { /* best-effort cleanup */ }
};

export const loadProjectMirror = (projectId: string): ProjectMirror | undefined => {
  try {
    const raw = localStorage.getItem(projectMirrorKey(projectId));
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<ProjectMirror>;
    if (value.format !== PROJECT_MIRROR_FORMAT || typeof value.savedAt !== "number") return undefined;
    const checked = validateProject(value.project);
    return checked.success && checked.data.id === projectId ? { format: PROJECT_MIRROR_FORMAT, project: checked.data, savedAt: value.savedAt } : undefined;
  } catch { return undefined; }
};
export const saveProjectMirror = (project: ProjectSnapshot): void => {
  try { localStorage.setItem(projectMirrorKey(project.id), JSON.stringify({ format: PROJECT_MIRROR_FORMAT, project, savedAt: Date.now() } satisfies ProjectMirror)); } catch { /* best-effort reload mirror */ }
};
export const removeProjectMirror = (projectId: string): void => {
  try { localStorage.removeItem(projectMirrorKey(projectId)); } catch { /* best-effort mirror cleanup */ }
};
