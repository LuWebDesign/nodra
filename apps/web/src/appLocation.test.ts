import { describe, expect, it } from "vitest";
import { pathForView, routeFromPath } from "./appLocation.js";

describe("application location", () => {
  it("maps supported paths to views and decodes project IDs", () => {
    expect(routeFromPath("/proyectos/project%2F42")).toEqual({ view: "project", projectId: "project/42" });
    expect(routeFromPath("/proyectos/%")).toEqual({ view: "dashboard" });
    expect(routeFromPath("/modelo")).toEqual({ view: "editor" });
    expect(routeFromPath("/preparar")).toEqual({ view: "editor" });
    expect(routeFromPath("/unknown")).toEqual({ view: "dashboard" });
  });

  it("preserves project encoding and editor mode paths", () => {
    expect(pathForView("project", "project/42", "design")).toBe("/proyectos/project%2F42");
    expect(pathForView("editor", undefined, "design")).toBe("/modelo");
    expect(pathForView("editor", undefined, "prepare")).toBe("/preparar");
    expect(pathForView("dashboard", undefined, "design")).toBe("/proyectos");
  });
});
