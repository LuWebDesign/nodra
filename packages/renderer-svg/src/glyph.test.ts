import { describe, expect, it } from "vitest";
import { createDocument, layerId } from "@nodra/domain";
import { renderSvg } from "./index.js";

describe("glyph SVG output", () => {
  it("renders cubic compound contours as one even-odd path", () => {
    const layer = { id: layerId("layer"), name: "Design", visible: true, order: 0 };
    const glyph = { type: "glyph" as const, id: "glyph-1", layerId: layer.id, position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, glyph: "O", fillRule: "evenodd" as const, rotation: 0, style: { stroke: "#000", fill: "#fff", strokeWidth: 1 }, contours: [{ nodes: [{ id: "a", anchor: { x: 0, y: 0 }, join: "corner" as const }, { id: "b", anchor: { x: 10, y: 0 }, join: "corner" as const }, { id: "c", anchor: { x: 10, y: 10 }, join: "corner" as const }], segments: [{ type: "cubicBezier" as const, startNodeId: "a", endNodeId: "b", control1: { x: 3, y: -2 }, control2: { x: 7, y: -2 } }, { type: "line" as const, startNodeId: "b", endNodeId: "c" }, { type: "line" as const, startNodeId: "c", endNodeId: "a" }] }] };
    const result = renderSvg({ ...createDocument("doc", [layer]), elements: [glyph] }, { zoom: 1, panMm: { x: 0, y: 0 } });
    expect(result.success).toBe(true);
    if (result.success) expect(result.svg).toContain(`data-element-id="glyph-1"`);
    if (result.success) expect(result.svg).toContain("C3 -2 7 -2 10 0");
  });

  it("applies glyph rotation and flips at render time without changing path coordinates", () => {
    const layer = { id: layerId("layer"), name: "Design", visible: true, order: 0 };
    const glyph = { type: "glyph" as const, id: "glyph-transform", layerId: layer.id, position: { x: 10, y: 20 }, size: { width: 10, height: 10 }, glyph: "A", fillRule: "evenodd" as const, rotation: Math.PI / 2, flipX: true, flipY: true, style: { stroke: "#000", fill: "#fff", strokeWidth: 1 }, contours: [{ nodes: [{ id: "a", anchor: { x: 10, y: 20 }, join: "corner" as const }, { id: "b", anchor: { x: 20, y: 20 }, join: "corner" as const }, { id: "c", anchor: { x: 10, y: 30 }, join: "corner" as const }], segments: [{ type: "line" as const, startNodeId: "a", endNodeId: "b" }, { type: "line" as const, startNodeId: "b", endNodeId: "c" }, { type: "line" as const, startNodeId: "c", endNodeId: "a" }] }] };
    const result = renderSvg({ ...createDocument("doc", [layer]), elements: [glyph] }, { zoom: 1, panMm: { x: 0, y: 0 } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.svg).toContain('transform="translate(15 25) rotate(90) scale(-1 -1) translate(-15 -25)"');
      expect(result.svg).toContain("M10 20 L20 20");
    }
  });
});
