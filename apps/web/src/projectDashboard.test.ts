import { describe, expect, it } from "vitest";
import { dashboardProjects, newProjectMetadata, projectDisplayName } from "./projectDashboard.js";

describe("project dashboard", () => {
  it("keeps persisted metadata and exposes the honest first piece concept", () => {
    expect(dashboardProjects([{ id: "p1", name: "Corte", updatedAt: 10 }])).toEqual([
      { id: "p1", name: "Corte", updatedAt: 10, pieceLabel: "Pieza 1 · concepto inicial" },
    ]);
  });
  it("uses a safe display name and creates metadata without changing the schema", () => {
    expect(projectDisplayName({ id: "p1", name: " ", updatedAt: 10 })).toBe("Proyecto sin título");
    expect(newProjectMetadata("p2", 42)).toEqual({ id: "p2", name: "Proyecto sin título", updatedAt: 42 });
  });
});
