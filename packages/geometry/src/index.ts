import polygonClipping, { type MultiPolygon } from "polygon-clipping";
import type { ContourElement, DimensionElement, Element, ElementId, EllipseElement, GlyphElement, HandleOffset, LineElement, PathCubicSegment, PathElement, PointMm, RectangleElement, SizeMm, SplineElement, SplineNode } from "@nodra/domain";

export interface Bounds { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface Viewport { readonly zoom: number; readonly panMm: PointMm }
export interface PointPx { readonly x: number; readonly y: number }
export interface CuttableSegment { readonly elementId: ElementId; readonly segmentIndex: number; readonly start: PointMm; readonly end: PointMm }

/** Projects supported Stage 1 objects into straight, cuttable boundary segments. */
export function cuttableSegments(element: Element): readonly CuttableSegment[] {
  if (element.type === "line") {
    const [start, end] = rotatedLineEndpoints(element);
    return start && end ? [{ elementId: element.id, segmentIndex: 0, start, end }] : [];
  }
  if (element.type === "path") {
        const nodes = new Map(element.nodes.map((node) => [node.id, node.anchor]));
        return element.segments.flatMap((segment, segmentIndex) => {
          if (segment.type !== "line") return [];
          const start = nodes.get(segment.startNodeId); const end = nodes.get(segment.endNodeId);
          return start && end ? [{ elementId: element.id, segmentIndex, start, end }] : [];
        });
      }
      if (element.type !== "rectangle") return [];
  const corners = rotatedCorners(element);
  return corners.map((start, index) => ({ elementId: element.id, segmentIndex: index, start, end: corners[(index + 1) % corners.length]! }));
}
export interface SegmentIntersection { readonly point: PointMm; readonly firstT: number; readonly secondT: number }

/** Splits a line at normalized parameters, preserving endpoints and removing duplicate cuts. */
export interface CutSegmentPiece extends CuttableSegment { readonly start: PointMm; readonly end: PointMm }
    export interface CutSegmentCycle { readonly points: readonly PointMm[]; readonly area: number }
    export interface CutGraphResult { readonly cycles: readonly CutSegmentCycle[]; readonly openPieces: readonly CutSegmentPiece[] }

    /** Finds bounded closed faces in a planar graph of straight cut pieces. */
    export function closedCuttableCycles(pieces: readonly CutSegmentPiece[], epsilon = 1e-9): readonly CutSegmentCycle[] {
      const key = (point: PointMm) => `${Math.round(point.x / epsilon)}:${Math.round(point.y / epsilon)}`;
      const vertices = new Map<string, PointMm>(); const adjacency = new Map<string, string[]>(); const edges = new Set<string>();
      for (const piece of pieces) {
        const startKey = key(piece.start); const endKey = key(piece.end); if (startKey === endKey) continue;
        vertices.set(startKey, piece.start); vertices.set(endKey, piece.end);
        const edgeKey = [startKey, endKey].sort().join("|"); if (edges.has(edgeKey)) continue; edges.add(edgeKey);
        adjacency.set(startKey, [...(adjacency.get(startKey) ?? []), endKey]); adjacency.set(endKey, [...(adjacency.get(endKey) ?? []), startKey]);
      }
      for (const [vertexKey, neighbors] of adjacency) neighbors.sort((first, second) => Math.atan2(vertices.get(first)!.y - vertices.get(vertexKey)!.y, vertices.get(first)!.x - vertices.get(vertexKey)!.x) - Math.atan2(vertices.get(second)!.y - vertices.get(vertexKey)!.y, vertices.get(second)!.x - vertices.get(vertexKey)!.x));
      const visited = new Set<string>(); const cycles: CutSegmentCycle[] = [];
      for (const [start, neighbors] of adjacency) for (const first of neighbors) {
        const directed = `${start}>${first}`; if (visited.has(directed)) continue;
        const points: PointMm[] = []; let from = start; let to = first; let guard = 0;
        while (guard++ <= edges.size * 2) {
          const marker = `${from}>${to}`; if (visited.has(marker)) break; visited.add(marker); points.push(vertices.get(from)!);
          const outgoing = adjacency.get(to) ?? []; let index = outgoing.findIndex((neighbor) => neighbor === from); if (index < 0) break;
          index = (index - 1 + outgoing.length) % outgoing.length; const next = outgoing[index]!; from = to; to = next;
          if (from === start && to === first) {
            const area = points.reduce((sum, point, pointIndex) => { const nextPoint = points[(pointIndex + 1) % points.length]!; return sum + point.x * nextPoint.y - nextPoint.x * point.y; }, 0) / 2;
            if (area > epsilon) cycles.push({ points, area });
            break;
          }
        }
      }
      return cycles;
    }

    /** Separates bounded faces from pieces that do not belong to any closed face. */
    export function classifyCutGraph(pieces: readonly CutSegmentPiece[], epsilon = 1e-9): CutGraphResult {
      const cycles = closedCuttableCycles(pieces, epsilon);
      const key = (point: PointMm) => `${Math.round(point.x / epsilon)}:${Math.round(point.y / epsilon)}`;
      const cycleEdges = new Set(cycles.flatMap((cycle) => cycle.points.map((point, index) => [key(point), key(cycle.points[(index + 1) % cycle.points.length]!)].sort().join("|"))));
      return { cycles, openPieces: pieces.filter((piece) => !cycleEdges.has([key(piece.start), key(piece.end)].sort().join("|"))) };
    }

export function splitLineSegment(start: PointMm, end: PointMm, parameters: readonly number[], epsilon = 1e-9): readonly PointMm[] {
  if (![start.x, start.y, end.x, end.y, epsilon, ...parameters].every(Number.isFinite) || epsilon < 0) throw new Error("segment coordinates, parameters, and epsilon must be finite");
  const cuts = [...new Set(parameters.filter((parameter) => parameter > epsilon && parameter < 1 - epsilon).map((parameter) => Math.max(0, Math.min(1, parameter))))].sort((first, second) => first - second);
  return [0, ...cuts, 1].map((parameter) => ({ x: start.x + (end.x - start.x) * parameter, y: start.y + (end.y - start.y) * parameter }));
}

/** Splits every straight boundary at all pairwise intersections without mutating source elements. */
export function splitCuttableSegments(segments: readonly CuttableSegment[], epsilon = 1e-9): readonly CutSegmentPiece[] {
  const parameters = segments.map(() => [] as number[]);
  for (let first = 0; first < segments.length; first += 1) for (let second = first + 1; second < segments.length; second += 1) {
    const intersection = lineSegmentIntersection(segments[first]!.start, segments[first]!.end, segments[second]!.start, segments[second]!.end, epsilon);
    if (intersection) { parameters[first]!.push(intersection.firstT); parameters[second]!.push(intersection.secondT); }
  }
  return segments.flatMap((segment, index) => splitLineSegment(segment.start, segment.end, parameters[index]!, epsilon).flatMap((start, pointIndex, points) => {
    const end = points[pointIndex + 1];
    return end ? [{ ...segment, start, end }] : [];
  }));
}

/** Returns the proper intersection of two finite line segments, if one exists. Endpoints count as intersections. */
export function lineSegmentIntersection(firstStart: PointMm, firstEnd: PointMm, secondStart: PointMm, secondEnd: PointMm, epsilon = 1e-9): SegmentIntersection | undefined {
  if (![firstStart.x, firstStart.y, firstEnd.x, firstEnd.y, secondStart.x, secondStart.y, secondEnd.x, secondEnd.y, epsilon].every(Number.isFinite) || epsilon < 0) throw new Error("segment coordinates and epsilon must be finite");
  const ax = firstEnd.x - firstStart.x; const ay = firstEnd.y - firstStart.y;
  const bx = secondEnd.x - secondStart.x; const by = secondEnd.y - secondStart.y;
  const denominator = ax * by - ay * bx;
  if (Math.abs(denominator) <= epsilon) return undefined;
  const cx = secondStart.x - firstStart.x; const cy = secondStart.y - firstStart.y;
  const firstT = (cx * by - cy * bx) / denominator;
  const secondT = (cx * ay - cy * ax) / denominator;
  if (firstT < -epsilon || firstT > 1 + epsilon || secondT < -epsilon || secondT > 1 + epsilon) return undefined;
  const clampedFirstT = Math.max(0, Math.min(1, firstT));
  return { point: { x: firstStart.x + ax * clampedFirstT, y: firstStart.y + ay * clampedFirstT }, firstT: clampedFirstT, secondT: Math.max(0, Math.min(1, secondT)) };
}
export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export type GroupHandle = ResizeHandle | "center";
export type Direction = "north-west" | "north" | "north-east" | "west" | "center" | "east" | "south-west" | "south" | "south-east";
export type ResizeCorner = Extract<ResizeHandle, "nw" | "ne" | "se" | "sw">;
export interface ResizeGeometry { readonly position: PointMm; readonly size: SizeMm }
export type RealGeometryNodeKind = "corner" | "edge-midpoint" | "endpoint" | "center" | "cardinal";
export interface RealGeometryNode { readonly kind: RealGeometryNodeKind | "anchor" | "control"; readonly point: PointMm; readonly nodeId?: string; readonly segmentIndex?: number; readonly handle?: "control1" | "control2" }
export interface ContourVertexNode { readonly elementId: ElementId; readonly ringIndex: number; readonly pointIndex: number; readonly point: PointMm }
export interface ContourSegmentHit { readonly elementId: ElementId; readonly ringIndex: number; readonly segmentIndex: number; readonly distance: number }
export const ELLIPSE_APPROXIMATION_SEGMENTS = 64;
export const ROUNDED_RECTANGLE_APPROXIMATION_SEGMENTS = 8;

export interface CubicBezier { readonly p0: PointMm; readonly p1: PointMm; readonly p2: PointMm; readonly p3: PointMm }
export type BezierHandleDirection = "in" | "out";
export interface BezierHandlePoint { readonly direction: BezierHandleDirection; readonly point: PointMm }
export interface BezierGeometryNode { readonly nodeId: string; readonly anchor: PointMm; readonly handles: readonly BezierHandlePoint[] }
export interface EditableGeometryNode { readonly kind: "anchor" | "handle"; readonly nodeId: string; readonly point: PointMm; readonly direction?: BezierHandleDirection; readonly nodeIndex: number; readonly segmentIndex?: number; readonly ringIndex?: number }
export interface BezierHandleGuide { readonly nodeId: string; readonly anchor: PointMm; readonly point: PointMm; readonly direction: BezierHandleDirection; readonly nodeIndex: number; readonly anchorNodeIndex: number; readonly segmentIndex?: number; readonly ringIndex?: number }
export interface LinearDimensionGeometry { readonly kind: "aligned" | "horizontal" | "vertical"; readonly start: PointMm; readonly end: PointMm; readonly lineStart: PointMm; readonly lineEnd: PointMm; readonly text: PointMm; readonly value: number }
export interface AngularDimensionGeometry { readonly kind: "angular"; readonly vertex: PointMm; readonly start: PointMm; readonly end: PointMm; readonly lineStart: PointMm; readonly lineEnd: PointMm; readonly text: PointMm; readonly value: number; readonly radius: number; readonly sweep: 0 | 1 }
export type DimensionGeometry = LinearDimensionGeometry | AngularDimensionGeometry;
export type DimensionPlacementKind = Extract<DimensionElement["kind"], "aligned" | "horizontal" | "vertical">;
export const pointMidpoint = (first: PointMm, second: PointMm): PointMm => ({ x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 });
export const dimensionKindForNodes = (first: PointMm, second: PointMm): DimensionPlacementKind => {
  const dx = Math.abs(second.x - first.x); const dy = Math.abs(second.y - first.y);
  if (dx === 0) return "vertical";
  if (dy === 0 || dy <= dx * 0.1) return "horizontal";
  if (dx <= dy * 0.1) return "vertical";
  return "aligned";
};

/** Uses the third click as intent: natural/aligned unless movement clearly asks for one axis. */
export const dimensionKindForPlacement = (first: PointMm, second: PointMm, placement: PointMm): DimensionPlacementKind => {
  const segmentDx = Math.abs(second.x - first.x); const segmentDy = Math.abs(second.y - first.y);
  if (segmentDx === 0) return "vertical";
  if (segmentDy === 0) return "horizontal";
  const midpoint = pointMidpoint(first, second);
  const intentDx = Math.abs(placement.x - midpoint.x); const intentDy = Math.abs(placement.y - midpoint.y);
  const clearIntentRatio = 1.75;
  if (intentDx >= intentDy * clearIntentRatio) return "horizontal";
  if (intentDy >= intentDx * clearIntentRatio) return "vertical";
  return "aligned";
};
export const dimensionOffsetForPlacement = (kind: DimensionPlacementKind, midpoint: PointMm, placement: PointMm): PointMm => kind === "horizontal" ? { x: 0, y: placement.y - midpoint.y } : kind === "vertical" ? { x: placement.x - midpoint.x, y: 0 } : { x: placement.x - midpoint.x, y: placement.y - midpoint.y };
export const dimensionOffsetForAlignedPlacement = (start: PointMm, end: PointMm, placement: PointMm): PointMm => {
  const length = Math.hypot(end.x - start.x, end.y - start.y); if (length === 0) return { x: 0, y: 0 };
  const midpoint = pointMidpoint(start, end); const signed = ((end.x - start.x) * (placement.y - midpoint.y) - (end.y - start.y) * (placement.x - midpoint.x)) / length;
  return { x: -(end.y - start.y) / length * signed, y: (end.x - start.x) / length * signed };
};
const nodeReference = (reference: DimensionElement["references"][number]): reference is Extract<DimensionElement["references"][number], { nodeIndex: number }> => "nodeIndex" in reference;
const lineAt = (reference: DimensionElement["references"][number], elements: readonly Element[]) => "kind" in reference && reference.kind === "line" ? elements.find((candidate): candidate is LineElement => candidate.id === reference.elementId && candidate.type === "line") : undefined;
export function angularDimensionGeometry(element: DimensionElement, elements: readonly Element[]): AngularDimensionGeometry | undefined {
  if (element.kind !== "angular" || !element.references.every((reference) => "kind" in reference && reference.kind === "line")) return undefined;
  const first = lineAt(element.references[0], elements); const second = lineAt(element.references[1], elements); if (!first || !second) return undefined;
  const [firstStart, firstEnd] = rotatedLineEndpoints(first); const [secondStart, secondEnd] = rotatedLineEndpoints(second);
  const candidates: readonly [PointMm, PointMm, PointMm][] = [[firstStart, firstEnd, secondStart], [firstStart, firstEnd, secondEnd], [firstEnd, firstStart, secondStart], [firstEnd, firstStart, secondEnd]];
  const connected = candidates.find((candidate) => Math.hypot(candidate[0].x - candidate[2].x, candidate[0].y - candidate[2].y) <= 1e-6); if (!connected) return undefined;
  const vertex = connected[0]; const firstRay = { x: connected[1].x - vertex.x, y: connected[1].y - vertex.y }; const secondEndpoint = Math.hypot(vertex.x - secondStart.x, vertex.y - secondStart.y) <= 1e-6 ? secondEnd : secondStart; const secondRay = { x: secondEndpoint.x - vertex.x, y: secondEndpoint.y - vertex.y };
  const firstLength = Math.hypot(firstRay.x, firstRay.y); const secondLength = Math.hypot(secondRay.x, secondRay.y); if (firstLength === 0 || secondLength === 0) return undefined;
  const unitFirst = { x: firstRay.x / firstLength, y: firstRay.y / firstLength }; const unitSecond = { x: secondRay.x / secondLength, y: secondRay.y / secondLength }; const cross = unitFirst.x * unitSecond.y - unitFirst.y * unitSecond.x; const dot = unitFirst.x * unitSecond.x + unitFirst.y * unitSecond.y;
  const value = Math.atan2(Math.abs(cross), dot) * 180 / Math.PI; const radius = Math.max(Math.hypot(element.offset.x, element.offset.y), 8); const bisector = { x: unitFirst.x + unitSecond.x, y: unitFirst.y + unitSecond.y }; const bisectorLength = Math.hypot(bisector.x, bisector.y); const direction = bisectorLength > 1e-9 ? { x: bisector.x / bisectorLength, y: bisector.y / bisectorLength } : { x: -unitFirst.y, y: unitFirst.x };
  const lineStart = { x: vertex.x + unitFirst.x * radius, y: vertex.y + unitFirst.y * radius }; const lineEnd = { x: vertex.x + unitSecond.x * radius, y: vertex.y + unitSecond.y * radius };
  return { kind: "angular", vertex, start: lineStart, end: lineEnd, lineStart, lineEnd, text: { x: vertex.x + direction.x * radius, y: vertex.y + direction.y * radius }, value, radius, sweep: cross >= 0 ? 1 : 0 };
}
export function dimensionGeometry(element: DimensionElement, elements: readonly Element[]): DimensionGeometry | undefined {
  if (element.kind === "angular") return angularDimensionGeometry(element, elements);
  if (!nodeReference(element.references[0]) || !nodeReference(element.references[1])) return undefined;
  const startElement = elements.find((candidate) => candidate.id === element.references[0].elementId);
  const endElement = elements.find((candidate) => candidate.id === element.references[1].elementId);
  if (!startElement || !endElement || startElement.type === "dimension" || endElement.type === "dimension") return undefined;
  const startReference = element.references[0]; const endReference = element.references[1];
  const start = realGeometryNodes(startElement)[startReference.nodeIndex]?.point;
  const end = realGeometryNodes(endElement)[endReference.nodeIndex]?.point;
  if (!start || !end) return undefined;
  const midpoint = pointMidpoint(start, end);
  const text = { x: midpoint.x + element.offset.x, y: midpoint.y + element.offset.y };
  const lineStart = element.kind === "horizontal" ? { x: start.x, y: text.y } : element.kind === "vertical" ? { x: text.x, y: start.y } : alignedOffsetPoint(start, start, end, element.offset);
  const lineEnd = element.kind === "horizontal" ? { x: end.x, y: text.y } : element.kind === "vertical" ? { x: text.x, y: end.y } : alignedOffsetPoint(end, start, end, element.offset);
  const value = element.kind === "horizontal" ? Math.abs(end.x - start.x) : element.kind === "vertical" ? Math.abs(end.y - start.y) : Math.hypot(end.x - start.x, end.y - start.y);
  return { kind: element.kind, start, end, lineStart, lineEnd, text: element.kind === "aligned" ? pointMidpoint(lineStart, lineEnd) : text, value };
}
const alignedOffsetPoint = (point: PointMm, start: PointMm, end: PointMm, storedOffset: PointMm): PointMm => { const length = Math.hypot(end.x - start.x, end.y - start.y); if (length === 0) return point; const signed = ((end.x - start.x) * storedOffset.y - (end.y - start.y) * storedOffset.x) / length; return { x: point.x - (end.y - start.y) / length * signed, y: point.y + (end.x - start.x) / length * signed }; };
export const resolveHandle = (anchor: PointMm, offset: HandleOffset): PointMm => ({ x: anchor.x + offset.dx, y: anchor.y + offset.dy });
export const mirrorHandleOffset = (offset: HandleOffset): HandleOffset => ({ dx: -offset.dx, dy: -offset.dy });
export const bezierHandlePoint = (anchor: PointMm, direction: BezierHandleDirection, offset: HandleOffset): BezierHandlePoint => ({ direction, point: resolveHandle(anchor, offset) });
export const splineCubicBezier = (start: SplineNode, end: SplineNode): CubicBezier => ({ p0: start.anchor, p1: resolveHandle(start.anchor, start.outHandle ?? { dx: 0, dy: 0 }), p2: resolveHandle(end.anchor, end.inHandle ?? { dx: 0, dy: 0 }), p3: end.anchor });
export interface PathGeometryNode { readonly kind: "anchor" | "control"; readonly nodeId: string; readonly segmentIndex?: number; readonly handle?: "control1" | "control2"; readonly point: PointMm }
export interface PathSegmentHit { readonly elementId: ElementId; readonly segmentIndex: number; readonly distance: number }
export interface GlyphGeometryNode extends PathGeometryNode { readonly ringIndex: number }
const cubic = (segment: PathCubicSegment, path: PathElement): CubicBezier => {
  const start = path.nodes.find((node) => node.id === segment.startNodeId);
  const end = path.nodes.find((node) => node.id === segment.endNodeId);
  if (!start || !end) throw new Error("Cubic segment references an unknown node");
  return { p0: start.anchor, p1: segment.control1, p2: segment.control2, p3: end.anchor };
};
export function evaluateCubicBezier(curve: CubicBezier, t: number): PointMm {
  if (!Number.isFinite(t)) throw new Error("t must be finite");
  const u = 1 - t;
  return { x: u ** 3 * curve.p0.x + 3 * u ** 2 * t * curve.p1.x + 3 * u * t ** 2 * curve.p2.x + t ** 3 * curve.p3.x, y: u ** 3 * curve.p0.y + 3 * u ** 2 * t * curve.p1.y + 3 * u * t ** 2 * curve.p2.y + t ** 3 * curve.p3.y };
}
export function cubicBezierDerivative(curve: CubicBezier, t: number): PointMm {
  const u = 1 - t;
  return { x: 3 * (u ** 2 * (curve.p1.x - curve.p0.x) + 2 * u * t * (curve.p2.x - curve.p1.x) + t ** 2 * (curve.p3.x - curve.p2.x)), y: 3 * (u ** 2 * (curve.p1.y - curve.p0.y) + 2 * u * t * (curve.p2.y - curve.p1.y) + t ** 2 * (curve.p3.y - curve.p2.y)) };
}
function derivativeRoots(p0: number, p1: number, p2: number, p3: number): number[] {
  // B'(t) / 3 = A t² + B t + C for the scalar cubic Bézier coordinate.
  const A = -p0 + 3 * p1 - 3 * p2 + p3;
  const B = 2 * (p0 - 2 * p1 + p2);
  const C = p1 - p0;
  const scale = Math.max(Math.abs(A), Math.abs(B), Math.abs(C));
  if (scale === 0) return [];
  const epsilon = 1e-12 * scale;
  if (Math.abs(A) <= epsilon) return Math.abs(B) <= epsilon ? [] : [-C / B].filter((t) => t > 0 && t < 1);
  const discriminant = B * B - 4 * A * C;
  if (discriminant < -epsilon * epsilon) return [];
  if (Math.abs(discriminant) <= epsilon * epsilon) {
    const t = -B / (2 * A);
    return t > 0 && t < 1 ? [t] : [];
  }
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [-1, 1].map((sign) => (-B + sign * root) / (2 * A)).filter((t) => t > 0 && t < 1);
}
export function cubicBezierBounds(curve: CubicBezier): Bounds {
  const ts = [0, 1, ...derivativeRoots(curve.p0.x, curve.p1.x, curve.p2.x, curve.p3.x), ...derivativeRoots(curve.p0.y, curve.p1.y, curve.p2.y, curve.p3.y)];
  const points = ts.map((t) => evaluateCubicBezier(curve, t));
  const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}
export function splitCubicBezier(curve: CubicBezier, t = 0.5): readonly [CubicBezier, CubicBezier] {
  if (!Number.isFinite(t) || t < 0 || t > 1) throw new Error("t must be within [0, 1]");
  const lerp = (a: PointMm, b: PointMm): PointMm => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const a = lerp(curve.p0, curve.p1); const b = lerp(curve.p1, curve.p2); const c = lerp(curve.p2, curve.p3); const d = lerp(a, b); const e = lerp(b, c); const m = lerp(d, e);
  return [{ p0: curve.p0, p1: a, p2: d, p3: m }, { p0: m, p1: e, p2: c, p3: curve.p3 }];
}
export function flattenCubicBezier(curve: CubicBezier, tolerance = 0.1): PointMm[] {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error("tolerance must be positive");
  const result: PointMm[] = [curve.p0];
  const flatEnough = (current: CubicBezier): boolean => {
    const distance = (p: PointMm, a: PointMm, b: PointMm) => Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1e-12);
    return Math.max(distance(current.p1, current.p0, current.p3), distance(current.p2, current.p0, current.p3)) <= tolerance;
  };
  const visit = (current: CubicBezier, depth: number): void => { if (depth >= 12 || flatEnough(current)) result.push(current.p3); else { const [left, right] = splitCubicBezier(current); visit(left, depth + 1); visit(right, depth + 1); } };
  visit(curve, 0); return result;
}
export function pathBounds(path: PathElement): Bounds {
  const bounds = path.segments.map((segment) => segment.type === "cubicBezier" ? cubicBezierBounds(cubic(segment, path)) : (() => { const a = path.nodes.find((node) => node.id === segment.startNodeId)!.anchor; const b = path.nodes.find((node) => node.id === segment.endNodeId)!.anchor; return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }; })());
  if (!bounds.length) throw new Error("Path must contain segments");
  const x = Math.min(...bounds.map((item) => item.x)); const y = Math.min(...bounds.map((item) => item.y)); const right = Math.max(...bounds.map((item) => item.x + item.width)); const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x, y, width: right - x, height: bottom - y };
}
const glyphPath = (glyph: GlyphElement, contour: GlyphElement["contours"][number]): PathElement => ({ type: "path", id: glyph.id, layerId: glyph.layerId, nodes: contour.nodes, segments: contour.segments, closed: true, style: glyph.style });
export function glyphBounds(glyph: GlyphElement): Bounds {
  const values = glyph.contours.map((contour) => pathBounds(glyphPath(glyph, contour)));
  const x = Math.min(...values.map((value) => value.x)); const y = Math.min(...values.map((value) => value.y));
  return { x, y, width: Math.max(...values.map((value) => value.x + value.width)) - x, height: Math.max(...values.map((value) => value.y + value.height)) - y };
}
export function glyphGeometryNodes(glyph: GlyphElement): readonly GlyphGeometryNode[] {
  return glyph.contours.flatMap((contour, ringIndex) => pathGeometryNodes(glyphPath(glyph, contour)).map((node) => ({ ...node, ringIndex })));
}
function splineBounds(spline: SplineElement): Bounds {
  const points = spline.nodes.flatMap((node) => [node.anchor, ...(node.inHandle ? [resolveHandle(node.anchor, node.inHandle)] : []), ...(node.outHandle ? [resolveHandle(node.anchor, node.outHandle)] : [])]);
  const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}
function splinePoints(spline: SplineElement, tolerance = 0.1): PointMm[] {
  const points: PointMm[] = [];
  for (let index = 1; index < spline.nodes.length; index += 1) points.push(...flattenCubicBezier(splineCubicBezier(spline.nodes[index - 1]!, spline.nodes[index]!), tolerance).slice(points.length ? 1 : 0));
  if (spline.closed) points.push(...flattenCubicBezier(splineCubicBezier(spline.nodes.at(-1)!, spline.nodes[0]!), tolerance).slice(1));
  return points;
}
export function pathGeometryNodes(path: PathElement): readonly PathGeometryNode[] {
  const result: PathGeometryNode[] = path.nodes.map((node) => ({ kind: "anchor", nodeId: node.id, point: node.anchor }));
  path.segments.forEach((segment, index) => { if (segment.type === "cubicBezier") { result.push({ kind: "control", nodeId: segment.startNodeId, segmentIndex: index, handle: "control1", point: segment.control1 }, { kind: "control", nodeId: segment.endNodeId, segmentIndex: index, handle: "control2", point: segment.control2 }); } });
  return result;
}
export const derivedPathGeometryNodes = pathGeometryNodes;

/** Projects every supported editable object into one node vocabulary for Forma feedback. */
export function editableGeometryNodes(element: Element): readonly EditableGeometryNode[] {
  if (element.type === "spline") return realGeometryNodes(element).map((node, nodeIndex) => ({ kind: node.kind === "control" ? "handle" : "anchor", nodeId: node.nodeId ?? `${element.id}:${nodeIndex}`, point: node.point, ...(node.kind === "control" ? { direction: node.handle === "control1" ? "out" as const : "in" as const } : {}), nodeIndex }));
  if (element.type === "path") return pathGeometryNodes(element).map((node, nodeIndex) => ({ kind: node.kind === "control" ? "handle" : "anchor", nodeId: node.nodeId, point: node.point, ...(node.kind === "control" ? { direction: node.handle === "control1" ? "out" as const : "in" as const, segmentIndex: node.segmentIndex } : {}), nodeIndex }));
  if (element.type === "glyph") return glyphGeometryNodes(element).map((node, nodeIndex) => ({ kind: node.kind === "control" ? "handle" : "anchor", nodeId: node.nodeId, point: node.point, ...(node.kind === "control" ? { direction: node.handle === "control1" ? "out" as const : "in" as const, segmentIndex: node.segmentIndex } : {}), ...(node.ringIndex !== undefined ? { ringIndex: node.ringIndex } : {}), nodeIndex }));
  return realGeometryNodes(element).map((node, nodeIndex) => ({ kind: "anchor" as const, nodeId: node.nodeId ?? `${element.id}:${nodeIndex}`, point: node.point, nodeIndex }));
}

/** Returns only directional controls, preserving the shared Forma node index. */
export function bezierHandleGuides(element: Element): readonly BezierHandleGuide[] {
  const nodes = editableGeometryNodes(element);
  return nodes.flatMap((node) => {
    if (node.kind !== "handle" || !node.direction) return [];
    const anchor = nodes.find((candidate) => candidate.kind === "anchor" && candidate.nodeId === node.nodeId);
    return anchor ? [{ nodeId: node.nodeId, anchor: anchor.point, point: node.point, direction: node.direction, nodeIndex: node.nodeIndex, anchorNodeIndex: anchor.nodeIndex, ...(node.segmentIndex !== undefined ? { segmentIndex: node.segmentIndex } : {}), ...(node.ringIndex !== undefined ? { ringIndex: node.ringIndex } : {}) }] : [];
  });
}

/** Keeps directional arrows scoped to the active anchor; inactive nodes show no handles. */
export function visibleBezierHandleGuides(element: Element, activeNodeIndexes: readonly number[]): readonly BezierHandleGuide[] {
  const active = new Set(activeNodeIndexes);
  return bezierHandleGuides(element).filter((guide) => active.has(guide.anchorNodeIndex));
}
function flattenPath(path: PathElement, tolerance = 0.1): PointMm[] {
  const points: PointMm[] = [];
  path.segments.forEach((segment, index) => {
    const start = path.nodes.find((node) => node.id === segment.startNodeId)!.anchor;
    const values = segment.type === "cubicBezier" ? flattenCubicBezier(cubic(segment, path), tolerance) : [start, path.nodes.find((node) => node.id === segment.endNodeId)!.anchor];
    points.push(...(index === 0 ? values : values.slice(1)));
  });
  return points;
}

/** Finds a path segment by document-space distance, excluding anchor hits. */
export function pathSegmentAt(path: PathElement, point: PointMm, toleranceMm = 0): PathSegmentHit | undefined {
  if (![point.x, point.y, toleranceMm].every(Number.isFinite) || toleranceMm < 0) throw new Error("path segment coordinates and tolerance must be valid");
  let best: PathSegmentHit | undefined;
  for (const [segmentIndex, segment] of path.segments.entries()) {
    const start = path.nodes.find((node) => node.id === segment.startNodeId)?.anchor;
    const end = path.nodes.find((node) => node.id === segment.endNodeId)?.anchor;
    if (!start || !end) continue;
    if (Math.hypot(point.x - start.x, point.y - start.y) <= toleranceMm || Math.hypot(point.x - end.x, point.y - end.y) <= toleranceMm) continue;
    const points = segment.type === "cubicBezier" ? flattenCubicBezier(cubic(segment, path)) : [start, end];
    let distance = Number.POSITIVE_INFINITY;
    for (let index = 1; index < points.length; index += 1) distance = Math.min(distance, contourSegmentDistance(point, points[index - 1]!, points[index]!));
    if (distance <= toleranceMm && (!best || distance < best.distance || distance === best.distance && segmentIndex < best.segmentIndex)) best = { elementId: path.id, segmentIndex, distance };
  }
  return best;
}

export function directionVector(direction: Direction): PointMm {
  const vectors: Readonly<Record<Direction, PointMm>> = {
    "north-west": { x: -1, y: -1 }, north: { x: 0, y: -1 }, "north-east": { x: 1, y: -1 },
    west: { x: -1, y: 0 }, center: { x: 0, y: 0 }, east: { x: 1, y: 0 },
    "south-west": { x: -1, y: 1 }, south: { x: 0, y: 1 }, "south-east": { x: 1, y: 1 },
  };
  return vectors[direction];
}

const TAU = Math.PI * 2;
const assertFinite = (value: number, name: string): void => { if (!Number.isFinite(value)) throw new Error(`${name} must be finite`); };
const assertPositive = (value: number, name: string): void => { assertFinite(value, name); if (value <= 0) throw new Error(`${name} must be positive`); };
const rotate = (point: PointMm, angle: number): PointMm => ({ x: point.x * Math.cos(angle) - point.y * Math.sin(angle), y: point.x * Math.sin(angle) + point.y * Math.cos(angle) });

export function elementCenter(element: Element): PointMm {
  return element.type === "dimension" ? element.offset : element.type === "line"
    ? { x: (element.start.x + element.end.x) / 2, y: (element.start.y + element.end.y) / 2 }
    : element.type === "contour" ? groupCenter(contourBounds(element))
    : element.type === "path" ? groupCenter(pathBounds(element))
    : element.type === "spline" ? groupCenter(splineBounds(element))
    : element.type === "glyph" ? groupCenter(glyphBounds(element))
    : { x: element.position.x + element.size.width * (element.type === "text" ? element.scaleX ?? 1 : 1) / 2, y: element.position.y + element.size.height * (element.type === "text" ? element.scaleY ?? 1 : 1) / 2 };
}

const contourBounds = (element: ContourElement): Bounds => {
  const points = element.contours.flatMap((contour) => contour.points);
  const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
};
export function contourWithPoints(element: ContourElement, points: readonly (readonly PointMm[])[]): ContourElement {
  const flattened = points.flat();
  const xs = flattened.map((point) => point.x);
  const ys = flattened.map((point) => point.y);
  const position = { x: Math.min(...xs), y: Math.min(...ys) };
  return { ...element, position, size: { width: Math.max(0.001, Math.max(...xs) - position.x), height: Math.max(0.001, Math.max(...ys) - position.y) }, contours: points.map((ring) => ({ points: [...ring] })), rotation: 0 };
}

/** Returns only stored polygon vertices, with stable ring/point identity. A repeated closing point is represented by pointIndex 0. */
export function contourVertexNodes(element: ContourElement): readonly ContourVertexNode[] {
  return element.contours.flatMap((contour, ringIndex) => contour.points.flatMap((point, pointIndex) => {
    const first = contour.points[0];
    const isClosingDuplicate = pointIndex === contour.points.length - 1 && contour.points.length > 1 && first?.x === point.x && first.y === point.y;
    return isClosingDuplicate ? [] : [{ elementId: element.id, ringIndex, pointIndex, point }];
  }));
}

/** Projects any drawable element to the polygon representation used by the SVG/polygon model. */
export function elementToContour(element: Element): ContourElement {
  const contours = element.type === "line"
    ? [{ points: [element.start, element.end, element.start] }]
    : element.type === "spline" ? [{ points: splinePoints(element) }]
    : element.type === "glyph" ? element.contours.map((contour) => ({ points: flattenPath(glyphPath(element, contour)) }))
    : contoursFromMultiPolygon(closedElementToPolygon(element));
  const points = contours.flatMap((ring) => ring.points);
  const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
  return { type: "contour", id: element.id, layerId: element.layerId, position: { x: Math.min(...xs), y: Math.min(...ys) }, size: { width: Math.max(0.001, Math.max(...xs) - Math.min(...xs)), height: Math.max(0.001, Math.max(...ys) - Math.min(...ys)) }, contours, fillRule: "evenodd", rotation: 0, style: element.style, ...( "operation" in element && element.operation ? { operation: element.operation } : {}) };
}

export function elementSegmentAt(element: Element, point: PointMm, toleranceMm = 0): ContourSegmentHit | undefined {
  if (element.type === "text") return undefined;
  if (element.type === "contour") return contourSegmentAt(element, point, toleranceMm);
  if (element.type === "line") {
    const [start, end] = rotatedLineEndpoints(element);
    const distance = contourSegmentDistance(point, start, end);
    return distance <= toleranceMm ? { elementId: element.id, ringIndex: 0, segmentIndex: 0, distance } : undefined;
  }
  const projected = elementToContour(element);
  return contourSegmentAt(projected, point, toleranceMm);
}
const contourSegmentDistance = (point: PointMm, start: PointMm, end: PointMm): number => {
  const dx = end.x - start.x; const dy = end.y - start.y; const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Number.POSITIVE_INFINITY;
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
};
/** Finds a contour edge by document-space distance, excluding the stored closing duplicate and endpoint hits. */
export function contourSegmentAt(element: ContourElement, point: PointMm, toleranceMm = 0): ContourSegmentHit | undefined {
  if (![point.x, point.y, toleranceMm].every(Number.isFinite) || toleranceMm < 0) throw new Error("contour segment coordinates and tolerance must be valid");
  let best: ContourSegmentHit | undefined;
  for (const [ringIndex, contour] of element.contours.entries()) {
    const closing = contour.points.length > 1 && contour.points.at(-1)?.x === contour.points[0]?.x && contour.points.at(-1)?.y === contour.points[0]?.y;
    const vertices = closing ? contour.points.slice(0, -1) : contour.points;
    for (let segmentIndex = 0; segmentIndex < vertices.length; segmentIndex += 1) {
      const start = vertices[segmentIndex]!; const end = vertices[(segmentIndex + 1) % vertices.length];
      if (!end) continue;
      if (Math.hypot(point.x - start.x, point.y - start.y) <= toleranceMm || Math.hypot(point.x - end.x, point.y - end.y) <= toleranceMm) continue;
      const distance = contourSegmentDistance(point, start, end);
      if (distance <= toleranceMm && (!best || distance < best.distance || distance === best.distance && `${ringIndex}:${segmentIndex}` < `${best.ringIndex}:${best.segmentIndex}`)) best = { elementId: element.id, ringIndex, segmentIndex, distance };
    }
  }
  return best;
}
const pointInRing = (point: PointMm, ring: readonly [number, number][]): boolean => {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const current = ring[index]!; const prior = ring[previous]!;
    if ((current[1] > point.y) !== (prior[1] > point.y) && point.x < (prior[0] - current[0]) * (point.y - current[1]) / (prior[1] - current[1]) + current[0]) inside = !inside;
  }
  return inside;
};

function primitivePolygon(element: RectangleElement | EllipseElement): [number, number][] {
  const center = elementCenter(element);
  const flipX = element.flipX ? -1 : 1; const flipY = element.flipY ? -1 : 1;
  if (element.type === "ellipse") return Array.from({ length: ELLIPSE_APPROXIMATION_SEGMENTS + 1 }, (_, index) => {
    const angle = index * TAU / ELLIPSE_APPROXIMATION_SEGMENTS;
    const local = { x: Math.cos(angle) * element.size.width / 2 * flipX, y: Math.sin(angle) * element.size.height / 2 * flipY };
    const world = transformPoint(local, center, element.rotation);
    return [world.x, world.y];
  });
  const radius = Math.min(element.cornerRadius, element.size.width / 2, element.size.height / 2);
  if (radius === 0) {
    const baseCorners: readonly [number, number][] = [
    [-element.size.width / 2 * flipX, -element.size.height / 2 * flipY],
    [element.size.width / 2 * flipX, -element.size.height / 2 * flipY],
    [element.size.width / 2 * flipX, element.size.height / 2 * flipY],
    [-element.size.width / 2 * flipX, element.size.height / 2 * flipY],
    [-element.size.width / 2 * flipX, -element.size.height / 2 * flipY],
    ];
    return baseCorners.map(([x, y]): [number, number] => { const world = transformPoint({ x, y }, center, element.rotation); return [world.x, world.y]; });
  }
  const corners = [{ x: -element.size.width / 2 + radius, y: -element.size.height / 2 + radius, start: Math.PI }, { x: element.size.width / 2 - radius, y: -element.size.height / 2 + radius, start: -Math.PI / 2 }, { x: element.size.width / 2 - radius, y: element.size.height / 2 - radius, start: 0 }, { x: -element.size.width / 2 + radius, y: element.size.height / 2 - radius, start: Math.PI / 2 }];
  const points: [number, number][] = [];
  for (const corner of corners) for (let index = 0; index <= ROUNDED_RECTANGLE_APPROXIMATION_SEGMENTS; index++) {
    const angle = corner.start + index * Math.PI / 2 / ROUNDED_RECTANGLE_APPROXIMATION_SEGMENTS;
    const world = transformPoint({ x: (corner.x + Math.cos(angle) * radius) * flipX, y: (corner.y + Math.sin(angle) * radius) * flipY }, center, element.rotation);
    points.push([world.x, world.y]);
  }
  return points;
}

export function closedElementToPolygon(element: Element): MultiPolygon {
  if (element.type === "line" || element.type === "dimension" || element.type === "text") throw new Error("Shape operations require closed objects");
  if (element.type === "path") { if (!element.closed) throw new Error("Shape operations require closed objects"); return [[flattenPath(element, 0.01).map((point) => [point.x, point.y] as [number, number])]]; }
  if (element.type === "spline") { if (!element.closed) throw new Error("Shape operations require closed objects"); return [[splinePoints(element, 0.01).map((point) => [point.x, point.y] as [number, number])]]; }
  if (element.type === "glyph") return [element.contours.map((contour) => flattenPath(glyphPath(element, contour), 0.01).map((point) => [point.x, point.y] as [number, number]))];
  if (element.type === "contour") return [element.contours.map((contour) => contour.points.map((point) => [point.x, point.y] as [number, number]))];
  return [[primitivePolygon(element)]];
}

export function contoursFromMultiPolygon(polygons: MultiPolygon): ContourElement["contours"] {
  return polygons.flatMap((polygon) => polygon.map((ring) => ({ points: ring.map(([x, y]) => ({ x, y })) })));
}

export type ShapeOperation = "union" | "difference";
export function shapeResultContours(operation: ShapeOperation, elements: readonly Element[]): ContourElement["contours"] {
  if (!elements.length || elements.some((element) => element.type === "line" || element.type === "dimension" || element.type === "text")) throw new Error("Shape operations require closed objects");
  const polygons = elements.map(closedElementToPolygon);
  const result = operation === "difference" ? polygonClipping.difference(polygons[0]!, ...polygons.slice(1)) : polygonClipping.union(polygons[0]!, ...polygons.slice(1));
  return contoursFromMultiPolygon(result);
}

export function rotatedLineEndpoints(element: LineElement): readonly [PointMm, PointMm] {
  const center = elementCenter(element);
  return [
    transformPoint({ x: element.start.x - center.x, y: element.start.y - center.y }, center, element.rotation),
    transformPoint({ x: element.end.x - center.x, y: element.end.y - center.y }, center, element.rotation),
  ];
}

export function rotationHandlePoints(element: Element, offsetMm: number): readonly PointMm[] {
  assertFinite(offsetMm, "offsetMm");
  if (offsetMm < 0) throw new Error("offsetMm must not be negative");
  if (element.type === "dimension") return [];
  const center = elementCenter(element);
  if (element.type === "line") {
    const [start, end] = rotatedLineEndpoints(element);
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length === 0) return [];
    const unit = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
    return [
      { x: start.x - unit.x * offsetMm, y: start.y - unit.y * offsetMm },
      { x: end.x + unit.x * offsetMm, y: end.y + unit.y * offsetMm },
    ];
  }
  if (element.type === "contour") {
    const bounds = contourBounds(element);
    return rotationHandlePoints({ type: "rectangle", id: element.id, layerId: element.layerId, position: { x: bounds.x, y: bounds.y }, size: { width: Math.max(bounds.width, 1), height: Math.max(bounds.height, 1) }, cornerRadius: 0, rotation: 0, style: element.style }, offsetMm);
  }
  if (element.type === "path") {
    const bounds = pathBounds(element);
    return rotationHandlePoints({ type: "rectangle", id: element.id, layerId: element.layerId, position: { x: bounds.x, y: bounds.y }, size: { width: Math.max(bounds.width, 1), height: Math.max(bounds.height, 1) }, cornerRadius: 0, rotation: 0, style: element.style }, offsetMm);
  }
  if (element.type === "spline" || element.type === "text") {
    const bounds = boundsOf(element);
    return rotationHandlePoints({ type: "rectangle", id: element.id, layerId: element.layerId, position: { x: bounds.x, y: bounds.y }, size: { width: Math.max(bounds.width, 1), height: Math.max(bounds.height, 1) }, cornerRadius: 0, rotation: 0, style: element.style }, offsetMm);
  }
  if (element.type === "glyph") {
    const bounds = glyphBounds(element);
    return rotationHandlePoints({ type: "rectangle", id: element.id, layerId: element.layerId, position: { x: bounds.x, y: bounds.y }, size: { width: Math.max(bounds.width, 1), height: Math.max(bounds.height, 1) }, cornerRadius: 0, rotation: 0, style: element.style }, offsetMm);
  }
  return rotatedCorners(element).map((corner) => {
    const distance = Math.hypot(corner.x - center.x, corner.y - center.y);
    if (distance === 0) return corner;
    return { x: corner.x + (corner.x - center.x) / distance * offsetMm, y: corner.y + (corner.y - center.y) / distance * offsetMm };
  });
}

export function rotationFromDrag(baseRotation: number, center: PointMm, start: PointMm, current: PointMm, snapIncrement = 0): number {
  [baseRotation, center.x, center.y, start.x, start.y, current.x, current.y, snapIncrement].forEach((value, index) => assertFinite(value, `rotation value ${index}`));
  if (snapIncrement < 0) throw new Error("snapIncrement must not be negative");
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const currentAngle = Math.atan2(current.y - center.y, current.x - center.x);
  const delta = Math.atan2(Math.sin(currentAngle - startAngle), Math.cos(currentAngle - startAngle));
  const rotation = normalizeAngle(baseRotation + delta);
  return snapIncrement > 0 ? normalizeAngle(Math.round(rotation / snapIncrement) * snapIncrement) : rotation;
}

export function validateSize(size: SizeMm): SizeMm {
  assertPositive(size.width, "width"); assertPositive(size.height, "height"); return { ...size };
}

export function transformPoint(point: PointMm, origin: PointMm, rotation: number, scale: PointMm = { x: 1, y: 1 }): PointMm {
  assertFinite(rotation, "rotation"); assertFinite(scale.x, "scale.x"); assertFinite(scale.y, "scale.y");
  const scaled = { x: point.x * scale.x, y: point.y * scale.y }; const turned = rotate(scaled, rotation);
  return { x: origin.x + turned.x, y: origin.y + turned.y };
}

export function rotatedCorners(element: RectangleElement | EllipseElement): readonly [PointMm, PointMm, PointMm, PointMm] {
  const half = { x: element.size.width / 2, y: element.size.height / 2 };
  const center = { x: element.position.x + half.x, y: element.position.y + half.y };
  return [transformPoint({ x: -half.x, y: -half.y }, center, element.rotation), transformPoint({ x: half.x, y: -half.y }, center, element.rotation), transformPoint({ x: half.x, y: half.y }, center, element.rotation), transformPoint({ x: -half.x, y: half.y }, center, element.rotation)];
}

/** Returns connection/alignment points in document space, independent of resize handles. */
export function realGeometryNodes(element: Element): readonly RealGeometryNode[] {
  if (element.type === "dimension") return [];
  if (element.type === "line") {
    const [start, end] = rotatedLineEndpoints(element);
    return [{ kind: "endpoint", point: start }, { kind: "center", point: elementCenter(element) }, { kind: "endpoint", point: end }];
  }
  if (element.type === "contour") {
    const nodes: RealGeometryNode[] = [{ kind: "center", point: elementCenter(element) }];
    for (const contour of element.contours) {
      const points = contour.points;
      const last = points.at(-1);
      const vertices = last && points.length > 1 && last.x === points[0]!.x && last.y === points[0]!.y ? points.slice(0, -1) : points;
      nodes.push(...vertices.map((point) => ({ kind: "corner" as const, point })));
      for (const [index, start] of vertices.entries()) {
        const end = vertices[(index + 1) % vertices.length];
        if (end) nodes.push({ kind: "edge-midpoint", point: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } });
      }
    }
    return nodes;
  }
  if (element.type === "path") return pathGeometryNodes(element);
  if (element.type === "glyph") return glyphGeometryNodes(element);
  if (element.type === "spline") return element.nodes.flatMap((node) => [{ kind: "anchor" as const, nodeId: node.id, point: node.anchor }, ...(node.inHandle ? [{ kind: "control" as const, nodeId: node.id, point: resolveHandle(node.anchor, node.inHandle), handle: "control2" as const }] : []), ...(node.outHandle ? [{ kind: "control" as const, nodeId: node.id, point: resolveHandle(node.anchor, node.outHandle), handle: "control1" as const }] : [])]);
  const half = { x: element.size.width / 2, y: element.size.height / 2 };
  const center = { x: element.position.x + half.x, y: element.position.y + half.y };
  if (element.type === "rectangle") {
    const [nw, ne, se, sw] = rotatedCorners(element);
    return [
      { kind: "corner", point: nw },
      { kind: "corner", point: ne },
      { kind: "corner", point: se },
      { kind: "corner", point: sw },
      { kind: "center", point: center },
      { kind: "edge-midpoint", point: transformPoint({ x: 0, y: -half.y }, center, element.rotation) },
      { kind: "edge-midpoint", point: transformPoint({ x: half.x, y: 0 }, center, element.rotation) },
      { kind: "edge-midpoint", point: transformPoint({ x: 0, y: half.y }, center, element.rotation) },
      { kind: "edge-midpoint", point: transformPoint({ x: -half.x, y: 0 }, center, element.rotation) },
    ];
  }
  return [
    { kind: "center" as const, point: center },
    { kind: "cardinal" as const, point: transformPoint({ x: 0, y: -half.y }, center, element.rotation) },
    { kind: "cardinal" as const, point: transformPoint({ x: half.x, y: 0 }, center, element.rotation) },
    { kind: "cardinal" as const, point: transformPoint({ x: 0, y: half.y }, center, element.rotation) },
    { kind: "cardinal" as const, point: transformPoint({ x: -half.x, y: 0 }, center, element.rotation) },
  ];
}

export function rotatedResizeHandles(element: RectangleElement | EllipseElement): readonly [PointMm, PointMm, PointMm, PointMm, PointMm, PointMm, PointMm, PointMm] {
  const half = { x: element.size.width / 2, y: element.size.height / 2 };
  const center = { x: element.position.x + half.x, y: element.position.y + half.y };
  return [
    transformPoint({ x: -half.x, y: -half.y }, center, element.rotation),
    transformPoint({ x: 0, y: -half.y }, center, element.rotation),
    transformPoint({ x: half.x, y: -half.y }, center, element.rotation),
    transformPoint({ x: half.x, y: 0 }, center, element.rotation),
    transformPoint({ x: half.x, y: half.y }, center, element.rotation),
    transformPoint({ x: 0, y: half.y }, center, element.rotation),
    transformPoint({ x: -half.x, y: half.y }, center, element.rotation),
    transformPoint({ x: -half.x, y: 0 }, center, element.rotation),
  ];
}

const corners = rotatedCorners;

export function resizeCorner(element: RectangleElement | EllipseElement, corner: ResizeCorner, pointer: PointMm, minimumSize = 1): ResizeGeometry {
  return resizeHandle(element, corner, pointer, minimumSize);
}

export function resizeHandle(element: RectangleElement | EllipseElement, handle: ResizeHandle, pointer: PointMm, minimumSize = 1): ResizeGeometry {
  assertPositive(minimumSize, "minimumSize");
  assertFinite(pointer.x, "pointer.x"); assertFinite(pointer.y, "pointer.y");
  const half = { x: element.size.width / 2, y: element.size.height / 2 };
  const center = { x: element.position.x + half.x, y: element.position.y + half.y };
  const localPointer = rotate({ x: pointer.x - center.x, y: pointer.y - center.y }, -element.rotation);
  const local = { x: localPointer.x + half.x, y: localPointer.y + half.y };
  const cornerSigns = handle === "nw" ? { x: -1, y: -1 } : handle === "ne" ? { x: 1, y: -1 } : handle === "se" ? { x: 1, y: 1 } : { x: -1, y: 1 };
  const isCorner = ["nw", "ne", "se", "sw"].includes(handle);
  const anchor = isCorner
    ? { x: cornerSigns.x < 0 ? element.size.width : 0, y: cornerSigns.y < 0 ? element.size.height : 0 }
    : handle === "n" || handle === "s"
      ? { x: element.size.width / 2, y: handle === "n" ? element.size.height : 0 }
      : { x: handle === "w" ? element.size.width : 0, y: element.size.height / 2 };
  let width = element.size.width;
  let height = element.size.height;
  let minX = 0;
  let minY = 0;
  if (isCorner) {
    const rawWidth = Math.abs(local.x - anchor.x);
    const rawHeight = Math.abs(local.y - anchor.y);
    const scale = Math.max(rawWidth / element.size.width, rawHeight / element.size.height, minimumSize / element.size.width, minimumSize / element.size.height);
    width = element.size.width * scale;
    height = element.size.height * scale;
    const direction = { x: Math.sign(local.x - anchor.x) || cornerSigns.x, y: Math.sign(local.y - anchor.y) || cornerSigns.y };
    minX = direction.x < 0 ? anchor.x - width : anchor.x;
    minY = direction.y < 0 ? anchor.y - height : anchor.y;
  } else if (handle === "n" || handle === "s") {
    height = Math.max(minimumSize, Math.abs(local.y - anchor.y));
    minY = local.y < anchor.y ? anchor.y - height : anchor.y;
  } else {
    width = Math.max(minimumSize, Math.abs(local.x - anchor.x));
    minX = local.x < anchor.x ? anchor.x - width : anchor.x;
  }
  const localCenter = { x: minX + width / 2 - half.x, y: minY + height / 2 - half.y };
  const worldCenter = { x: center.x + rotate(localCenter, element.rotation).x, y: center.y + rotate(localCenter, element.rotation).y };
  return { position: { x: worldCenter.x - width / 2, y: worldCenter.y - height / 2 }, size: { width, height } };
}

export function boundsOf(element: Element): Bounds {
  if (element.type === "dimension") return { x: element.offset.x - 1, y: element.offset.y - 1, width: 2, height: 2 };
  if (element.type === "line") {
    const [start, end] = rotatedLineEndpoints(element);
    return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
  }
  if (element.type === "contour") return contourBounds(element);
  if (element.type === "path") return pathBounds(element);
  if (element.type === "spline") return splineBounds(element);
  if (element.type === "glyph") return glyphBounds(element);
  if (element.type === "text") return { x: element.position.x, y: element.position.y, width: element.size.width * (element.scaleX ?? 1), height: element.size.height * (element.scaleY ?? 1) };
  const points = corners(element); const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}
export function boundsOfElements(elements: readonly Element[]): Bounds { if (!elements.length) throw new Error("At least one element is required"); const values = elements.map(boundsOf); const x = Math.min(...values.map((v) => v.x)); const y = Math.min(...values.map((v) => v.y)); const right = Math.max(...values.map((v) => v.x + v.width)); const bottom = Math.max(...values.map((v) => v.y + v.height)); return { x, y, width: right - x, height: bottom - y }; }
/** Returns true when any part of an element lies outside the page export rectangle. */
export function boundsOutsidePage(element: Element, page: SizeMm): boolean {
  assertPositive(page.width, "page.width"); assertPositive(page.height, "page.height");
  const bounds = boundsOf(element);
  return bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > page.width || bounds.y + bounds.height > page.height;
}
export function groupCenter(bounds: Bounds): PointMm { return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }; }
export function groupHandlePoints(bounds: Bounds): Readonly<Record<GroupHandle, PointMm>> { const r = bounds.x + bounds.width; const b = bounds.y + bounds.height; return { nw: { x: bounds.x, y: bounds.y }, n: { x: bounds.x + bounds.width / 2, y: bounds.y }, ne: { x: r, y: bounds.y }, e: { x: r, y: bounds.y + bounds.height / 2 }, se: { x: r, y: b }, s: { x: bounds.x + bounds.width / 2, y: b }, sw: { x: bounds.x, y: b }, w: { x: bounds.x, y: bounds.y + bounds.height / 2 }, center: groupCenter(bounds) }; }
export function resizeGroup(elements: readonly Element[], handle: ResizeHandle, pointer: PointMm, minimumSize = 1, aspectLock = false): readonly Element[] {
  const bounds = boundsOfElements(elements);
  const horizontal = handle.includes("e") || handle.includes("w");
  const vertical = handle.includes("n") || handle.includes("s");
  const anchorX = handle.includes("e") ? bounds.x : handle.includes("w") ? bounds.x + bounds.width : bounds.x + bounds.width / 2;
  const anchorY = handle.includes("s") ? bounds.y : handle.includes("n") ? bounds.y + bounds.height : bounds.y + bounds.height / 2;
  let width = Math.max(minimumSize, horizontal ? Math.abs(pointer.x - anchorX) : bounds.width);
  let height = Math.max(minimumSize, vertical ? Math.abs(pointer.y - anchorY) : bounds.height);
  if (aspectLock) {
    const ratio = bounds.width > 0 && bounds.height > 0 ? bounds.width / bounds.height : 1;
    if (horizontal && !vertical) height = Math.max(minimumSize, width / ratio);
    else if (vertical && !horizontal) width = Math.max(minimumSize, height * ratio);
    else if (horizontal && vertical) {
      const scale = Math.max(width / Math.max(bounds.width, minimumSize), height / Math.max(bounds.height, minimumSize));
      width = Math.max(minimumSize, bounds.width * scale);
      height = Math.max(minimumSize, bounds.height * scale);
    }
  }
  const x = handle.includes("w") ? anchorX - width : handle.includes("e") ? anchorX : bounds.x;
  const y = handle.includes("n") ? anchorY - height : handle.includes("s") ? anchorY : bounds.y;
  const sx = bounds.width ? width / bounds.width : 1;
  const sy = bounds.height ? height / bounds.height : 1;
  return elements.map((e) => e.type === "dimension" ? e : e.type === "line"
    ? { ...e, start: { x: x + (e.start.x - bounds.x) * sx, y: y + (e.start.y - bounds.y) * sy }, end: { x: x + (e.end.x - bounds.x) * sx, y: y + (e.end.y - bounds.y) * sy } }
    : e.type === "contour"
      ? contourWithPoints(e, e.contours.map((contour) => contour.points.map((point) => ({ x: x + (point.x - bounds.x) * sx, y: y + (point.y - bounds.y) * sy }))))
      : e.type === "path"
        ? { ...e, nodes: e.nodes.map((node) => ({ ...node, anchor: { x: x + (node.anchor.x - bounds.x) * sx, y: y + (node.anchor.y - bounds.y) * sy } })), segments: e.segments.map((segment) => segment.type === "cubicBezier" ? { ...segment, control1: { x: x + (segment.control1.x - bounds.x) * sx, y: y + (segment.control1.y - bounds.y) * sy }, control2: { x: x + (segment.control2.x - bounds.x) * sx, y: y + (segment.control2.y - bounds.y) * sy } } : segment) }
      : e.type === "glyph"
        ? { ...e, position: { x, y }, size: { width, height }, contours: e.contours.map((contour) => ({ ...contour, nodes: contour.nodes.map((node) => ({ ...node, anchor: { x: x + (node.anchor.x - bounds.x) * sx, y: y + (node.anchor.y - bounds.y) * sy } })), segments: contour.segments.map((segment) => segment.type === "cubicBezier" ? { ...segment, control1: { x: x + (segment.control1.x - bounds.x) * sx, y: y + (segment.control1.y - bounds.y) * sy }, control2: { x: x + (segment.control2.x - bounds.x) * sx, y: y + (segment.control2.y - bounds.y) * sy } } : segment) })) }
     : e.type === "spline"
       ? { ...e, nodes: e.nodes.map((node) => ({ ...node, anchor: { x: x + (node.anchor.x - bounds.x) * sx, y: y + (node.anchor.y - bounds.y) * sy }, ...(node.inHandle ? { inHandle: { dx: node.inHandle.dx * sx, dy: node.inHandle.dy * sy } } : {}), ...(node.outHandle ? { outHandle: { dx: node.outHandle.dx * sx, dy: node.outHandle.dy * sy } } : {}) })) }
      : e.type === "text"
        ? { ...e, position: { x: handle.includes("w") ? x : e.position.x, y: handle.includes("n") ? y : e.position.y }, scaleX: (e.scaleX ?? 1) * Math.abs(sx), scaleY: (e.scaleY ?? 1) * Math.abs(sy) }
     : { ...e, position: { x: x + (elementCenter(e).x - bounds.x) * sx - e.size.width * sx / 2, y: y + (elementCenter(e).y - bounds.y) * sy - e.size.height * sy / 2 }, size: { width: e.size.width * sx, height: e.size.height * sy } });
}
export function rotateElements(elements: readonly Element[], center: PointMm, delta: number): readonly Element[] {
  const rotatePoint = (point: PointMm): PointMm => transformPoint({ x: point.x - center.x, y: point.y - center.y }, center, delta);
  const rotateOffset = (offset: HandleOffset): HandleOffset => {
    const rotated = rotate({ x: offset.dx, y: offset.dy }, delta);
    return { dx: rotated.x, dy: rotated.y };
  };
  const rotateSplineNode = (node: SplineNode): SplineNode => ({
    ...node,
    anchor: rotatePoint(node.anchor),
    ...(node.inHandle ? { inHandle: rotateOffset(node.inHandle) } : {}),
    ...(node.outHandle ? { outHandle: rotateOffset(node.outHandle) } : {}),
  });
  return elements.map((element) => element.type === "dimension" ? element : element.type === "line"
    ? { ...element, start: rotatePoint(element.start), end: rotatePoint(element.end) }
    : element.type === "contour"
      ? contourWithPoints(element, element.contours.map((contour) => contour.points.map(rotatePoint)))
      : element.type === "path"
        ? { ...element, nodes: element.nodes.map((node) => ({ ...node, anchor: rotatePoint(node.anchor) })), segments: element.segments.map((segment) => segment.type === "cubicBezier" ? { ...segment, control1: rotatePoint(segment.control1), control2: rotatePoint(segment.control2) } : segment) }
        : element.type === "glyph"
          ? { ...element, position: { x: rotatePoint(elementCenter(element)).x - element.size.width / 2, y: rotatePoint(elementCenter(element)).y - element.size.height / 2 }, contours: element.contours.map((contour) => ({ ...contour, nodes: contour.nodes.map((node) => ({ ...node, anchor: rotatePoint(node.anchor) })), segments: contour.segments.map((segment) => segment.type === "cubicBezier" ? { ...segment, control1: rotatePoint(segment.control1), control2: rotatePoint(segment.control2) } : segment) })) }
        : element.type === "spline"
          ? { ...element, nodes: element.nodes.map(rotateSplineNode) }
          : (() => {
            const c = rotatePoint(elementCenter(element));
            return { ...element, position: { x: c.x - element.size.width / 2, y: c.y - element.size.height / 2 }, rotation: normalizeAngle(element.rotation + delta) };
          })());
}

const lineDistanceToSegment = (point: PointMm, start: PointMm, end: PointMm): number => {
  const dx = end.x - start.x; const dy = end.y - start.y; const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) throw new Error("Line endpoints must differ");
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
};

export function hitTest(element: Element, point: PointMm, toleranceMm = 0): boolean {
  assertFinite(toleranceMm, "toleranceMm"); if (toleranceMm < 0) throw new Error("toleranceMm must not be negative");
  if (element.type === "dimension") { const geometry = dimensionGeometry(element, []); return Boolean(geometry && Math.hypot(point.x - geometry.text.x, point.y - geometry.text.y) <= Math.max(toleranceMm, 2)); }
  if (element.type === "line") {
    const [start, end] = rotatedLineEndpoints(element);
    return lineDistanceToSegment(point, start, end) <= toleranceMm;
  }
  if (element.type === "contour") {
    return element.contours.reduce((inside, contour) => inside !== pointInRing(point, contour.points.map((value) => [value.x, value.y] as [number, number])), false);
  }
  if (element.type === "path") return pathHitTest(element, point, toleranceMm);
  if (element.type === "glyph") return element.contours.reduce((inside, contour) => inside !== pathHitTest(glyphPath(element, contour), point, toleranceMm), false);
      if (element.type === "spline") {
        const points = splinePoints(element);
        const onStroke = points.some((value, index) => index > 0 && contourSegmentDistance(point, points[index - 1]!, value) <= toleranceMm);
       if (onStroke || !element.closed) return onStroke;
        return pointInRing(point, points.map((value) => [value.x, value.y] as [number, number]));
      }
  const width = element.type === "text" ? element.size.width * Math.abs(element.scaleX ?? 1) : element.size.width;
  const height = element.type === "text" ? element.size.height * Math.abs(element.scaleY ?? 1) : element.size.height;
  const center = { x: element.position.x + width / 2, y: element.position.y + height / 2 };
  const local = rotate({ x: point.x - center.x, y: point.y - center.y }, -element.rotation);
  if (element.type === "rectangle" || element.type === "text") return Math.abs(local.x) <= width / 2 + toleranceMm && Math.abs(local.y) <= height / 2 + toleranceMm;
  const rx = width / 2 + toleranceMm; const ry = height / 2 + toleranceMm;
  return (local.x * local.x) / (rx * rx) + (local.y * local.y) / (ry * ry) <= 1;
}
export function pathHitTest(path: PathElement, point: PointMm, toleranceMm = 0): boolean {
  const distance = (a: PointMm, b: PointMm): number => { const dx = b.x - a.x; const dy = b.y - a.y; const length = dx * dx + dy * dy; const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)); return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)); };
  const onStroke = path.segments.some((segment) => {
    if (segment.type === "line") { const a = path.nodes.find((node) => node.id === segment.startNodeId)!.anchor; const b = path.nodes.find((node) => node.id === segment.endNodeId)!.anchor; return distance(a, b) <= toleranceMm; }
    return flattenCubicBezier(cubic(segment, path), Math.max(toleranceMm, 0.1)).some((item, index, points) => index > 0 && distance(points[index - 1]!, item) <= toleranceMm);
  });
  if (onStroke) return true;
  if (!path.closed) return false;
  const polygon = flattenPath(path);
  return pointInRing(point, polygon.map((value) => [value.x, value.y] as [number, number]));
}

export function mmToScreen(point: PointMm, viewport: Viewport): PointPx { assertPositive(viewport.zoom, "zoom"); return { x: (point.x - viewport.panMm.x) * viewport.zoom, y: (point.y - viewport.panMm.y) * viewport.zoom }; }
export function screenToMm(point: PointPx, viewport: Viewport): PointMm { assertPositive(viewport.zoom, "zoom"); return { x: point.x / viewport.zoom + viewport.panMm.x, y: point.y / viewport.zoom + viewport.panMm.y }; }
export function normalizeAngle(angle: number): number { assertFinite(angle, "angle"); return ((angle % TAU) + TAU) % TAU; }
export function degreesToRadians(degrees: number): number { assertFinite(degrees, "degrees"); return normalizeAngle(degrees * Math.PI / 180); }
export function radiansToDegrees(radians: number): number { return normalizeAngle(radians) * 180 / Math.PI; }
