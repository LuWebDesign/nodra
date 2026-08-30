import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import type { ProjectSnapshot } from "@nodra/domain";
import { decodeProjectFile, encodeProjectFile } from "./projectFileCodec.js";

const projectFileFilter = [{ name: "Kond Design project", extensions: ["kond"] }];

export interface NativeProjectFile {
  readonly path: string;
  readonly project: ProjectSnapshot;
}

const withKondExtension = (path: string): string => path.toLowerCase().endsWith(".kond") ? path : `${path}.kond`;

async function readNativeProject(path: string): Promise<NativeProjectFile> {
  return { path, project: decodeProjectFile(await readTextFile(path)) };
}

export async function openNativeProject(): Promise<NativeProjectFile | undefined> {
  const selected = await open({ multiple: false, directory: false, filters: projectFileFilter });
  if (typeof selected !== "string") return undefined;
  return readNativeProject(selected);
}

export async function openNativeProjectAt(path: string): Promise<NativeProjectFile> {
  return readNativeProject(path);
}

export async function saveNativeProject(
  project: ProjectSnapshot,
  currentPath?: string,
): Promise<string | undefined> {
  const selectedPath = currentPath ?? await save({
    defaultPath: "diseño.kond",
    filters: projectFileFilter,
  });
  if (!selectedPath) return undefined;

  const path = withKondExtension(selectedPath);
  const encoded = encodeProjectFile(project);
  await invoke("write_project_file", { path, contents: encoded });
  if (await readTextFile(path) !== encoded) throw new Error("El archivo no pudo verificarse después de guardarlo");
  return path;
}
