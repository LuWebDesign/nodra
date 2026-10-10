import { beforeEach, describe, expect, it } from "vitest";
import { elementId, layerId } from "@nodra/domain";
import { beginGesture, commitGesture, createElement, deleteElement, dispatch, previewGestureFromBase } from "@nodra/editor-core";
import { resolveActivePieceId, sessionForSketchEditor, shouldAutosaveProject, shouldPersistEditorSnapshot, useDocumentStore, usePersistenceStore } from "./stores.js";
import { addSolvedDocumentConstraint } from "./globalConstraintCommands.js";

describe("document store persistence boundary", () => {
  beforeEach(() => { useDocumentStore.setState(useDocumentStore.getInitialState(), true); usePersistenceStore.setState(usePersistenceStore.getInitialState(), true); });

  it("keeps a requested piece tab active and falls back to the first piece", () => {
    const project = useDocumentStore.getState().project;
    const second = { ...project.pieces[0]!, id: "piece-2" as never, name: "Pieza 2" };
    const withPieces = { ...project, pieces: [...project.pieces, second] };
    expect(resolveActivePieceId(withPieces, second.id)).toBe(second.id);
    expect(resolveActivePieceId(withPieces, "missing" as never)).toBe(project.pieces[0]!.id);
  });

  it("autosaves only unsaved committed project state while active", () => {
    const project = useDocumentStore.getState().project;
    expect(shouldAutosaveProject("prompted-autosave", "idle", project)).toBe(true);
    expect(shouldAutosaveProject("manual", "idle", project)).toBe(false);
    expect(shouldAutosaveProject("prompted-autosave", "active", project)).toBe(false);
    expect(shouldAutosaveProject("prompted-autosave", "idle", project, { projectId: project.id, snapshot: JSON.stringify(project) })).toBe(false);
  });

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
    expect(next.project.pages[0]?.elements).toEqual([{ ...sketch, pieceId: piece.id, role: "normal", edges: sketch.edges.map((edge) => ({ ...edge, role: "normal" })) }]);
    expect(sketch).not.toHaveProperty("role");
    expect(sketch.edges[0]).not.toHaveProperty("role");
    expect(next.project.pieces[0]).toMatchObject({ state: "underdefined", sketches: [{ pageId: "page-1", sketchId: "sketch-1" }] });

  });

  it("preserves accepted document line relations when associating another sketch with the piece", () => {
    const initial = useDocumentStore.getState();
    const basePiece = initial.project.pieces[0]!;
    const otherPiece = { ...basePiece, id: "unrelated-piece" as never, name: "Unrelated", state: "underdefined" as const, sketches: [{ pageId: "unrelated-page" as never, sketchId: elementId("unrelated-sketch") }] };
    const unrelatedSketch = { type: "sketch" as const, id: elementId("unrelated-sketch"), layerId: layerId("layer-1"), pieceId: otherPiece.id, nodes: [{ id: "u", point: { x: 1, y: 1 } }, { id: "v", point: { x: 4, y: 1 } }], edges: [{ id: "uv", startNodeId: "u", endNodeId: "v" }], constraints: [{ id: "unrelated-horizontal", kind: "horizontal" as const, references: [{ elementId: elementId("unrelated-sketch"), nodeId: "u" }, { elementId: elementId("unrelated-sketch"), nodeId: "v" }] as const }], style: { stroke: "#000", strokeWidth: 1 } };
    const unrelatedPage = { ...initial.project.pages[0]!, id: "unrelated-page" as never, name: "Unrelated", elements: [unrelatedSketch] };
    const expandedProject = { ...initial.project, pieces: [...initial.project.pieces, otherPiece], pages: [...initial.project.pages, unrelatedPage] };
    useDocumentStore.getState().setProject(expandedProject);
    const state = useDocumentStore.getState();
    const beforeUnrelatedPage = structuredClone(state.project.pages[1]);
    const beforeUnrelatedPiece = structuredClone(state.project.pieces[1]);
    const piece = state.project.pieces[0]!;
    const first = { type: "sketch" as const, id: elementId("first-sketch"), layerId: layerId("layer-1"), nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 10, y: 0 } }], edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }], constraints: [], style: { stroke: "#000", strokeWidth: 1 } };
    const second = { type: "sketch" as const, id: elementId("second-sketch"), layerId: layerId("layer-1"), nodes: [{ id: "c", point: { x: 0, y: 20 } }, { id: "d", point: { x: 10, y: 20 } }], edges: [{ id: "cd", startNodeId: "c", endNodeId: "d" }], constraints: [], style: { stroke: "#000", strokeWidth: 1 } };
    const firstCreated = dispatch(state.editor, createElement(first));
    const priorRelation = { id: "first-horizontal", kind: "horizontal" as const, references: [{ elementId: first.id, nodeId: "a" }, { elementId: first.id, nodeId: "b" }] as const };
    const firstCommitted = dispatch(firstCreated, addSolvedDocumentConstraint(priorRelation));
    state.commitNewSketch(firstCommitted, first.id, piece.id);
    const secondCreated = dispatch(firstCommitted, createElement(second));
    const relation = { id: "line-parallel", kind: "parallel" as const, references: [{ elementId: first.id, edgeId: "ab" }, { elementId: second.id, edgeId: "cd" }] as const };
    const accepted = dispatch(secondCreated, addSolvedDocumentConstraint(relation));

    useDocumentStore.getState().commitNewSketch(accepted, second.id, piece.id);

    const next = useDocumentStore.getState();
    expect(next.project.pages[0]?.constraints).toEqual([priorRelation, relation]);
    expect(next.project.revision).toBe(4);
    expect(next.project.pieces[0]).toMatchObject({ state: "underdefined", sketches: [{ pageId: "page-1", sketchId: first.id }] });
    expect(next.project.pages[0]?.elements.find((element) => element.id === second.id)).toMatchObject({ pieceId: piece.id });
    expect(next.project.pages[1]).toEqual(beforeUnrelatedPage);
    expect(next.project.pieces[1]).toEqual(beforeUnrelatedPiece);
  });

  it("leaves the exact project untouched when the requested sketch is missing", () => {
    const state = useDocumentStore.getState();
    const originalProject = state.project;
    const originalEditor = state.editor;

    state.commitNewSketch(state.editor, elementId("missing-sketch"));

    expect(useDocumentStore.getState().project).toBe(originalProject);
    expect(useDocumentStore.getState().editor).toBe(originalEditor);
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
