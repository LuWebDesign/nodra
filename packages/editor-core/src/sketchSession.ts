import type { DocumentSnapshot, ElementId } from "@nodra/domain";
import type { Transaction } from "./index.js";

export interface SketchSessionHistory {
  readonly undo: readonly Transaction[];
  readonly redo: readonly Transaction[];
}

export interface PendingSketchPreview {
  readonly id: string;
  readonly sketchId: ElementId;
  readonly sequence: number;
}

export type SketchSessionState =
  | { readonly status: "idle"; readonly document: DocumentSnapshot; readonly editorHistory: SketchSessionHistory; readonly selection: readonly ElementId[] }
  | {
      readonly status: "active";
      readonly sketchId: ElementId;
      readonly document: DocumentSnapshot;
      readonly editorHistory: SketchSessionHistory;
      readonly entryDocument: DocumentSnapshot;
      readonly entryEditorHistory: SketchSessionHistory;
      readonly entrySelection: readonly ElementId[];
      readonly pending: PendingSketchPreview | undefined;
      readonly committed: readonly Transaction[];
    }
  | {
      readonly status: "confirming-cancel";
      readonly sketchId: ElementId;
      readonly document: DocumentSnapshot;
      readonly editorHistory: SketchSessionHistory;
      readonly entryDocument: DocumentSnapshot;
      readonly entryEditorHistory: SketchSessionHistory;
      readonly entrySelection: readonly ElementId[];
      readonly committed: readonly Transaction[];
    };

export type SketchSessionEvent =
  | { readonly type: "enter"; readonly sketchId: ElementId }
  | { readonly type: "begin-preview"; readonly previewId: string; readonly sketchId: ElementId }
  | { readonly type: "update-preview"; readonly previewId: string; readonly sketchId: ElementId }
  | { readonly type: "commit-gesture"; readonly sketchId: ElementId; readonly transaction: Transaction; readonly affectedElementIds: readonly ElementId[] }
  | { readonly type: "escape" }
  | { readonly type: "accept" }
  | { readonly type: "cancel-session" }
  | { readonly type: "confirm-cancel" }
  | { readonly type: "decline-cancel" };

const clone = <T>(value: T): T => structuredClone(value);
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const historyClone = (history: SketchSessionHistory): SketchSessionHistory => clone({ undo: [...history.undo], redo: [...history.redo] });
export const isSketchScopedDocumentChange = (before: DocumentSnapshot, after: DocumentSnapshot, sketchId: ElementId): boolean => {
  const beforeState = { ...before, revision: undefined, elements: undefined };
  const afterState = { ...after, revision: undefined, elements: undefined };
  if (!same(beforeState, afterState) || before.elements.length !== after.elements.length) return false;
  return before.elements.every((element, index) => {
    const afterElement = after.elements[index];
    if (element.id !== sketchId) return same(element, afterElement);
    return afterElement !== undefined && afterElement.id === sketchId && afterElement.type === "sketch";
  });
};
const preservesSketchScope = (before: DocumentSnapshot, after: DocumentSnapshot, sketchId: ElementId): boolean => isSketchScopedDocumentChange(before, after, sketchId);

export function createSketchSession(document: DocumentSnapshot, editorHistory: SketchSessionHistory = { undo: [], redo: [] }, selection: readonly ElementId[] = []): SketchSessionState {
  return { status: "idle", document: clone(document), editorHistory: historyClone(editorHistory), selection: [...selection] };
}

export const isSketchSessionHistoryLocked = (state: SketchSessionState): boolean => state.status !== "idle";

export function reduceSketchSession(state: SketchSessionState, event: SketchSessionEvent): SketchSessionState {
  if (state.status === "idle") {
    if (event.type !== "enter") return state;
    const element = state.document.elements.find((candidate) => candidate.id === event.sketchId);
    if (!element || element.type !== "sketch") return state;
    return { status: "active", sketchId: event.sketchId, document: state.document, editorHistory: state.editorHistory, entryDocument: clone(state.document), entryEditorHistory: historyClone(state.editorHistory), entrySelection: [...state.selection], pending: undefined, committed: [] };
  }

  if (state.status === "confirming-cancel") {
    if (event.type === "confirm-cancel") return { status: "idle", document: clone(state.entryDocument), editorHistory: historyClone(state.entryEditorHistory), selection: [...state.entrySelection] };
    if (event.type === "decline-cancel" || event.type === "escape") return { status: "active", sketchId: state.sketchId, document: state.document, editorHistory: state.editorHistory, entryDocument: state.entryDocument, entryEditorHistory: state.entryEditorHistory, entrySelection: state.entrySelection, pending: undefined, committed: state.committed };
    return state;
  }

  switch (event.type) {
    case "begin-preview": return event.sketchId === state.sketchId ? { ...state, pending: { id: event.previewId, sketchId: event.sketchId, sequence: 0 } } : state;
    case "update-preview": return event.sketchId === state.sketchId && state.pending?.id === event.previewId ? { ...state, pending: { ...state.pending, sequence: state.pending.sequence + 1 } } : state;
    case "escape": return state.pending ? { ...state, pending: undefined } : state;
    case "commit-gesture": {
      if (event.sketchId !== state.sketchId || event.affectedElementIds.length === 0 || event.affectedElementIds.some((id) => id !== state.sketchId)) return state;
      const { transaction } = event;
      if (!same(transaction.before, state.document) || !preservesSketchScope(transaction.before, transaction.after, state.sketchId) || same(transaction.after, transaction.before)) return state;
      const nextTransaction = clone(transaction);
      return { ...state, document: clone(transaction.after), editorHistory: { undo: [...state.editorHistory.undo, nextTransaction], redo: [] }, pending: undefined, committed: [...state.committed, nextTransaction] };
    }
    case "accept": return { status: "idle", document: state.document, editorHistory: state.editorHistory, selection: [...state.entrySelection] };
    case "cancel-session": return state.committed.length === 0 ? { status: "idle", document: state.entryDocument, editorHistory: state.entryEditorHistory, selection: [...state.entrySelection] } : { status: "confirming-cancel", sketchId: state.sketchId, document: state.document, editorHistory: state.editorHistory, entryDocument: state.entryDocument, entryEditorHistory: state.entryEditorHistory, entrySelection: state.entrySelection, committed: state.committed };
    default: return state;
  }
}
