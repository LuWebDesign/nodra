import type { Element, EllipseElement, PointMm, RectangleElement, SizeMm } from "@nodra/domain";

export interface Bounds { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface Viewport { readonly zoom: number; readonly panMm: PointMm }
export interface PointPx { readonly x: number; readonly y: number }
export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export type ResizeCorner = Extract<ResizeHandle, "nw" | "ne" | "se" | "sw">;
export interface ResizeGeometry { readonly position: PointMm; readonly size: SizeMm }

const TAU = Math.PI * 2;
const assertFinite = (value: number, name: string): void => { if (!Number.isFinite(value)) throw new Error(`${name} must be finite`); };
const assertPositive = (value: number, name: string): void => { assertFinite(value, name); if (value <= 0) throw new Error(`${name} must be positive`); };
const rotate = (point: PointMm, angle: number): PointMm => ({ x: point.x * Math.cos(angle) - point.y * Math.sin(angle), y: point.x * Math.sin(angle) + point.y * Math.cos(angle) });

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
    return { x: Math.min(element.start.x, element.end.x), y: Math.min(element.start.y, element.end.y), width: Math.abs(element.end.x - element.start.x), height: Math.abs(element.end.y - element.start.y) };
  }
  const points = corners(element); const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

const distanceToSegment = (point: PointMm, start: PointMm, end: PointMm): number => {
  const dx = end.x - start.x; const dy = end.y - start.y; const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) throw new Error("Line endpoints must differ");
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
};

export function hitTest(element: Element, point: PointMm, toleranceMm = 0): boolean {
  assertFinite(toleranceMm, "toleranceMm"); if (toleranceMm < 0) throw new Error("toleranceMm must not be negative");
  if (element.type === "line") return distanceToSegment(point, element.start, element.end) <= toleranceMm;
  const center = { x: element.position.x + element.size.width / 2, y: element.position.y + element.size.height / 2 };
  const local = rotate({ x: point.x - center.x, y: point.y - center.y }, -element.rotation);
  if (element.type === "rectangle") return Math.abs(local.x) <= element.size.width / 2 + toleranceMm && Math.abs(local.y) <= element.size.height / 2 + toleranceMm;
  const rx = element.size.width / 2 + toleranceMm; const ry = element.size.height / 2 + toleranceMm;
  return (local.x * local.x) / (rx * rx) + (local.y * local.y) / (ry * ry) <= 1;
}

export function mmToScreen(point: PointMm, viewport: Viewport): PointPx { assertPositive(viewport.zoom, "zoom"); return { x: (point.x - viewport.panMm.x) * viewport.zoom, y: (point.y - viewport.panMm.y) * viewport.zoom }; }
export function screenToMm(point: PointPx, viewport: Viewport): PointMm { assertPositive(viewport.zoom, "zoom"); return { x: point.x / viewport.zoom + viewport.panMm.x, y: point.y / viewport.zoom + viewport.panMm.y }; }
export function normalizeAngle(angle: number): number { assertFinite(angle, "angle"); return ((angle % TAU) + TAU) % TAU; }
