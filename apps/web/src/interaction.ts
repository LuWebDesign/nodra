import type { DocumentSnapshot, Element, ElementId, PointMm } from "@nodra/domain";
import { boundsOf, hitTest, realGeometryNodes, type Bounds, type RealGeometryNode } from "@nodra/geometry";

export interface DragGeometry { readonly position: PointMm; readonly size: { readonly width: number; readonly height: number } }
export interface SnapGuide { readonly source: PointMm; readonly target: PointMm }
export interface SnapMoveResult { readonly delta: PointMm; readonly guide: SnapGuide | undefined }
export interface NodeHit { readonly elementId: ElementId; readonly nodeIndex: number; readonly node: RealGeometryNode }

export type DrawingTool = "rectangle" | "ellipse" | "line";

export type PointerDownIntent = "draw" | "select";
export type TransformMode = "resize" | "rotate";

export function canActivateRotation(tool: string, selectedIds: readonly ElementId[], hit: ElementId | undefined): boolean {
  return tool === "select" && selectedIds.length === 1 && hit === selectedIds[0];
}

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

/** Finds one deterministic document-space correction for a move gesture. */
export function snapMoveDelta(document: DocumentSnapshot, selectedIds: readonly ElementId[], rawDelta: PointMm, zoom: number, tolerancePx = 8, anchor?: NodeHit): SnapMoveResult {
  if (![rawDelta.x, rawDelta.y, zoom, tolerancePx].every(Number.isFinite) || zoom <= 0 || tolerancePx < 0) throw new Error("snap coordinates, zoom, and tolerance must be valid");
  const selected = new Set(selectedIds);
  const visibleLayers = new Set(document.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const moving = anchor
    ? [{ point: { x: anchor.node.point.x + rawDelta.x, y: anchor.node.point.y + rawDelta.y }, order: `${anchor.elementId}:${anchor.nodeIndex}` }]
    : document.elements.filter((element) => selected.has(element.id)).flatMap((element) => realGeometryNodes(element).map((node, index) => ({ point: { x: node.point.x + rawDelta.x, y: node.point.y + rawDelta.y }, order: `${element.id}:${index}` })));
  const targets = document.elements.filter((element) => !selected.has(element.id) && visibleLayers.has(element.layerId)).flatMap((element) => realGeometryNodes(element).map((node, index) => ({ point: node.point, order: `${element.id}:${index}` })));
  let best: { distance: number; source: PointMm; target: PointMm; sourceOrder: string; targetOrder: string } | undefined;
  for (const source of moving) for (const target of targets) {
    const distance = Math.hypot(source.point.x - target.point.x, source.point.y - target.point.y) * zoom;
    const candidate = { distance, source: source.point, target: target.point, sourceOrder: source.order, targetOrder: target.order };
    if (distance <= tolerancePx && (!best || distance < best.distance || distance === best.distance && `${candidate.sourceOrder}:${candidate.targetOrder}` < `${best.sourceOrder}:${best.targetOrder}`)) best = candidate;
  }
  if (!best) return { delta: rawDelta, guide: undefined };
  const correction = { x: best.target.x - best.source.x, y: best.target.y - best.source.y };
  return { delta: { x: rawDelta.x + correction.x, y: rawDelta.y + correction.y }, guide: { source: { x: best.source.x + correction.x, y: best.source.y + correction.y }, target: best.target } };
}

/** Finds a visible real node before falling back to shape hit-testing. Tolerance is screen-pixel based. */
export function pickNode(document: DocumentSnapshot, point: PointMm, zoom: number, tolerancePx = 8): NodeHit | undefined {
  if (![point.x, point.y, zoom, tolerancePx].every(Number.isFinite) || zoom <= 0 || tolerancePx < 0) throw new Error("node coordinates, zoom, and tolerance must be valid");
  const visible = new Set(document.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const layerOrder = new Map(document.layers.map((layer) => [layer.id, layer.order]));
  const elements = [...document.elements].filter((element) => visible.has(element.layerId)).sort((a, b) => (layerOrder.get(b.layerId) ?? 0) - (layerOrder.get(a.layerId) ?? 0));
  let best: { hit: NodeHit; distance: number; order: string } | undefined;
  for (const element of elements) for (const [nodeIndex, node] of realGeometryNodes(element).entries()) {
    const distance = Math.hypot(node.point.x - point.x, node.point.y - point.y) * zoom;
    const order = `${element.id}:${nodeIndex}`;
    if (distance <= tolerancePx && (!best || distance < best.distance || distance === best.distance && order < best.order)) best = { hit: { elementId: element.id, nodeIndex, node }, distance, order };
  }
  return best?.hit;
}

/** Keeps a node anchor only when the pointer-down selection includes its element. */
export function selectedNodeAnchor(node: NodeHit | undefined, selectedIds: readonly ElementId[]): NodeHit | undefined {
  return node && selectedIds.includes(node.elementId) ? node : undefined;
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

/** Returns the geometric center used by selection feedback, in page millimetres. */
export function selectionCenter(element: Element): PointMm {
  return element.type === "line"
    ? { x: (element.start.x + element.end.x) / 2, y: (element.start.y + element.end.y) / 2 }
    : { x: element.position.x + element.size.width / 2, y: element.position.y + element.size.height / 2 };
}

/** Returns the selected object's center only when the pointer picks that object. */
export function hoveredSelectionCenter(document: DocumentSnapshot, element: Element, point: PointMm, zoom: number): PointMm | undefined {
  return pickElement(document, point, zoom) === element.id ? selectionCenter(element) : undefined;
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

export const ZOOM_100_PERCENT = 3;
export const INITIAL_ZOOM = ZOOM_100_PERCENT / 10;
export const MIN_ZOOM = INITIAL_ZOOM;
export const MAX_ZOOM = 8;

export function centerPageInCanvas(canvas: { readonly width: number; readonly height: number }, page: { readonly width: number; readonly height: number }, zoom: number): PointMm {
  if (![canvas.width, canvas.height, page.width, page.height, zoom].every(Number.isFinite) || canvas.width <= 0 || canvas.height <= 0 || page.width <= 0 || page.height <= 0 || zoom <= 0) throw new Error("canvas, page, and zoom dimensions must be positive");
  return { x: (page.width - canvas.width / zoom) / 2, y: (page.height - canvas.height / zoom) / 2 };
}

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
  const node = pickNode(document, point, zoom);
  if (node) return node.elementId;
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
