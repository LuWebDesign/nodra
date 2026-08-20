import { describe, expect, it } from "vitest";
import { createDocument, elementId, layerId, type RectangleElement } from "@nodra/domain";
import { beginGesture, commitGesture, createEditor, createElement, dispatch, moveElement, previewGesture, redo, reorderLayer, select, setLayerVisibility, undo } from "./index.js";

const rectangle: RectangleElement = { type: "rectangle", id: elementId("r1"), layerId: layerId("default"), position: { x: 1, y: 2 }, size: { width: 10, height: 5 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
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
});
