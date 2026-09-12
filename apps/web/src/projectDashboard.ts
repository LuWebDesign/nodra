import { nextRevision, pageId, pieceId, type PageId, type PieceSnapshot, type ProjectSnapshot } from "@nodra/domain";
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

export interface NewPageInput {
      readonly name?: string;
    }

    export interface NewProjectInput {
  readonly projectName: string;
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

export interface ProjectDetailPiece {
      readonly id: string;
      readonly name: string;
      readonly pageId: string;
      readonly material: string | undefined;
      readonly thicknessMm: number | undefined;
      readonly state: string;
      readonly sketches: readonly { readonly pageId: string; readonly sketchId: string; readonly label: string }[];
    }

    export interface ProjectDetail {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: number;
  readonly revision: number;
  readonly units: "mm";
  readonly status: string;
  readonly materials: readonly string[];
  readonly metrics: {
    readonly pieceCount: number;
    readonly pageCount: number;
    readonly sketchCount: number;
    readonly elementCount: number;
  };
  readonly pieces: readonly ProjectDetailPiece[];
  readonly pages: readonly { readonly id: string; readonly label: string; readonly sketchCount: number; readonly pieces: readonly ProjectDetailPiece[] }[];
  readonly assemblies: readonly [];
}

export const piecePageId = (project: ProjectSnapshot, piece: PieceSnapshot): PageId => {
  if (piece.pageId && project.pages.some((page) => page.id === piece.pageId)) return piece.pageId;
  const referenced = piece.sketches.find((reference) => project.pages.some((page) => page.id === reference.pageId))?.pageId;
  return referenced ?? project.pages[0]!.id;
};

export const nextPieceName = (project: ProjectSnapshot, pageIdValue = project.activePageId): string => {
  const count = project.pieces.filter((piece) => piecePageId(project, piece) === pageIdValue).length;
  return `Pieza ${count + 1}`;
};

const nextPieceId = (project: ProjectSnapshot): ReturnType<typeof pieceId> => {
  const used = new Set(project.pieces.map((piece) => piece.id));
  let number = project.pieces.length + 1;
  while (used.has(`${project.id}:piece-${number}` as ReturnType<typeof pieceId>)) number += 1;
  return pieceId(`${project.id}:piece-${number}`);
};

const nextPageId = (project: ProjectSnapshot): ReturnType<typeof pageId> => {
  const used = new Set(project.pages.map((page) => page.id));
  let number = project.pages.length + 1;
  while (used.has(`${project.id}:page-${number}` as ReturnType<typeof pageId>)) number += 1;
  return pageId(`${project.id}:page-${number}`);
};

export const selectPiecePage = (project: ProjectSnapshot, piece: PieceSnapshot): ProjectSnapshot => ({ ...project, activePageId: piecePageId(project, piece), activePieceId: piece.id });

export const projectDetail = ({ metadata, project }: DashboardProjectSource): ProjectDetail => {
  const pageNumbers = new Map(project.pages.map((page, index) => [page.id, index + 1]));
  const pieceStates = new Set(project.pieces.map((piece) => pieceStateLabels[piece.state]));
  const sketches = new Set(project.pages.flatMap((page) => page.elements.flatMap((element) => element.type === "sketch" ? [`${page.id}:${element.id}`] : [])));
  return {
    id: metadata.id,
    name: projectDisplayName(metadata),
    updatedAt: metadata.updatedAt,
    revision: project.revision,
    units: project.units,
    status: project.pieces.length === 0 ? "Sin piezas" : pieceStates.size === 1 ? [...pieceStates][0]! : "Estados mixtos",
    materials: [...new Set(project.pieces.flatMap((piece) => piece.material ? [piece.material] : []))],
    metrics: {
      pieceCount: project.pieces.length,
      pageCount: project.pages.length,
      sketchCount: sketches.size,
      elementCount: project.pages.reduce((count, page) => count + page.elements.length, 0),
    },
    pieces: project.pieces.map((piece) => ({
      id: piece.id,
      name: piece.name,
      pageId: piecePageId(project, piece),
      material: piece.material,
      thicknessMm: piece.thicknessMm,
      state: pieceStateLabels[piece.state],
      sketches: piece.sketches.slice(0, 1).map((reference, index) => ({ ...reference, label: `Croquis ${index + 1} · Página ${pageNumbers.get(reference.pageId) ?? "?"}` })),
    })),
    pages: project.pages.map((page) => ({ id: page.id, label: page.name, sketchCount: page.elements.filter((element) => element.type === "sketch").length, pieces: project.pieces.map((piece) => ({ id: piece.id, name: piece.name, pageId: piecePageId(project, piece), material: piece.material, thicknessMm: piece.thicknessMm, state: pieceStateLabels[piece.state], sketches: piece.sketches.slice(0, 1).map((reference, sketchIndex) => ({ ...reference, label: `Croquis ${sketchIndex + 1} · Página ${pageNumbers.get(reference.pageId) ?? "?"}` })) })).filter((piece) => piece.pageId === page.id) })),
    assemblies: [],
  };
};

export const projectTree = projectDetail;

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
  const material = input.material?.trim();
  const piece: PieceSnapshot = {
    id: nextPieceId(project),
    name,
    ...(material ? { material } : {}),
    ...(input.thicknessMm === undefined ? {} : { thicknessMm: input.thicknessMm }),
    process: "cut",
    state: "design",
    sketches: [],
  };
  return { ...project, revision: nextRevision(project.revision), pieces: [...project.pieces, { ...piece, pageId: project.activePageId }], activePieceId: piece.id };
};

export const addPage = (project: ProjectSnapshot, input: NewPageInput = {}): ProjectSnapshot => {
  const template = project.pages.find((page) => page.id === project.activePageId) ?? project.pages[0]!;
  const name = input.name?.trim() || `Página ${project.pages.length + 1}`;
  if (!name) throw new Error("Page name is required");
  const created = { ...template, id: nextPageId(project), name, elements: [], constraints: [], connections: [], positionalCoincidences: [] };
  return { ...project, revision: nextRevision(project.revision), pages: [...project.pages, created], activePageId: created.id };
};

export const renameProjectMetadata = (metadata: ProjectMetadata, name: string, now = Date.now()): ProjectMetadata => newProjectMetadata(metadata.id, name, now);

export const renamePiece = (project: ProjectSnapshot, pieceIdValue: string, name: string): ProjectSnapshot => {
  const normalized = name.trim();
  if (!normalized) throw new Error("Piece name is required");
  if (!project.pieces.some((piece) => piece.id === pieceIdValue)) throw new Error("Piece does not belong to project");
  return { ...project, revision: nextRevision(project.revision), pieces: project.pieces.map((piece) => piece.id === pieceIdValue ? { ...piece, name: normalized } : piece) };
};

export const renamePage = (project: ProjectSnapshot, pageIdValue: string, name: string): ProjectSnapshot => {
  const normalized = name.trim();
  if (!normalized) throw new Error("Page name is required");
  if (!project.pages.some((page) => page.id === pageIdValue)) throw new Error("Page does not belong to project");
  return { ...project, revision: nextRevision(project.revision), pages: project.pages.map((page) => page.id === pageIdValue ? { ...page, name: normalized } : page) };
};

export const deletePiece = (project: ProjectSnapshot, piece: PieceSnapshot): ProjectSnapshot => {
  if (project.pieces.length <= 1) throw new Error("Project must keep at least one piece");
  if (!project.pieces.some((candidate) => candidate.id === piece.id)) throw new Error("Piece does not belong to project");
  const remainingPieces = project.pieces.filter((candidate) => candidate.id !== piece.id);
  const remainingReferences = new Set(remainingPieces.flatMap((candidate) => candidate.sketches.map((reference) => `${reference.pageId}:${reference.sketchId}`)));
  const exclusivelyOwned = new Set(piece.sketches.filter((reference) => !remainingReferences.has(`${reference.pageId}:${reference.sketchId}`)).map((reference) => `${reference.pageId}:${reference.sketchId}`));
  const dedicatedPageId = pageId(`${piece.id}:page`);
  const dedicatedPageIsShared = remainingPieces.some((candidate) => candidate.sketches.some((reference) => reference.pageId === dedicatedPageId));
  const pages = project.pages.filter((page) => page.id !== dedicatedPageId || dedicatedPageIsShared).map((page) => {
    const removedIds = new Set(page.elements.filter((element) => exclusivelyOwned.has(`${page.id}:${element.id}`)).map((element) => element.id));
    for (const element of page.elements) if (element.type === "dimension" && element.references.some((reference) => removedIds.has(reference.elementId))) removedIds.add(element.id);
    return {
      ...page,
      elements: page.elements.filter((element) => !removedIds.has(element.id)),
      ...(page.constraints ? { constraints: page.constraints.filter((constraint) => constraint.references.every((reference) => !removedIds.has(reference.elementId))) } : {}),
      ...(page.connections ? { connections: page.connections.filter((connection) => !removedIds.has(connection.first.elementId) && !removedIds.has(connection.second.elementId)) } : {}),
      ...(page.positionalCoincidences ? { positionalCoincidences: page.positionalCoincidences.filter((coincidence) => !removedIds.has(coincidence.first.elementId) && !removedIds.has(coincidence.second.elementId)) } : {}),
    };
  });
  const partial = { ...project, revision: nextRevision(project.revision), pieces: remainingPieces, pages };
  return selectPiecePage(partial, remainingPieces[0]!);
};

export const projectDisplayName = (project: ProjectMetadata): string => project.name.trim() || "Proyecto sin título";

export const newProjectMetadata = (id: string, name: string, now = Date.now()): ProjectMetadata => {
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Project name is required");
  return { id, name: normalizedName, updatedAt: now };
};

export const configureInitialProject = (project: ProjectSnapshot, input: NewProjectInput, now = Date.now()): DashboardProjectSource => ({ metadata: newProjectMetadata(project.id, input.projectName, now), project });
