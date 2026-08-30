import { invoke } from "@tauri-apps/api/core";
import type { ProjectSnapshot } from "@nodra/domain";
import { openNativeProject, openNativeProjectAt, saveNativeProject } from "./nativeProjectFile.js";

export function installDesktopFileBridge(): void {
  (globalThis as typeof globalThis & {
    __KOND_DESKTOP__?: {
      openProject: () => Promise<{ path: string; project: ProjectSnapshot } | undefined>;
      saveProject: (project: ProjectSnapshot, currentPath?: string) => Promise<string | undefined>;
      initialProject: () => Promise<{ readonly path: string; readonly project: ProjectSnapshot } | undefined>;
    };
  }).__KOND_DESKTOP__ = {
    openProject: openNativeProject,
    saveProject: saveNativeProject,
    initialProject: async () => {
      const path = await invoke<string | null>("initial_project_path");
      return path ? openNativeProjectAt(path) : undefined;
    },
  };
}
