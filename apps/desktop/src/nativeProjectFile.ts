import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { ProjectSnapshot } from "@nodra/domain";
import { decodeProjectFile, encodeProjectFile } from "./projectFileCodec.js";

const projectFileFilter = [{ name: "Kond Design project", extensions: ["kond"] }];

export interface NativeProjectFile {
  readonly path: string;
  readonly project: ProjectSnapshot;
}

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
  const path = currentPath ?? await save({
    defaultPath: "diseño.kond",
    filters: projectFileFilter,
  });
  if (!path) return undefined;

  await writeTextFile(path, encodeProjectFile(project));
  return path;
}
