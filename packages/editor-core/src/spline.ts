import type { HandleOffset, PathElement, PointMm, SplineContinuity, SplineElement, SplineNode } from "@nodra/domain";
import { resolveHandle } from "@nodra/geometry";

export type SplineHandle = "in" | "out";
export type SplineResult = { readonly success: true; readonly spline: SplineElement } | { readonly success: false; readonly error: string };
export type SplineCommand = (spline: SplineElement) => SplineResult;
export type SplineHitTarget = { readonly kind: "handle"; readonly nodeId: string; readonly handle: SplineHandle } | { readonly kind: "node"; readonly nodeId: string } | { readonly kind: "spline" };
export interface SplineTransaction { readonly before: SplineElement; readonly after: SplineElement; readonly selectionBefore: SplineHitTarget | undefined; readonly selectionAfter: SplineHitTarget | undefined }
export interface SplineEditorState { readonly spline: SplineElement; readonly selection: SplineHitTarget | undefined; readonly undo: readonly SplineTransaction[]; readonly redo: readonly SplineTransaction[]; readonly gesture: { readonly base: SplineElement; readonly preview: SplineElement } | undefined }

const validPoint = (point: PointMm): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);
const validOffset = (offset: HandleOffset): boolean => Number.isFinite(offset.dx) && Number.isFinite(offset.dy);
const replaceNode = (spline: SplineElement, nodeId: string, update: (node: SplineNode) => SplineNode): SplineResult => {
  const index = spline.nodes.findIndex((node) => node.id === nodeId);
  if (index < 0) return { success: false, error: `Spline node not found: ${nodeId}` };
  const nodes = [...spline.nodes]; nodes[index] = update(nodes[index]!);
  return { success: true, spline: { ...spline, nodes } };
};
const segment = (start: SplineNode, end: SplineNode): PathElement["segments"][number] => start.outHandle || end.inHandle
  ? { type: "cubicBezier", startNodeId: start.id, endNodeId: end.id, control1: resolveHandle(start.anchor, start.outHandle ?? { dx: 0, dy: 0 }), control2: resolveHandle(end.anchor, end.inHandle ?? { dx: 0, dy: 0 }) }
  : { type: "line", startNodeId: start.id, endNodeId: end.id };

export function splineToPathElement(spline: SplineElement): PathElement {
  const segments: PathElement["segments"][number][] = spline.nodes.slice(1).map((node, index) => segment(spline.nodes[index]!, node));
  if (spline.closed && spline.nodes.length > 1) segments.push(segment(spline.nodes.at(-1)!, spline.nodes[0]!));
  return { type: "path", id: spline.id, layerId: spline.layerId, nodes: spline.nodes.map((node) => ({ id: node.id, anchor: node.anchor, join: node.continuity })), segments, closed: spline.closed, style: spline.style, ...(spline.operation ? { operation: spline.operation } : {}) };
}
export function moveSplineNode(spline: SplineElement, nodeId: string, anchor: PointMm): SplineResult { return validPoint(anchor) ? replaceNode(spline, nodeId, (node) => ({ ...node, anchor })) : { success: false, error: "Spline node coordinates must be finite" }; }
export function moveSplineHandle(spline: SplineElement, nodeId: string, handle: SplineHandle, offset: HandleOffset): SplineResult { return validOffset(offset) ? replaceNode(spline, nodeId, (node) => ({ ...node, ...(handle === "in" ? { inHandle: offset } : { outHandle: offset }) })) : { success: false, error: "Spline handle offsets must be finite" }; }
export function setSplineContinuity(spline: SplineElement, nodeId: string, continuity: SplineContinuity): SplineResult { return replaceNode(spline, nodeId, (node) => ({ ...node, continuity })); }
export function insertSplineNode(spline: SplineElement, node: SplineNode, afterNodeId?: string): SplineResult {
  if (spline.nodes.some((current) => current.id === node.id)) return { success: false, error: `Spline node already exists: ${node.id}` };
  if (!validPoint(node.anchor)) return { success: false, error: "Spline node coordinates must be finite" };
  if (afterNodeId === undefined) return { success: true, spline: { ...spline, nodes: [...spline.nodes, node] } };
  const index = spline.nodes.findIndex((current) => current.id === afterNodeId);
  if (index < 0) return { success: false, error: `Spline node not found: ${afterNodeId}` };
  const nodes = [...spline.nodes]; nodes.splice(index + 1, 0, node); return { success: true, spline: { ...spline, nodes } };
}
export function hitTestSpline(spline: SplineElement, point: PointMm, tolerance: number): SplineHitTarget | undefined {
  if (!validPoint(point) || !Number.isFinite(tolerance) || tolerance < 0) return undefined;
  const hits: { target: SplineHitTarget; distance: number; priority: number }[] = [];
  for (const node of spline.nodes) {
    const distance = Math.hypot(node.anchor.x - point.x, node.anchor.y - point.y);
    if (distance <= tolerance) hits.push({ target: { kind: "node", nodeId: node.id }, distance, priority: 1 });
    for (const handle of ["in", "out"] as const) { const offset = handle === "in" ? node.inHandle : node.outHandle; if (!offset) continue; const resolved = resolveHandle(node.anchor, offset); const handleDistance = Math.hypot(resolved.x - point.x, resolved.y - point.y); if (handleDistance <= tolerance) hits.push({ target: { kind: "handle", nodeId: node.id, handle }, distance: handleDistance, priority: 0 }); }
  }
  return hits.sort((a, b) => a.priority - b.priority || a.distance - b.distance)[0]?.target;
}

export function createSplineEditor(spline: SplineElement): SplineEditorState {
  return { spline, selection: undefined, undo: [], redo: [], gesture: undefined };
}

export function dispatchSpline(state: SplineEditorState, command: SplineCommand): SplineEditorState {
  const result = command(state.spline);
  if (!result.success || result.spline === state.spline) return state;
  const transaction: SplineTransaction = {
    before: state.spline,
    after: result.spline,
    selectionBefore: state.selection,
    selectionAfter: state.selection,
  };
  return { ...state, spline: result.spline, undo: [...state.undo, transaction], redo: [] };
}

export function selectSpline(state: SplineEditorState, selection: SplineHitTarget | undefined): SplineEditorState {
  return { ...state, selection };
}

export function beginSplineGesture(state: SplineEditorState): SplineEditorState {
  return { ...state, gesture: { base: state.spline, preview: state.spline } };
}

export function previewSplineGesture(state: SplineEditorState, command: SplineCommand): SplineEditorState {
  if (!state.gesture) return state;
  const result = command(state.gesture.base);
  return result.success
    ? { ...state, spline: result.spline, gesture: { ...state.gesture, preview: result.spline } }
    : state;
}

export function commitSplineGesture(state: SplineEditorState): SplineEditorState {
  if (!state.gesture) return state;
  const { base, preview } = state.gesture;
  if (preview === base) return { ...state, gesture: undefined };
  const transaction: SplineTransaction = {
    before: base,
    after: preview,
    selectionBefore: state.selection,
    selectionAfter: state.selection,
  };
  return { ...state, spline: preview, undo: [...state.undo, transaction], redo: [], gesture: undefined };
}

export function cancelSplineGesture(state: SplineEditorState): SplineEditorState {
  return state.gesture ? { ...state, spline: state.gesture.base, gesture: undefined } : state;
}

export function undoSpline(state: SplineEditorState): SplineEditorState {
  const transaction = state.undo.at(-1);
  if (!transaction) return state;
  return {
    ...state,
    spline: transaction.before,
    selection: transaction.selectionBefore,
    undo: state.undo.slice(0, -1),
    redo: [...state.redo, transaction],
  };
}

export function redoSpline(state: SplineEditorState): SplineEditorState {
  const transaction = state.redo.at(-1);
  if (!transaction) return state;
  return {
    ...state,
    spline: transaction.after,
    selection: transaction.selectionAfter,
    undo: [...state.undo, transaction],
    redo: state.redo.slice(0, -1),
  };
}

export function deleteSplineNode(spline: SplineElement, nodeId: string): SplineResult { if (!spline.nodes.some((node) => node.id === nodeId)) return { success: false, error: `Spline node not found: ${nodeId}` }; if (spline.nodes.length <= 2) return { success: false, error: "A spline must retain at least two nodes" }; return { success: true, spline: { ...spline, nodes: spline.nodes.filter((node) => node.id !== nodeId) } }; }
