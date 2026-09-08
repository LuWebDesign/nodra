import { beforeEach, describe, expect, it } from "vitest";
import { elementId, layerId } from "@nodra/domain";
import { beginGesture, commitGesture, createElement, deleteElement, dispatch, previewGestureFromBase } from "@nodra/editor-core";
import { sessionForSketchEditor, shouldPersistEditorSnapshot, useDocumentStore, usePersistenceStore } from "./stores.js";

describe("document store persistence boundary", () => {
  beforeEach(() => { useDocumentStore.setState(useDocumentStore.getInitialState(), true); usePersistenceStore.setState(usePersistenceStore.getInitialState(), true); });

  it("surfaces an explicit pending official-save state", () => {
    usePersistenceStore.getState().set("pending", "Cambios pendientes de guardar");
    expect(usePersistenceStore.getState()).toMatchObject({ state: "pending", message: "Cambios pendientes de guardar" });
  });

  it("gates recovery mirrors while sketch edits are active", () => {
    expect(shouldPersistEditorSnapshot("active", false)).toBe(false);
    expect(shouldPersistEditorSnapshot("confirming-cancel", false)).toBe(false);
    expect(shouldPersistEditorSnapshot("idle", true)).toBe(false);
    expect(shouldPersistEditorSnapshot("idle", false)).toBe(true);
  });

  it("associates the first valid sketch segment with its pending piece in one revision", () => {
    const state = useDocumentStore.getState();
    const piece = state.project.pieces[0]!;
    const sketch = { type: "sketch" as const, id: elementId("sketch-1"), layerId: layerId("layer-1"), nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 10, y: 0 } }], edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }], constraints: [], style: { stroke: "#000", strokeWidth: 1 } };
    const nextEditor = dispatch(state.editor, createElement(sketch));

    state.commitNewSketch(nextEditor, sketch.id, piece.id);

    const next = useDocumentStore.getState();
    expect(next.project.revision).toBe(1);
    expect(next.project.pages[0]?.elements).toEqual([sketch]);
    expect(next.project.pieces[0]).toMatchObject({ state: "underdefined", sketches: [{ pageId: "page-1", sketchId: "sketch-1" }] });

  });

  it("associates ordinary sketch creation with the default piece", () => {
    const state = useDocumentStore.getState();
    const sketch = { type: "sketch" as const, id: elementId("ordinary-sketch"), layerId: layerId("layer-1"), nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 5, y: 0 } }], edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }], constraints: [], style: { stroke: "#000", strokeWidth: 1 } };
    const nextEditor = dispatch(state.editor, createElement(sketch));

    state.commitNewSketch(nextEditor, sketch.id);

    expect(useDocumentStore.getState().project.pieces[0]?.sketches).toEqual([{ pageId: "page-1", sketchId: sketch.id }]);
  });

  it("prunes stale ownership when a committed sketch is removed", () => {
    const state = useDocumentStore.getState();
    const sketch = { type: "sketch" as const, id: elementId("removed-sketch"), layerId: layerId("layer-1"), nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 5, y: 0 } }], edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }], constraints: [], style: { stroke: "#000", strokeWidth: 1 } };
    state.commitNewSketch(dispatch(state.editor, createElement(sketch)), sketch.id);
    const associated = useDocumentStore.getState();

    associated.setEditor(dispatch(associated.editor, deleteElement(sketch.id)));

    expect(useDocumentStore.getState().project).toMatchObject({ pieces: [{ state: "design", sketches: [] }], pages: [{ elements: [] }] });
  });

  it("enters a new sketch session from the newly created editor state", () => {
    const state = useDocumentStore.getState();
    const sketch = { type: "sketch" as const, id: elementId("session-sketch"), layerId: layerId("layer-1"), nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 5, y: 0 } }], edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }], constraints: [], style: { stroke: "#000", strokeWidth: 1 } };
    const nextEditor = dispatch(state.editor, createElement(sketch));
    const selectedEditor = { ...nextEditor, selection: [sketch.id] };

    const session = sessionForSketchEditor(selectedEditor, sketch.id);

    expect(session).toMatchObject({ status: "active", sketchId: sketch.id, entryDocument: selectedEditor.document, entrySelection: [sketch.id] });
    expect(session.status === "active" && session.entryEditorHistory.undo).toEqual(selectedEditor.undo);
  });

  it("renders gesture previews without replacing committed project state", () => {
    const state = useDocumentStore.getState();
    const rectangle = { type: "rectangle" as const, id: elementId("preview"), layerId: layerId("layer-1"), position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const preview = previewGestureFromBase(beginGesture(state.editor), createElement(rectangle));
    state.setEditor(preview);
    expect(useDocumentStore.getState().document.elements).toHaveLength(1);
    expect(useDocumentStore.getState().project.pages[0]?.elements).toHaveLength(0);
    state.setEditor(commitGesture(preview));
    expect(useDocumentStore.getState().project.pages[0]?.elements).toHaveLength(1);
  });
});
