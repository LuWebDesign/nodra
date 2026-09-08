import { describe, expect, it } from "vitest";
import { createDocument, createProject } from "@nodra/domain";
import { addPiece, dashboardProjects, newProjectMetadata, pieceDisplayLabel, projectDisplayName } from "./projectDashboard.js";

describe("project dashboard", () => {
  it("projects persisted pieces instead of synthesizing dashboard content", () => {
    const project = { ...createProject(createDocument("p1")), pieces: [{ ...createProject(createDocument("p1")).pieces[0]!, material: "MDF", thicknessMm: 3 }] };
    expect(dashboardProjects([{ metadata: { id: "p1", name: "Corte", updatedAt: 10 }, project }])).toEqual([
      { id: "p1", name: "Corte", updatedAt: 10, pieces: project.pieces },
    ]);
    expect(pieceDisplayLabel(project.pieces[0]!)).toBe("Pieza 1 · MDF · 3 mm · En diseño");
  });
  it("adds a stable piece while trimming optional fields and incrementing once", () => {
    const project = createProject(createDocument("p1"));
    const next = addPiece(project, { name: " Pieza lateral ", material: " " });
    expect(next.revision).toBe(1);
    expect(next.pieces[1]).toEqual({ id: "p1:piece-2", name: "Pieza lateral", process: "cut", state: "design", sketches: [] });
  });
  it("uses a safe display name and creates metadata without changing the schema", () => {
    expect(projectDisplayName({ id: "p1", name: " ", updatedAt: 10 })).toBe("Proyecto sin título");
    expect(newProjectMetadata("p2", 42)).toEqual({ id: "p2", name: "Proyecto sin título", updatedAt: 42 });
  });
});
