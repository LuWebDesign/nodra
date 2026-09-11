export type AppView = "dashboard" | "project" | "editor";
export type AppMode = "design" | "prepare";

export type AppRoute = {
  readonly view: AppView;
  readonly projectId?: string;
};

export const routeFromPath = (pathname: string): AppRoute => {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "proyectos" && parts[1]) {
    try { return { view: "project", projectId: decodeURIComponent(parts[1]) }; } catch { return { view: "dashboard" }; }
  }
  if (parts[0] === "modelo") return { view: "editor" };
  if (parts[0] === "preparar") return { view: "editor" };
  return { view: "dashboard" };
};

export const pathForView = (view: AppView, projectId: string | undefined, mode: AppMode): string =>
  view === "project" && projectId
    ? `/proyectos/${encodeURIComponent(projectId)}`
    : view === "editor"
      ? mode === "prepare" ? "/preparar" : "/modelo"
      : "/proyectos";
