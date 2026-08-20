import type { DocumentSnapshot, Element, ElementId, PointMm } from "@nodra/domain";
import { boundsOf, hitTest, type Bounds } from "@nodra/geometry";

export interface DragGeometry { readonly position: PointMm; readonly size: { readonly width: number; readonly height: number } }

export type DrawingTool = "rectangle" | "ellipse" | "line";

export type PointerDownIntent = "draw" | "select";

export function pointerDownIntent(tool: string, hit: ElementId | undefined): PointerDownIntent {
  return isDrawingTool(tool) && hit === undefined ? "draw" : "select";
}

export function isDrawingTool(tool: string): tool is DrawingTool {
  return tool === "rectangle" || tool === "ellipse" || tool === "line";
}

export function movementExceedsThreshold(start: PointMm, end: PointMm, threshold = 3): boolean {
  if (![start.x, start.y, end.x, end.y, threshold].every(Number.isFinite) || threshold < 0) throw new Error("movement coordinates and threshold must be finite");
  return Math.hypot(end.x - start.x, end.y - start.y) >= threshold;
}

export function screenDeltaToMm(delta: PointMm, zoom: number): PointMm {
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error("zoom must be positive");
  return { x: delta.x / zoom, y: delta.y / zoom };
}

/** Converts a pointer client coordinate into pixels local to the canvas element. */
export function clientPointToCanvas(client: PointMm, rect: { readonly left: number; readonly top: number }): PointMm {
  return { x: client.x - rect.left, y: client.y - rect.top };
}

/** Converts canonical page coordinates into pixels relative to the canvas. */
export function pagePointToCanvas(point: PointMm, zoom: number, panMm: PointMm): PointMm {
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error("zoom must be positive");
  return { x: (point.x - panMm.x) * zoom, y: (point.y - panMm.y) * zoom };
}

export function selectionFrame(element: Element, zoom: number, panMm: PointMm): { readonly left: number; readonly top: number; readonly width: number; readonly height: number } {
  const bounds = boundsOf(element);
  const topLeft = pagePointToCanvas({ x: bounds.x, y: bounds.y }, zoom, panMm);
  return { left: topLeft.x - (bounds.width === 0 ? 1 : 0), top: topLeft.y - (bounds.height === 0 ? 1 : 0), width: Math.max(2, bounds.width * zoom), height: Math.max(2, bounds.height * zoom) };
}

/** Converts canonical page coordinates into coordinates relative to the scaled page layer. */
export function pagePointToScreen(point: PointMm, zoom: number): PointMm {
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error("zoom must be positive");
  return { x: point.x * zoom, y: point.y * zoom };
}

export function screenPointToMm(point: PointMm, origin: PointMm, zoom: number, panMm: PointMm): PointMm {
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error("zoom must be positive");
  return { x: (point.x - origin.x) / zoom + panMm.x, y: (point.y - origin.y) / zoom + panMm.y };
}

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 8;

export function zoomAtPoint(zoom: number, panMm: PointMm, pointPx: PointMm, nextZoom: number): { readonly zoom: number; readonly panMm: PointMm } {
  if (![zoom, nextZoom, panMm.x, panMm.y, pointPx.x, pointPx.y].every(Number.isFinite) || zoom <= 0) throw new Error("zoom values and coordinates must be finite and positive where applicable");
  const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
  const anchor = { x: pointPx.x / zoom + panMm.x, y: pointPx.y / zoom + panMm.y };
  return { zoom: clamped, panMm: { x: anchor.x - pointPx.x / clamped, y: anchor.y - pointPx.y / clamped } };
}

export function normalizeDrag(start: PointMm, end: PointMm, minimumSize = 1): DragGeometry {
  if (!Number.isFinite(minimumSize) || minimumSize <= 0) throw new Error("minimumSize must be positive");
  return { position: { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) }, size: { width: Math.max(minimumSize, Math.abs(end.x - start.x)), height: Math.max(minimumSize, Math.abs(end.y - start.y)) } };
}

export function normalizeBounds(start: PointMm, end: PointMm): Bounds {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}

export function containsBounds(container: Bounds, candidate: Bounds): boolean {
  return candidate.x >= container.x && candidate.y >= container.y && candidate.x + candidate.width <= container.x + container.width && candidate.y + candidate.height <= container.y + container.height;
}

export function pickElement(document: DocumentSnapshot, point: PointMm, zoom: number): ElementId | undefined {
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error("zoom must be positive");
  const visible = new Set(document.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const layerOrder = new Map(document.layers.map((layer) => [layer.id, layer.order]));
  const tolerance = 6 / zoom;
  return [...document.elements].sort((a, b) => (layerOrder.get(a.layerId) ?? 0) - (layerOrder.get(b.layerId) ?? 0)).reverse().find((element) => visible.has(element.layerId) && hitTest(element, point, tolerance))?.id;
}

export function elementsContainedBy(document: DocumentSnapshot, marquee: Bounds): ElementId[] {
  const visible = new Set(document.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  return document.elements.filter((element) => visible.has(element.layerId) && containsBounds(marquee, boundsOf(element))).map((element) => element.id);
}

export function marqueeSelection(document: DocumentSnapshot, start: PointMm, end: PointMm): ElementId[] {
  return elementsContainedBy(document, normalizeBounds(start, end));
}
