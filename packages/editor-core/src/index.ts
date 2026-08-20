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
  nextRevision,
  revision,
  withElements,
} from "@nodra/domain";
import { validateDocument } from "@nodra/validation";

export type ElementPatch = { readonly position?: PointMm; readonly size?: SizeMm; readonly rotation?: number; readonly style?: VisualStyle; readonly operation?: OperationMetadata; readonly start?: PointMm; readonly end?: PointMm };
export type EditorCommand = { readonly name: string; readonly apply: (document: DocumentSnapshot) => CommandResult };
export type CommandResult = { readonly success: true; readonly document: DocumentSnapshot } | { readonly success: false; readonly error: string };
export interface Transaction { readonly command: string; readonly before: DocumentSnapshot; readonly after: DocumentSnapshot }
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
      return { ...element, position: { x: element.position.x + delta.x, y: element.position.y + delta.y } };
    }));
  },
});

export const resizeElement = (id: ElementId, position: PointMm, size: SizeMm): EditorCommand => updateElement(id, { position, size });
export const rotateElement = (id: ElementId, rotation: number): EditorCommand => updateElement(id, { rotation });

export const setLayerVisibility = (id: LayerId, visible: boolean): EditorCommand => ({
  name: `layer-visibility:${id}`,
  apply: (document) => document.layers.some((layer) => layer.id === id)
    ? result({ ...document, revision: nextRevision(document.revision), layers: document.layers.map((layer) => layer.id === id ? { ...layer, visible } : layer) })
    : { success: false, error: `Layer not found: ${id}` },
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
  if (!applied.success) return state;
  return { ...state, document: applied.document, undo: [...state.undo, { command: command.name, before: state.document, after: applied.document }], redo: [], gesture: undefined };
}

export function undo(state: EditorState): EditorState {
  const transaction = state.undo.at(-1);
  if (!transaction) return state;
  return { ...state, document: transaction.before, undo: state.undo.slice(0, -1), redo: [...state.redo, transaction], gesture: undefined };
}
export function redo(state: EditorState): EditorState {
  const transaction = state.redo.at(-1);
  if (!transaction) return state;
  return { ...state, document: transaction.after, undo: [...state.undo, transaction], redo: state.redo.slice(0, -1), gesture: undefined };
}

export function beginGesture(state: EditorState): EditorState {
  return { ...state, gesture: { base: state.document, preview: state.document } };
}
export function previewGesture(state: EditorState, command: EditorCommand): EditorState {
  if (!state.gesture) return state;
  const applied = command.apply(state.gesture.preview);
  return applied.success ? { ...state, document: applied.document, gesture: { ...state.gesture, preview: applied.document } } : state;
}
export function commitGesture(state: EditorState): EditorState {
  if (!state.gesture) return state;
  const { base, preview } = state.gesture;
  if (preview === base) return { ...state, gesture: undefined };
  return { ...state, document: preview, undo: [...state.undo, { command: "gesture", before: base, after: preview }], redo: [], gesture: undefined };
}
export function cancelGesture(state: EditorState): EditorState {
  return state.gesture ? { ...state, document: state.gesture.base, gesture: undefined } : state;
}

export { revision };
