import { elementsForPiece, type Element, type ElementId, type PageSnapshot, type PieceId, type ProjectSnapshot, type LayerId } from "@nodra/domain";
import type { ProfileInputElement, ProfileInputScope } from "@nodra/geometry";

/** Native geometry accepted by profile derivation, kept transient at the editor boundary. */
const isProfileInputElement = (element: Element): element is ProfileInputElement =>
  element.type === "sketch" || element.type === "rectangle" || element.type === "circle" || element.type === "arc" || element.type === "line";

const scope = (elements: readonly Element[]): ProfileInputScope => ({
  // Filtering preserves the page's document order and never mutates its snapshots.
  elements: elements.filter(isProfileInputElement),
});

/** Returns the profile inputs owned by one piece on a page. */
export const profileScopeForPiece = (
  project: ProjectSnapshot,
  page: PageSnapshot,
  pieceId: PieceId,
): ProfileInputScope => {
  if (!project.pieces.some((piece) => piece.id === pieceId)) return { elements: [] };
  return scope(elementsForPiece(project, page, pieceId));
};

/** Returns one piece's profile inputs on a layer, in document order. */
export const profileScopeForLayer = (
  project: ProjectSnapshot,
  page: PageSnapshot,
  pieceId: PieceId,
  layerId: LayerId,
): ProfileInputScope => ({
  elements: profileScopeForPiece(project, page, pieceId).elements.filter((element) => element.layerId === layerId),
});

/** Returns selected profile inputs from one piece; unknown IDs are ignored. */
export const profileScopeForSelection = (
  project: ProjectSnapshot,
  page: PageSnapshot,
  pieceId: PieceId,
  elementIds: readonly ElementId[],
): ProfileInputScope => {
  const selected = new Set(elementIds);
  return {
    elements: profileScopeForPiece(project, page, pieceId).elements.filter((element) => selected.has(element.id)),
  };
};
