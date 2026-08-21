import { difference, union, type MultiPolygon } from "polygon-clipping";
import type { ContourElement, Element, EllipseElement, LineElement, PointMm, RectangleElement, SizeMm } from "@nodra/domain";

export interface Bounds { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface Viewport { readonly zoom: number; readonly panMm: PointMm }
export interface PointPx { readonly x: number; readonly y: number }
export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export type GroupHandle = ResizeHandle | "center";
export type ResizeCorner = Extract<ResizeHandle, "nw" | "ne" | "se" | "sw">;
export interface ResizeGeometry { readonly position: PointMm; readonly size: SizeMm }
export type RealGeometryNodeKind = "corner" | "edge-midpoint" | "endpoint" | "center" | "cardinal";
export interface RealGeometryNode { readonly kind: RealGeometryNodeKind; readonly point: PointMm }
export const ELLIPSE_APPROXIMATION_SEGMENTS = 64;
export const ROUNDED_RECTANGLE_APPROXIMATION_SEGMENTS = 8;

const TAU = Math.PI * 2;
const assertFinite = (value: number, name: string): void => { if (!Number.isFinite(value)) throw new Error(`${name} must be finite`); };
const assertPositive = (value: number, name: string): void => { assertFinite(value, name); if (value <= 0) throw new Error(`${name} must be positive`); };
const rotate = (point: PointMm, angle: number): PointMm => ({ x: point.x * Math.cos(angle) - point.y * Math.sin(angle), y: point.x * Math.sin(angle) + point.y * Math.cos(angle) });

export function elementCenter(element: Element): PointMm {
  return element.type === "line"
    ? { x: (element.start.x + element.end.x) / 2, y: (element.start.y + element.end.y) / 2 }
    : element.type === "contour" ? groupCenter(contourBounds(element))
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
  if (element.type === "line") throw new Error("Shape operations require closed objects");
  if (element.type === "contour") return [element.contours.map((contour) => contour.points.map((point) => [point.x, point.y] as [number, number]))];
  return [[primitivePolygon(element)]];
}

export function contoursFromMultiPolygon(polygons: MultiPolygon): ContourElement["contours"] {
  return polygons.flatMap((polygon) => polygon.map((ring) => ({ points: ring.map(([x, y]) => ({ x, y })) })));
}

export type ShapeOperation = "union" | "difference";
export function shapeResultContours(operation: ShapeOperation, elements: readonly Element[]): ContourElement["contours"] {
  if (!elements.length || elements.some((element) => element.type === "line")) throw new Error("Shape operations require closed objects");
  const polygons = elements.map(closedElementToPolygon);
  const result = operation === "difference" ? difference(polygons[0]!, polygons[1]!) : union(polygons[0]!, ...polygons.slice(1));
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
  if (element.type === "line") {
    const [start, end] = rotatedLineEndpoints(element);
    return [{ kind: "endpoint", point: start }, { kind: "center", point: elementCenter(element) }, { kind: "endpoint", point: end }];
  }
  if (element.type === "contour") return element.contours.flatMap((contour) => contour.points.map((point) => ({ kind: "corner" as const, point })));
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
  if (element.type === "line") {
    const [start, end] = rotatedLineEndpoints(element);
    return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
  }
  if (element.type === "contour") return contourBounds(element);
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
    : { ...e, position: { x: x + (elementCenter(e).x - bounds.x) * sx - e.size.width * sx / 2, y: y + (elementCenter(e).y - bounds.y) * sy - e.size.height * sy / 2 }, size: { width: e.size.width * sx, height: e.size.height * sy } });
}
export function rotateElements(elements: readonly Element[], center: PointMm, delta: number): readonly Element[] { const rotatePoint = (p: PointMm) => transformPoint({ x: p.x - center.x, y: p.y - center.y }, center, delta); return elements.map((e) => e.type === "line" ? { ...e, start: rotatePoint(e.start), end: rotatePoint(e.end) } : e.type === "contour" ? contourWithPoints(e, e.contours.map((contour) => contour.points.map(rotatePoint))) : (() => { const c = rotatePoint(elementCenter(e)); return { ...e, position: { x: c.x - e.size.width / 2, y: c.y - e.size.height / 2 }, rotation: normalizeAngle(e.rotation + delta) }; })()); }

const distanceToSegment = (point: PointMm, start: PointMm, end: PointMm): number => {
  const dx = end.x - start.x; const dy = end.y - start.y; const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) throw new Error("Line endpoints must differ");
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
};

export function hitTest(element: Element, point: PointMm, toleranceMm = 0): boolean {
  assertFinite(toleranceMm, "toleranceMm"); if (toleranceMm < 0) throw new Error("toleranceMm must not be negative");
  if (element.type === "line") {
    const [start, end] = rotatedLineEndpoints(element);
    return distanceToSegment(point, start, end) <= toleranceMm;
  }
  if (element.type === "contour") {
    return element.contours.reduce((inside, contour) => inside !== pointInRing(point, contour.points.map((value) => [value.x, value.y] as [number, number])), false);
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
