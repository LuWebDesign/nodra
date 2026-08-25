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

it("renders a canonical cubic path without mutating its source", () => {
  const path = { type: "path" as const, id: elementId("bezier"), layerId: layer.id, nodes: [{ id: "a", anchor: { x: 0, y: 0 }, join: "corner" as const }, { id: "b", anchor: { x: 10, y: 0 }, join: "corner" as const }], segments: [{ type: "cubicBezier" as const, startNodeId: "a", endNodeId: "b", control1: { x: 2, y: 5 }, control2: { x: 8, y: -5 } }], closed: false, rotation: 0, style };
  const source = withElements(createDocument("doc-1", [layer]), [path]);
  const result = renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } });
  expect(result.success && result.svg).toContain("C2 5 8 -5 10 0");
  expect(source.elements[0]).toEqual(path);
});

describe("SVG renderer boundary", () => {
  it("renders supported primitives using mm geometry converted through the viewport", () => {
    const result = renderSvg(document(), { zoom: 2, panMm: { x: 5, y: 10 } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.svg).toContain('x="10" y="20" width="60" height="20"');
      expect(result.svg).toContain('fill="none"');
      expect(result.svg).toContain('cx="110" cy="30" rx="20" ry="10"');
      expect(result.svg).toContain('x1="-10" y1="-20" x2="10" y2="-10"');
      expect(result.renderedElementIds).toEqual(["rect", "ellipse", "line"]);
    }
  });

  it("renders associative annotation dimensions as non-destructive SVG", () => {
    const line = { type: "line" as const, id: elementId("measured-line"), layerId: layer.id, start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style };
    const dimension = { type: "dimension" as const, id: elementId("dimension"), layerId: layer.id, kind: "aligned" as const, references: [{ elementId: line.id, nodeIndex: 0 }, { elementId: line.id, nodeIndex: 2 }] as const, offset: { x: 0, y: -6 }, precision: 1, units: "mm" as const, rotation: 0 as const, style: { stroke: "#2563eb", strokeWidth: 0.45 } };
    const result = renderSvg(withElements(createDocument("dimensions", [layer]), [line, dimension]), { zoom: 1, panMm: { x: 0, y: 0 } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.svg).toContain('data-dimension="aligned"');
      expect(result.svg).toContain('10.0 mm');
      expect(result.renderedElementIds).toEqual(["measured-line", "dimension"]);
    }
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
});
