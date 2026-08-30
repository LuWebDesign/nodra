import { describe, expect, it } from "vitest";
import { createDocument, elementId, layerId, withElements, type DocumentSnapshot } from "@nodra/domain";
import { renderSvg } from "./index.js";

const layer = { id: layerId("design"), name: "Design", visible: true, order: 0 } as const;
const style = { stroke: "#111", strokeWidth: 0.2 } as const;
const document = (): DocumentSnapshot => withElements(createDocument("doc-1", [layer]), [
  { type: "rectangle", id: elementId("rect"), layerId: layer.id, position: { x: 10, y: 20 }, size: { width: 30, height: 10 }, cornerRadius: 0, rotation: 0, style },
  { type: "ellipse", id: elementId("ellipse"), layerId: layer.id, position: { x: 50, y: 20 }, size: { width: 20, height: 10 }, rotation: 0, style },
  { type: "line", id: elementId("line"), layerId: layer.id, start: { x: 0, y: 0 }, end: { x: 10, y: 5 }, rotation: 0, style },
]);

describe("SVG renderer boundary", () => {
  it("renders supported primitives using mm geometry converted through the viewport", () => {
    const result = renderSvg(document(), { zoom: 2, panMm: { x: 5, y: 10 } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.svg).toContain('x="10" y="20" width="60" height="20"');
      expect(result.svg).toContain('fill="#111"');
          expect(result.svg).toContain('fill-opacity="0.22"');
          expect(result.svg).toContain('data-element-id="line"');
      expect(result.svg).toContain('cx="110" cy="30" rx="20" ry="10"');
      expect(result.svg).toContain('x1="-10" y1="-20" x2="10" y2="-10"');
      expect(result.renderedElementIds).toEqual(["rect", "ellipse", "line"]);
    }
  });
  it("renders radius dimensions with an R prefix", () => {
    const ellipse = { type: "ellipse" as const, id: elementId("circle"), layerId: layer.id, position: { x: 10, y: 10 }, size: { width: 20, height: 20 }, rotation: 0, style };
    const radius = { type: "dimension" as const, id: elementId("radius"), layerId: layer.id, kind: "radius" as const, references: [{ kind: "node" as const, elementId: ellipse.id, nodeIndex: 0, nodeId: "center" }, { kind: "node" as const, elementId: ellipse.id, nodeIndex: 2, nodeId: "e" }] as const, offset: { x: 8, y: 0 }, precision: 2, units: "mm" as const, rotation: 0 as const, style };
    const result = renderSvg(withElements(createDocument("radius", [layer]), [ellipse, radius]), { zoom: 1, panMm: { x: 0, y: 0 } });
    expect(result.success).toBe(true);
    if (result.success) expect(result.svg).toContain("R10.00 mm");
  });

  it("renders connected angular dimensions as an arc with degree text", () => {
    const first = { type: "line" as const, id: elementId("angle-first"), layerId: layer.id, start: { x: 20, y: 20 }, end: { x: 60, y: 20 }, rotation: 0, style };
    const second = { type: "line" as const, id: elementId("angle-second"), layerId: layer.id, start: { x: 20, y: 20 }, end: { x: 20, y: 60 }, rotation: 0, style };
    const angle = { type: "dimension" as const, id: elementId("angle"), layerId: layer.id, kind: "angular" as const, references: [{ kind: "line" as const, elementId: first.id }, { kind: "line" as const, elementId: second.id }] as const, offset: { x: 10, y: 10 }, precision: 0, units: "mm" as const, rotation: 0 as const, style };
    const result = renderSvg(withElements(createDocument("angle", [layer]), [first, second, angle]), { zoom: 1, panMm: { x: 0, y: 0 } });
    expect(result.success).toBe(true);
    if (result.success) { expect(result.svg).toContain('data-dimension="angular"'); expect(result.svg).toContain(" A "); expect(result.svg).toContain("90°"); }
  });

  it("renders rectangle corner radii in screen millimetres and clamps to half dimensions", () => {
    const source = withElements(createDocument("rounded", [layer]), [{ type: "rectangle", id: elementId("rounded-rect"), layerId: layer.id, position: { x: 0, y: 0 }, size: { width: 20, height: 10 }, cornerRadius: 8, rotation: 0, style }]);
    const result = renderSvg(source, { zoom: 2, panMm: { x: 0, y: 0 } });
    expect(result.success).toBe(true);
    if (result.success) expect(result.svg).toContain('rx="10" ry="10"');
  });
  it("renders compound contours as closed paths with an even-odd fill rule", () => {
    const source = withElements(createDocument("contour", [layer]), [{ type: "contour", id: elementId("contour"), layerId: layer.id, position: { x: 0, y: 0 }, size: { width: 20, height: 20 }, contours: [{ points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }, { x: 0, y: 0 }] }, { points: [{ x: 5, y: 5 }, { x: 5, y: 15 }, { x: 15, y: 15 }, { x: 15, y: 5 }, { x: 5, y: 5 }] }], fillRule: "evenodd", rotation: 0, style }]);
    const result = renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } });
    expect(result.success).toBe(true);
    if (result.success) expect(result.svg).toContain('fill-rule="evenodd"');
  });

  it("emits a reflection transform for mirrored elements", () => {
    const source = withElements(createDocument("mirrored", [layer]), [{ type: "line", id: elementId("mirrored-line"), layerId: layer.id, start: { x: 0, y: 0 }, end: { x: 20, y: 10 }, rotation: 0, flipX: true, style }]);
    const result = renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } });

    expect(result.success).toBe(true);
    if (result.success) expect(result.svg).toContain('scale(-1 1)');
  });

  it("renders contour points directly so baked flips are visible without a second transform", () => {
    const source = withElements(createDocument("flipped-contour", [layer]), [{ type: "contour", id: elementId("flipped-contour"), layerId: layer.id, position: { x: 0, y: 0 }, size: { width: 20, height: 10 }, contours: [{ points: [{ x: 20, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 0 }] }], fillRule: "evenodd", rotation: 0, flipX: true, style }]);
    const result = renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } });
    expect(result.success).toBe(true);
    if (result.success) expect(result.svg).toContain("M20 0 L0 0 L0 10");
  });

  it("omits hidden layers without changing layer or element data", () => {
    const source = document();
    const hidden = { ...source, layers: [{ ...layer, visible: false }] };
    const result = renderSvg(hidden, { zoom: 1, panMm: { x: 0, y: 0 } });
    expect(result.success).toBe(true);
    if (result.success) expect(result.renderedElementIds).toEqual([]);
    expect(hidden).toEqual({ ...source, layers: [{ ...layer, visible: false }] });
  });

  it("returns bounded invalid and unsupported results instead of throwing", () => {
    expect(renderSvg({ schemaVersion: 1 }, { zoom: 1, panMm: { x: 0, y: 0 } })).toMatchObject({ success: false, reason: "invalid" });
    expect(renderSvg({ schemaVersion: 99 }, { zoom: 1, panMm: { x: 0, y: 0 } })).toMatchObject({ success: false, reason: "unsupported" });
    expect(renderSvg(document(), { zoom: 0, panMm: { x: 0, y: 0 } })).toMatchObject({ success: false, reason: "invalid" });
  });

  it("classifies invalid schema-3 documents as invalid rather than unsupported", () => {
    const invalid = { ...document(), revision: -1 };
    expect(renderSvg(invalid, { zoom: 1, panMm: { x: 0, y: 0 } })).toMatchObject({ success: false, reason: "invalid" });
  });

  it("classifies genuinely unsupported schema versions as unsupported", () => {
    expect(renderSvg({ ...document(), schemaVersion: 99 }, { zoom: 1, panMm: { x: 0, y: 0 } })).toMatchObject({ success: false, reason: "unsupported" });
  });

  it("does not mutate the source snapshot", () => {
    const source = document();
    const before = structuredClone(source);
    renderSvg(source, { zoom: 3, panMm: { x: 4, y: 5 } });
    expect(source).toEqual(before);
  });
  it("renders canonical open paths with line and cubic commands", () => {
    const source = withElements(createDocument("path", [layer]), [{ type: "path", id: elementId("path"), layerId: layer.id, nodes: [{ id: "a", anchor: { x: 0, y: 0 }, join: "corner" }, { id: "b", anchor: { x: 10, y: 0 }, join: "smooth" }, { id: "c", anchor: { x: 20, y: 0 }, join: "corner" }], segments: [{ type: "line", startNodeId: "a", endNodeId: "b" }, { type: "cubicBezier", startNodeId: "b", endNodeId: "c", control1: { x: 12, y: 5 }, control2: { x: 18, y: 5 } }], closed: false, style }]);
    const result = renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } });
    expect(result.success).toBe(true);
    if (result.success) expect(result.svg).toContain("M0 0 L10 0 C12 5 18 5 20 0");
  });
  it("renders native splines through the canonical path pipeline", () => {
    const source = withElements(createDocument("spline", [layer]), [{ type: "spline", id: elementId("spline"), layerId: layer.id, nodes: [{ id: "a", anchor: { x: 0, y: 0 }, continuity: "smooth", outHandle: { dx: 3, dy: 0 } }, { id: "b", anchor: { x: 10, y: 0 }, continuity: "smooth", inHandle: { dx: -3, dy: 0 } }, { id: "c", anchor: { x: 10, y: 10 }, continuity: "smooth" }], closed: true, style: { stroke: "#123456", fill: "#abcdef", strokeWidth: 2 } }]);
    const result = renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.svg).toContain('data-element-id="spline"');
      expect(result.svg).toContain("C3 0 7 0 10 0");
      expect(result.svg).toContain("L10 10");
      expect(result.svg).toContain("Z");
      expect(result.svg).toContain('stroke="#123456"');
      expect(result.svg).toContain('fill="#abcdef"');
    }
  });

  it("renders actual multiline text newlines as separate tspans", () => {
    const source = withElements(createDocument("text", [layer]), [{
      type: "text", id: elementId("text"), layerId: layer.id, position: { x: 10, y: 20 }, size: { width: 40, height: 20 },
      text: "first\nsecond", fontFamily: "Arial", fontSize: 10, fontWeight: "normal", fontStyle: "normal", textAlign: "left", lineHeight: 1.2, rotation: 0,
      style,
    }]);
    const result = renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.svg).toContain('<tspan x="10" dy="0">first</tspan><tspan x="10" dy="12">second</tspan>');
      expect(result.svg).not.toContain("first\\nsecond");
    }
  });

  it("renders text strokes with the configured positive model width", () => {
    const source = withElements(createDocument("thin-text", [layer]), [{
      type: "text", id: elementId("thin-text"), layerId: layer.id, position: { x: 10, y: 20 }, size: { width: 40, height: 20 },
      text: "thin", fontFamily: "Arial", fontSize: 10, fontWeight: "normal", fontStyle: "normal", textAlign: "left", lineHeight: 1.2, rotation: 0,
      style: { stroke: "#111", fill: "none", strokeWidth: 0.2 },
    }]);
    const result = renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.svg).toContain('<text data-element-id="thin-text"');
      expect(result.svg).toContain('stroke-width="0.2"');
      expect(result.svg).not.toContain('stroke-width="1"');
    }
  });
});
