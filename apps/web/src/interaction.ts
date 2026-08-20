import type { DocumentSnapshot, ElementId, PointMm } from "@nodra/domain";
import { boundsOf, hitTest, type Bounds } from "@nodra/geometry";

export interface DragGeometry { readonly position: PointMm; readonly size: { readonly width: number; readonly height: number } }

export function screenDeltaToMm(delta: PointMm, zoom: number): PointMm {
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error("zoom must be positive");
  return { x: delta.x / zoom, y: delta.y / zoom };
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
