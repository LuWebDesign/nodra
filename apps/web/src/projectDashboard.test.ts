import { describe, expect, it } from "vitest";
import { createDocument, createProject, elementId, layerId, pageId } from "@nodra/domain";
import { addPiece, configureInitialProject, dashboardProjects, deletePiece, newProjectMetadata, pieceDisplayLabel, piecePageId, projectDetail, projectDisplayName, projectTree, renameProjectMetadata, selectPiecePage } from "./projectDashboard.js";

describe("project dashboard", () => {
  it("projects persisted pieces instead of synthesizing dashboard content", () => {
    const project = { ...createProject(createDocument("p1")), pieces: [{ ...createProject(createDocument("p1")).pieces[0]!, material: "MDF", thicknessMm: 3 }] };
    expect(dashboardProjects([{ metadata: { id: "p1", name: "Corte", updatedAt: 10 }, project }])).toEqual([
      { id: "p1", name: "Corte", updatedAt: 10, pieces: project.pieces },
    ]);
    expect(pieceDisplayLabel(project.pieces[0]!)).toBe("Pieza 1 · MDF · 3 mm · En diseño");
  });
  it("derives the project hierarchy from piece references and project pages", () => {
    const base = createProject(createDocument("detail", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]));
    const sketch = { type: "sketch" as const, id: elementId("sketch-1"), layerId: layerId("layer-1"), nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 5, y: 0 } }], edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }], style: { stroke: "#000", strokeWidth: 1 } };
    const project = { ...base, pages: [{ ...base.pages[0]!, elements: [sketch] }, { ...base.pages[0]!, id: pageId("page-2"), elements: [] }], pieces: [{ ...base.pieces[0]!, state: "underdefined" as const, sketches: [{ pageId: pageId("page-1"), sketchId: sketch.id }] }] };

    expect(projectDetail({ metadata: { id: "detail", name: "Mesa", updatedAt: 10 }, project })).toEqual({
      id: "detail", name: "Mesa",
      pieces: [{ id: base.pieces[0]!.id, name: "Pieza 1", pageId: "page-1", material: undefined, thicknessMm: undefined, state: "Subdefinida", sketches: [{ pageId: "page-1", sketchId: "sketch-1", label: "Croquis 1 · Página 1" }] }],
      pages: [{ id: "page-1", label: "Página 1", sketchCount: 1 }, { id: "page-2", label: "Página 2", sketchCount: 0 }],
      assemblies: [],
    });
  });
  it("adds a stable piece with an independent active page", () => {
    const project = createProject(createDocument("p1", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]));
    const next = addPiece(project, { name: " Pieza lateral ", material: " " });
    expect(next.revision).toBe(1);
    expect(next.pieces[1]).toEqual({ id: "p1:piece-2", name: "Pieza lateral", process: "cut", state: "design", sketches: [] });
    expect(next.pages).toHaveLength(2);
    expect(next.activePageId).toBe("p1:piece-2:page");
    expect(next.pages[1]).toMatchObject({ id: "p1:piece-2:page", elements: [], connections: [] });
    expect(next.pages[1]).not.toBe(next.pages[0]);
  });
  it("selects each piece page with a safe fallback for legacy pieces", () => {
    const project = addPiece(createProject(createDocument("select")), { name: "Segunda" });
    expect(selectPiecePage(project, project.pieces[0]!).activePageId).toBe("page-1");
    expect(selectPiecePage(project, project.pieces[1]!).activePageId).toBe("select:piece-2:page");
    const legacy = { ...project, pages: [project.pages[0]!], pieces: [{ ...project.pieces[0]!, sketches: [] }, { ...project.pieces[1]!, sketches: [] }] };
    expect(piecePageId(legacy, legacy.pieces[1]!)).toBe("page-1");
  });
  it("renames metadata without changing project identity", () => {
    expect(renameProjectMetadata({ id: "p1", name: "Viejo", updatedAt: 1 }, " Nuevo ", 7)).toEqual({ id: "p1", name: "Nuevo", updatedAt: 7 });
    expect(() => renameProjectMetadata({ id: "p1", name: "Viejo", updatedAt: 1 }, " ", 7)).toThrow("Project name is required");
  });
  it("deletes only a piece's exclusively owned sketches and preserves shared-page geometry", () => {
    const base = addPiece(createProject(createDocument("delete", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }])), { name: "Segunda" });
    const owned = { type: "sketch" as const, id: elementId("owned"), layerId: layerId("layer-1"), nodes: [], edges: [], style: { stroke: "#000", strokeWidth: 1 } };
    const preserved = { ...owned, id: elementId("preserved") };
    const orphanedDimension = { type: "dimension" as const, id: elementId("owned-dimension"), layerId: layerId("layer-1"), kind: "aligned" as const, references: [{ kind: "node" as const, elementId: owned.id, nodeIndex: 0 }, { kind: "node" as const, elementId: preserved.id, nodeIndex: 0 }] as const, offset: { x: 0, y: 0 }, precision: 2, units: "mm" as const, rotation: 0 as const, style: { stroke: "#000", strokeWidth: 1 } };
    const legacyShared = { ...base, activePageId: pageId("page-1"), pages: [{ ...base.pages[0]!, elements: [owned, preserved, orphanedDimension] }, base.pages[1]!], pieces: [{ ...base.pieces[0]!, sketches: [{ pageId: pageId("page-1"), sketchId: owned.id }] }, { ...base.pieces[1]!, sketches: [{ pageId: pageId("page-1"), sketchId: preserved.id }] }] };
    const next = deletePiece(legacyShared, legacyShared.pieces[0]!);
    expect(next.pieces.map((piece) => piece.id)).toEqual([legacyShared.pieces[1]!.id]);
    expect(next.pages[0]!.elements.map((element) => element.id)).toEqual([preserved.id]);
    expect(next.pages.some((page) => page.id === "delete:piece-2:page")).toBe(true);
    expect(() => deletePiece(next, next.pieces[0]!)).toThrow("Project must keep at least one piece");
  });
  it("derives a navigation tree without copying page geometry", () => {
    const project = addPiece(createProject(createDocument("tree")), { name: "Segunda" });
    const tree = projectTree({ metadata: { id: "tree", name: "Árbol", updatedAt: 1 }, project });
    expect(tree).toMatchObject({ name: "Árbol", pieces: [{ name: "Pieza 1", pageId: "page-1" }, { name: "Segunda", pageId: "tree:piece-2:page" }], pages: [{ id: "page-1" }, { id: "tree:piece-2:page" }] });
    expect(JSON.stringify(tree)).not.toContain("elements");
  });
  it("configures named project metadata and the initial persisted piece without adding a revision", () => {
    const project = createProject(createDocument("p2"));
    const configured = configureInitialProject(project, { projectName: " Mesa ", pieceName: " Tapa ", material: "MDF", thicknessMm: 6 }, 42);

    expect(configured.metadata).toEqual({ id: "p2", name: "Mesa", updatedAt: 42 });
    expect(configured.project.revision).toBe(1);
    expect(configured.project.pieces).toEqual([{ id: "p2:piece-1", name: "Tapa", material: "MDF", thicknessMm: 6, process: "cut", state: "design", sketches: [] }]);
    expect(() => configureInitialProject(project, { projectName: " ", pieceName: "Tapa" }, 42)).toThrow("Project name is required");
  });
  it("uses safe display names and rejects empty metadata names", () => {
    expect(projectDisplayName({ id: "p1", name: " ", updatedAt: 10 })).toBe("Proyecto sin título");
    expect(newProjectMetadata("p2", " Mesa ", 42)).toEqual({ id: "p2", name: "Mesa", updatedAt: 42 });
    expect(() => newProjectMetadata("p2", " ", 42)).toThrow("Project name is required");
  });
});
