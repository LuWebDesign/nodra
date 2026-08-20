import { describe, expect, it, vi } from "vitest";
import { layers, preparePlaceholder, toolbar } from "./index.js";

describe("UI primitives", () => {
  it("returns stateless toolbar and layer contracts", () => {
    const onToolChange = vi.fn();
    const onVisibilityChange = vi.fn();
    expect(toolbar({ activeTool: "select", onToolChange }).kind).toBe("toolbar");
    expect(layers({ layers: [{ id: "l1", name: "Default", visible: true }], onVisibilityChange }).props.layers).toHaveLength(1);
    expect(onToolChange).not.toHaveBeenCalled();
    expect(onVisibilityChange).not.toHaveBeenCalled();
  });

  it("makes Prepare's lack of execution capability explicit", () => {
    expect(preparePlaceholder().props.label).toContain("No hardware execution is connected");
  });
});
