import { describe, expect, it } from "vitest";
import { createDocument, createEmptyProject, elementId, layerId, pageId, pieceId, type PageSnapshot, type ProjectSnapshot } from "@nodra/domain";
import { profileScopeForLayer, profileScopeForPiece, profileScopeForSelection } from "./profileScope.js";

const layer = { id: layerId("layer-1"), name: "Layer", visible: true, order: 0 };
const style = { stroke: "#000", strokeWidth: 1 };
const line = (id: string, layerId = layer.id, pieceIdValue?: string) => ({
  type: "line" as const, id: elementId(id), layerId, start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style,
  ...(pieceIdValue ? { pieceId: pieceId(pieceIdValue) } : {}),
});

const setup = (): { project: ProjectSnapshot; page: PageSnapshot } => {
  const first = pieceId("piece-1");
  const second = pieceId("piece-2");
  const base = createEmptyProject(createDocument("project"));
  const page: PageSnapshot = {
    id: pageId("page-1"), name: "Page", page: { width: 100, height: 100 }, layers: [layer],
    elements: [line("first", layer.id, first), line("second", layer.id, second), line("legacy")],
  };
  return {
    page,
    project: { ...base, pieces: [
      { id: first, name: "First", process: "cut", state: "design", pageId: page.id, sketches: [] },
      { id: second, name: "Second", process: "cut", state: "design", pageId: page.id, sketches: [] },
    ], pages: [page], activePageId: page.id },
  };
};

describe("profile scope helpers", () => {
  it("does not leak geometry from another piece", () => {
    const { project, page } = setup();
    expect(profileScopeForPiece(project, page, pieceId("piece-1")).elements.map((element) => element.id)).toEqual([elementId("first"), elementId("legacy")]);
  });

  it("filters a piece scope by layer", () => {
    const { project, page } = setup();
    expect(profileScopeForLayer(project, page, pieceId("piece-1"), layer.id).elements.map((element) => element.id)).toEqual([elementId("first"), elementId("legacy")]);
    expect(profileScopeForLayer(project, page, pieceId("piece-1"), "missing" as never).elements).toEqual([]);
  });

  it("filters selection IDs, ignores unknown IDs, and preserves document order", () => {
    const { project, page } = setup();
    expect(profileScopeForSelection(project, page, pieceId("piece-1"), [elementId("unknown"), elementId("first")]).elements.map((element) => element.id)).toEqual([elementId("first")]);
  });

  it("does not mutate snapshots", () => {
    const { project, page } = setup();
    const before = structuredClone(page);
    profileScopeForSelection(project, page, pieceId("piece-1"), [elementId("first")]);
    expect(page).toEqual(before);
  });
});
