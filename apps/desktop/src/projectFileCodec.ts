import type { ProjectSnapshot } from "@nodra/domain";
import { validateProject } from "@nodra/validation";

export function encodeProjectFile(project: ProjectSnapshot): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

export function decodeProjectFile(text: string): ProjectSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("El archivo no contiene JSON válido");
  }
  const checked = validateProject(parsed);
  if (!checked.success) throw new Error(`Proyecto inválido: ${checked.error}`);
  return checked.data;
}
