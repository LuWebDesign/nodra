import { nextRevision, pieceId, type PieceSnapshot, type ProjectSnapshot } from "@nodra/domain";
import type { ProjectMetadata } from "@nodra/persistence";

export interface DashboardProject extends ProjectMetadata {
  readonly pieces: readonly PieceSnapshot[];
}

export interface DashboardProjectSource {
  readonly metadata: ProjectMetadata;
  readonly project: ProjectSnapshot;
}

export interface NewPieceInput {
  readonly name: string;
  readonly material?: string;
  readonly thicknessMm?: number;
}

const pieceStateLabels: Readonly<Record<PieceSnapshot["state"], string>> = {
  design: "En diseño",
  underdefined: "Subdefinida",
  defined: "Definida",
  validated: "Validada",
  ready: "Lista",
};

/** Projects persisted piece data without turning metadata into a second source of truth. */
export const dashboardProjects = (projects: readonly DashboardProjectSource[]): readonly DashboardProject[] =>
  projects.map(({ metadata, project }) => ({ ...metadata, pieces: project.pieces }));

export const pieceDisplayLabel = (piece: PieceSnapshot): string => [
  piece.name,
  piece.material,
  piece.thicknessMm === undefined ? undefined : `${piece.thicknessMm} mm`,
  pieceStateLabels[piece.state],
].filter((value): value is string => value !== undefined).join(" · ");

export const addPiece = (project: ProjectSnapshot, input: NewPieceInput): ProjectSnapshot => {
  const name = input.name.trim();
  if (!name) throw new Error("Piece name is required");
  if (input.thicknessMm !== undefined && (!Number.isFinite(input.thicknessMm) || input.thicknessMm <= 0)) throw new Error("Piece thickness must be positive");
  const used = new Set(project.pieces.map((piece) => piece.id));
  let number = project.pieces.length + 1;
  while (used.has(`${project.id}:piece-${number}` as never)) number += 1;
  const material = input.material?.trim();
  const piece: PieceSnapshot = {
    id: pieceId(`${project.id}:piece-${number}`),
    name,
    ...(material ? { material } : {}),
    ...(input.thicknessMm === undefined ? {} : { thicknessMm: input.thicknessMm }),
    process: "cut",
    state: "design",
    sketches: [],
  };
  return { ...project, revision: nextRevision(project.revision), pieces: [...project.pieces, piece] };
};

export const projectDisplayName = (project: ProjectMetadata): string => project.name.trim() || "Proyecto sin título";

export const newProjectMetadata = (id: string, now = Date.now()): ProjectMetadata => ({
  id,
  name: "Proyecto sin título",
  updatedAt: now,
});
