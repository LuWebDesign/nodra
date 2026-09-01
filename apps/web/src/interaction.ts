import type { DocumentSnapshot, Element, ElementId, LineElement, PathElement, PathSegment, PointMm } from "@nodra/domain";
import { boundsOf, boundsOfElements, connectableNodeAddress, contourSegmentAt, contourVertexNodes, dimensionGeometry, elementCenter, elementSegmentAt, hitTest, pathGeometryNodes, cuttableSegments, splitCuttableSegments, pathSegmentAt, realGeometryNodes, type Bounds, type ContourSegmentHit, type ContourVertexNode, type PathGeometryNode, type RealGeometryNode, type PathSegmentHit } from "@nodra/geometry";

export interface DragGeometry { readonly position: PointMm; readonly size: { readonly width: number; readonly height: number } }
export interface CircleGeometry { readonly position: PointMm; readonly size: { readonly width: number; readonly height: number }; readonly radius: number }
export interface CreationGuide { readonly source: PointMm; readonly target: PointMm; readonly kind: "node" | "center" }
export interface DirectionalGuide { readonly source: PointMm; readonly target: PointMm; readonly angle: number; readonly snappedPoint: PointMm }
export interface CreationSnap { readonly point: PointMm; readonly kind: "node" | "center"; readonly node?: NodeHit; readonly address?: import("@nodra/domain").ConnectableNodeAddress }
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
export interface DimensionLineHit { readonly elementId: ElementId; readonly line: LineElement; readonly distance: number; readonly edgeId?: string; readonly edgeIndex?: number }
export interface CircleDimensionHit { readonly elementId: ElementId; readonly center: NodeHit; readonly rim: NodeHit; readonly distance: number }
export type DimensionTarget = { readonly kind: "node"; readonly hit: NodeHit } | { readonly kind: "circle"; readonly hit: CircleDimensionHit } | { readonly kind: "line"; readonly hit: DimensionLineHit };
export interface PathNodeHit { readonly elementId: ElementId; readonly node: PathGeometryNode & { readonly ringIndex?: number } }
    export interface CuttableSegmentHit { readonly elementId: ElementId; readonly segmentIndex: number; readonly distance: number; readonly start: PointMm; readonly end: PointMm; readonly points?: readonly PointMm[] }
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

/** Picks a straight line or rectangle boundary for the Cut Segments tool. */
    export function pickCuttableSegment(document: DocumentSnapshot, point: PointMm, zoom: number, tolerancePx = 8): CuttableSegmentHit | undefined {
      if (![point.x, point.y, zoom, tolerancePx].every(Number.isFinite) || zoom <= 0 || tolerancePx < 0) throw new Error("cut segment coordinates, zoom, and tolerance must be valid");
      const visible = new Set(document.layers.filter((layer) => layer.visible).map((layer) => layer.id));
      let best: CuttableSegmentHit | undefined;
      const sourceSegments = document.elements.flatMap((element) => visible.has(element.layerId) ? cuttableSegments(element) : []);
      const splitSegments = splitCuttableSegments(sourceSegments);
      for (const segment of splitSegments) {
        const dx = segment.end.x - segment.start.x; const dy = segment.end.y - segment.start.y; const lengthSquared = dx * dx + dy * dy;
        if (lengthSquared <= 0) continue;
        const t = Math.max(0, Math.min(1, ((point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy) / lengthSquared));
        const distance = Math.hypot(point.x - (segment.start.x + t * dx), point.y - (segment.start.y + t * dy));
        if (distance * zoom <= tolerancePx && (!best || distance < best.distance)) {
          const element = document.elements.find((candidate) => candidate.id === segment.elementId);
          const arcPieces = element?.type === "ellipse" ? splitSegments.filter((candidate) => candidate.elementId === segment.elementId && candidate.segmentIndex === segment.segmentIndex) : undefined;
          const points = arcPieces ? [arcPieces[0]!.start, ...arcPieces.map((piece) => piece.end)] : undefined;
          best = { elementId: segment.elementId, segmentIndex: segment.segmentIndex, distance, start: points?.[0] ?? segment.start, end: points?.at(-1) ?? segment.end, ...(points ? { points } : {}) };
        }
      }
      return best;
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
  let best: { hit: NodeHit; distance: number; layerOrder: number; elementIndex: number; nodeIndex: number } | undefined;
  for (const element of elements) for (const [nodeIndex, node] of realGeometryNodes(element).entries()) {
    const distance = Math.hypot(node.point.x - point.x, node.point.y - point.y) * zoom;
    const currentLayerOrder = layerOrder.get(element.layerId) ?? 0;
    const elementIndex = document.elements.indexOf(element);
    if (distance <= tolerancePx && (!best || distance < best.distance || distance === best.distance && (currentLayerOrder > best.layerOrder || currentLayerOrder === best.layerOrder && (elementIndex > best.elementIndex || elementIndex === best.elementIndex && nodeIndex < best.nodeIndex)))) best = { hit: { elementId: element.id, nodeIndex, node }, distance, layerOrder: currentLayerOrder, elementIndex, nodeIndex };
  }
  return best?.hit;
}

/** Returns a perfect circle from a fixed center and a document-space pointer. */
export function circleGeometry(center: PointMm, pointer: PointMm): CircleGeometry | undefined {
  if (![center.x, center.y, pointer.x, pointer.y].every(Number.isFinite)) throw new Error("circle coordinates must be finite");
  const radius = Math.hypot(pointer.x - center.x, pointer.y - center.y);
  return radius > 0 ? { position: { x: center.x - radius, y: center.y - radius }, size: { width: radius * 2, height: radius * 2 }, radius } : undefined;
}

/** Finds the exact visible creation target under a pointer without changing the pointer itself. */
export function snapCreationPoint(document: DocumentSnapshot, point: PointMm, zoom: number, tolerancePx = 8): CreationSnap | undefined {
  if (![point.x, point.y, zoom, tolerancePx].every(Number.isFinite) || zoom <= 0 || tolerancePx < 0) throw new Error("creation snap coordinates, zoom, and tolerance must be valid");
  const visible = new Set(document.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  let bestNode: { readonly point: PointMm; readonly distance: number; readonly order: string; readonly node: NodeHit } | undefined;
  let bestCenter: { readonly point: PointMm; readonly distance: number; readonly order: string } | undefined;
  for (const element of document.elements) if (visible.has(element.layerId)) for (const [index, node] of realGeometryNodes(element).entries()) {
    const distance = Math.hypot(node.point.x - point.x, node.point.y - point.y) * zoom;
    if (distance > tolerancePx) continue;
    const candidate = { point: node.point, distance, order: `${element.id}:${index}`, node: { elementId: element.id, nodeIndex: index, node } };
    if (node.kind === "center") {
      if (!bestCenter || distance < bestCenter.distance || distance === bestCenter.distance && candidate.order < bestCenter.order) bestCenter = candidate;
    } else if (!bestNode || distance < bestNode.distance || distance === bestNode.distance && candidate.order < bestNode.order) bestNode = candidate;
  }
  if (bestNode) {
    const target = document.elements.find((element) => element.id === bestNode!.node.elementId);
    const address = target ? connectableNodeAddress(target, bestNode!.node.nodeIndex) : undefined;
    return { point: bestNode.point, kind: "node", node: bestNode.node, ...(address ? { address } : {}) };
  }
  return bestCenter ? { point: bestCenter.point, kind: "center" } : undefined;
}

/** Finds visual-only creation guides. The returned target never changes the requested point. */
export function creationGuides(document: DocumentSnapshot, point: PointMm, zoom: number, tolerancePx = 8): readonly CreationGuide[] {
  const snap = snapCreationPoint(document, point, zoom, tolerancePx);
  return snap ? [{ source: point, target: snap.point, kind: snap.kind }] : [];
}

/** Returns the live direction angle from a line origin to the pointer. */
export function lineAngleDegrees(source: PointMm, pointer: PointMm): number | undefined {
  if (![source.x, source.y, pointer.x, pointer.y].every(Number.isFinite)) throw new Error("line angle coordinates must be finite");
  if (source.x === pointer.x && source.y === pointer.y) return undefined;
  return Math.round(Math.atan2(pointer.y - source.y, pointer.x - source.x) * 180 / Math.PI * 10) / 10;
}

/** Finds axis guides from the cursor to nearby visible nodes before line creation. */
export function cursorNodeGuides(document: DocumentSnapshot, pointer: PointMm, zoom: number, tolerancePx = 8): readonly CreationGuide[] {
  if (![pointer.x, pointer.y, zoom, tolerancePx].every(Number.isFinite) || zoom <= 0 || tolerancePx < 0) throw new Error("cursor node guide coordinates and tolerance must be valid");
  const visible = new Set(document.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const best: [ { guide: CreationGuide; distance: number; order: string } | undefined, { guide: CreationGuide; distance: number; order: string } | undefined ] = [undefined, undefined];
  for (const element of document.elements) if (visible.has(element.layerId)) for (const [index, node] of realGeometryNodes(element).entries()) {
    const candidates = [{ distance: Math.abs(pointer.x - node.point.x) * zoom, target: { x: node.point.x, y: pointer.y }, order: element.id + ":" + index + ":vertical" }, { distance: Math.abs(pointer.y - node.point.y) * zoom, target: { x: pointer.x, y: node.point.y }, order: element.id + ":" + index + ":horizontal" }];
    candidates.forEach((candidate, axis) => { if (candidate.distance <= tolerancePx && (!best[axis] || candidate.distance < best[axis]!.distance || candidate.distance === best[axis]!.distance && candidate.order < best[axis]!.order)) best[axis] = { distance: candidate.distance, order: candidate.order, guide: { source: node.point, target: candidate.target, kind: "node" } }; });
  }
  return best.flatMap((candidate) => candidate ? [candidate.guide] : []);
}

/** Snaps a line endpoint to the nearest configured angular increment. */
export function directionalGuide(source: PointMm, pointer: PointMm, angleIncrementDegrees = 15, toleranceDegrees = 5): DirectionalGuide | undefined {
  if (![source.x, source.y, pointer.x, pointer.y, angleIncrementDegrees, toleranceDegrees].every(Number.isFinite) || angleIncrementDegrees <= 0 || angleIncrementDegrees > 180 || toleranceDegrees < 0 || toleranceDegrees > angleIncrementDegrees / 2) throw new Error("direction guide coordinates and angle must be valid");
  const dx = pointer.x - source.x; const dy = pointer.y - source.y; const distance = Math.hypot(dx, dy);
  if (distance === 0) return undefined;
  const increment = angleIncrementDegrees * Math.PI / 180;
  const rawAngle = Math.atan2(dy, dx); const angle = Math.round(rawAngle / increment) * increment;
  const angularDistance = Math.abs(Math.atan2(Math.sin(rawAngle - angle), Math.cos(rawAngle - angle))) * 180 / Math.PI;
  if (angularDistance > toleranceDegrees) return undefined;
  const snappedPoint = { x: source.x + Math.cos(angle) * distance, y: source.y + Math.sin(angle) * distance };
  return { source, target: snappedPoint, angle: Math.round(angle * 180 / Math.PI * 1e10) / 1e10, snappedPoint };
}

/** Finds visual axis guides from the active line origin to nearby visible nodes. */
export function nodeAlignmentGuides(document: DocumentSnapshot, source: PointMm, pointer: PointMm, zoom: number, tolerancePx = 8): readonly CreationGuide[] {
  if (![source.x, source.y, pointer.x, pointer.y, zoom, tolerancePx].every(Number.isFinite) || zoom <= 0 || tolerancePx < 0) throw new Error("node guide coordinates and tolerance must be valid");
  const visible = new Set(document.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const best: [ { guide: CreationGuide; distance: number; order: string } | undefined, { guide: CreationGuide; distance: number; order: string } | undefined ] = [undefined, undefined];
  for (const element of document.elements) if (visible.has(element.layerId)) for (const [index, node] of realGeometryNodes(element).entries()) {
    if (node.point.x === source.x && node.point.y === source.y) continue;
    const candidates = [{ distance: Math.abs(pointer.x - node.point.x) * zoom, target: { x: node.point.x, y: source.y }, order: element.id + ":" + index + ":vertical" }, { distance: Math.abs(pointer.y - node.point.y) * zoom, target: { x: source.x, y: node.point.y }, order: element.id + ":" + index + ":horizontal" }];
    candidates.forEach((candidate, axis) => { if (candidate.distance <= tolerancePx && (!best[axis] || candidate.distance < best[axis]!.distance || candidate.distance === best[axis]!.distance && candidate.order < best[axis]!.order)) best[axis] = { distance: candidate.distance, order: candidate.order, guide: { source, target: candidate.target, kind: "node" } }; });
  }
  return best.flatMap((candidate) => candidate ? [candidate.guide] : []);
}

export function hasNonCollinearPoints(points: readonly PointMm[], epsilon = 1e-9): boolean {
  if (points.length < 3) return false;
  for (let first = 0; first < points.length - 2; first += 1) for (let second = first + 1; second < points.length - 1; second += 1) for (let third = second + 1; third < points.length; third += 1) {
    const a = points[first]!, b = points[second]!, c = points[third]!;
    if (Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) > epsilon) return true;
  }
  return false;
}

export type NodeFeedbackTool = "select" | "forma" | "pen" | "spline" | "rectangle" | "ellipse" | "line" | "cut" | "dimension" | "radius";
export type HoverNode = NodeHit | FormaNodeHit;

/** Snaps a Forma node drag to another visible real node within screen tolerance. */
export function snapFormaNodePoint(document: DocumentSnapshot, point: PointMm, zoom: number, moving: { readonly elementId: ElementId; readonly nodeIndex?: number }, tolerancePx = 8): PointMm {
  if (![point.x, point.y, zoom, tolerancePx].every(Number.isFinite) || zoom <= 0 || tolerancePx < 0) throw new Error("Forma snap coordinates and tolerance must be valid");
  const visible = new Set(document.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  let best: { point: PointMm; distance: number; order: string } | undefined;
  for (const element of document.elements) if (visible.has(element.layerId)) for (const [nodeIndex, node] of realGeometryNodes(element).entries()) {
    if (node.kind === "center" || element.id === moving.elementId && moving.nodeIndex === nodeIndex) continue;
    const distance = Math.hypot(node.point.x - point.x, node.point.y - point.y) * zoom;
    const order = element.id + ":" + nodeIndex;
    if (distance <= tolerancePx && (!best || distance < best.distance || distance === best.distance && order < best.order)) best = { point: node.point, distance, order };
  }
  return best?.point ?? point;
}

/** Finds the node feedback target supported by a tool without changing its hit semantics. */
export function pickHoverNode(document: DocumentSnapshot, point: PointMm, zoom: number, tool: NodeFeedbackTool, tolerancePx = 8): HoverNode | undefined {
  if (tool === "forma") return pickFormaNode(document, point, zoom, tolerancePx);
  return pickNode(document, point, zoom, tolerancePx);
}

/** Picks endpoints first, then the body of a visible native line or sketch edge. */
export function pickDimensionTarget(document: DocumentSnapshot, point: PointMm, zoom: number, tolerancePx = 8): DimensionTarget | undefined {
  if (![point.x, point.y, zoom, tolerancePx].every(Number.isFinite) || zoom <= 0 || tolerancePx < 0) return undefined;
  const visible = new Set(document.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  let bestLine: DimensionLineHit | undefined;
  for (const element of document.elements) {
    if (!visible.has(element.layerId) || element.type !== "line") continue;
    const hit = elementSegmentAt(element, point, tolerancePx / zoom);
    if (!hit) continue;
    const line = element;
    const dx = line.end.x - line.start.x; const dy = line.end.y - line.start.y; const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0 ? ((point.x - line.start.x) * dx + (point.y - line.start.y) * dy) / lengthSquared : 0;
    if (t > 1e-6 && t < 1 - 1e-6 && (!bestLine || hit.distance < bestLine.distance)) bestLine = { elementId: element.id, line, distance: hit.distance };
  }
  if (bestLine) return { kind: "line", hit: bestLine };
  const node = pickNode(document, point, zoom, tolerancePx);
  const nodeElement = node ? document.elements.find((element) => element.id === node.elementId) : undefined;
  if (node?.node.kind === "cardinal" && nodeElement?.type === "ellipse" && nodeElement.size.width === nodeElement.size.height) {
    const nodes = realGeometryNodes(nodeElement);
    const centerIndex = nodes.findIndex((candidate) => candidate.kind === "center");
    const center = nodes[centerIndex];
    if (center) return { kind: "circle", hit: { elementId: nodeElement.id, center: { elementId: nodeElement.id, nodeIndex: centerIndex, node: center }, rim: node, distance: 0 } };
  }
  if (node && !(nodeElement?.type === "line" && node.node.kind === "center")) return { kind: "node", hit: node };
  const layerOrder = new Map(document.layers.map((layer) => [layer.id, layer.order]));
  let bestCircle: CircleDimensionHit | undefined;
  let bestCircleDistance = Number.POSITIVE_INFINITY;
  let bestCircleLayerOrder = Number.NEGATIVE_INFINITY;
  let bestCircleElementIndex = -1;
  for (const [elementIndex, element] of document.elements.entries()) {
    if (element.type !== "ellipse" || element.size.width !== element.size.height || !visible.has(element.layerId)) continue;
    const center = realGeometryNodes(element).find((candidate) => candidate.kind === "center");
    const cardinalNodes = realGeometryNodes(element).flatMap((candidate, index) => candidate.kind === "cardinal" ? [{ candidate, index }] : []);
    if (!center || !cardinalNodes.length) continue;
    const radius = element.size.width / 2;
    const centerDistance = Math.hypot(point.x - center.point.x, point.y - center.point.y);
    const distance = Math.abs(centerDistance - radius);
    if (distance * zoom > tolerancePx) continue;
    const rim = cardinalNodes.reduce((closest, candidate) => {
      const candidateDistance = Math.hypot(candidate.candidate.point.x - point.x, candidate.candidate.point.y - point.y);
      return !closest || candidateDistance < closest.distance || candidateDistance === closest.distance && candidate.index < closest.index ? { ...candidate, distance: candidateDistance } : closest;
    }, undefined as ({ readonly candidate: RealGeometryNode; readonly index: number; readonly distance: number } | undefined));
    if (!rim) continue;
    const currentLayerOrder = layerOrder.get(element.layerId) ?? 0;
    if (distance < bestCircleDistance || distance === bestCircleDistance && (currentLayerOrder > bestCircleLayerOrder || currentLayerOrder === bestCircleLayerOrder && elementIndex > bestCircleElementIndex)) {
      bestCircle = { elementId: element.id, center: { elementId: element.id, nodeIndex: realGeometryNodes(element).indexOf(center), node: center }, rim: { elementId: element.id, nodeIndex: rim.index, node: rim.candidate }, distance };
      bestCircleDistance = distance;
      bestCircleLayerOrder = currentLayerOrder;
      bestCircleElementIndex = elementIndex;
    }
  }
  if (bestCircle) return { kind: "circle", hit: bestCircle };
  let best: DimensionLineHit | undefined;
  const candidates = document.elements.flatMap((element): readonly DimensionLineHit[] => {
    if (element.type === "line" && visible.has(element.layerId)) return [{ elementId: element.id, line: element, distance: Number.POSITIVE_INFINITY }];
    return [];
  });
  for (const candidate of candidates) {
    const { line } = candidate;
    const [start, end] = realGeometryNodes(line).filter((node): node is RealGeometryNode => node.kind === "endpoint").map((node) => node.point);
    if (!start || !end) continue;
    const dx = end.x - start.x; const dy = end.y - start.y; const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) continue;
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
    if (t <= 0 || t >= 1) continue;
    const distance = Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
    if (distance * zoom <= tolerancePx && (!best || distance < best.distance || distance === best.distance && `${line.id}:${candidate.edgeIndex ?? -1}` < `${best.elementId}:${best.edgeIndex ?? -1}`)) best = { ...candidate, distance };
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
  if (![point.x, point.y, zoom, tolerancePx].every(Number.isFinite) || zoom <= 0 || tolerancePx < 0) return undefined;
  const visible = new Set(document.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  let best: { hit: FormaNodeHit; distance: number; order: string } | undefined;
  for (const element of document.elements) if (visible.has(element.layerId)) {
    // Forma feedback is best-effort. Geometry helpers deliberately remain
    // strict for domain/editor callers; one bad element must not take down
    // the composition while computing this optional feedback.
    try {
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
    } catch {
      // Unsupported/malformed geometry simply has no Forma node hit.
    }
  }
  return best?.hit;
}

export function pickFormaSegment(document: DocumentSnapshot, point: PointMm, zoom: number, tolerancePx = 8): ContourSegmentHitResult | undefined {
  if (![point.x, point.y, zoom, tolerancePx].every(Number.isFinite) || zoom <= 0 || tolerancePx < 0) return undefined;
  const visible = new Set(document.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  let best: ContourSegmentHitResult | undefined;
  for (const element of document.elements) if (visible.has(element.layerId)) {
    if (element.type === "text") continue;
    // Forma segment insertion converts the element to a closed contour. Open
    // paths and splines remain editable through their native node controls,
    // but must not enter the closed-shape conversion path during render-time
    // cursor feedback or double-click handling.
    if ((element.type === "path" || element.type === "spline") && !element.closed) continue;
    try {
      const hit = elementSegmentAt(element, point, tolerancePx / zoom);
      if (hit && (!best || hit.distance < best.distance || hit.distance === best.distance && `${hit.elementId}:${hit.ringIndex}:${hit.segmentIndex}` < `${best.elementId}:${best.ringIndex}:${best.segmentIndex}`)) best = hit;
    } catch {
      // Segment insertion is optional feedback and is closed per element.
    }
  }
  return best;
}

/** Safe body picking for Forma entry; ordinary selection keeps its strict path. */
export function pickFormaElement(document: DocumentSnapshot, point: PointMm, zoom: number): ElementId | undefined {
  if (![point.x, point.y, zoom].every(Number.isFinite) || zoom <= 0) return undefined;
  const node = pickFormaNode(document, point, zoom);
  if (node) return node.elementId;
  const visible = new Set(document.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const layerOrder = new Map(document.layers.map((layer) => [layer.id, layer.order]));
  return [...document.elements].sort((a, b) => (layerOrder.get(a.layerId) ?? 0) - (layerOrder.get(b.layerId) ?? 0)).reverse().find((element) => {
    if (!visible.has(element.layerId)) return false;
    try {
      return element.type !== "dimension" && hitTest(element, point, 6 / zoom);
    } catch {
      return false;
    }
  })?.id;
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

export interface PageClientMetrics {
  readonly rect: { readonly left: number; readonly top: number };
  readonly renderedWidth: number;
  readonly renderedHeight: number;
  readonly borderLeft: number;
  readonly borderTop: number;
}

/** Converts a client point through the actual rendered page box into document mm. */
export function clientPointToPage(client: PointMm, page: { readonly width: number; readonly height: number }, metrics: PageClientMetrics): PointMm {
  if (![client.x, client.y, page.width, page.height, metrics.rect.left, metrics.rect.top, metrics.renderedWidth, metrics.renderedHeight, metrics.borderLeft, metrics.borderTop].every(Number.isFinite) || page.width <= 0 || page.height <= 0 || metrics.renderedWidth <= 0 || metrics.renderedHeight <= 0) throw new Error("page coordinates and rendered dimensions must be valid");
  return { x: (client.x - metrics.rect.left - metrics.borderLeft) * page.width / metrics.renderedWidth, y: (client.y - metrics.rect.top - metrics.borderTop) * page.height / metrics.renderedHeight };
}

/** Converts canonical page coordinates into pixels relative to the canvas. */
/** Projects document millimetres into canvas-viewport pixels (used by canvas-level overlays). */
export function viewportPointToCanvas(point: PointMm, zoom: number, panMm: PointMm): PointMm {
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error("zoom must be positive");
  return { x: (point.x - panMm.x) * zoom, y: (point.y - panMm.y) * zoom };
}

/** Projects document millimetres into the local coordinate system of the page element. */
export function pagePointToCanvas(point: PointMm, zoom: number, panMm: PointMm): PointMm {
  return viewportPointToCanvas(point, zoom, panMm);
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

/** Projects document millimetres into the local coordinate system of the rendered page. */
export function documentPointToPage(point: PointMm, zoom: number): PointMm {
  return pagePointToScreen(point, zoom);
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

export function normalizeBounds(start: PointMm, end: PointMm): Bounds {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}

export function containsBounds(container: Bounds, candidate: Bounds): boolean {
  return candidate.x >= container.x && candidate.y >= container.y && candidate.x + candidate.width <= container.x + container.width && candidate.y + candidate.height <= container.y + container.height;
}

const distanceToSegment = (point: PointMm, start: PointMm, end: PointMm): number => { const dx = end.x - start.x; const dy = end.y - start.y; const lengthSquared = dx * dx + dy * dy; const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)); return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy)); };

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
        const dimensionTolerance = Math.max(tolerance, 12);
    return Boolean(geometry && (distanceToSegment(point, geometry.lineStart, geometry.lineEnd) <= dimensionTolerance || Math.hypot(point.x - geometry.text.x, point.y - geometry.text.y) <= dimensionTolerance || Math.hypot(point.x - geometry.text.x, point.y - (geometry.text.y - 8)) <= dimensionTolerance));
  })?.id;
}

export function elementsContainedBy(document: DocumentSnapshot, marquee: Bounds): ElementId[] {
  const visible = new Set(document.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  return document.elements.filter((element) => visible.has(element.layerId) && containsBounds(marquee, boundsOf(element))).map((element) => element.id);
}

export function marqueeSelection(document: DocumentSnapshot, start: PointMm, end: PointMm): ElementId[] {
  return elementsContainedBy(document, normalizeBounds(start, end));
}
