import { describe, expect, it } from "vitest";
import { createDocument, elementId, layerId, type RectangleElement } from "@nodra/domain";
import { addToSelection, beginGesture, clearSelection, commitGesture, createEditor, createElement, dispatch, moveElement, moveElements, previewGesture, previewGestureFromBase, redo, removeFromSelection, reorderLayer, resizeElement, select, selectForPointerDown, setLayerVisibility, toggleSelection, undo, updateElement, updateElementStyles } from "./index.js";

const rectangle: RectangleElement = { type: "rectangle", id: elementId("r1"), layerId: layerId("default"), position: { x: 1, y: 2 }, size: { width: 10, height: 5 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
const document = createDocument("doc", [{ id: layerId("default"), name: "Default", visible: true, order: 0 }]);

describe("editor core", () => {
  it("applies explicit commands and keeps selection outside document history", () => {
    const created = dispatch(createEditor(document), createElement(rectangle));
    const selected = select(created, [rectangle.id]);
    expect(selected.selection).toEqual([rectangle.id]);
    expect(selected.undo).toHaveLength(1);
    expect(selected.document.revision).toBe(1);
  });

  it("commits one completed gesture as one history entry", () => {
    let state = dispatch(createEditor(document), createElement(rectangle));
    state = beginGesture(state);
    state = previewGesture(state, moveElement(rectangle.id, { x: 2, y: 3 }));
    state = previewGesture(state, moveElement(rectangle.id, { x: 1, y: 1 }));
    state = commitGesture(state);
    expect(state.undo).toHaveLength(2);
    expect(state.document.elements[0]).toMatchObject({ position: { x: 4, y: 6 } });
    expect(undo(state).document.elements[0]).toMatchObject({ position: { x: 1, y: 2 } });
  });
  it("commits a resize position and size as one history entry", () => {
    let state = dispatch(createEditor(document), createElement(rectangle));
    state = beginGesture(state);
    state = previewGesture(state, resizeElement(rectangle.id, { x: 4, y: 5 }, { width: 20, height: 12 }));
    state = previewGesture(state, resizeElement(rectangle.id, { x: 6, y: 7 }, { width: 22, height: 14 }));
    state = commitGesture(state);
    expect(state.undo).toHaveLength(2);
    expect(state.document.elements[0]).toMatchObject({ position: { x: 6, y: 7 }, size: { width: 22, height: 14 } });
    expect(undo(state).document.elements[0]).toMatchObject({ position: rectangle.position, size: rectangle.size });
  });

  it("updates exact shape geometry in one command and rejects invalid sizes", () => {
    let state = dispatch(createEditor(document), createElement(rectangle));
    state = dispatch(state, updateElement(rectangle.id, { position: { x: 12.125, y: 8.5 }, size: { width: 25.75, height: 4.25 } }));
    expect(state.document.elements[0]).toMatchObject({ position: { x: 12.125, y: 8.5 }, size: { width: 25.75, height: 4.25 } });
    expect(state.undo).toHaveLength(2);
    const rejected = dispatch(state, updateElement(rectangle.id, { size: { width: 0, height: -1 } }));
    expect(rejected).toBe(state);
  });

  it("persists a valid rectangle corner radius and rejects a negative radius", () => {
    let state = dispatch(createEditor(document), createElement(rectangle));
    state = dispatch(state, updateElement(rectangle.id, { cornerRadius: 3.5 }));
    expect(state.document.elements[0]).toMatchObject({ cornerRadius: 3.5 });
    const rejected = dispatch(state, updateElement(rectangle.id, { cornerRadius: -1 }));
    expect(rejected).toBe(state);
  });

  it("undoes and redoes, then invalidates redo after a new edit", () => {
    let state = dispatch(createEditor(document), createElement(rectangle));
    state = dispatch(state, moveElement(rectangle.id, { x: 2, y: 0 }));
    state = undo(state);
    expect(redo(state).document.elements[0]).toMatchObject({ position: { x: 3, y: 2 } });
    state = dispatch(state, moveElement(rectangle.id, { x: 0, y: 4 }));
    expect(redo(state)).toBe(state);
  });

  it("supports layer visibility and ordering without mutating the source", () => {
    const second = { id: layerId("second"), name: "Second", visible: true, order: 1 };
    let state = createEditor({ ...document, layers: [...document.layers, second] });
    state = dispatch(state, setLayerVisibility(second.id, false));
    state = dispatch(state, reorderLayer(second.id, 0));
    expect(state.document.layers[0]).toMatchObject({ id: second.id, visible: false, order: 0 });
    expect(document.layers[0]?.visible).toBe(true);
  });

  it("provides deduplicated, known selection helpers", () => {
    let state = dispatch(createEditor(document), createElement(rectangle));
    state = addToSelection(state, [rectangle.id, rectangle.id, "unknown" as never]);
    expect(state.selection).toEqual([rectangle.id]);
    expect(toggleSelection(state, rectangle.id).selection).toEqual([]);
    expect(removeFromSelection(state, [rectangle.id]).selection).toEqual([]);
    expect(clearSelection(state).selection).toEqual([]);
  });

  it("preserves an existing selection for an unmodified pointer-down move", () => {
    let state = createEditor({ ...document, elements: [rectangle, { ...rectangle, id: elementId("r2"), position: { x: 20, y: 2 } }] });
    state = select(state, [rectangle.id, elementId("r2")]);

    expect(selectForPointerDown(state, rectangle.id, false)).toBe(state);
    expect(selectForPointerDown(state, rectangle.id, false).selection).toEqual([rectangle.id, elementId("r2")]);
    expect(selectForPointerDown(state, rectangle.id, true).selection).toEqual([elementId("r2")]);
    expect(selectForPointerDown(state, elementId("r2"), true).selection).toEqual([rectangle.id]);
    expect(selectForPointerDown(select(state, [rectangle.id]), elementId("r2"), false).selection).toEqual([elementId("r2")]);
  });

  it("moves multiple shapes and lines atomically", () => {
    const line = { type: "line" as const, id: elementId("line"), layerId: layerId("default"), start: { x: 0, y: 0 }, end: { x: 3, y: 4 }, rotation: 0, style: rectangle.style };
    let state = createEditor({ ...document, elements: [rectangle, line] });
    state = beginGesture(state);
    state = previewGesture(state, moveElements([rectangle.id, line.id, rectangle.id], { x: 2, y: -1 }));
    state = commitGesture(state);
    expect(state.undo).toHaveLength(1);
    expect(state.document.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: rectangle.id, position: { x: 3, y: 1 } }),
      expect.objectContaining({ id: line.id, start: { x: 2, y: -1 }, end: { x: 5, y: 3 } }),
    ]));
    expect(undo(state).document.elements).toEqual([rectangle, line]);
  });

  it("recomputes pointer previews from the gesture base without cumulative drift", () => {
    let state = beginGesture(createEditor({ ...document, elements: [rectangle] }));
    state = previewGestureFromBase(state, moveElement(rectangle.id, { x: 4, y: 0 }));
    state = previewGestureFromBase(state, moveElement(rectangle.id, { x: 2, y: 0 }));
    expect(state.document.elements[0]).toMatchObject({ position: { x: 3, y: 2 } });
  });

  it("updates fill and stroke for the complete selection in one undoable transaction", () => {
    const ellipse = { type: "ellipse" as const, id: elementId("ellipse"), layerId: layerId("default"), position: { x: 20, y: 2 }, size: { width: 8, height: 6 }, rotation: 0, style: { stroke: "#111", fill: "#fff", strokeWidth: 1 } };
    let state = createEditor({ ...document, elements: [rectangle, ellipse] });
    state = select(state, [rectangle.id, ellipse.id]);
    state = dispatch(state, updateElementStyles(state.selection, { fill: null, stroke: "#f00" }));

    expect(state.undo).toHaveLength(1);
    expect(state.document.elements[0]?.style).toEqual({ stroke: "#f00", strokeWidth: 1 });
    expect(state.document.elements[1]?.style).toEqual({ stroke: "#f00", strokeWidth: 1 });
    expect(undo(state).document.elements).toEqual([rectangle, ellipse]);
    expect(redo(undo(state)).document.elements[0]?.style).toEqual({ stroke: "#f00", strokeWidth: 1 });
  });
});
