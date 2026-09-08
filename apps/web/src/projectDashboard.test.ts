import { describe, expect, it } from "vitest";
import { createDocument, createProject, elementId, layerId, pageId } from "@nodra/domain";
import { addPiece, configureInitialProject, dashboardProjects, newProjectMetadata, pieceDisplayLabel, projectDetail, projectDisplayName } from "./projectDashboard.js";

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
      pieces: [{ id: base.pieces[0]!.id, name: "Pieza 1", material: undefined, thicknessMm: undefined, state: "Subdefinida", sketches: [{ pageId: "page-1", sketchId: "sketch-1", label: "Croquis 1 · Página 1" }] }],
      pages: [{ id: "page-1", label: "Página 1", sketchCount: 1 }, { id: "page-2", label: "Página 2", sketchCount: 0 }],
      assemblies: [],
    });
  });
  it("adds a stable piece while trimming optional fields and incrementing once", () => {
    const project = createProject(createDocument("p1"));
    const next = addPiece(project, { name: " Pieza lateral ", material: " " });
    expect(next.revision).toBe(1);
    expect(next.pieces[1]).toEqual({ id: "p1:piece-2", name: "Pieza lateral", process: "cut", state: "design", sketches: [] });
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
