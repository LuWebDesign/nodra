import type { Element, ElementId, EllipseElement, LineElement, PathElement, PointMm, SketchElement, SplineElement } from "@nodra/domain";
import type { CircleCurve2D, CubicBezierCurve2D, Curve2D, LineCurve2D } from "./curve2d.js";

export type Curve2DSource =
  | { readonly kind: "line-element"; readonly elementId: ElementId }
  | { readonly kind: "sketch-edge"; readonly elementId: ElementId; readonly edgeId: string; readonly startNodeId: string; readonly endNodeId: string }
  | { readonly kind: "path-segment"; readonly elementId: ElementId; readonly segmentId: string; readonly startNodeId: string; readonly endNodeId: string }
  | { readonly kind: "spline-span"; readonly elementId: ElementId; readonly startNodeId: string; readonly endNodeId: string }
  | { readonly kind: "ellipse-element"; readonly elementId: ElementId };

export interface SourcedCurve2D<TCurve extends Curve2D = Curve2D> {
  readonly curve: TCurve;
  readonly source: Curve2DSource;
  /** Transient source-array position; never use as persistent identity. */
  readonly sourceIndex: number;
}

function finitePoint(point: PointMm, label: string): PointMm {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error(`${label} coordinates must be finite`);
  return { x: point.x, y: point.y };
}

function checkedPoint(point: PointMm): PointMm {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error("Curve adapter calculation exceeds the numeric range");
  return { x: point.x === 0 ? 0 : point.x, y: point.y === 0 ? 0 : point.y };
}

function assertUniqueIds(values: readonly { readonly id: string }[], label: string): void {
  if (new Set(values.map(({ id }) => id)).size !== values.length) throw new Error(`${label} contains duplicate IDs`);
}

function rotateAround(point: PointMm, center: PointMm, angle: number, flipX: boolean, flipY: boolean): PointMm {
  if (!Number.isFinite(angle)) throw new Error("Line rotation must be finite");
  const x = (point.x - center.x) * (flipX ? -1 : 1); const y = (point.y - center.y) * (flipY ? -1 : 1);
  return checkedPoint({ x: center.x + x * Math.cos(angle) - y * Math.sin(angle), y: center.y + x * Math.sin(angle) + y * Math.cos(angle) });
}

/** Adapts the visible line after applying its document-space rotation around its midpoint. */
export function lineElementToCurve(element: LineElement): SourcedCurve2D<LineCurve2D> {
  const start = finitePoint(element.start, "Line start"); const end = finitePoint(element.end, "Line end");
  const center = checkedPoint({ x: start.x / 2 + end.x / 2, y: start.y / 2 + end.y / 2 });
  return {
    curve: { type: "line", start: rotateAround(start, center, element.rotation, element.flipX === true, element.flipY === true), end: rotateAround(end, center, element.rotation, element.flipX === true, element.flipY === true) },
    source: { kind: "line-element", elementId: element.id }, sourceIndex: 0,
  };
}

/** Resolves a sketch edge by stable ID; array position is provenance metadata only. */
export function sketchEdgeToCurve(sketch: SketchElement, edgeId: string): SourcedCurve2D<LineCurve2D> {
  assertUniqueIds(sketch.edges, "Sketch edges"); assertUniqueIds(sketch.nodes, "Sketch nodes");
  const edgeIndex = sketch.edges.findIndex((edge) => edge.id === edgeId);
  if (edgeIndex < 0) throw new Error(`Sketch edge '${edgeId}' was not found`);
  const edge = sketch.edges[edgeIndex]!;
  const start = sketch.nodes.find((node) => node.id === edge.startNodeId); const end = sketch.nodes.find((node) => node.id === edge.endNodeId);
  if (!start || !end) throw new Error(`Sketch edge '${edge.id}' references an unknown node`);
  return {
    curve: { type: "line", start: finitePoint(start.point, "Sketch start"), end: finitePoint(end.point, "Sketch end") },
    source: { kind: "sketch-edge", elementId: sketch.id, edgeId: edge.id, startNodeId: edge.startNodeId, endNodeId: edge.endNodeId }, sourceIndex: edgeIndex,
  };
}

function assertPathTopology(path: PathElement): void {
  assertUniqueIds(path.segments, "Path segments"); assertUniqueIds(path.nodes, "Path nodes");
  const expectedCount = path.closed ? path.nodes.length : Math.max(0, path.nodes.length - 1);
  if (path.segments.length !== expectedCount) throw new Error("Path segment count does not match topology");
  path.segments.forEach((segment, index) => {
    const start = path.nodes[index]; const end = path.nodes[path.closed ? (index + 1) % path.nodes.length : index + 1];
    if (!start || !end || segment.startNodeId !== start.id || segment.endNodeId !== end.id) throw new Error("Path segments must follow node order");
  });
}

/** Resolves a native path segment by stable ID without flattening cubic geometry. */
export function pathSegmentToCurve(path: PathElement, segmentId: string): SourcedCurve2D<LineCurve2D | CubicBezierCurve2D> {
  assertPathTopology(path);
  const segmentIndex = path.segments.findIndex((segment) => segment.id === segmentId);
  if (segmentIndex < 0) throw new Error(`Path segment '${segmentId}' was not found`);
  const segment = path.segments[segmentIndex]!;
  const start = path.nodes.find((node) => node.id === segment.startNodeId); const end = path.nodes.find((node) => node.id === segment.endNodeId);
  if (!start || !end) throw new Error(`Path segment '${segment.id}' references an unknown node`);
  const p0 = finitePoint(start.anchor, "Path start"); const p3 = finitePoint(end.anchor, "Path end");
  const curve = segment.type === "line"
    ? { type: "line" as const, start: p0, end: p3 }
    : { type: "cubicBezier" as const, p0, p1: finitePoint(segment.control1, "Path control1"), p2: finitePoint(segment.control2, "Path control2"), p3 };
  return {
    curve,
    source: { kind: "path-segment", elementId: path.id, segmentId: segment.id, startNodeId: segment.startNodeId, endNodeId: segment.endNodeId }, sourceIndex: segmentIndex,
  };
}

/** Adapts one native Spline span; missing handles are zero offsets at their anchors. */
export function splineSpanToCurve(spline: SplineElement, spanIndex: number): SourcedCurve2D<CubicBezierCurve2D> {
  assertUniqueIds(spline.nodes, "Spline nodes");
  if (!Number.isInteger(spanIndex) || spanIndex < 0) throw new Error("Spline span index must be a non-negative integer");
  const spanCount = spline.closed && spline.nodes.length > 1 ? spline.nodes.length : Math.max(0, spline.nodes.length - 1);
  if (spanIndex >= spanCount) throw new Error("Spline span index is out of range");
  const start = spline.nodes[spanIndex]!; const end = spline.nodes[(spanIndex + 1) % spline.nodes.length]!;
  const p0 = finitePoint(start.anchor, "Spline start"); const p3 = finitePoint(end.anchor, "Spline end");
  const p1 = checkedPoint({ x: p0.x + (start.outHandle?.dx ?? 0), y: p0.y + (start.outHandle?.dy ?? 0) });
  const p2 = checkedPoint({ x: p3.x + (end.inHandle?.dx ?? 0), y: p3.y + (end.inHandle?.dy ?? 0) });
  return {
    curve: { type: "cubicBezier", p0, p1, p2, p3 },
    source: { kind: "spline-span", elementId: spline.id, startNodeId: start.id, endNodeId: end.id }, sourceIndex: spanIndex,
  };
}

/**
 * Returns undefined for a genuine ellipse because Phase 1 has no EllipseCurve2D.
 * A circle has no persisted seam, so rotation/flips are intentionally canonicalized
 * to Curve2D's +X seam and clockwise traversal without changing its locus.
 */
export function ellipseElementToCurve(element: EllipseElement): SourcedCurve2D<CircleCurve2D> | undefined {
  const values = [element.position.x, element.position.y, element.size.width, element.size.height, element.rotation];
  if (!values.every(Number.isFinite) || element.size.width <= 0 || element.size.height <= 0) throw new Error("Ellipse geometry must be finite and positive");
  if (element.size.width !== element.size.height) return undefined;
  const radius = element.size.width / 2;
  const center = checkedPoint({ x: element.position.x + radius, y: element.position.y + radius });
  return { curve: { type: "circle", center, radius }, source: { kind: "ellipse-element", elementId: element.id }, sourceIndex: 0 };
}

/** Returns supported source curves in persistent source order; unsupported elements return none. */
export function elementToCurves(element: Element): readonly SourcedCurve2D[] {
  if (element.type === "line") return [lineElementToCurve(element)];
  if (element.type === "ellipse") { const sourced = ellipseElementToCurve(element); return sourced ? [sourced] : []; }
  if (element.type === "sketch") return element.edges.map((edge) => sketchEdgeToCurve(element, edge.id));
  if (element.type === "path") return element.segments.map((segment) => pathSegmentToCurve(element, segment.id));
  if (element.type === "spline") {
    const spanCount = element.closed && element.nodes.length > 1 ? element.nodes.length : Math.max(0, element.nodes.length - 1);
    return Array.from({ length: spanCount }, (_, spanIndex) => splineSpanToCurve(element, spanIndex));
  }
  return [];
}
