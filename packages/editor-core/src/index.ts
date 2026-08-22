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
  elementId,
  nextRevision,
  revision,
  withElements,
} from "@nodra/domain";
import { validateDocument } from "@nodra/validation";
import { boundsOfElements, contourWithPoints, directionVector, elementCenter, elementToContour, groupCenter, realGeometryNodes, resizeGroup, rotateElements, shapeResultContours, transformPoint, type Direction } from "@nodra/geometry";

export type ElementPatch = { readonly position?: PointMm; readonly size?: SizeMm; readonly rotation?: number; readonly cornerRadius?: number; readonly style?: VisualStyle; readonly operation?: OperationMetadata; readonly start?: PointMm; readonly end?: PointMm };
export interface ContourNodeAddress { readonly ringIndex: number; readonly pointIndex: number }
export interface ContourSegmentAddress { readonly ringIndex: number; readonly segmentIndex: number }
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
    if (operation === "subtract" && known.length < 2) return { success: false, error: "Recortar requires at least two objects" };
    const first = known[0]!;
    const contours = shapeResultContours(operation === "subtract" ? "difference" : "union", operation === "subtract" ? [known.at(-1)!, ...known.slice(0, -1)] : known);
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

export const updateContourNode = (id: ElementId, address: ContourNodeAddress, point: PointMm): EditorCommand => ({
  name: `contour-node:${id}:${address.ringIndex}:${address.pointIndex}`,
  apply: (document) => {
    if (![point.x, point.y].every(Number.isFinite)) return { success: false, error: "Contour node coordinates must be finite" };
    const current = document.elements.find((element) => element.id === id);
    if (!current) return { success: false, error: `Element not found: ${id}` };
    if (current.type !== "contour") return { success: false, error: "Contour node updates require a contour" };
    const ring = current.contours[address.ringIndex];
    if (!ring || !ring.points[address.pointIndex]) return { success: false, error: "Contour node not found" };
    const points = current.contours.map((candidate, ringIndex) => candidate.points.map((candidatePoint, pointIndex) => {
      const isAddress = ringIndex === address.ringIndex && pointIndex === address.pointIndex;
      const closesRing = ringIndex === address.ringIndex && address.pointIndex === 0 && pointIndex === candidate.points.length - 1 && candidate.points.at(-1)?.x === candidate.points[0]?.x && candidate.points.at(-1)?.y === candidate.points[0]?.y;
      return isAddress || closesRing ? point : candidatePoint;
    }));
    return replaceElements(document, document.elements.map((element) => element.id === id && element.type === "contour" ? contourWithPoints(element, points) : element));
  },
});

export const insertContourNode = (id: ElementId, address: ContourSegmentAddress, point: PointMm): EditorCommand => ({
  name: `contour-node-insert:${id}:${address.ringIndex}:${address.segmentIndex}`,
  apply: (document) => {
    if (![point.x, point.y].every(Number.isFinite)) return { success: false, error: "Contour node coordinates must be finite" };
    const current = document.elements.find((element) => element.id === id);
    if (!current) return { success: false, error: `Element not found: ${id}` };
    if (current.type !== "contour") return { success: false, error: "Contour node insertion requires a contour" };
    const ring = current.contours[address.ringIndex];
    if (!ring) return { success: false, error: "Contour segment ring not found" };
    const closing = ring.points.length > 1 && ring.points.at(-1)?.x === ring.points[0]?.x && ring.points.at(-1)?.y === ring.points[0]?.y;
    const vertexCount = closing ? ring.points.length - 1 : ring.points.length;
    if (!Number.isInteger(address.segmentIndex) || address.segmentIndex < 0 || address.segmentIndex >= vertexCount) return { success: false, error: "Contour segment not found" };
    const insertIndex = address.segmentIndex + 1;
    const points = current.contours.map((candidate, ringIndex) => ringIndex !== address.ringIndex ? candidate.points : [...candidate.points.slice(0, insertIndex), point, ...candidate.points.slice(insertIndex)]);
    return replaceElements(document, document.elements.map((element) => element.id === id && element.type === "contour" ? contourWithPoints(element, points) : element));
  },
});

export const insertFormaNode = (id: ElementId, address: ContourSegmentAddress, point: PointMm): EditorCommand => ({
  name: `forma-node-insert:${id}:${address.segmentIndex}`,
  apply: (document) => {
    const current = document.elements.find((element) => element.id === id);
    if (!current) return { success: false, error: `Element not found: ${id}` };
    if (current.type === "contour") return insertContourNode(id, address, point).apply(document);
    const contour = elementToContour(current);
    const inserted = insertContourNode(id, address, point).apply({ ...document, elements: document.elements.map((element) => element.id === id ? contour : element) });
    return inserted.success ? inserted : { success: false, error: inserted.error };
  },
});

export const updateElementNode = (id: ElementId, nodeIndex: number, point: PointMm): EditorCommand => ({
  name: `forma-node:${id}:${nodeIndex}`,
  apply: (document) => {
    if (![point.x, point.y].every(Number.isFinite) || !Number.isInteger(nodeIndex) || nodeIndex < 0) return { success: false, error: "Forma node coordinates must be finite" };
    const current = document.elements.find((element) => element.id === id);
    if (!current) return { success: false, error: `Element not found: ${id}` };
    if (current.type === "contour") return { success: false, error: "Contour nodes require a contour address" };
    const nodes = realGeometryNodes(current);
    const node = nodes[nodeIndex];
    if (!node) return { success: false, error: "Forma node not found" };
    if (current.type === "line") {
      const delta = { x: point.x - node.point.x, y: point.y - node.point.y };
      const next = nodeIndex === 0 ? { ...current, start: point } : nodeIndex === 2 ? { ...current, end: point } : { ...current, start: { x: current.start.x + delta.x, y: current.start.y + delta.y }, end: { x: current.end.x + delta.x, y: current.end.y + delta.y } };
      return replaceElements(document, document.elements.map((element) => element.id === id ? next : element));
    }
    if (node.kind === "center") return moveElement(id, { x: point.x - node.point.x, y: point.y - node.point.y }).apply(document);
    const handle = current.type === "rectangle" || current.type === "ellipse"
      ? node.kind === "corner" ? (["nw", "ne", "se", "sw"] as const)[nodes.filter((candidate) => candidate.kind === "corner").findIndex((candidate) => candidate === node)]
        : node.kind === "cardinal" ? (["n", "e", "s", "w"] as const)[nodes.filter((candidate) => candidate.kind === "cardinal").findIndex((candidate) => candidate === node)]
        : undefined
      : undefined;
    const handleIndex = nodes.indexOf(node);
    const mappedHandle = handle ?? (["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const)[handleIndex];
    if (!mappedHandle) return { success: false, error: "Forma node cannot resize this object" };
    const geometry = resizeGroup([current], mappedHandle, point, 1)[0];
    return geometry ? replaceElements(document, document.elements.map((element) => element.id === id ? geometry : element)) : { success: false, error: "Forma node resize failed" };
  },
});

export const deleteElementNodes = (id: ElementId, nodeIndexes: readonly number[]): EditorCommand => ({
  name: `forma-node-delete:${id}:${[...nodeIndexes].join(",")}`,
  apply: (document) => {
    const current = document.elements.find((element) => element.id === id);
    if (!current) return { success: false, error: `Element not found: ${id}` };
    const indexes = [...new Set(nodeIndexes)].sort((a, b) => b - a);
    if (!indexes.length) return { success: false, error: "No Forma nodes selected" };
    if (current.type !== "contour" && indexes.some((index) => realGeometryNodes(current)[index]?.kind === "center")) return { success: false, error: "El centro no es un nodo de contorno eliminable" };
    const contour = current.type === "contour" ? current : elementToContour(current);
    const remove = new Set(indexes);
    const points = contour.contours.map((ring) => {
      const vertices = ring.points.slice(0, -1);
      const kept = vertices.filter((_, index) => !remove.has(index));
      return [...kept, kept[0]!];
    });
    if (points.some((ring) => ring.length < 4)) return { success: false, error: "No se puede eliminar: el anillo debe conservar al menos tres vértices" };
    return replaceElements(document, document.elements.map((element) => element.id === id ? contourWithPoints({ ...contour, id } as typeof contour, points) : element));
  },
});

export const deleteContourNodes = (id: ElementId, addresses: readonly ContourNodeAddress[]): EditorCommand => ({
  name: `contour-node-delete:${id}`,
  apply: (document) => {
    const current = document.elements.find((element) => element.id === id);
    if (!current || current.type !== "contour") return { success: false, error: "Contour nodes require a contour" };
    const removals = new Map<number, Set<number>>();
    for (const address of addresses) {
      if (!Number.isInteger(address.ringIndex) || !Number.isInteger(address.pointIndex)) return { success: false, error: "Invalid contour node address" };
      const ring = current.contours[address.ringIndex];
      if (!ring) return { success: false, error: "Contour node ring not found" };
      const vertices = ring.points.slice(0, -1);
      if (address.pointIndex < 0 || address.pointIndex >= vertices.length) return { success: false, error: "Contour node not found" };
      const set = removals.get(address.ringIndex) ?? new Set<number>(); set.add(address.pointIndex); removals.set(address.ringIndex, set);
    }
    const points = current.contours.map((ring, ringIndex) => { const vertices = ring.points.slice(0, -1); const kept = vertices.filter((_, index) => !removals.get(ringIndex)?.has(index)); return [...kept, kept[0]!]; });
    if (points.some((ring) => ring.length < 4)) return { success: false, error: "No se puede eliminar: el anillo debe conservar al menos tres vértices" };
    return replaceElements(document, document.elements.map((element) => element.id === id && element.type === "contour" ? contourWithPoints(element, points) : element));
  },
});

const translateElement = (element: Element, delta: PointMm, id: ElementId): Element => {
  if (element.type === "line") return { ...element, id, start: { x: element.start.x + delta.x, y: element.start.y + delta.y }, end: { x: element.end.x + delta.x, y: element.end.y + delta.y } };
  if (element.type === "contour") return { ...contourWithPoints(element, element.contours.map((contour) => contour.points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y })))), id, rotation: element.rotation };
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
