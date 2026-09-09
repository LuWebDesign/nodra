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

export interface NewProjectInput {
  readonly projectName: string;
  readonly pieceName: string;
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

export interface ProjectDetail {
  readonly id: string;
  readonly name: string;
  readonly pieces: readonly { readonly id: string; readonly name: string; readonly pageId: string; readonly material: string | undefined; readonly thicknessMm: number | undefined; readonly state: string; readonly sketches: readonly { readonly pageId: string; readonly sketchId: string; readonly label: string }[] }[];
  readonly pages: readonly { readonly id: string; readonly label: string; readonly sketchCount: number }[];
  readonly assemblies: readonly [];
}

export const piecePageId = (project: ProjectSnapshot, piece: PieceSnapshot): PageId => {
  const referenced = piece.sketches.find((reference) => project.pages.some((page) => page.id === reference.pageId))?.pageId;
  if (referenced) return referenced;
  const dedicated = pageId(`${piece.id}:page`);
  if (project.pages.some((page) => page.id === dedicated)) return dedicated;
  return project.pages[project.pieces.findIndex((candidate) => candidate.id === piece.id)]?.id ?? project.pages[0]!.id;
};

export const selectPiecePage = (project: ProjectSnapshot, piece: PieceSnapshot): ProjectSnapshot => ({ ...project, activePageId: piecePageId(project, piece) });

export const projectDetail = ({ metadata, project }: DashboardProjectSource): ProjectDetail => {
  const pageNumbers = new Map(project.pages.map((page, index) => [page.id, index + 1]));
  return {
    id: metadata.id,
    name: projectDisplayName(metadata),
    pieces: project.pieces.map((piece) => ({
      id: piece.id,
      name: piece.name,
      pageId: piecePageId(project, piece),
      material: piece.material,
      thicknessMm: piece.thicknessMm,
      state: pieceStateLabels[piece.state],
      sketches: piece.sketches.map((reference, index) => ({ ...reference, label: `Croquis ${index + 1} · Página ${pageNumbers.get(reference.pageId) ?? "?"}` })),
    })),
    pages: project.pages.map((page, index) => ({ id: page.id, label: `Página ${index + 1}`, sketchCount: page.elements.filter((element) => element.type === "sketch").length })),
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
  const template = project.pages.find((page) => page.id === project.activePageId) ?? project.pages[0]!;
  const dedicatedPage = { ...template, id: pageId(`${piece.id}:page`), elements: [], constraints: [], connections: [], positionalCoincidences: [] };
  return { ...project, revision: nextRevision(project.revision), pieces: [...project.pieces, piece], pages: [...project.pages, dedicatedPage], activePageId: dedicatedPage.id };
};

export const renameProjectMetadata = (metadata: ProjectMetadata, name: string, now = Date.now()): ProjectMetadata => newProjectMetadata(metadata.id, name, now);

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

export const configureInitialProject = (project: ProjectSnapshot, input: NewProjectInput, now = Date.now()): DashboardProjectSource => {
  const metadata = newProjectMetadata(project.id, input.projectName, now);
  const pieceName = input.pieceName.trim();
  if (!pieceName) throw new Error("Piece name is required");
  if (input.thicknessMm !== undefined && (!Number.isFinite(input.thicknessMm) || input.thicknessMm <= 0)) throw new Error("Piece thickness must be positive");
  const material = input.material?.trim();
  const initial = project.pieces[0]!;
  const piece: PieceSnapshot = { ...initial, name: pieceName, ...(material ? { material } : {}), ...(input.thicknessMm === undefined ? {} : { thicknessMm: input.thicknessMm }) };
  return { metadata, project: { ...project, revision: nextRevision(project.revision), pieces: [piece, ...project.pieces.slice(1)] } };
};
