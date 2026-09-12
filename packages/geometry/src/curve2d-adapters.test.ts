import { describe, expect, it } from "vitest";
import { elementId, layerId, type ArcElement, type CircleElement, type EllipseElement, type PathElement, type RectangleElement, type SketchElement, type SplineElement } from "@nodra/domain";
import { arcElementToCurve, circleElementToCurve, deriveCurvePieces, elementToContour, elementToCurves, ellipseElementToCurve, lineElementToCurve, pathSegmentToCurve, rectangleElementToCurves, rotatedLineEndpoints, sketchEdgeToCurve, splineSpanToCurve } from "./index.js";

const style = { stroke: "#000", strokeWidth: 1 };
const layer = layerId("layer");
const line = (rotation = 0) => ({ type: "line" as const, id: elementId("line"), layerId: layer, start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation, style });

const sketch: SketchElement = {
  type: "sketch", id: elementId("sketch"), layerId: layer,
  nodes: [{ id: "a", point: { x: 1, y: 2 } }, { id: "b", point: { x: 3, y: 4 } }, { id: "c", point: { x: 8, y: 9 } }],
  edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }, { id: "bc", startNodeId: "b", endNodeId: "c" }], style,
};
const path: PathElement = {
  type: "path", id: elementId("path"), layerId: layer,
  nodes: [{ id: "a", anchor: { x: 0, y: 0 }, join: "corner" }, { id: "b", anchor: { x: 10, y: 0 }, join: "smooth" }, { id: "c", anchor: { x: 20, y: 5 }, join: "corner" }],
  segments: [{ id: "ab", type: "line", startNodeId: "a", endNodeId: "b" }, { id: "bc", type: "cubicBezier", startNodeId: "b", endNodeId: "c", control1: { x: 12, y: 3 }, control2: { x: 18, y: 7 } }],
  closed: false, style,
};
const spline: SplineElement = {
  type: "spline", id: elementId("spline"), layerId: layer,
  nodes: [{ id: "a", anchor: { x: 0, y: 0 }, outHandle: { dx: 2, dy: 1 }, continuity: "corner" }, { id: "b", anchor: { x: 10, y: 0 }, inHandle: { dx: -2, dy: 1 }, continuity: "smooth" }, { id: "c", anchor: { x: 20, y: 5 }, continuity: "corner" }],
  closed: false, style,
};

describe("Curve2D source adapters", () => {
  it("uses the canonical visible LineElement rotation and stable provenance", () => {
    const element = line(Math.PI / 2);
    const sourced = lineElementToCurve(element);
    expect(sourced.source).toEqual({ kind: "line-element", elementId: element.id });
    expect(sourced.sourceIndex).toBe(0);
    expect(sourced.curve.start.x).toBeCloseTo(5); expect(sourced.curve.start.y).toBeCloseTo(-5);
    expect(sourced.curve.end.x).toBeCloseTo(5); expect(sourced.curve.end.y).toBeCloseTo(5);
    expect(rotatedLineEndpoints(element)).toEqual([sourced.curve.start, sourced.curve.end]);
    const flipped = { ...line(), flipX: true };
    expect(lineElementToCurve(flipped).curve).toEqual({ type: "line", start: { x: 10, y: 0 }, end: { x: 0, y: 0 } });
    expect(elementToContour(flipped).contours[0]!.points).toEqual([{ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }]);
    const diagonal = { ...line(Math.PI / 2), start: { x: 0, y: 0 }, end: { x: 4, y: 2 } };
    const diagonalCurve = lineElementToCurve(diagonal).curve;
    expect(diagonalCurve.start.x).toBeCloseTo(3); expect(diagonalCurve.start.y).toBeCloseTo(-1);
    expect(diagonalCurve.end.x).toBeCloseTo(1); expect(diagonalCurve.end.y).toBeCloseTo(3);
  });

  it("resolves sketch geometry by stable IDs while retaining source order as metadata", () => {
    const sourced = sketchEdgeToCurve(sketch, "bc");
    expect(sourced.curve).toEqual({ type: "line", start: { x: 3, y: 4 }, end: { x: 8, y: 9 } });
    expect(sourced.source).toEqual({ kind: "sketch-edge", elementId: sketch.id, edgeId: "bc", startNodeId: "b", endNodeId: "c" });
    expect(sourced.sourceIndex).toBe(1);
    expect(elementToCurves(sketch).map(({ sourceIndex }) => sourceIndex)).toEqual([0, 1]);
    const reordered = { ...sketch, edges: [sketch.edges[1]!, sketch.edges[0]!] };
    expect(sketchEdgeToCurve(reordered, "bc").source).toEqual(sourced.source);
    expect(sketchEdgeToCurve(reordered, "bc").sourceIndex).toBe(0);
  });

  it("rejects missing and duplicate sketch topology instead of silently dropping it", () => {
    expect(() => sketchEdgeToCurve(sketch, "missing")).toThrow("was not found");
    expect(() => sketchEdgeToCurve({ ...sketch, nodes: sketch.nodes.slice(0, 2) }, "bc")).toThrow("references an unknown node");
    expect(() => sketchEdgeToCurve({ ...sketch, nodes: [...sketch.nodes, sketch.nodes[0]!] }, "ab")).toThrow("duplicate IDs");
    expect(() => sketchEdgeToCurve({ ...sketch, edges: [...sketch.edges, sketch.edges[0]!] }, "ab")).toThrow("duplicate IDs");
  });

  it("adapts line and cubic PathSegments exactly without flattening", () => {
    expect(pathSegmentToCurve(path, "ab")).toEqual({
      curve: { type: "line", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      source: { kind: "path-segment", elementId: path.id, segmentId: "ab", startNodeId: "a", endNodeId: "b" }, sourceIndex: 0,
    });
    expect(pathSegmentToCurve(path, "bc")).toEqual({
      curve: { type: "cubicBezier", p0: { x: 10, y: 0 }, p1: { x: 12, y: 3 }, p2: { x: 18, y: 7 }, p3: { x: 20, y: 5 } },
      source: { kind: "path-segment", elementId: path.id, segmentId: "bc", startNodeId: "b", endNodeId: "c" }, sourceIndex: 1,
    });
    expect(elementToCurves(path).map(({ sourceIndex }) => sourceIndex)).toEqual([0, 1]);
    const closed: PathElement = { ...path, closed: true, segments: [...path.segments, { id: "ca", type: "line", startNodeId: "c", endNodeId: "a" }] };
    expect(elementToCurves(closed)).toHaveLength(3);
    const bcSource = pathSegmentToCurve(closed, "bc").source;
    const reordered: PathElement = { ...closed, nodes: [closed.nodes[1]!, closed.nodes[2]!, closed.nodes[0]!], segments: [closed.segments[1]!, closed.segments[2]!, closed.segments[0]!] };
    expect(pathSegmentToCurve(reordered, "bc").source).toEqual(bcSource);
    expect(pathSegmentToCurve(reordered, "bc").sourceIndex).toBe(0);
  });

  it("rejects malformed path topology and non-finite controls", () => {
    expect(() => pathSegmentToCurve(path, "missing")).toThrow("was not found");
    expect(() => pathSegmentToCurve({ ...path, nodes: path.nodes.slice(0, 2) }, "bc")).toThrow("does not match topology");
    expect(() => pathSegmentToCurve({ ...path, segments: [path.segments[1]!, path.segments[0]!] }, "bc")).toThrow("must follow node order");
    expect(() => pathSegmentToCurve({ ...path, nodes: [...path.nodes, path.nodes[0]!] }, "ab")).toThrow("duplicate IDs");
    const cubic = path.segments[1]!;
    if (cubic.type !== "cubicBezier") throw new Error("Expected cubic fixture");
    expect(() => pathSegmentToCurve({ ...path, segments: [path.segments[0]!, { ...cubic, control1: { x: Number.NaN, y: 0 } }] }, "bc")).toThrow("must be finite");
  });

  it("maps Spline handle offsets and preserves open and closed span identity", () => {
    expect(splineSpanToCurve(spline, 0)).toEqual({
      curve: { type: "cubicBezier", p0: { x: 0, y: 0 }, p1: { x: 2, y: 1 }, p2: { x: 8, y: 1 }, p3: { x: 10, y: 0 } },
      source: { kind: "spline-span", elementId: spline.id, startNodeId: "a", endNodeId: "b" }, sourceIndex: 0,
    });
    expect(splineSpanToCurve(spline, 1).curve).toEqual({ type: "cubicBezier", p0: { x: 10, y: 0 }, p1: { x: 10, y: 0 }, p2: { x: 20, y: 5 }, p3: { x: 20, y: 5 } });
    expect(elementToCurves(spline)).toHaveLength(2);
    const closed = { ...spline, closed: true };
    expect(splineSpanToCurve(closed, 2)).toMatchObject({ curve: { p0: { x: 20, y: 5 }, p3: { x: 0, y: 0 } }, source: { startNodeId: "c", endNodeId: "a" }, sourceIndex: 2 });
    expect(elementToCurves(closed)).toHaveLength(3);
  });

  it("rejects invalid Spline spans and duplicate node identity", () => {
    expect(() => splineSpanToCurve(spline, -1)).toThrow("non-negative integer");
    expect(() => splineSpanToCurve(spline, 0.5)).toThrow("non-negative integer");
    expect(() => splineSpanToCurve(spline, 2)).toThrow("out of range");
    expect(() => splineSpanToCurve({ ...spline, nodes: [...spline.nodes, spline.nodes[0]!] }, 0)).toThrow("duplicate IDs");
    expect(elementToCurves({ ...spline, nodes: [], closed: true })).toEqual([]);
  });

  it("adapts canonical CircleElements with stable provenance", () => {
    const circle: CircleElement = { type: "circle", id: elementId("circle"), layerId: layer, center: { x: 5, y: 7 }, radius: 3, style };
    expect(circleElementToCurve(circle)).toEqual({ curve: { type: "circle", center: { x: 5, y: 7 }, radius: 3 }, source: { kind: "circle-element", elementId: circle.id }, sourceIndex: 0 });
    expect(elementToCurves(circle)).toEqual([circleElementToCurve(circle)]);
    expect(() => circleElementToCurve({ ...circle, radius: Number.NaN })).toThrow("finite and positive");
    expect(() => circleElementToCurve({ ...circle, radius: 0 })).toThrow("finite and positive");
  });

  it("adapts canonical ArcElements exactly with stable provenance", () => {
    const arc: ArcElement = { type: "arc", id: elementId("arc"), layerId: layer, center: { x: 5, y: 7 }, radius: 3, startAngle: 0, endAngle: Math.PI / 2, direction: "clockwise", style };
    expect(arcElementToCurve(arc)).toEqual({ curve: { type: "arc", center: { x: 5, y: 7 }, radius: 3, startAngle: 0, endAngle: Math.PI / 2, direction: "clockwise" }, source: { kind: "arc-element", elementId: arc.id }, sourceIndex: 0 });
    expect(elementToCurves(arc)).toEqual([arcElementToCurve(arc)]);
    expect(() => arcElementToCurve({ ...arc, endAngle: 0 })).toThrow("canonical partial sweep");
    expect(() => arcElementToCurve({ ...arc, startAngle: Math.PI * 2 })).toThrow("canonical partial sweep");
  });

  it("keeps legacy oval EllipseElements unsupported by the circle adapter", () => {
    const ellipse: EllipseElement = { type: "ellipse", id: elementId("oval"), layerId: layer, position: { x: 2, y: 4 }, size: { width: 6, height: 5 }, rotation: 1, style };
    expect(ellipseElementToCurve(ellipse)).toBeUndefined();
    expect(elementToCurves(ellipse)).toEqual([]);
    expect(() => ellipseElementToCurve({ ...ellipse, size: { width: Number.NaN, height: 5 } })).toThrow("finite and positive");
  });

  it("adapts sharp RectangleElements as four exact stable line edges", () => {
    const rectangle: RectangleElement = { type: "rectangle", id: elementId("rectangle"), layerId: layer, position: { x: 0, y: 0 }, size: { width: 6, height: 4 }, cornerRadius: 0, rotation: 0, style };
    expect(rectangleElementToCurves(rectangle)).toEqual([
      { curve: { type: "line", start: { x: 0, y: 0 }, end: { x: 6, y: 0 } }, source: { kind: "rectangle-edge", elementId: rectangle.id, edge: "top" }, sourceIndex: 0 },
      { curve: { type: "line", start: { x: 6, y: 0 }, end: { x: 6, y: 4 } }, source: { kind: "rectangle-edge", elementId: rectangle.id, edge: "right" }, sourceIndex: 1 },
      { curve: { type: "line", start: { x: 6, y: 4 }, end: { x: 0, y: 4 } }, source: { kind: "rectangle-edge", elementId: rectangle.id, edge: "bottom" }, sourceIndex: 2 },
      { curve: { type: "line", start: { x: 0, y: 4 }, end: { x: 0, y: 0 } }, source: { kind: "rectangle-edge", elementId: rectangle.id, edge: "left" }, sourceIndex: 3 },
    ]);
    expect(elementToCurves(rectangle)).toEqual(rectangleElementToCurves(rectangle));
    expect(rectangleElementToCurves({ ...rectangle, flipX: true, flipY: true })).toEqual(rectangleElementToCurves(rectangle));
    expect(elementToCurves({ ...rectangle, cornerRadius: 1 })).toEqual([]);
    expect(elementToCurves({ ...rectangle, cornerRadii: { topLeft: 0, topRight: 0, bottomRight: 1, bottomLeft: 0 } })).toEqual([]);
    const rotated = rectangleElementToCurves({ ...rectangle, rotation: Math.PI / 2 });
    expect(rotated[0]?.curve.type).toBe("line");
    if (rotated[0]?.curve.type !== "line") throw new Error("Expected a line edge");
    expect(rotated[0].curve.start.x).toBeCloseTo(5); expect(rotated[0].curve.start.y).toBeCloseTo(-1);
    expect(rotated[0].curve.end.x).toBeCloseTo(5); expect(rotated[0].curve.end.y).toBeCloseTo(5);
    expect(() => rectangleElementToCurves({ ...rectangle, size: { width: 0, height: 4 } })).toThrow("finite and positive");
  });

  it("derives deterministic full-domain native pieces with stable identity and orientation", () => {
        const linePiece = deriveCurvePieces([lineElementToCurve(line())])[0]!;
        const circleElement: CircleElement = { type: "circle", id: elementId("piece-circle"), layerId: layer, center: { x: 0, y: 0 }, radius: 4, style };
        const arcElement: ArcElement = { type: "arc", id: elementId("piece-arc"), layerId: layer, center: { x: 0, y: 0 }, radius: 4, startAngle: 0, endAngle: Math.PI / 2, direction: "clockwise", style };
        const circlePiece = deriveCurvePieces([circleElementToCurve(circleElement)])[0]!;
        const arcPiece = deriveCurvePieces([arcElementToCurve(arcElement)])[0]!;
        const cubicPiece = deriveCurvePieces([pathSegmentToCurve(path, "bc")])[0]!;
        expect(linePiece).toMatchObject({ sourceInterval: { t0: 0, t1: 1 }, orientation: "forward" });
        expect(circlePiece).toMatchObject({ curve: { type: "circle" }, source: { elementId: circleElement.id } });
        expect(arcPiece).toMatchObject({ curve: { type: "arc" }, source: { elementId: arcElement.id } });
        expect(cubicPiece).toMatchObject({ curve: { type: "cubicBezier" }, endpointIdentity: { startNodeId: "b", endNodeId: "c" } });
        expect(deriveCurvePieces([pathSegmentToCurve(path, "bc")])).toEqual([cubicPiece]);
      });

      it("rejects invalid sourced piece metadata and keeps unsupported adapters conservative", () => {
        const sourced = lineElementToCurve(line());
        expect(() => deriveCurvePieces([{ ...sourced, sourceIndex: -1 }])).toThrow("source index");
        const ellipse: EllipseElement = { type: "ellipse", id: elementId("piece-oval"), layerId: layer, position: { x: 2, y: 4 }, size: { width: 6, height: 5 }, rotation: 1, style };
        expect(elementToCurves(ellipse)).toEqual([]);
      });

      it("keeps unsupported elements empty and never mutates source entities", () => {
    const rounded: RectangleElement = { type: "rectangle", id: elementId("rounded"), layerId: layer, position: { x: 0, y: 0 }, size: { width: 5, height: 4 }, cornerRadius: 1, rotation: 0, style };
    expect(elementToCurves(rounded)).toEqual([]);
    const before = JSON.stringify([line(), sketch, path, spline, rounded]);
    elementToCurves(line()); elementToCurves(sketch); elementToCurves(path); elementToCurves(spline); elementToCurves(rounded);
    expect(JSON.stringify([line(), sketch, path, spline, rounded])).toBe(before);
  });

  it("rejects numeric overflow while projecting source geometry", () => {
    expect(() => lineElementToCurve({ ...line(Math.PI / 2), start: { x: 1.7e308, y: -1e308 }, end: { x: 1.7e308, y: 1e308 } })).toThrow("numeric range");
    expect(() => splineSpanToCurve({ ...spline, nodes: [{ ...spline.nodes[0]!, anchor: { x: Number.MAX_VALUE, y: 0 }, outHandle: { dx: Number.MAX_VALUE, dy: 0 } }, spline.nodes[1]!] }, 0)).toThrow("numeric range");
  });
});
