import { describe, expect, it } from "vitest";
import { createDocument, elementId, layerId, withElements, type ArcElement, type DocumentSnapshot } from "@nodra/domain";
import { buildSketchProfile } from "@nodra/geometry";
import { validateDocument } from "@nodra/validation";
import { FabricableDocumentProjectionError, projectFabricableDocument, renderSketchProfileSvg, renderSvg } from "./index.js";

const layer = { id: layerId("design"), name: "Design", visible: true, order: 0 } as const;
const style = { stroke: "#111", strokeWidth: 0.2 } as const;
const document = (): DocumentSnapshot => withElements(createDocument("doc-1", [layer]), [
  { type: "rectangle", id: elementId("rect"), layerId: layer.id, position: { x: 10, y: 20 }, size: { width: 30, height: 10 }, cornerRadius: 0, rotation: 0, style },
  { type: "ellipse", id: elementId("ellipse"), layerId: layer.id, position: { x: 50, y: 20 }, size: { width: 20, height: 10 }, rotation: 0, style },
  { type: "circle", id: elementId("circle"), layerId: layer.id, center: { x: 85, y: 25 }, radius: 5, style },
  { type: "line", id: elementId("line"), layerId: layer.id, start: { x: 0, y: 0 }, end: { x: 10, y: 5 }, rotation: 0, style },
]);

describe("SVG renderer boundary", () => {
  it("offsets H/V glyphs perpendicular to their referenced edges while preserving longitudinal centers", () => {
    const sketchId = elementId("hv-offset-sketch");
    const render = (kind: "horizontal" | "vertical", end: { x: number; y: number }, reversed = false) => {
      const nodes = [{ id: "a", point: { x: 10, y: 10 } }, { id: "b", point: end }];
      const ordered = reversed ? [...nodes].reverse() : nodes;
      const sketch = { type: "sketch" as const, id: sketchId, layerId: layer.id, nodes: ordered, edges: [{ id: "edge", startNodeId: "a", endNodeId: "b" }], constraints: [{ id: kind, kind, references: [{ elementId: sketchId, nodeId: reversed ? "b" : "a" }, { elementId: sketchId, nodeId: reversed ? "a" : "b" }] as const }], style };
      const result = renderSvg(withElements(createDocument("hv-offset", [layer]), [sketch]), { zoom: 1, panMm: { x: 0, y: 0 } });
      expect(result.success).toBe(true);
      if (!result.success) return undefined;
      expect(result.svg).toContain('<line data-sketch-edge="edge"');
      return result.svg.match(new RegExp(`data-constraint-id="${kind}"[^>]*transform="([^"]+)"`))?.[1];
    };
    expect(render("horizontal", { x: 30, y: 10 })).toBe("translate(20 -4)");
    expect(render("horizontal", { x: 30, y: 10 }, true)).toBe("translate(20 -4)");
    expect(render("vertical", { x: 10, y: 30 })).toBe("translate(24 20)");
    expect(render("vertical", { x: 10, y: 30 }, true)).toBe("translate(24 20)");
    // Even a two-pixel edge keeps its glyph centered along its length and offset
    // by a fixed screen-space clearance, so the edge itself stays visible.
    expect(render("horizontal", { x: 11, y: 10 })).toBe("translate(10.5 -4)");
    expect(render("horizontal", { x: 30, y: 20 })).toBe("translate(26.26099 2.478019)");
  });
  it("renders derived editor-only constraint glyphs from stable sketch references", () => {
    const id = elementId("constraint-sketch");
    const sketch = (nodes: readonly { id: string; point: { x: number; y: number } }[], edges: readonly { id: string; startNodeId: string; endNodeId: string }[]) => ({
      type: "sketch" as const, id, layerId: layer.id, nodes, edges, style,
      constraints: [
        { id: 'horizontal"<&', kind: "horizontal" as const, references: [{ elementId: id, nodeId: "a" }, { elementId: id, nodeId: "b" }] as const },
        { id: "vertical", kind: "vertical" as const, references: [{ elementId: id, nodeId: "b" }, { elementId: id, nodeId: "c" }] as const },
        { id: "perpendicular", kind: "perpendicular" as const, references: [{ elementId: id, edgeId: "ab" }, { elementId: id, edgeId: "ef" }] as const },
        { id: "midpoint", kind: "midpoint" as const, references: [{ elementId: id, nodeId: "d" }, { elementId: id, edgeId: "ab" }] as const },
      ],
    });
    const nodes = [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 10, y: 0 } }, { id: "c", point: { x: 10, y: 10 } }, { id: "d", point: { x: 5, y: 1 } }, { id: "e", point: { x: 20, y: 0 } }, { id: "f", point: { x: 20, y: 10 } }];
    const edges = [{ id: "ab", startNodeId: "a", endNodeId: "b" }, { id: "bc", startNodeId: "b", endNodeId: "c" }, { id: "ef", startNodeId: "e", endNodeId: "f" }];
    const source = withElements(createDocument("constraint-glyphs", [layer]), [sketch(nodes, edges)]);
    const rendered = renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } });
    expect(rendered.success).toBe(true);
    if (rendered.success) {
      expect(rendered.svg).toContain('data-constraint-id="horizontal&quot;&lt;&amp;" data-constraint-kind="horizontal" data-constraint-owner="constraint-sketch"');
      expect(rendered.svg).toContain(">H</text>"); expect(rendered.svg).toContain(">V</text>"); expect(rendered.svg).toContain(">⊥</text>"); expect(rendered.svg).toContain(">M</text>");
      expect(rendered.svg).toContain('pointer-events="none"');
      const moved = renderSvg(withElements(createDocument("constraint-glyphs", [layer]), [sketch(nodes.map((node) => node.id === "b" ? { ...node, point: { x: 20, y: 0 } } : node), [...edges].reverse())]), { zoom: 1, panMm: { x: 0, y: 0 } });
      expect(moved.success).toBe(true);
      if (moved.success) {
        const movedAnchor = moved.svg.match(/data-constraint-id="midpoint"[^>]*transform="([^"]+)"/)?.[1];
        const originalAnchor = rendered.svg.match(/data-constraint-id="midpoint"[^>]*transform="([^"]+)"/)?.[1];
        expect(movedAnchor).not.toBe(originalAnchor);
      }
      const reordered = renderSvg(withElements(createDocument("constraint-glyphs", [layer]), [sketch([...nodes].reverse(), [...edges].reverse())]), { zoom: 1, panMm: { x: 0, y: 0 } });
      expect(reordered.success).toBe(true);
      if (reordered.success) {
        expect(reordered.svg.match(/data-constraint-id=/g)).toHaveLength(rendered.svg.match(/data-constraint-id=/g)!.length);
        expect(reordered.svg).toContain('data-constraint-id="perpendicular"');
        expect(reordered.svg.match(/data-constraint-id="midpoint"[^>]*transform="([^"]+)"/)?.[1]).toBe(rendered.svg.match(/data-constraint-id="midpoint"[^>]*transform="([^"]+)"/)?.[1]);
      }
      const exported = renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } }, { mode: "export" });
      expect(exported.success && exported.svg).not.toContain("data-constraint-id");
      const hidden = { ...source, layers: [{ ...layer, visible: false }] };
      const hiddenResult = renderSvg(hidden, { zoom: 1, panMm: { x: 0, y: 0 } });
      expect(hiddenResult.success && hiddenResult.svg).not.toContain("data-constraint-id");
    }
  });
  it("renders a validated Path midpoint source without synthesizing source geometry", () => {
    const path = { type: "path" as const, id: elementId("native-path"), layerId: layer.id, nodes: [{ id: "start", anchor: { x: 0, y: 0 }, join: "corner" as const }, { id: "end", anchor: { x: 10, y: 0 }, join: "corner" as const }], segments: [{ id: "open-segment", type: "line" as const, startNodeId: "start", endNodeId: "end" }], closed: false, style };
    const dependentId = elementId("path-midpoint-dependent");
    const dependent = { type: "sketch" as const, id: dependentId, layerId: layer.id, nodes: [{ id: "mid", point: { x: 5, y: 0 } }, { id: "other", point: { x: 8, y: 2 } }], edges: [{ id: "dependent-edge", startNodeId: "mid", endNodeId: "other" }], style };
    const relation = { id: "path-midpoint", kind: "midpoint" as const, references: [{ elementId: dependentId, nodeId: "mid" }] as const, source: { kind: "path-segment" as const, elementId: path.id, segmentId: "open-segment" } };
    const source = { ...withElements(createDocument("path-midpoint-render", [layer]), [path, dependent]), schemaVersion: 11, constraints: [relation] };
    const before = structuredClone(source);

    expect(validateDocument(source).success).toBe(true);
    expect(() => renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } })).not.toThrow();
    const rendered = renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } });
    expect(rendered.success).toBe(true);
    if (rendered.success) {
      expect(rendered.renderedElementIds).toEqual([path.id, dependentId]);
      expect(rendered.svg).toContain('data-element-id="native-path"');
      expect(rendered.svg).not.toContain('data-element-id="native-path:open-segment"');
      expect(rendered.svg).not.toContain('data-constraint-id="path-midpoint"');
    }
    expect(source).toEqual(before);
  });
  it("renders a validated v12 Spline span source without synthesizing source nodes", () => {
    const spline = { type: "spline" as const, id: elementId("native-spline"), layerId: layer.id, nodes: [{ id: "start", anchor: { x: 0, y: 0 }, continuity: "smooth" as const, outHandle: { dx: 0, dy: 4 } }, { id: "end", anchor: { x: 10, y: 0 }, continuity: "smooth" as const, inHandle: { dx: 0, dy: 4 } }], closed: false, style };
    const dependentId = elementId("spline-span-dependent");
    const dependent = { type: "sketch" as const, id: dependentId, layerId: layer.id, nodes: [{ id: "mid", point: { x: 5, y: 5 } }, { id: "other", point: { x: 8, y: 2 } }], edges: [{ id: "dependent-edge", startNodeId: "mid", endNodeId: "other" }], style };
    const relation = { id: "spline-span-midpoint", kind: "midpoint" as const, references: [{ elementId: dependentId, nodeId: "mid" }] as const, source: { kind: "spline-span" as const, elementId: spline.id, startNodeId: "start", endNodeId: "end" } };
    const source = { ...withElements(createDocument("spline-span-render", [layer]), [spline, dependent]), schemaVersion: 12, constraints: [relation] };
    const before = structuredClone(source);
    expect(validateDocument(source).success).toBe(true);
    const rendered = renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } });
    expect(rendered.success).toBe(true);
    if (rendered.success) {
      expect(rendered.renderedElementIds).toEqual([spline.id, dependentId]);
      expect(rendered.svg).toContain('data-element-id="native-spline"');
      expect(rendered.svg).not.toContain('data-element-id="native-spline:start"');
      expect(rendered.svg).not.toContain('data-constraint-id="spline-span-midpoint"');
    }
    expect(source).toEqual(before);
  });
  it("renders a validated v13 Arc midpoint source without synthesizing nodes or mutating the snapshot", () => {
    const arc: ArcElement = { type: "arc", id: elementId("native-arc"), layerId: layer.id, center: { x: 0, y: 0 }, radius: 10, startAngle: 0, endAngle: Math.PI, direction: "clockwise", style };
    const dependentId = elementId("arc-midpoint-dependent");
    const dependent = { type: "sketch" as const, id: dependentId, layerId: layer.id, nodes: [{ id: "mid", point: { x: 0, y: 10 } }, { id: "other", point: { x: 8, y: 12 } }], edges: [{ id: "dependent-edge", startNodeId: "mid", endNodeId: "other" }], style };
    const relation = { id: "arc-midpoint", kind: "midpoint" as const, references: [{ elementId: dependentId, nodeId: "mid" }] as const, source: { kind: "arc" as const, elementId: arc.id } };
    const source = { ...withElements(createDocument("arc-midpoint-render", [layer]), [arc, dependent]), schemaVersion: 13, constraints: [relation] };
    const before = structuredClone(source);
    expect(validateDocument(source).success).toBe(true);
    const rendered = renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } });
    expect(rendered.success).toBe(true);
    if (rendered.success) {
      expect(rendered.renderedElementIds).toEqual([arc.id, dependentId]);
      expect(rendered.svg).toContain('data-element-id="native-arc"');
      expect(rendered.svg).not.toContain('data-element-id="native-arc:start"');
      expect(rendered.svg).not.toContain('data-constraint-id="arc-midpoint"');
    }
    expect(source).toEqual(before);
  });
  it("does not interpret a one-reference native midpoint as a sketch-edge glyph", () => {
    const dependentId = elementId("native-dependent");
    const dependent = { type: "sketch" as const, id: dependentId, layerId: layer.id, nodes: [{ id: "mid", point: { x: 5, y: 0 } }, { id: "other", point: { x: 8, y: 2 } }], edges: [{ id: "dependent-edge", startNodeId: "mid", endNodeId: "other" }], style };
    const line = { type: "line" as const, id: elementId("native-line"), layerId: layer.id, start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style };
    const relation = { id: "native-midpoint", kind: "midpoint" as const, references: [{ elementId: dependentId, nodeId: "mid" }] as const, source: { kind: "line" as const, elementId: line.id } };
    const source = { ...withElements(createDocument("native-midpoint-render", [layer]), [dependent, line]), constraints: [relation] };

    const rendered = renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } });

    expect(rendered.success).toBe(true);
    if (rendered.success) expect(rendered.svg).not.toContain('data-constraint-id="native-midpoint"');
  });
  it("renders a cross-sketch document constraint only on its first referenced sketch", () => {
    const firstId = elementId("first-sketch");
    const secondId = elementId("second-sketch");
    const first = { type: "sketch" as const, id: firstId, layerId: layer.id, nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 10, y: 0 } }], edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }], style };
    const visibleLayer = { ...layer, id: layerId("visible"), order: 1 } as const;
    const second = { type: "sketch" as const, id: secondId, layerId: visibleLayer.id, nodes: [{ id: "c", point: { x: 20, y: 0 } }, { id: "d", point: { x: 20, y: 10 } }], edges: [{ id: "cd", startNodeId: "c", endNodeId: "d" }], style };
    const constraint = { id: "cross-perpendicular", kind: "perpendicular" as const, references: [{ elementId: firstId, edgeId: "ab" }, { elementId: secondId, edgeId: "cd" }] as const };
    const source = { ...withElements(createDocument("cross-constraint", [layer, visibleLayer]), [first, second]), constraints: [constraint] };
    const rendered = renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } });
    expect(rendered.success).toBe(true);
    if (rendered.success) {
      expect(rendered.svg.match(/data-constraint-id="cross-perpendicular"/g)).toHaveLength(1);
      expect(rendered.svg).toContain('data-constraint-owner="first-sketch"');
    }
    const hiddenOwner = { ...source, layers: [{ ...layer, visible: false }, visibleLayer] };
    const hiddenResult = renderSvg(hiddenOwner, { zoom: 1, panMm: { x: 0, y: 0 } });
    expect(hiddenResult.success && hiddenResult.svg).not.toContain("cross-perpendicular");
  });

  it("renders supported primitives using mm geometry converted through the viewport", () => {
    const result = renderSvg(document(), { zoom: 2, panMm: { x: 5, y: 10 } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.svg).toContain('x="10" y="20" width="60" height="20"');
      expect(result.svg).toContain('fill="#111"');
          expect(result.svg).toContain('fill-opacity="0.22"');
          expect(result.svg).toContain('data-element-id="line"');
      expect(result.svg).toContain('cx="110" cy="30" rx="20" ry="10"');
      expect(result.svg).toContain('<circle data-element-id="circle" cx="160" cy="30" r="10"');
      expect(result.svg).toContain('x1="-10" y1="-20" x2="10" y2="-10"');
      expect(result.renderedElementIds).toEqual(["rect", "ellipse", "circle", "line"]);
    }
  });
  it("subdues construction geometry in editor mode and preserves normal geometry", () => {
    const source = withElements(createDocument("construction-editor", [layer]), [
      { type: "line", id: elementId("construction-line"), layerId: layer.id, start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, role: "construction" as const, style },
      { type: "line", id: elementId("normal-line"), layerId: layer.id, start: { x: 0, y: 10 }, end: { x: 10, y: 10 }, rotation: 0, style },
    ]);
    const result = renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.svg).toContain('data-element-id="construction-line"');
      expect(result.svg).toContain('data-element-id="construction-line" x1="0" y1="0" x2="10" y2="0" transform="translate(5 0) rotate(0) scale(1 1) translate(-5 0)" stroke="#111" stroke-width="0.2" fill="none" stroke-dasharray="6 4"');
      expect(result.svg).toContain('data-element-id="normal-line"');
      expect(result.svg).not.toContain('data-element-id="normal-line" x1="0" y1="10" x2="10" y2="10" transform="translate(5 10) rotate(0) scale(1 1) translate(-5 -10)" stroke="#111" stroke-width="0.2" fill="none" stroke-dasharray="6 4"');
    }
  });

  it("styles construction sketch edges individually in mixed-role sketches", () => {
    const source = withElements(createDocument("construction-sketch", [layer]), [{
      type: "sketch", id: elementId("mixed-sketch"), layerId: layer.id,
      nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 10, y: 0 } }, { id: "c", point: { x: 10, y: 10 } }],
      edges: [{ id: "normal-edge", startNodeId: "a", endNodeId: "b" }, { id: "construction-edge", startNodeId: "b", endNodeId: "c", role: "construction" }], style,
    }]);
    const result = renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.svg).toContain('<line data-sketch-edge="normal-edge" x1="0" y1="0" x2="10" y2="0" />');
      expect(result.svg).toContain('<line data-sketch-edge="construction-edge" x1="10" y1="0" x2="10" y2="10" stroke-dasharray="6 4" />');
    }
  });

  it("projects only fabricable geometry for export without mutating the source", () => {
    const source = withElements(createDocument("fabricable", [layer]), [
      { type: "line", id: elementId("normal-line"), layerId: layer.id, start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style },
      { type: "line", id: elementId("construction-line"), layerId: layer.id, start: { x: 0, y: 10 }, end: { x: 10, y: 10 }, rotation: 0, role: "construction" as const, style },
      { type: "sketch", id: elementId("mixed-sketch"), layerId: layer.id, nodes: [{ id: "a", point: { x: 0, y: 20 } }, { id: "b", point: { x: 10, y: 20 } }, { id: "c", point: { x: 10, y: 30 } }], edges: [{ id: "normal-edge", startNodeId: "a", endNodeId: "b" }, { id: "construction-edge", startNodeId: "b", endNodeId: "c", role: "construction" }], style },
    ]);
    const before = structuredClone(source);
    const projection = projectFabricableDocument(source);
    expect(projection.elements.map((element) => element.id)).toEqual(["normal-line", "mixed-sketch"]);
    expect((projection.elements[1] as Extract<typeof projection.elements[number], { type: "sketch" }>).edges.map((edge) => edge.id)).toEqual(["normal-edge"]);
    expect(source).toEqual(before);
    const exported = renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } }, { mode: "export" });
    expect(exported.success).toBe(true);
    if (exported.success) {
      expect(exported.renderedElementIds).toEqual(["normal-line", "mixed-sketch"]);
      expect(exported.svg).not.toContain("construction-line");
      expect(exported.svg).not.toContain("construction-edge");
    }
  });

  it("rejects invalid source geometry before removing construction geometry", () => {
    const invalidConstruction = { type: "line" as const, id: elementId("invalid-construction"), layerId: layer.id, start: { x: Number.NaN, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, role: "construction" as const, style };
    const source = withElements(createDocument("invalid-construction", [layer]), [invalidConstruction]);

    expect(() => projectFabricableDocument(source)).toThrow(FabricableDocumentProjectionError);
    try {
      projectFabricableDocument(source);
      throw new Error("Expected invalid source projection to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(FabricableDocumentProjectionError);
      expect((error as FabricableDocumentProjectionError).issues).toEqual(expect.arrayContaining([expect.stringContaining("start.x")]));
    }
  });

  it("rejects fabricable projections with references to removed construction geometry", () => {
    const construction = { type: "line" as const, id: elementId("construction-dimension-target"), layerId: layer.id, start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, role: "construction" as const, style };
    const dimension = { type: "dimension" as const, id: elementId("dependent-dimension"), layerId: layer.id, kind: "aligned" as const, references: [{ kind: "node" as const, elementId: construction.id, nodeIndex: 0, nodeId: "start" }, { kind: "node" as const, elementId: construction.id, nodeIndex: 1, nodeId: "end" }] as const, offset: { x: 0, y: 5 }, precision: 2, units: "mm" as const, rotation: 0 as const, style };
    const source = withElements(createDocument("orphan-dimension", [layer]), [construction, dimension]);
    const before = structuredClone(source);

    try {
      projectFabricableDocument(source);
      throw new Error("Expected orphaned dimension projection to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(FabricableDocumentProjectionError);
      expect((error as FabricableDocumentProjectionError).issues).toEqual(expect.arrayContaining([expect.stringContaining("references")]));
    }
    expect(renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } }, { mode: "export" })).toMatchObject({ success: false, reason: "invalid", issues: expect.arrayContaining([expect.stringContaining("references")]) });
    expect(renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } }).success).toBe(true);
    expect(source).toEqual(before);

    const sketch = { type: "sketch" as const, id: elementId("construction-edge-sketch"), layerId: layer.id, nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 10, y: 0 } }, { id: "c", point: { x: 10, y: 10 } }], edges: [{ id: "fabricable-edge", startNodeId: "a", endNodeId: "b" }, { id: "removed-edge", startNodeId: "b", endNodeId: "c", role: "construction" as const }], constraints: [{ id: "depends-on-removed-edge", kind: "horizontal" as const, references: [{ elementId: elementId("construction-edge-sketch"), edgeId: "removed-edge" }] as const }], style };
    const constrained = withElements(createDocument("orphan-edge", [layer]), [sketch]);
    const constrainedBefore = structuredClone(constrained);
    expect(() => projectFabricableDocument(constrained)).toThrow(FabricableDocumentProjectionError);
    expect(renderSvg(constrained, { zoom: 1, panMm: { x: 0, y: 0 } }, { mode: "export" })).toMatchObject({ success: false, reason: "invalid", issues: expect.arrayContaining([expect.stringContaining("references")]) });
    expect(constrained).toEqual(constrainedBefore);
  });

  it("marks sketch edges for transient hover styling without changing native line rendering", () => {
    const sketch = { type: "sketch" as const, id: elementId("hover-sketch"), layerId: layer.id, nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 20, y: 0 } }], edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }], constraints: [], style };
    const nativeLine = { type: "line" as const, id: elementId("native-hover-line"), layerId: layer.id, start: { x: 0, y: 10 }, end: { x: 20, y: 10 }, rotation: 0, style: { stroke: "#123456", strokeWidth: 0.5 } };
    const source = withElements(createDocument("sketch-edge-hover", [layer]), [sketch, nativeLine]);
    const result = renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } });
    const hovered = renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } }, { hoveredSketchEdge: { elementId: "hover-sketch", edgeId: "ab" } });

    expect(result.success).toBe(true);
    expect(hovered.success && hovered.svg).toContain('data-sketch-edge="ab" data-sketch-hovered="true"');
    if (result.success) {
      expect(result.svg).toContain('data-element-id="hover-sketch"');
      expect(result.svg).toContain('data-sketch-element="true" data-sketch-state="underdefined"');
      expect(result.svg).toContain('<line data-sketch-edge="ab" x1="0" y1="0" x2="20" y2="0" />');
      expect(result.svg).toContain('data-element-id="native-hover-line" x1="0" y1="10" x2="20" y2="10" transform=');
      expect(result.svg).toContain('data-element-id="native-hover-line" x1="0" y1="10" x2="20" y2="10" transform="translate(10 10) rotate(0) scale(1 1) translate(-10 -10)" stroke="#123456" stroke-width="0.5"');
    }
  });

  it("renders sketch definition state through the shared constraint boundary", () => {
    const underdefined = { type: "sketch" as const, id: elementId("underdefined"), layerId: layer.id, nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 20, y: 0 } }], edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }], constraints: [], style };
    const defined = { ...underdefined, id: elementId("defined"), nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 20, y: 0 } }], constraints: [{ id: "fixed-a", kind: "fixed" as const, references: [{ elementId: elementId("defined"), nodeId: "a" }] as const }, { id: "horizontal", kind: "horizontal" as const, references: [{ elementId: elementId("defined"), nodeId: "a" }, { elementId: elementId("defined"), nodeId: "b" }] as const }, { id: "length", kind: "distance-horizontal" as const, references: [{ elementId: elementId("defined"), nodeId: "a" }, { elementId: elementId("defined"), nodeId: "b" }] as const, value: 20 }] };
    const source = withElements(createDocument("constraint-colors", [layer]), [underdefined, defined]);
    const result = renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } });
    const hoveredDefined = renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } }, { hoveredSketchEdge: { elementId: "defined", edgeId: "ab" } });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.svg).toContain('data-element-id="underdefined" stroke="#2563eb"');
      expect(result.svg).toContain('data-element-id="defined" stroke="#111827"');
      expect(result.svg).toContain('data-sketch-element="true" data-sketch-state="fully-defined"');
      expect(hoveredDefined.success && hoveredDefined.svg).not.toContain('data-sketch-edge="ab" data-sketch-hovered="true"');
    }
  });
  it("colors a sketch by the highest-precedence state across disconnected components", () => {
    const source = {
      type: "sketch" as const,
      id: elementId("aggregate-state"),
      layerId: layer.id,
      nodes: [
        { id: "defined-a", point: { x: 0, y: 0 } }, { id: "defined-b", point: { x: 10, y: 0 } },
        { id: "underdefined-a", point: { x: 20, y: 0 } }, { id: "underdefined-b", point: { x: 30, y: 0 } },
        { id: "overdefined-a", point: { x: 40, y: 0 } }, { id: "overdefined-b", point: { x: 50, y: 0 } },
        { id: "conflict-a", point: { x: 60, y: 0 } }, { id: "conflict-b", point: { x: 70, y: 0 } },
      ],
      edges: [{ id: "visible", startNodeId: "defined-a", endNodeId: "defined-b" }],
      constraints: [
        { id: "fixed-defined", kind: "fixed" as const, references: [{ elementId: elementId("aggregate-state"), nodeId: "defined-a" }] as const },
        { id: "join-defined", kind: "coincident" as const, references: [{ elementId: elementId("aggregate-state"), nodeId: "defined-a" }, { elementId: elementId("aggregate-state"), nodeId: "defined-b" }] as const },
        ],
      style,
    };
    const base = withElements(createDocument("aggregate-state", [layer]), [source]);
    const document = { ...base, constraints: [
      { id: "conflict-10", kind: "distance-horizontal" as const, value: 10, references: [{ elementId: source.id, nodeId: "conflict-a" }, { elementId: source.id, nodeId: "conflict-b" }] },
      { id: "conflict-20", kind: "distance-horizontal" as const, value: 20, references: [{ elementId: source.id, nodeId: "conflict-a" }, { elementId: source.id, nodeId: "conflict-b" }] },
      { id: "over-1", kind: "horizontal" as const, references: [{ elementId: source.id, nodeId: "overdefined-a" }, { elementId: source.id, nodeId: "overdefined-b" }] },
      { id: "over-2", kind: "horizontal" as const, references: [{ elementId: source.id, nodeId: "overdefined-a" }, { elementId: source.id, nodeId: "overdefined-b" }] },
    ] };
    const result = renderSvg(document, { zoom: 1, panMm: { x: 0, y: 0 } });

    expect(result.success).toBe(true);
    if (result.success) expect(result.svg).toContain('data-element-id="aggregate-state" stroke="#ef4444"');

    const renderWith = (localIds: readonly string[], globalIds: readonly string[], expectedStroke: string) => {
      const variant = {
        ...base,
        elements: [{ ...source, constraints: source.constraints?.filter((constraint) => localIds.includes(constraint.id)) }],
        constraints: document.constraints.filter((constraint) => globalIds.includes(constraint.id)),
      };
      const rendered = renderSvg(variant, { zoom: 1, panMm: { x: 0, y: 0 } }, { hoveredSketchEdge: { elementId: "aggregate-state", edgeId: "visible" } });
      expect(rendered.success && rendered.svg).toContain(`data-element-id="aggregate-state" stroke="${expectedStroke}"`);
      expect(rendered.success && rendered.svg).toContain(`data-sketch-state="${expectedStroke === "#ef4444" ? "conflict" : expectedStroke === "#f59e0b" ? "overdefined" : "underdefined"}"`);
      if (expectedStroke === "#2563eb") expect(rendered.success && rendered.svg).toContain('data-sketch-edge="visible" data-sketch-hovered="true"');
      else expect(rendered.success && rendered.svg).not.toContain('data-sketch-edge="visible" data-sketch-hovered="true"');
    };
    renderWith(["fixed-defined", "join-defined"], ["conflict-10", "conflict-20", "over-1", "over-2"], "#ef4444");
    renderWith(["fixed-defined", "join-defined"], ["over-1", "over-2"], "#f59e0b");
    renderWith(["fixed-defined", "join-defined"], [], "#2563eb");
  });

  it("keeps editor diagnostic colors out of export rendering", () => {
    const underdefined = { type: "sketch" as const, id: elementId("export-sketch"), layerId: layer.id, nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 20, y: 0 } }], edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }], constraints: [], style };
    const document = withElements(createDocument("export-constraint-colors", [layer]), [underdefined]);

    const editor = renderSvg(document, { zoom: 1, panMm: { x: 0, y: 0 } });
    const exported = renderSvg(document, { zoom: 1, panMm: { x: 0, y: 0 } }, { mode: "export" });

    expect(editor.success && editor.svg).toContain('data-element-id="export-sketch" stroke="#2563eb"');
    expect(exported.success && exported.svg).toContain('data-element-id="export-sketch" stroke="#111"');
    expect(exported.success && exported.svg).not.toContain('stroke="#2563eb"');
  });
  it("keeps invalid and conflict diagnostics red when their sketch edges are hovered", () => {
    const sketch = { type: "sketch" as const, id: elementId("hover-diagnostic-sketch"), layerId: layer.id, nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 20, y: 0 } }], edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }], style };
    const invalid = { ...sketch, constraints: [{ id: "unsupported-horizontal", kind: "horizontal" as const, references: [{ elementId: sketch.id, nodeId: "a" }, { elementId: sketch.id, nodeId: "b" }] as const, value: 10 }] };
    const conflictBase = withElements(createDocument("hover-diagnostic-conflict", [layer]), [sketch]);
    const conflict = { ...conflictBase, constraints: [
      { id: "distance-10", kind: "distance-horizontal" as const, value: 10, references: [{ elementId: sketch.id, nodeId: "a" }, { elementId: sketch.id, nodeId: "b" }] as const },
      { id: "distance-20", kind: "distance-horizontal" as const, value: 20, references: [{ elementId: sketch.id, nodeId: "a" }, { elementId: sketch.id, nodeId: "b" }] as const },
    ] };
    const hover = { hoveredSketchEdge: { elementId: sketch.id, edgeId: "ab" } };

    for (const [source, state] of [[withElements(createDocument("hover-diagnostic-invalid", [layer]), [invalid]), "invalid"], [conflict, "conflict"]] as const) {
      const result = renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } }, hover);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.svg).toContain(`data-sketch-state="${state}"`);
        expect(result.svg).toContain('stroke="#ef4444"');
        expect(result.svg).not.toContain('data-sketch-edge="ab" data-sketch-hovered="true"');
      }
    }
  });
  it("renders global constraint conflicts for every involved sketch", () => {
    const first = { type: "sketch" as const, id: elementId("global-state-first"), layerId: layer.id, nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 20, y: 0 } }], edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }], style };
    const second = { ...first, id: elementId("global-state-second"), nodes: [{ id: "c", point: { x: 0, y: 10 } }, { id: "d", point: { x: 20, y: 10 } }], edges: [{ id: "cd", startNodeId: "c", endNodeId: "d" }] };
    const document = { ...withElements(createDocument("global-constraint-colors", [layer]), [first, second]), constraints: [{ id: "global-horizontal", kind: "horizontal" as const, references: [{ elementId: first.id, nodeId: "a" }, { elementId: second.id, nodeId: "c" }] as const }] };

    const result = renderSvg(document, { zoom: 1, panMm: { x: 0, y: 0 } });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.svg).toContain('data-element-id="global-state-first" stroke="#ef4444"');
      expect(result.svg).toContain('data-element-id="global-state-second" stroke="#ef4444"');
    }
  });
  it("renders radius dimensions for canonical circles with an R prefix", () => {
    const circle = { type: "circle" as const, id: elementId("circle"), layerId: layer.id, center: { x: 20, y: 20 }, radius: 10, style };
    const radius = { type: "dimension" as const, id: elementId("radius"), layerId: layer.id, kind: "radius" as const, references: [{ kind: "node" as const, elementId: circle.id, nodeIndex: 0, nodeId: "center" }, { kind: "node" as const, elementId: circle.id, nodeIndex: 2, nodeId: "e" }] as const, offset: { x: 8, y: 0 }, precision: 2, units: "mm" as const, rotation: 0 as const, style };
    const result = renderSvg(withElements(createDocument("radius", [layer]), [circle, radius]), { zoom: 1, panMm: { x: 0, y: 0 } });
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
    expect(renderSvg(document(), { zoom: 1, panMm: { x: 0, y: 0 } }, null)).toMatchObject({ success: false, reason: "invalid" });
    expect(renderSvg(document(), { zoom: 1, panMm: { x: 0, y: 0 } }, [])).toMatchObject({ success: false, reason: "invalid" });
    expect(renderSvg(document(), { zoom: 1, panMm: { x: 0, y: 0 } }, { mode: "other" })).toMatchObject({ success: false, reason: "invalid" });
    expect(renderSvg(document(), { zoom: 1, panMm: { x: 0, y: 0 } }, { extra: true })).toMatchObject({ success: false, reason: "invalid" });
    expect(renderSvg(document(), { zoom: 1, panMm: { x: 0, y: 0 } }, { [Symbol("extra")]: true })).toMatchObject({ success: false, reason: "invalid" });
    expect(renderSvg(document(), { zoom: 1, panMm: { x: 0, y: 0 } }, Object.defineProperty({}, "mode", { get: () => { throw new Error("unreadable"); } }))).toMatchObject({ success: false, reason: "invalid" });
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
    const source = withElements(createDocument("path", [layer]), [{ type: "path", id: elementId("path"), layerId: layer.id, nodes: [{ id: "a", anchor: { x: 0, y: 0 }, join: "corner" }, { id: "b", anchor: { x: 10, y: 0 }, join: "smooth" }, { id: "c", anchor: { x: 20, y: 0 }, join: "corner" }], segments: [{ id: "fixture-segment-1", type: "line", startNodeId: "a", endNodeId: "b" }, { id: "fixture-segment-2", type: "cubicBezier", startNodeId: "b", endNodeId: "c", control1: { x: 12, y: 5 }, control2: { x: 18, y: 5 } }], closed: false, style }]);
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

  it("renders canonical arcs as exact open SVG arcs in both directions", () => {
    const arcs = [
      { type: "arc", id: elementId("arc-cw"), layerId: layer.id, center: { x: 20, y: 20 }, radius: 10, startAngle: 0, endAngle: Math.PI / 2, direction: "clockwise", style: { stroke: "#123", fill: "#f00", strokeWidth: 0.5 } },
      { type: "arc", id: elementId("arc-ccw"), layerId: layer.id, center: { x: 50, y: 20 }, radius: 10, startAngle: 0, endAngle: Math.PI / 2, direction: "counterclockwise", style },
    ] as const;
    const source = withElements(createDocument("arcs", [layer]), arcs);
    const result = renderSvg(source, { zoom: 2, panMm: { x: 5, y: 10 } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.svg).toContain('data-element-id="arc-cw" d="M50 20 A 20 20 0 0 1 30 40"');
      expect(result.svg).toContain('data-element-id="arc-ccw" d="M110 20 A 20 20 0 1 0 90 40"');
      expect(result.svg).toContain('data-element-id="arc-cw" d="M50 20 A 20 20 0 0 1 30 40" stroke="#123" stroke-width="0.5" fill="none"');
    }
  });

  it("normalizes arc seam direction and emits the large-arc flag without mutating patterned sources", () => {
    const arc: ArcElement = { type: "arc", id: elementId("arc-seam"), layerId: layer.id, center: { x: 20, y: 20 }, radius: 10, startAngle: (350 * Math.PI) / 180, endAngle: (10 * Math.PI) / 180, direction: "counterclockwise" as const, style: { stroke: "#123", fill: "url(#pattern)", strokeWidth: 0.5 } };
    const source = withElements(createDocument("arc-seam", [layer]), [arc]);
    const before = structuredClone(source);
    const result = renderSvg(source, { zoom: 1, panMm: { x: 0, y: 0 } });
    expect(result.success).toBe(true);
    if (result.success) expect(result.svg).toContain('d="M29.848078 18.263518 A 10 10 0 1 0 29.848078 21.736482"');
    expect(result.success && result.svg).toContain('fill="none"');
    expect(source).toEqual(before);
  });

  it("renders canonical full-circle profiles with native arc commands", () => {
        const circle = { type: "circle" as const, id: elementId("profile-circle"), layerId: layer.id, center: { x: 20, y: 20 }, radius: 10, style };
        const profile = buildSketchProfile({ elements: [circle] });
        expect(profile.status).toBe("valid-closed");
        const result = renderSketchProfileSvg(profile, { zoom: 2, panMm: { x: 5, y: 10 } }, { width: 120, height: 90 });
        const repeated = renderSketchProfileSvg(profile, { zoom: 2, panMm: { x: 5, y: 10 } }, { width: 120, height: 90 });
        expect(result.success).toBe(true);
        expect(repeated).toEqual(result);
        if (result.success) {
          expect(result.svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" data-units="mm" width="120" height="90" viewBox="0 0 120 90">');
          expect(result.svg).toContain('M50 20 A 20 20');
          expect(result.svg.match(/ A /g)).toHaveLength(2);
          expect(result.svg).toContain('fill-rule="evenodd"');
        }
      });

      it("renders canonical region holes from parametric fragments and preserves classification", () => {
        const outer = { type: "circle" as const, id: elementId("profile-outer"), layerId: layer.id, center: { x: 20, y: 20 }, radius: 10, style };
        const inner = { type: "circle" as const, id: elementId("profile-hole"), layerId: layer.id, center: { x: 20, y: 20 }, radius: 4, style };
        const profile = buildSketchProfile({ elements: [outer, inner] });
        expect(profile.status).toBe("valid-closed");
        expect(profile.regions).toHaveLength(1);
        expect(profile.regions[0]?.holes).toHaveLength(1);
        const result = renderSketchProfileSvg(profile, { zoom: 1, panMm: { x: 0, y: 0 } }, { fill: "#123<&", width: 120, height: 90 });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.svg.match(/ A /g)).toHaveLength(4);
          expect(result.svg).toContain('fill="#123&lt;&amp;"');
          expect(result.svg).toContain('fill-rule="evenodd"');
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
