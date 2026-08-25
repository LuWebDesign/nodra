import polygonClipping, { type MultiPolygon } from "polygon-clipping";
import type { ContourElement, DimensionElement, DimensionReference, Element, EllipseElement, LineElement, PathElement, PointMm, RectangleElement, SizeMm } from "@nodra/domain";

export interface Bounds { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface Viewport { readonly zoom: number; readonly panMm: PointMm }
export interface PointPx { readonly x: number; readonly y: number }
export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export type GroupHandle = ResizeHandle | "center";
export type Direction = "north-west" | "north" | "north-east" | "west" | "center" | "east" | "south-west" | "south" | "south-east";
export type ResizeCorner = Extract<ResizeHandle, "nw" | "ne" | "se" | "sw">;
export interface ResizeGeometry { readonly position: PointMm; readonly size: SizeMm }
export type RealGeometryNodeKind = "corner" | "edge-midpoint" | "endpoint" | "center" | "cardinal";
export interface RealGeometryNode { readonly kind: RealGeometryNodeKind; readonly point: PointMm }
export const ELLIPSE_APPROXIMATION_SEGMENTS = 64;
export const ROUNDED_RECTANGLE_APPROXIMATION_SEGMENTS = 8;

export interface CubicBezier { readonly p0: PointMm; readonly p1: PointMm; readonly p2: PointMm; readonly p3: PointMm }
export interface PathNodeGeometry { readonly nodeId: string; readonly kind: "anchor" | "inHandle" | "outHandle"; readonly point: PointMm }
export interface DimensionGeometry { readonly start: PointMm; readonly end: PointMm; readonly lineStart: PointMm; readonly lineEnd: PointMm; readonly text: PointMm; readonly value: number }

export function cubicBezierPoint(curve: CubicBezier, t: number): PointMm {
  assertFinite(t, "t"); const u = 1 - t;
  return { x: u ** 3 * curve.p0.x + 3 * u ** 2 * t * curve.p1.x + 3 * u * t ** 2 * curve.p2.x + t ** 3 * curve.p3.x, y: u ** 3 * curve.p0.y + 3 * u ** 2 * t * curve.p1.y + 3 * u * t ** 2 * curve.p2.y + t ** 3 * curve.p3.y };
}
export function cubicBezierDerivative(curve: CubicBezier, t: number): PointMm {
  assertFinite(t, "t"); const u = 1 - t;
  return { x: 3 * (u ** 2 * (curve.p1.x - curve.p0.x) + 2 * u * t * (curve.p2.x - curve.p1.x) + t ** 2 * (curve.p3.x - curve.p2.x)), y: 3 * (u ** 2 * (curve.p1.y - curve.p0.y) + 2 * u * t * (curve.p2.y - curve.p1.y) + t ** 2 * (curve.p3.y - curve.p2.y)) };
}
function quadraticRoots(a: number, b: number, c: number): number[] {
  const epsilon = 1e-12;
  if (Math.abs(a) < epsilon) return Math.abs(b) < epsilon ? [] : [-c / b];
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -epsilon) return [];
  if (Math.abs(discriminant) <= epsilon) return [-b / (2 * a)];
  const root = Math.sqrt(discriminant); return [(-b - root) / (2 * a), (-b + root) / (2 * a)];
}
export function cubicBezierBounds(curve: CubicBezier): Bounds {
  const values = [0, 1];
  for (const axis of ["x", "y"] as const) {
    const a = -curve.p0[axis] + 3 * curve.p1[axis] - 3 * curve.p2[axis] + curve.p3[axis];
    const b = 2 * (curve.p0[axis] - 2 * curve.p1[axis] + curve.p2[axis]);
    const c = curve.p1[axis] - curve.p0[axis];
    values.push(...quadraticRoots(3 * a, 3 * b, 3 * c).filter((t) => t > 0 && t < 1));
  }
  const points = values.map((t) => cubicBezierPoint(curve, t)); const xs = points.map((p) => p.x); const ys = points.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}
export function splitCubicBezier(curve: CubicBezier, t: number): readonly [CubicBezier, CubicBezier] {
  assertFinite(t, "t"); if (t < 0 || t > 1) throw new Error("t must be between 0 and 1");
  const lerp = (a: PointMm, b: PointMm): PointMm => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const p01 = lerp(curve.p0, curve.p1), p12 = lerp(curve.p1, curve.p2), p23 = lerp(curve.p2, curve.p3); const p012 = lerp(p01, p12), p123 = lerp(p12, p23); const mid = lerp(p012, p123);
  return [{ p0: curve.p0, p1: p01, p2: p012, p3: mid }, { p0: mid, p1: p123, p2: p23, p3: curve.p3 }];
}
const pointLineDistance = (point: PointMm, start: PointMm, end: PointMm): number => { const dx = end.x - start.x; const dy = end.y - start.y; const length = Math.hypot(dx, dy); return length === 0 ? Math.hypot(point.x - start.x, point.y - start.y) : Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / length; };
export function flattenCubicBezier(curve: CubicBezier, tolerance = 0.1): readonly PointMm[] {
  assertPositive(tolerance, "tolerance"); const output: PointMm[] = [curve.p0];
  const visit = (current: CubicBezier, depth: number): void => { if (depth >= 20 || Math.max(pointLineDistance(current.p1, current.p0, current.p3), pointLineDistance(current.p2, current.p0, current.p3)) <= tolerance) { output.push(current.p3); return; } const [left, right] = splitCubicBezier(current, 0.5); visit(left, depth + 1); visit(right, depth + 1); };
  visit(curve, 0); return output;
}
export function pathBounds(element: PathElement): Bounds { const nodes = new Map(element.nodes.map((node) => [node.id, node.anchor])); const bounds = element.segments.map((s) => s.type === "line" ? (() => { const a = nodes.get(s.startNodeId)!; const b = nodes.get(s.endNodeId)!; return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }; })() : cubicBezierBounds({ p0: nodes.get(s.startNodeId)!, p1: s.control1, p2: s.control2, p3: nodes.get(s.endNodeId)! })); const x = Math.min(...bounds.map((b) => b.x)); const y = Math.min(...bounds.map((b) => b.y)); const right = Math.max(...bounds.map((b) => b.x + b.width)); const bottom = Math.max(...bounds.map((b) => b.y + b.height)); return { x, y, width: right - x, height: bottom - y }; }
export function pathGeometryNodes(element: PathElement): readonly PathNodeGeometry[] {
  return element.nodes.flatMap((node) => {
    const incoming = element.segments.find((segment) => segment.type === "cubicBezier" && segment.endNodeId === node.id);
    const outgoing = element.segments.find((segment) => segment.type === "cubicBezier" && segment.startNodeId === node.id);
    return [{ nodeId: node.id, kind: "anchor" as const, point: node.anchor }, ...(incoming?.type === "cubicBezier" ? [{ nodeId: node.id, kind: "inHandle" as const, point: incoming.control2 }] : []), ...(outgoing?.type === "cubicBezier" ? [{ nodeId: node.id, kind: "outHandle" as const, point: outgoing.control1 }] : [])];
  });
}

export function resolveDimensionReference(elements: readonly Element[], reference: DimensionReference): PointMm | undefined {
  const target = elements.find((element) => element.id === reference.elementId);
  if (!target || target.type === "dimension") return undefined;
  return realGeometryNodes(target)[reference.nodeIndex]?.point;
}

export function dimensionValue(kind: DimensionElement["kind"], start: PointMm, end: PointMm): number {
  assertFinite(start.x, "start.x"); assertFinite(start.y, "start.y"); assertFinite(end.x, "end.x"); assertFinite(end.y, "end.y");
  if (kind === "horizontal") return Math.abs(end.x - start.x);
  if (kind === "vertical") return Math.abs(end.y - start.y);
  return Math.hypot(end.x - start.x, end.y - start.y);
}

export function dimensionGeometry(element: DimensionElement, elements: readonly Element[]): DimensionGeometry | undefined {
  const start = resolveDimensionReference(elements, element.references[0]);
  const end = resolveDimensionReference(elements, element.references[1]);
  if (!start || !end) return undefined;
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const text = { x: midpoint.x + element.offset.x, y: midpoint.y + element.offset.y };
  const lineStart = element.kind === "horizontal" ? { x: start.x, y: text.y } : element.kind === "vertical" ? { x: text.x, y: start.y } : { x: start.x + element.offset.x, y: start.y + element.offset.y };
  const lineEnd = element.kind === "horizontal" ? { x: end.x, y: text.y } : element.kind === "vertical" ? { x: text.x, y: end.y } : { x: end.x + element.offset.x, y: end.y + element.offset.y };
  return { start, end, lineStart, lineEnd, text, value: dimensionValue(element.kind, start, end) };
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
  return element.type === "line"
    ? { x: (element.start.x + element.end.x) / 2, y: (element.start.y + element.end.y) / 2 }
    : element.type === "dimension" ? { x: element.offset.x, y: element.offset.y }
    : element.type === "contour" ? groupCenter(contourBounds(element))
    : element.type === "path" ? groupCenter(pathBounds(element))
    : { x: element.position.x + element.size.width / 2, y: element.position.y + element.size.height / 2 };
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
  return { ...element, position, size: { width: Math.max(...xs) - position.x, height: Math.max(...ys) - position.y }, contours: points.map((ring) => ({ points: [...ring] })), rotation: 0 };
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
  if (element.type === "line" || element.type === "dimension") throw new Error("Shape operations require closed objects");
  if (element.type === "contour") return [element.contours.map((contour) => contour.points.map((point) => [point.x, point.y] as [number, number]))];
  if (element.type === "path") { if (!element.closed) throw new Error("Shape operations require closed objects"); return [[flattenPath(element).map((point) => [point.x, point.y] as [number, number])]]; }
  return [[primitivePolygon(element)]];
}

export function contoursFromMultiPolygon(polygons: MultiPolygon): ContourElement["contours"] {
  return polygons.flatMap((polygon) => polygon.map((ring) => ({ points: ring.map(([x, y]) => ({ x, y })) })));
}

export type ShapeOperation = "union" | "difference";
export function shapeResultContours(operation: ShapeOperation, elements: readonly Element[]): ContourElement["contours"] {
  if (!elements.length || elements.some((element) => element.type === "line" || element.type === "dimension")) throw new Error("Shape operations require closed objects");
  const polygons = elements.map(closedElementToPolygon);
  const result = operation === "difference" ? polygonClipping.difference(polygons[0]!, polygons[1]!) : polygonClipping.union(polygons[0]!, ...polygons.slice(1));
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
  if (element.type === "path") return pathGeometryNodes(element).filter((node) => node.kind === "anchor").map((node) => ({ x: node.point.x + (node.point.x - center.x) / Math.max(1, Math.hypot(node.point.x - center.x, node.point.y - center.y)) * offsetMm, y: node.point.y + (node.point.y - center.y) / Math.max(1, Math.hypot(node.point.x - center.x, node.point.y - center.y)) * offsetMm }));
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
  if (element.type === "path") return [{ kind: "center", point: elementCenter(element) }, ...pathGeometryNodes(element).map((node) => ({ kind: node.kind === "anchor" ? "corner" as const : "cardinal" as const, point: node.point }))];
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
  const points = corners(element); const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}
export function boundsOfElements(elements: readonly Element[]): Bounds { if (!elements.length) throw new Error("At least one element is required"); const values = elements.map(boundsOf); const x = Math.min(...values.map((v) => v.x)); const y = Math.min(...values.map((v) => v.y)); const right = Math.max(...values.map((v) => v.x + v.width)); const bottom = Math.max(...values.map((v) => v.y + v.height)); return { x, y, width: right - x, height: bottom - y }; }
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
  return elements.map((e) => e.type === "line"
    ? { ...e, start: { x: x + (e.start.x - bounds.x) * sx, y: y + (e.start.y - bounds.y) * sy }, end: { x: x + (e.end.x - bounds.x) * sx, y: y + (e.end.y - bounds.y) * sy } }
     : e.type === "contour"
      ? contourWithPoints(e, e.contours.map((contour) => contour.points.map((point) => ({ x: x + (point.x - bounds.x) * sx, y: y + (point.y - bounds.y) * sy }))))
     : e.type === "path" || e.type === "dimension" ? e : { ...e, position: { x: x + (elementCenter(e).x - bounds.x) * sx - e.size.width * sx / 2, y: y + (elementCenter(e).y - bounds.y) * sy - e.size.height * sy / 2 }, size: { width: e.size.width * sx, height: e.size.height * sy } });
}
export function rotateElements(elements: readonly Element[], center: PointMm, delta: number): readonly Element[] { const rotatePoint = (p: PointMm) => transformPoint({ x: p.x - center.x, y: p.y - center.y }, center, delta); return elements.map((e) => e.type === "line" ? { ...e, start: rotatePoint(e.start), end: rotatePoint(e.end) } : e.type === "contour" ? contourWithPoints(e, e.contours.map((contour) => contour.points.map(rotatePoint))) : e.type === "path" ? { ...e, nodes: e.nodes.map((node) => ({ ...node, anchor: rotatePoint(node.anchor) })), segments: e.segments.map((segment) => segment.type === "cubicBezier" ? { ...segment, control1: rotatePoint(segment.control1), control2: rotatePoint(segment.control2) } : segment) } : e.type === "dimension" ? e : (() => { const c = rotatePoint(elementCenter(e)); return { ...e, position: { x: c.x - e.size.width / 2, y: c.y - e.size.height / 2 }, rotation: normalizeAngle(e.rotation + delta) }; })()); }

const distanceToSegment = (point: PointMm, start: PointMm, end: PointMm): number => {
  const dx = end.x - start.x; const dy = end.y - start.y; const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) throw new Error("Line endpoints must differ");
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
};

export function hitTest(element: Element, point: PointMm, toleranceMm = 0): boolean {
  assertFinite(toleranceMm, "toleranceMm"); if (toleranceMm < 0) throw new Error("toleranceMm must not be negative");
  if (element.type === "dimension") return Math.hypot(point.x - element.offset.x, point.y - element.offset.y) <= Math.max(toleranceMm, 2);
  if (element.type === "line") {
    const [start, end] = rotatedLineEndpoints(element);
    return distanceToSegment(point, start, end) <= toleranceMm;
  }
  if (element.type === "contour") {
    return element.contours.reduce((inside, contour) => inside !== pointInRing(point, contour.points.map((value) => [value.x, value.y] as [number, number])), false);
  }
  if (element.type === "path") {
    if (element.closed && pointInRing(point, flattenPath(element).map((value) => [value.x, value.y] as [number, number]))) return true;
    const nodes = new Map(element.nodes.map((node) => [node.id, node.anchor]));
    return element.segments.some((segment) => { const a = nodes.get(segment.startNodeId)!; const b = nodes.get(segment.endNodeId)!; if (segment.type === "line") return distanceToSegment(point, a, b) <= toleranceMm; return flattenCubicBezier({ p0: a, p1: segment.control1, p2: segment.control2, p3: b }, Math.max(toleranceMm, 0.1)).some((next, index, points) => index > 0 && distanceToSegment(point, points[index - 1]!, next) <= toleranceMm); });
  }
  const center = { x: element.position.x + element.size.width / 2, y: element.position.y + element.size.height / 2 };
  const local = rotate({ x: point.x - center.x, y: point.y - center.y }, -element.rotation);
  if (element.type === "rectangle") return Math.abs(local.x) <= element.size.width / 2 + toleranceMm && Math.abs(local.y) <= element.size.height / 2 + toleranceMm;
  const rx = element.size.width / 2 + toleranceMm; const ry = element.size.height / 2 + toleranceMm;
  return (local.x * local.x) / (rx * rx) + (local.y * local.y) / (ry * ry) <= 1;
}

export function mmToScreen(point: PointMm, viewport: Viewport): PointPx { assertPositive(viewport.zoom, "zoom"); return { x: (point.x - viewport.panMm.x) * viewport.zoom, y: (point.y - viewport.panMm.y) * viewport.zoom }; }
export function screenToMm(point: PointPx, viewport: Viewport): PointMm { assertPositive(viewport.zoom, "zoom"); return { x: point.x / viewport.zoom + viewport.panMm.x, y: point.y / viewport.zoom + viewport.panMm.y }; }
export function normalizeAngle(angle: number): number { assertFinite(angle, "angle"); return ((angle % TAU) + TAU) % TAU; }
export function degreesToRadians(degrees: number): number { assertFinite(degrees, "degrees"); return normalizeAngle(degrees * Math.PI / 180); }
export function radiansToDegrees(radians: number): number { return normalizeAngle(radians) * 180 / Math.PI; }

function flattenPath(element: PathElement): readonly PointMm[] {
  const nodes = new Map(element.nodes.map((node) => [node.id, node.anchor])); const output: PointMm[] = [];
  element.segments.forEach((segment, index) => { const start = nodes.get(segment.startNodeId)!; if (index === 0) output.push(start); if (segment.type === "line") output.push(nodes.get(segment.endNodeId)!); else output.push(...flattenCubicBezier({ p0: start, p1: segment.control1, p2: segment.control2, p3: nodes.get(segment.endNodeId)! }).slice(1)); });
  return output;
}
