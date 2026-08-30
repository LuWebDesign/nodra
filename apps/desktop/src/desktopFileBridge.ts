import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type { ProjectSnapshot } from "@nodra/domain";
import { openNativeProject, openNativeProjectAt, saveNativeProject } from "./nativeProjectFile.js";

type DesktopBridge = {
  openProject: () => Promise<{ path: string; project: ProjectSnapshot } | undefined>;
  saveProject: (project: ProjectSnapshot, currentPath?: string) => Promise<string | undefined>;
  initialProject: () => Promise<{ readonly path: string; readonly project: ProjectSnapshot } | undefined>;
  checkForUpdates: () => Promise<void>;
};

const checkForUpdates = async (): Promise<void> => {
  const update = await check();
  if (!update) return;
  const shouldInstall = window.confirm(`Hay una actualización disponible (${update.version}). ¿Querés instalarla ahora?`);
  if (!shouldInstall) return;
  await update.downloadAndInstall();
  await relaunch();
};

export function installDesktopFileBridge(): void {
  (globalThis as typeof globalThis & { __KOND_DESKTOP__?: DesktopBridge }).__KOND_DESKTOP__ = {
    openProject: openNativeProject,
    saveProject: saveNativeProject,
    checkForUpdates,
    initialProject: async () => {
      const path = await invoke<string | null>("initial_project_path");
      return path ? openNativeProjectAt(path) : undefined;
    },
  };
}
