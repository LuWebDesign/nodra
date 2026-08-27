import type { DocumentSnapshot, Element, ElementId, LineElement, PathElement, PathSegment, PointMm } from "@nodra/domain";
import { boundsOf, boundsOfElements, contourSegmentAt, contourVertexNodes, dimensionGeometry, elementCenter, elementSegmentAt, hitTest, pathGeometryNodes, pathSegmentAt, realGeometryNodes, type Bounds, type ContourSegmentHit, type ContourVertexNode, type PathGeometryNode, type RealGeometryNode, type PathSegmentHit } from "@nodra/geometry";

export interface DragGeometry { readonly position: PointMm; readonly size: { readonly width: number; readonly height: number } }
export interface CircleGeometry { readonly position: PointMm; readonly size: { readonly width: number; readonly height: number }; readonly radius: number }
export interface SnapGuide { readonly source: PointMm; readonly target: PointMm }
export interface SnapMoveResult { readonly delta: PointMm; readonly guide: SnapGuide | undefined }
export type AlignmentGuideOrientation = "vertical" | "horizontal";
export type AlignmentGuideKind = "edge" | "center" | "node";
export interface AlignmentGuide {
  readonly orientation: AlignmentGuideOrientation;
  readonly coordinate: number;
  readonly start: number;
  readonly end: number;
  readonly kind: AlignmentGuideKind;
  readonly source: PointMm;
  readonly target: PointMm;
}
export interface NodeHit { readonly elementId: ElementId; readonly nodeIndex: number; readonly node: RealGeometryNode }
export interface DimensionLineHit { readonly elementId: ElementId; readonly line: LineElement; readonly distance: number }
export type DimensionTarget = { readonly kind: "node"; readonly hit: NodeHit } | { readonly kind: "line"; readonly hit: DimensionLineHit };
export interface PathNodeHit { readonly elementId: ElementId; readonly node: PathGeometryNode & { readonly ringIndex?: number } }
export type PathGuideDirection = "incoming" | "outgoing";
export interface PathGuide {
  readonly elementId: ElementId;
  readonly segmentIndex: number;
  readonly nodeId: string;
  readonly anchor: PointMm;
  readonly control: PointMm;
  readonly direction: PathGuideDirection;
}
export type ContourNodeHit = ContourVertexNode;
export type ContourSegmentHitResult = ContourSegmentHit;
export type PathSegmentHitResult = PathSegmentHit;
export type FormaNodeHit = { readonly elementId: ElementId; readonly nodeIndex?: number; readonly contourNode?: ContourNodeHit; readonly point: PointMm };

export function visibleEditablePathNodeIndexes(nodes: readonly PathGeometryNode[], segments: readonly Pick<PathSegment, "startNodeId" | "endNodeId">[], selectedNodeIndexes: readonly number[]): readonly number[] {
  const selectedAnchors = new Set(selectedNodeIndexes.flatMap((index) => nodes[index]?.kind === "anchor" ? [nodes[index]!.nodeId] : []));
  return nodes.flatMap((node, index) => {
    if (node.kind === "anchor" || selectedAnchors.has(node.nodeId)) return [index];
    const segment = node.segmentIndex === undefined ? undefined : segments[node.segmentIndex];
    return segment && (selectedAnchors.has(segment.startNodeId) || selectedAnchors.has(segment.endNodeId)) ? [index] : [];
  });
}

export function selectedPathAnchorIds(path: PathElement, keys: readonly string[]): string[] {
  return [...new Set(keys.flatMap((key) => {
    const match = key.match(new RegExp(`^${path.id}:p:(\\d+)$`));
    const node = match ? pathGeometryNodes(path)[Number(match[1])] : undefined;
    return node?.kind === "anchor" ? [node.nodeId] : [];
  }))];
}

/** Derives editor-only handle guides from the path's existing geometry nodes. */
export function pathGuides(path: PathElement): readonly PathGuide[] {
  const nodes = pathGeometryNodes(path);
  return nodes.flatMap((node) => {
    if (node.kind !== "control" || node.segmentIndex === undefined || !node.handle) return [];
    const anchor = nodes.find((candidate) => candidate.kind === "anchor" && candidate.nodeId === node.nodeId);
    if (!anchor) return [];
    return [{ elementId: path.id, segmentIndex: node.segmentIndex, nodeId: node.nodeId, anchor: anchor.point, control: node.point, direction: node.handle === "control1" ? "outgoing" : "incoming" }];
  });
}

export type DrawingTool = "rectangle" | "ellipse" | "line";

export type PointerDownIntent = "draw" | "select";
export type TransformMode = "resize" | "rotate";

export function canActivateRotation(tool: string, selectedIds: readonly ElementId[], hit: ElementId | undefined): boolean {
  return tool === "select" && selectedIds.length > 0 && hit !== undefined && selectedIds.includes(hit);
}

export function pointerDownIntent(tool: string, hit: ElementId | undefined): PointerDownIntent {
  return isDrawingTool(tool) && hit === undefined ? "draw" : "select";
}

export function isDrawingTool(tool: string): tool is DrawingTool {
  return tool === "rectangle" || tool === "ellipse" || tool === "line";
}

export function pickPathNode(document: DocumentSnapshot, point: PointMm, zoom: number, tolerancePx = 8): PathNodeHit | undefined {
  if (![point.x, point.y, zoom, tolerancePx].every(Number.isFinite) || zoom <= 0 || tolerancePx < 0) throw new Error("path node coordinates, zoom, and tolerance must be valid");
  const visible = new Set(document.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  let best: { hit: PathNodeHit; distance: number; order: string } | undefined;
  for (const element of document.elements) if (element.type === "path" && visible.has(element.layerId)) for (const [index, node] of pathGeometryNodes(element).entries()) {
    const distance = Math.hypot(node.point.x - point.x, node.point.y - point.y) * zoom;
    const order = `${element.id}:${node.kind}:${node.nodeId}:${node.segmentIndex ?? -1}:${node.handle ?? ""}:${index}`;
    if (distance <= tolerancePx && (!best || distance < best.distance || distance === best.distance && order < best.order)) best = { hit: { elementId: element.id, node }, distance, order };
  }
  return best?.hit;
}

export function pickPathSegment(document: DocumentSnapshot, point: PointMm, zoom: number, tolerancePx = 8): PathSegmentHitResult | undefined {
  if (![point.x, point.y, zoom, tolerancePx].every(Number.isFinite) || zoom <= 0 || tolerancePx < 0) throw new Error("path segment coordinates, zoom, and tolerance must be valid");
  const visible = new Set(document.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  let best: PathSegmentHitResult | undefined;
  for (const element of document.elements) if (element.type === "path" && visible.has(element.layerId)) {
    const hit = pathSegmentAt(element, point, tolerancePx / zoom);
    if (hit && (!best || hit.distance < best.distance || hit.distance === best.distance && `${hit.elementId}:${hit.segmentIndex}` < `${best.elementId}:${best.segmentIndex}`)) best = hit;
  }
  return best;
}

export function movementExceedsThreshold(start: PointMm, end: PointMm, threshold = 3): boolean {
  if (![start.x, start.y, end.x, end.y, threshold].every(Number.isFinite) || threshold < 0) throw new Error("movement coordinates and threshold must be finite");
  return Math.hypot(end.x - start.x, end.y - start.y) >= threshold;
}

/** Derives the two controls for a pen endpoint drag in document millimetres. */
export function cubicPlacementControls(start: PointMm, end: PointMm, pointer: PointMm): { readonly control1: PointMm; readonly control2: PointMm } {
  if (![start.x, start.y, end.x, end.y, pointer.x, pointer.y].every(Number.isFinite)) throw new Error("cubic placement coordinates must be finite");
  return {
    control1: { x: start.x + (end.x - start.x) / 3, y: start.y + (end.y - start.y) / 3 },
    control2: { x: end.x - (pointer.x - end.x), y: end.y - (pointer.y - end.y) },
  };
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

type AlignmentCandidate = { readonly coordinate: number; readonly kind: AlignmentGuideKind; readonly point: PointMm; readonly start: number; readonly end: number; readonly order: string };
const translatedBounds = (bounds: Bounds, delta: PointMm): Bounds => ({ x: bounds.x + delta.x, y: bounds.y + delta.y, width: bounds.width, height: bounds.height });
const boundsCandidates = (bounds: Bounds, delta: PointMm, prefix: string): { readonly vertical: readonly AlignmentCandidate[]; readonly horizontal: readonly AlignmentCandidate[] } => {
  const moved = translatedBounds(bounds, delta);
  return {
    vertical: [
      { coordinate: moved.x, kind: "edge", point: { x: moved.x, y: moved.y }, start: moved.y, end: moved.y + moved.height, order: `${prefix}:left` },
      { coordinate: moved.x + moved.width / 2, kind: "center", point: { x: moved.x + moved.width / 2, y: moved.y + moved.height / 2 }, start: moved.y, end: moved.y + moved.height, order: `${prefix}:center-x` },
      { coordinate: moved.x + moved.width, kind: "edge", point: { x: moved.x + moved.width, y: moved.y + moved.height }, start: moved.y, end: moved.y + moved.height, order: `${prefix}:right` },
    ],
    horizontal: [
      { coordinate: moved.y, kind: "edge", point: { x: moved.x, y: moved.y }, start: moved.x, end: moved.x + moved.width, order: `${prefix}:top` },
      { coordinate: moved.y + moved.height / 2, kind: "center", point: { x: moved.x + moved.width / 2, y: moved.y + moved.height / 2 }, start: moved.x, end: moved.x + moved.width, order: `${prefix}:center-y` },
      { coordinate: moved.y + moved.height, kind: "edge", point: { x: moved.x + moved.width, y: moved.y + moved.height }, start: moved.x, end: moved.x + moved.width, order: `${prefix}:bottom` },
    ],
  };
};
const nodeCandidates = (elements: readonly Element[], delta: PointMm, bounds: Bounds, prefix: string): { readonly vertical: readonly AlignmentCandidate[]; readonly horizontal: readonly AlignmentCandidate[] } => {
  const vertical: AlignmentCandidate[] = []; const horizontal: AlignmentCandidate[] = [];
  for (const element of elements) for (const [index, node] of realGeometryNodes(element).entries()) {
    const point = { x: node.point.x + delta.x, y: node.point.y + delta.y };
    vertical.push({ coordinate: point.x, kind: "node", point, start: bounds.y, end: bounds.y + bounds.height, order: `${prefix}:node-x:${index}` });
    horizontal.push({ coordinate: point.y, kind: "node", point, start: bounds.x, end: bounds.x + bounds.width, order: `${prefix}:node-y:${index}` });
  }
  return { vertical, horizontal };
};

/** Returns visual alignment guides without changing the requested movement or resize. */
export function alignmentGuides(document: DocumentSnapshot, selectedIds: readonly ElementId[], delta: PointMm = { x: 0, y: 0 }, zoom: number, tolerancePx = 8): readonly AlignmentGuide[] {
  if (![delta.x, delta.y, zoom, tolerancePx].every(Number.isFinite) || zoom <= 0 || tolerancePx < 0) throw new Error("alignment coordinates, zoom, and tolerance must be valid");
  const selected = new Set(selectedIds);
  const visible = new Set(document.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const movingElements = document.elements.filter((element) => selected.has(element.id) && visible.has(element.layerId));
  if (!movingElements.length) return [];
  const movingBounds = translatedBounds(boundsOfElements(movingElements), delta);
  const movingBoundsCandidates = boundsCandidates(movingBounds, { x: 0, y: 0 }, "moving");
  const movingNodes = nodeCandidates(movingElements, delta, movingBounds, "moving");
  const targets = document.elements.filter((element) => !selected.has(element.id) && visible.has(element.layerId));
  const targetCandidates = targets.flatMap((element) => {
    const bounds = boundsOf(element);
    const box = boundsCandidates(bounds, { x: 0, y: 0 }, element.id);
    const nodes = nodeCandidates([element], { x: 0, y: 0 }, bounds, element.id);
    return { vertical: [...box.vertical, ...nodes.vertical], horizontal: [...box.horizontal, ...nodes.horizontal], bounds };
  });
  const find = (orientation: AlignmentGuideOrientation): AlignmentGuide | undefined => {
    const source = [...(orientation === "vertical" ? movingBoundsCandidates.vertical : movingBoundsCandidates.horizontal), ...(orientation === "vertical" ? movingNodes.vertical : movingNodes.horizontal)];
    let best: { distance: number; source: AlignmentCandidate; target: AlignmentCandidate } | undefined;
    for (const sourceCandidate of source) for (const target of targetCandidates) {
      const targetCandidate = orientation === "vertical" ? target.vertical : target.horizontal;
      for (const candidate of targetCandidate) {
        const distance = Math.abs(sourceCandidate.coordinate - candidate.coordinate) * zoom;
        if (distance > tolerancePx) continue;
        const next = { distance, source: sourceCandidate, target: candidate };
        if (!best || distance < best.distance || distance === best.distance && `${sourceCandidate.order}:${candidate.order}` < `${best.source.order}:${best.target.order}`) best = next;
      }
    }
    if (!best) return undefined;
    const start = Math.min(best.source.start, best.target.start) - 4 / zoom;
    const end = Math.max(best.source.end, best.target.end) + 4 / zoom;
    return { orientation, coordinate: (best.source.coordinate + best.target.coordinate) / 2, start, end, kind: best.source.kind === "node" || best.target.kind === "node" ? "node" : best.source.kind === "center" || best.target.kind === "center" ? "center" : "edge", source: best.source.point, target: best.target.point };
  };
  return [find("vertical"), find("horizontal")].filter((guide): guide is AlignmentGuide => guide !== undefined);
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

/** Picks endpoints first, then the body of a visible native line. */
export function pickDimensionTarget(document: DocumentSnapshot, point: PointMm, zoom: number, tolerancePx = 8): DimensionTarget | undefined {
  const node = pickNode(document, point, zoom, tolerancePx);
  const nodeElement = node ? document.elements.find((element) => element.id === node.elementId) : undefined;
  if (node && !(nodeElement?.type === "line" && node.node.kind === "center")) return { kind: "node", hit: node };
  const visible = new Set(document.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  let best: DimensionLineHit | undefined;
  for (const line of document.elements.filter((element): element is LineElement => element.type === "line" && visible.has(element.layerId))) {
    const [start, end] = realGeometryNodes(line).filter((node): node is RealGeometryNode => node.kind === "endpoint").map((node) => node.point);
    if (!start || !end) continue;
    const dx = end.x - start.x; const dy = end.y - start.y; const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) continue;
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
    if (t <= 0 || t >= 1) continue;
    const distance = Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
    if (distance * zoom <= tolerancePx && (!best || distance < best.distance || distance === best.distance && line.id < best.elementId)) best = { elementId: line.id, line, distance };
  }
  return best ? { kind: "line", hit: best } : undefined;
}

export function pickContourNode(document: DocumentSnapshot, point: PointMm, zoom: number, tolerancePx = 8): ContourNodeHit | undefined {
  if (![point.x, point.y, zoom, tolerancePx].every(Number.isFinite) || zoom <= 0 || tolerancePx < 0) throw new Error("contour node coordinates, zoom, and tolerance must be valid");
  const visible = new Set(document.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  let best: { hit: ContourNodeHit; distance: number; order: string } | undefined;
  for (const element of document.elements) if (element.type === "contour" && visible.has(element.layerId)) for (const node of contourVertexNodes(element)) {
    const distance = Math.hypot(node.point.x - point.x, node.point.y - point.y) * zoom;
    const order = `${node.elementId}:${node.ringIndex}:${node.pointIndex}`;
    if (distance <= tolerancePx && (!best || distance < best.distance || distance === best.distance && order < best.order)) best = { hit: node, distance, order };
  }
  return best?.hit;
}

export function pickContourSegment(document: DocumentSnapshot, point: PointMm, zoom: number, tolerancePx = 8): ContourSegmentHitResult | undefined {
  if (![point.x, point.y, zoom, tolerancePx].every(Number.isFinite) || zoom <= 0 || tolerancePx < 0) throw new Error("contour segment coordinates, zoom, and tolerance must be valid");
  const visible = new Set(document.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  let best: ContourSegmentHitResult | undefined;
  for (const element of document.elements) if (element.type === "contour" && visible.has(element.layerId)) {
    const hit = contourSegmentAt(element, point, tolerancePx / zoom);
    if (hit && (!best || hit.distance < best.distance || hit.distance === best.distance && `${hit.elementId}:${hit.ringIndex}:${hit.segmentIndex}` < `${best.elementId}:${best.ringIndex}:${best.segmentIndex}`)) best = hit;
  }
  return best;
}

export function pickFormaNode(document: DocumentSnapshot, point: PointMm, zoom: number, tolerancePx = 8): FormaNodeHit | undefined {
  const visible = new Set(document.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  let best: { hit: FormaNodeHit; distance: number; order: string } | undefined;
  for (const element of document.elements) if (visible.has(element.layerId)) {
    if (element.type === "text") continue;
    if (element.type === "contour") for (const node of contourVertexNodes(element)) {
      const distance = Math.hypot(node.point.x - point.x, node.point.y - point.y) * zoom;
      const order = `${element.id}:c:${node.ringIndex}:${node.pointIndex}`;
      if (distance <= tolerancePx && (!best || distance < best.distance || distance === best.distance && order < best.order)) best = { hit: { elementId: element.id, contourNode: node, point: node.point }, distance, order };
    }
    else for (const [nodeIndex, node] of realGeometryNodes(element).entries()) {
      const distance = Math.hypot(node.point.x - point.x, node.point.y - point.y) * zoom;
      const order = `${element.id}:p:${nodeIndex}`;
      if (distance <= tolerancePx && (!best || distance < best.distance || distance === best.distance && order < best.order)) best = { hit: { elementId: element.id, nodeIndex, point: node.point }, distance, order };
    }
  }
  return best?.hit;
}

export function pickFormaSegment(document: DocumentSnapshot, point: PointMm, zoom: number, tolerancePx = 8): ContourSegmentHitResult | undefined {
  const visible = new Set(document.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  let best: ContourSegmentHitResult | undefined;
  for (const element of document.elements) if (visible.has(element.layerId)) {
    if (element.type === "text") continue;
    const hit = elementSegmentAt(element, point, tolerancePx / zoom);
    if (hit && (!best || hit.distance < best.distance || hit.distance === best.distance && `${hit.elementId}:${hit.ringIndex}:${hit.segmentIndex}` < `${best.elementId}:${best.ringIndex}:${best.segmentIndex}`)) best = hit;
  }
  return best;
}

export function formaNodeKey(node: FormaNodeHit): string { return node.contourNode ? `${node.elementId}:c:${node.contourNode.ringIndex}:${node.contourNode.pointIndex}` : `${node.elementId}:p:${node.nodeIndex}`; }

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
  return elementCenter(element);
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
export const INITIAL_ZOOM = ZOOM_100_PERCENT / 4;
export const MIN_ZOOM = ZOOM_100_PERCENT / 10;
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

/** Derives a non-degenerate circle from a fixed center and a document-space pointer. */
export function circleGeometry(center: PointMm, pointer: PointMm): CircleGeometry | undefined {
  if (![center.x, center.y, pointer.x, pointer.y].every(Number.isFinite)) throw new Error("circle coordinates must be finite");
  const radius = Math.hypot(pointer.x - center.x, pointer.y - center.y);
  if (radius === 0) return undefined;
  return { position: { x: center.x - radius, y: center.y - radius }, size: { width: radius * 2, height: radius * 2 }, radius };
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
  return [...document.elements].sort((a, b) => (layerOrder.get(a.layerId) ?? 0) - (layerOrder.get(b.layerId) ?? 0)).reverse().find((element) => {
    if (!visible.has(element.layerId)) return false;
    if (element.type !== "dimension") return hitTest(element, point, tolerance);
    const geometry = dimensionGeometry(element, document.elements);
    return Boolean(geometry && (Math.hypot(point.x - geometry.text.x, point.y - geometry.text.y) <= Math.max(tolerance, 3) || Math.hypot(point.x - geometry.lineStart.x, point.y - geometry.lineStart.y) <= tolerance || Math.hypot(point.x - geometry.lineEnd.x, point.y - geometry.lineEnd.y) <= tolerance));
  })?.id;
}

export function elementsContainedBy(document: DocumentSnapshot, marquee: Bounds): ElementId[] {
  const visible = new Set(document.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  return document.elements.filter((element) => visible.has(element.layerId) && containsBounds(marquee, boundsOf(element))).map((element) => element.id);
}

export function marqueeSelection(document: DocumentSnapshot, start: PointMm, end: PointMm): ElementId[] {
  return elementsContainedBy(document, normalizeBounds(start, end));
}
