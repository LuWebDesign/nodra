import {
  type DocumentSnapshot,
  type Element,
  type ElementId,
  type Layer,
  type LayerId,
  type PointMm,
  type SizeMm,
  type VisualStyle,
  type OperationMetadata,
  type PathElement,
  type PathJoinMode,
  elementId,
  nextRevision,
  revision,
  withElements,
} from "@nodra/domain";
import { validateDocument } from "@nodra/validation";
import { boundsOfElements, contourWithPoints, directionVector, elementCenter, groupCenter, resizeGroup, rotateElements, shapeResultContours, splitCubicBezier, transformPoint, type Direction } from "@nodra/geometry";

export type ElementPatch = { readonly position?: PointMm; readonly size?: SizeMm; readonly rotation?: number; readonly cornerRadius?: number; readonly style?: VisualStyle; readonly operation?: OperationMetadata; readonly start?: PointMm; readonly end?: PointMm };
export type StylePatch = { readonly stroke?: string; readonly fill?: string | null; readonly strokeWidth?: number };
export type EditorCommand = { readonly name: string; readonly apply: (document: DocumentSnapshot) => CommandResult };
export type CommandResult = { readonly success: true; readonly document: DocumentSnapshot } | { readonly success: false; readonly error: string };
export interface Transaction { readonly command: string; readonly before: DocumentSnapshot; readonly after: DocumentSnapshot; readonly selectionBefore: readonly ElementId[]; readonly selectionAfter: readonly ElementId[] }
export interface EditorState {
  readonly document: DocumentSnapshot;
  readonly selection: readonly ElementId[];
  readonly undo: readonly Transaction[];
  readonly redo: readonly Transaction[];
  readonly gesture: { readonly base: DocumentSnapshot; readonly preview: DocumentSnapshot } | undefined;
}

const result = (document: DocumentSnapshot): CommandResult => {
  const checked = validateDocument(document);
  return checked.success ? { success: true, document: checked.data } : { success: false, error: checked.error };
};
const replaceElements = (document: DocumentSnapshot, elements: readonly Element[]): CommandResult => result(withElements(document, elements));
const elementIndex = (document: DocumentSnapshot, id: ElementId): number => document.elements.findIndex((element) => element.id === id);

export const createElement = (element: Element): EditorCommand => ({
  name: `create:${element.type}`,
  apply: (document) => document.elements.some((current) => current.id === element.id)
    ? { success: false, error: `Element already exists: ${element.id}` }
    : replaceElements(document, [...document.elements, { ...element }]),
});

export const deleteElement = (id: ElementId): EditorCommand => ({
  name: `delete:${id}`,
  apply: (document) => document.elements.some((element) => element.id === id)
    ? replaceElements(document, document.elements.filter((element) => element.id !== id))
    : { success: false, error: `Element not found: ${id}` },
});

export const updateElement = (id: ElementId, patch: ElementPatch): EditorCommand => ({
  name: `update:${id}`,
  apply: (document) => {
    const index = elementIndex(document, id);
    if (index < 0) return { success: false, error: `Element not found: ${id}` };
    const elements = [...document.elements];
    elements[index] = { ...elements[index], ...patch } as Element;
    return replaceElements(document, elements);
  },
});

export const moveElement = (id: ElementId, delta: PointMm): EditorCommand => ({
  name: `move:${id}`,
  apply: (document) => {
    const element = document.elements.find((current) => current.id === id);
    if (!element) return { success: false, error: `Element not found: ${id}` };
    if (element.type === "line") return replaceElements(document, document.elements.map((current) => current.id === id && current.type === "line" ? { ...current, start: { x: current.start.x + delta.x, y: current.start.y + delta.y }, end: { x: current.end.x + delta.x, y: current.end.y + delta.y } } : current));
    if (element.type === "contour") return replaceElements(document, document.elements.map((current) => current.id === id && current.type === "contour" ? contourWithPoints(current, current.contours.map((contour) => contour.points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y })))) : current));
    if (element.type === "path") return replaceElements(document, document.elements.map((current) => current.id === id && current.type === "path" ? { ...current, nodes: current.nodes.map((node) => ({ ...node, anchor: { x: node.anchor.x + delta.x, y: node.anchor.y + delta.y } })), segments: current.segments.map((segment) => segment.type === "line" ? segment : { ...segment, control1: { x: segment.control1.x + delta.x, y: segment.control1.y + delta.y }, control2: { x: segment.control2.x + delta.x, y: segment.control2.y + delta.y } }) } : current));
    return replaceElements(document, document.elements.map((current) => current.id === id && current.type !== "line" ? { ...current, position: { x: current.position.x + delta.x, y: current.position.y + delta.y } } : current));
  },
});

export const moveElements = (ids: readonly ElementId[], delta: PointMm): EditorCommand => ({
  name: `move:${[...new Set(ids)].join(",")}`,
  apply: (document) => {
    const selected = new Set(ids);
    const known = document.elements.filter((element) => selected.has(element.id));
    if (known.length !== selected.size) return { success: false, error: "One or more elements were not found" };
    if (known.length === 0) return { success: false, error: "No elements selected" };
    return replaceElements(document, document.elements.map((element) => {
      if (!selected.has(element.id)) return element;
      if (element.type === "line") return { ...element, start: { x: element.start.x + delta.x, y: element.start.y + delta.y }, end: { x: element.end.x + delta.x, y: element.end.y + delta.y } };
      if (element.type === "contour") return contourWithPoints(element, element.contours.map((contour) => contour.points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y }))));
      if (element.type === "path") return { ...element, nodes: element.nodes.map((node) => ({ ...node, anchor: { x: node.anchor.x + delta.x, y: node.anchor.y + delta.y } })), segments: element.segments.map((segment) => segment.type === "line" ? segment : { ...segment, control1: { x: segment.control1.x + delta.x, y: segment.control1.y + delta.y }, control2: { x: segment.control2.x + delta.x, y: segment.control2.y + delta.y } }) };
      return { ...element, position: { x: element.position.x + delta.x, y: element.position.y + delta.y } };
    }));
  },
});
export const resizeElements = (ids: readonly ElementId[], handle: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w", pointer: PointMm, aspectLock = false): EditorCommand => ({ name: `resize-group:${ids.join(",")}`, apply: (document) => { const selected = new Set(ids); const elements = document.elements.filter((e) => selected.has(e.id)); if (!elements.length || elements.length !== selected.size) return { success: false, error: "Invalid group selection" }; const next = resizeGroup(elements, handle, pointer, 1, aspectLock); return replaceElements(document, document.elements.map((e) => next.find((n) => n.id === e.id) ?? e)); } });
export const rotateElementsAroundCenter = (ids: readonly ElementId[], delta: number): EditorCommand => ({ name: `rotate-group:${ids.join(",")}`, apply: (document) => { const selected = new Set(ids); const elements = document.elements.filter((e) => selected.has(e.id)); if (!elements.length || elements.length !== selected.size) return { success: false, error: "Invalid group selection" }; const next = rotateElements(elements, groupCenter(boundsOfElements(elements)), delta); return replaceElements(document, document.elements.map((e) => next.find((n) => n.id === e.id) ?? e)); } });

export const resizeElement = (id: ElementId, position: PointMm, size: SizeMm): EditorCommand => updateElement(id, { position, size });
export const rotateElement = (id: ElementId, rotation: number): EditorCommand => ({ name: `rotate:${id}`, apply: (document) => {
  const current = document.elements.find((element) => element.id === id);
  if (!current) return { success: false, error: `Element not found: ${id}` };
  if (current.type !== "contour") return updateElement(id, { rotation }).apply(document);
  const center = elementCenter(current);
  return replaceElements(document, document.elements.map((element) => element.id === id && element.type === "contour" ? contourWithPoints(element, element.contours.map((contour) => contour.points.map((point) => transformPoint({ x: point.x - center.x, y: point.y - center.y }, center, rotation - current.rotation)))) : element));
} });

export type ShapeOperation = "weld" | "subtract" | "outline";
export const shapeOperation = (ids: readonly ElementId[], operation: ShapeOperation): EditorCommand => ({
  name: `shape-${operation}:${ids.join(",")}`,
  apply: (document) => {
    const selected = ids.map((id) => document.elements.find((element) => element.id === id));
    const known = selected.filter((element): element is Element => Boolean(element));
    if (known.length !== selected.length || !known.length) return { success: false, error: "No valid objects selected" };
    if (known.some((element) => element.type === "line")) return { success: false, error: "Shape operations require closed objects" };
    if (operation === "subtract" && known.length !== 2) return { success: false, error: "Recortar requires exactly two objects" };
    const first = known[0]!;
    const contours = shapeResultContours(operation === "subtract" ? "difference" : "union", operation === "subtract" ? [known[1]!, known[0]!] : known);
    if (!contours.length) return { success: false, error: "The shape operation produced an empty result" };
    const points = contours.flatMap((contour) => contour.points);
    const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
    const resultElement = {
      type: "contour" as const,
      id: elementId(`contour-${crypto.randomUUID()}`),
      layerId: first.layerId,
      position: { x: Math.min(...xs), y: Math.min(...ys) },
      size: { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) },
      contours,
      fillRule: "evenodd" as const,
      rotation: 0 as const,
      style: first.style,
      ...(first.operation ? { operation: first.operation } : {}),
    };
    const removed = new Set(known.map((element) => element.id));
    const firstIndex = Math.min(...known.map((element) => elementIndex(document, element.id)));
    const elements = document.elements.filter((element) => !removed.has(element.id));
    elements.splice(firstIndex, 0, resultElement);
    return replaceElements(document, elements);
  },
});
export const createPath = (path: PathElement): EditorCommand => createElement(path);

const addPoint = (first: PointMm, second: PointMm): PointMm => ({ x: first.x + second.x, y: first.y + second.y });
const subtractPoint = (first: PointMm, second: PointMm): PointMm => ({ x: first.x - second.x, y: first.y - second.y });
const scalePoint = (point: PointMm, scale: number): PointMm => ({ x: point.x * scale, y: point.y * scale });
const lengthOf = (point: PointMm): number => Math.hypot(point.x, point.y);

function joinedOppositeControl(path: PathElement, segmentIndex: number, control: "control1" | "control2", moved: PointMm, segments: PathElement["segments"]): readonly [number, "control1" | "control2", PointMm] | undefined {
  const segmentCount = path.segments.length;
  const nodeIndex = control === "control1" ? segmentIndex : (segmentIndex + 1) % path.nodes.length;
  const node = path.nodes[nodeIndex];
  if (!node || node.join === "corner") return undefined;
  const adjacentIndex = control === "control1" ? segmentIndex - 1 : segmentIndex + 1;
  const normalizedIndex = path.closed ? (adjacentIndex + segmentCount) % segmentCount : adjacentIndex;
  if (normalizedIndex < 0 || normalizedIndex >= segmentCount) return undefined;
  const adjacent = segments[normalizedIndex];
  if (!adjacent || adjacent.type !== "cubicBezier") return undefined;
  const oppositeControl = control === "control1" ? "control2" : "control1";
  const existing = adjacent[oppositeControl];
  const movedVector = subtractPoint(moved, node.anchor);
  const movedLength = lengthOf(movedVector);
  let oppositeVector: PointMm;
  if (node.join === "symmetric") {
    oppositeVector = scalePoint(movedVector, -1);
  } else if (movedLength === 0) {
    return undefined;
  } else {
    const existingLength = lengthOf(subtractPoint(existing, node.anchor));
    oppositeVector = scalePoint(movedVector, -existingLength / movedLength);
  }
  return [normalizedIndex, oppositeControl, addPoint(node.anchor, oppositeVector)];
}

const updatePath = (document: DocumentSnapshot, id: ElementId, update: (path: PathElement) => PathElement): CommandResult => {
  const index = elementIndex(document, id); const current = document.elements[index];
  if (!current) return { success: false, error: `Element not found: ${id}` };
  if (current.type !== "path") return { success: false, error: `Element is not a path: ${id}` };
  const next = update(current); if (JSON.stringify(next) === JSON.stringify(current)) return { success: true, document };
  const elements = [...document.elements]; elements[index] = next; return replaceElements(document, elements);
};
export const movePathNode = (id: ElementId, nodeId: string, delta: PointMm): EditorCommand => ({ name: `move-path-node:${id}:${nodeId}`, apply: (document) => updatePath(document, id, (path) => {
  const nodeIndex = path.nodes.findIndex((node) => node.id === nodeId);
  if (nodeIndex < 0) return path;
  const nextAnchor = addPoint(path.nodes[nodeIndex]!.anchor, delta);
  const segments = path.segments.map((segment) => segment);
  const outgoingIndex = nodeIndex;
  const incomingIndex = nodeIndex - 1;
  const indices = path.closed ? [outgoingIndex % segments.length, (incomingIndex + segments.length) % segments.length] : [outgoingIndex, incomingIndex];
  for (const segmentIndex of indices) {
    if (segmentIndex < 0 || segmentIndex >= segments.length) continue;
    const segment = segments[segmentIndex];
    if (!segment || segment.type !== "cubicBezier") continue;
    segments[segmentIndex] = segmentIndex === outgoingIndex ? { ...segment, control1: addPoint(segment.control1, delta) } : { ...segment, control2: addPoint(segment.control2, delta) };
  }
  return { ...path, nodes: path.nodes.map((node, index) => index === nodeIndex ? { ...node, anchor: nextAnchor } : node), segments };
}) });
export const movePathHandle = (id: ElementId, segmentIndex: number, control: "control1" | "control2", point: PointMm): EditorCommand => ({ name: `move-path-handle:${id}:${segmentIndex}:${control}`, apply: (document) => updatePath(document, id, (path) => {
  const segment = path.segments[segmentIndex];
  if (!segment || segment.type !== "cubicBezier") return path;
  const segments = path.segments.map((current, index) => index === segmentIndex ? { ...current, [control]: point } : current);
  const opposite = joinedOppositeControl(path, segmentIndex, control, point, segments);
  if (opposite) {
    const [oppositeIndex, oppositeControl, oppositePoint] = opposite;
    const adjacent = segments[oppositeIndex];
    if (adjacent?.type === "cubicBezier") segments[oppositeIndex] = { ...adjacent, [oppositeControl]: oppositePoint };
  }
  return { ...path, segments };
}) });
export const setPathJoinMode = (id: ElementId, nodeId: string, join: PathJoinMode): EditorCommand => ({ name: `path-join:${id}:${nodeId}`, apply: (document) => updatePath(document, id, (path) => ({ ...path, nodes: path.nodes.map((node) => node.id === nodeId ? { ...node, join } : node) })) });
export const setPathClosed = (id: ElementId, closed: boolean): EditorCommand => ({ name: `${closed ? "close" : "open"}-path:${id}`, apply: (document) => updatePath(document, id, (path) => { if (path.closed === closed) return path; if (closed) return { ...path, closed: true, segments: [...path.segments, { type: "line" }] }; return { ...path, closed: false, segments: path.segments.slice(0, -1) }; }) });
export const openPath = (id: ElementId): EditorCommand => setPathClosed(id, false);
export const closePath = (id: ElementId): EditorCommand => setPathClosed(id, true);
export const reversePath = (id: ElementId): EditorCommand => ({ name: `reverse-path:${id}`, apply: (document) => updatePath(document, id, (path) => { const nodes = [...path.nodes].reverse(); const segments = [...path.segments].reverse().map((segment) => segment.type === "line" ? segment : ({ ...segment, control1: segment.control2, control2: segment.control1 })); return { ...path, nodes, segments }; }) });
export const splitPathSegment = (id: ElementId, segmentIndex: number, nodeId: string, anchor?: PointMm): EditorCommand => ({ name: `split-path:${id}:${segmentIndex}`, apply: (document) => updatePath(document, id, (path) => { const segment = path.segments[segmentIndex]; const start = path.nodes[segmentIndex]?.anchor; const end = path.nodes[(segmentIndex + 1) % path.nodes.length]?.anchor; if (!segment || !start || !end || path.nodes.some((node) => node.id === nodeId)) return path; const t = anchor ? 0.5 : 0.5; const parts = segment.type === "line" ? [[start, start, end, end], [start, start, end, end]] as const : splitCubicBezier(start, segment.control1, segment.control2, end, t); const point = anchor ?? parts[0][3]; const inserted = { id: nodeId, anchor: point, join: "corner" as const }; const nodes = [...path.nodes]; nodes.splice(segmentIndex + 1, 0, inserted); const segments = [...path.segments]; segments.splice(segmentIndex, 1, ...(segment.type === "line" ? [{ type: "line" as const }, { type: "line" as const }] : [{ type: "cubicBezier" as const, control1: parts[0][1], control2: parts[0][2] }, { type: "cubicBezier" as const, control1: parts[1][1], control2: parts[1][2] }])); return { ...path, nodes, segments }; }) });
export const insertPathNode = splitPathSegment;

const translateElement = (element: Element, delta: PointMm, id: ElementId): Element => {
  if (element.type === "line") return { ...element, id, start: { x: element.start.x + delta.x, y: element.start.y + delta.y }, end: { x: element.end.x + delta.x, y: element.end.y + delta.y } };
  if (element.type === "contour") return { ...contourWithPoints(element, element.contours.map((contour) => contour.points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y })))), id, rotation: element.rotation };
  if (element.type === "path") return { ...element, id, nodes: element.nodes.map((node) => ({ ...node, anchor: { x: node.anchor.x + delta.x, y: node.anchor.y + delta.y } })), segments: element.segments.map((segment) => segment.type === "line" ? segment : { ...segment, control1: { x: segment.control1.x + delta.x, y: segment.control1.y + delta.y }, control2: { x: segment.control2.x + delta.x, y: segment.control2.y + delta.y } }) };
  return { ...element, id, position: { x: element.position.x + delta.x, y: element.position.y + delta.y } };
};

export const duplicateElements = (ids: readonly ElementId[], direction: Direction, distance: number, count: number): EditorCommand => ({
  name: `duplicate:${direction}:${count}`,
  apply: (document) => {
    if (!Number.isFinite(distance) || distance < 0) return { success: false, error: "Distance must be a finite non-negative number" };
    if (!Number.isInteger(count) || count < 1) return { success: false, error: "Copy count must be a positive integer" };
    const uniqueIds = [...new Set(ids)];
    const selected = document.elements.filter((element) => uniqueIds.includes(element.id));
    if (!selected.length || selected.length !== uniqueIds.length) return { success: false, error: "One or more elements were not found" };
    const vector = directionVector(direction);
    const bounds = boundsOfElements(selected);
    const step = { x: vector.x * (vector.x === 0 ? 0 : bounds.width + distance), y: vector.y * (vector.y === 0 ? 0 : bounds.height + distance) };
    const copies = Array.from({ length: count }, (_, copyIndex) => selected.map((element) => translateElement(element, { x: step.x * (copyIndex + 1), y: step.y * (copyIndex + 1) }, elementId(`element-${crypto.randomUUID()}`)))).flat();
    return replaceElements(document, [...document.elements, ...copies]);
  },
});

export type FlipAxis = "horizontal" | "vertical";
export const flipElements = (ids: readonly ElementId[], axis: FlipAxis): EditorCommand => ({
  name: `flip-${axis}:${[...new Set(ids)].join(",")}`,
  apply: (document) => {
    const selected = new Set(ids);
    const known = document.elements.filter((element) => selected.has(element.id));
    if (known.length !== selected.size) return { success: false, error: "One or more elements were not found" };
    if (known.length === 0) return { success: false, error: "No elements selected" };
    const center = groupCenter(boundsOfElements(known));
    const horizontal = axis === "horizontal";
    return replaceElements(document, document.elements.map((element) => {
      if (!selected.has(element.id)) return element;
      const currentCenter = elementCenter(element);
      const reflectedCenter = horizontal
        ? { x: center.x * 2 - currentCenter.x, y: currentCenter.y }
        : { x: currentCenter.x, y: center.y * 2 - currentCenter.y };
      const delta = { x: reflectedCenter.x - currentCenter.x, y: reflectedCenter.y - currentCenter.y };
      if (element.type === "path") return { ...element, nodes: element.nodes.map((node) => ({ ...node, anchor: horizontal ? { x: center.x * 2 - node.anchor.x, y: node.anchor.y } : { x: node.anchor.x, y: center.y * 2 - node.anchor.y } })), segments: element.segments.map((segment) => segment.type === "line" ? segment : ({ ...segment, control1: horizontal ? { x: center.x * 2 - segment.control1.x, y: segment.control1.y } : { x: segment.control1.x, y: center.y * 2 - segment.control1.y }, control2: horizontal ? { x: center.x * 2 - segment.control2.x, y: segment.control2.y } : { x: segment.control2.x, y: center.y * 2 - segment.control2.y } })) };
      const moved = element.type === "line"
        ? { ...element, start: { x: element.start.x + delta.x, y: element.start.y + delta.y }, end: { x: element.end.x + delta.x, y: element.end.y + delta.y } }
        : { ...element, position: { x: element.position.x + delta.x, y: element.position.y + delta.y } };
      if (element.type === "contour") return contourWithPoints(element, element.contours.map((contour) => contour.points.map((point) => horizontal ? { x: center.x * 2 - point.x, y: point.y } : { x: point.x, y: center.y * 2 - point.y })));
      return { ...moved, rotation: -element.rotation, [horizontal ? "flipX" : "flipY"]: !(horizontal ? element.flipX : element.flipY) };
    }));
  },
});

export const updateElementStyles = (ids: readonly ElementId[], patch: StylePatch): EditorCommand => ({
  name: `style:${[...new Set(ids)].join(",")}`,
  apply: (document) => {
    const selected = new Set(ids);
    const known = document.elements.filter((element) => selected.has(element.id));
    if (known.length !== selected.size) return { success: false, error: "One or more elements were not found" };
    if (known.length === 0) return { success: false, error: "No elements selected" };
    return replaceElements(document, document.elements.map((element) => {
      if (!selected.has(element.id)) return element;
      const style = { ...element.style, ...patch } as VisualStyle & { fill?: string | null };
      if (patch.fill === null) delete style.fill;
      return { ...element, style } as Element;
    }));
  },
});

export const updatePage = (width: number, height: number): EditorCommand => ({
  name: "page-size",
  apply: (document) => result({ ...document, page: { width, height }, revision: nextRevision(document.revision) }),
});

export const setLayerVisibility = (id: LayerId, visible: boolean): EditorCommand => ({
  name: `layer-visibility:${id}`,
  apply: (document) => {
    const layer = document.layers.find((current) => current.id === id);
    if (!layer) return { success: false, error: `Layer not found: ${id}` };
    if (layer.visible === visible) return { success: true, document };
    return result({ ...document, revision: nextRevision(document.revision), layers: document.layers.map((current) => current.id === id ? { ...current, visible } : current) });
  },
});

export const reorderLayer = (id: LayerId, order: number): EditorCommand => ({
  name: `layer-order:${id}`,
  apply: (document) => {
    if (!document.layers.some((layer) => layer.id === id) || !Number.isInteger(order) || order < 0 || order >= document.layers.length) return { success: false, error: `Invalid layer or order: ${id}` };
    const ordered = [...document.layers].sort((a, b) => a.order - b.order);
    const currentIndex = ordered.findIndex((layer) => layer.id === id);
    const [moved] = ordered.splice(currentIndex, 1);
    ordered.splice(order, 0, moved!);
    return result({ ...document, revision: nextRevision(document.revision), layers: ordered.map((layer, index) => ({ ...layer, order: index })) });
  },
});

export const addLayer = (layer: Layer): EditorCommand => ({
  name: `layer-add:${layer.id}`,
  apply: (document) => document.layers.some((current) => current.id === layer.id)
    ? { success: false, error: `Layer already exists: ${layer.id}` }
    : result({ ...document, revision: nextRevision(document.revision), layers: [...document.layers, { ...layer }] }),
});

export function createEditor(document: DocumentSnapshot): EditorState { return { document, selection: [], undo: [], redo: [], gesture: undefined }; }
const knownSelection = (state: EditorState, ids: readonly ElementId[]): ElementId[] => {
  const known = new Set(state.document.elements.map((element) => element.id));
  return [...new Set(ids)].filter((id) => known.has(id));
};
export function select(state: EditorState, ids: readonly ElementId[]): EditorState {
  return { ...state, selection: knownSelection(state, ids) };
}
export const replaceSelection = select;
export function addToSelection(state: EditorState, ids: readonly ElementId[]): EditorState { return select(state, [...state.selection, ...ids]); }
export function removeFromSelection(state: EditorState, ids: readonly ElementId[]): EditorState { const removed = new Set(ids); return select(state, state.selection.filter((id) => !removed.has(id))); }
export function toggleSelection(state: EditorState, id: ElementId): EditorState { return state.selection.includes(id) ? removeFromSelection(state, [id]) : addToSelection(state, [id]); }
export function selectForPointerDown(state: EditorState, id: ElementId, shiftKey: boolean): EditorState {
  if (shiftKey) return toggleSelection(state, id);
  return state.selection.includes(id) ? state : select(state, [id]);
}
export function clearSelection(state: EditorState): EditorState { return { ...state, selection: [] }; }

export function dispatch(state: EditorState, command: EditorCommand): EditorState {
  const applied = command.apply(state.document);
  if (!applied.success || applied.document === state.document) return state;
  const nextSelection = command.name.startsWith("shape-")
    ? applied.document.elements.filter((element) => !state.document.elements.some((previous) => previous.id === element.id)).map((element) => element.id)
    : command.name.startsWith("duplicate:")
      ? applied.document.elements.filter((element) => !state.document.elements.some((previous) => previous.id === element.id)).map((element) => element.id)
    : knownSelection({ ...state, document: applied.document }, state.selection);
  return { ...state, document: applied.document, selection: nextSelection, undo: [...state.undo, { command: command.name, before: state.document, after: applied.document, selectionBefore: state.selection, selectionAfter: nextSelection }], redo: [], gesture: undefined };
}

export function undo(state: EditorState): EditorState {
  const transaction = state.undo.at(-1);
  if (!transaction) return state;
  const selection = transaction.command.startsWith("shape-") || transaction.command.startsWith("duplicate:") ? transaction.selectionBefore : knownSelection({ ...state, document: transaction.before }, state.selection);
  return { ...state, document: transaction.before, selection, undo: state.undo.slice(0, -1), redo: [...state.redo, transaction], gesture: undefined };
}
export function redo(state: EditorState): EditorState {
  const transaction = state.redo.at(-1);
  if (!transaction) return state;
  const selection = transaction.command.startsWith("shape-") || transaction.command.startsWith("duplicate:") ? transaction.selectionAfter : knownSelection({ ...state, document: transaction.after }, state.selection);
  return { ...state, document: transaction.after, selection, undo: [...state.undo, transaction], redo: state.redo.slice(0, -1), gesture: undefined };
}

export function beginGesture(state: EditorState): EditorState {
  return { ...state, gesture: { base: state.document, preview: state.document } };
}
export function previewGesture(state: EditorState, command: EditorCommand): EditorState {
  if (!state.gesture) return state;
  const applied = command.apply(state.gesture.preview);
  return applied.success ? { ...state, document: applied.document, gesture: { ...state.gesture, preview: applied.document } } : state;
}
/** Recomputes a preview from the gesture base, so pointer-derived corrections never accumulate. */
export function previewGestureFromBase(state: EditorState, command: EditorCommand): EditorState {
  if (!state.gesture) return state;
  const applied = command.apply(state.gesture.base);
  return applied.success ? { ...state, document: applied.document, gesture: { ...state.gesture, preview: applied.document } } : state;
}
export function commitGesture(state: EditorState): EditorState {
  if (!state.gesture) return state;
  const { base, preview } = state.gesture;
  if (preview === base) return { ...state, gesture: undefined };
  return { ...state, document: preview, undo: [...state.undo, { command: "gesture", before: base, after: preview, selectionBefore: state.selection, selectionAfter: state.selection }], redo: [], gesture: undefined };
}
export function cancelGesture(state: EditorState): EditorState {
  return state.gesture ? { ...state, document: state.gesture.base, gesture: undefined } : state;
}

export { revision };
