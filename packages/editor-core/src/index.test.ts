import { describe, expect, it } from "vitest";
import { createDocument, elementId, layerId, type DimensionElement, type GlyphElement, type PathElement, type RectangleElement, type SplineElement, type TextElement } from "@nodra/domain";
import { addToSelection, appendSplineNode, beginGesture, cancelGesture, clearSelection, closePath, closeSplineElement, commitGesture, createEditor, createElement, createPathCubicNode, deleteContourNodes, deleteElement, deleteElementNodes, deletePathNodes, dispatch, duplicateElements, flipElements, insertContourNode, invalidDimensionIdsForShapeOperation, moveElement, moveElements, movePathNode, movePathHandle, openPath, previewGesture, previewGestureFromBase, redo, removeFromSelection, reorderLayer, resizeElement, resizeElements, rotateElementsAroundCenter, select, selectForPointerDown, setLayerVisibility, setPathJoin, shapeOperation, splitPathSegment, toggleSelection, undo, updateContourNode, updateElement, updateElementNode, updateElementStyles, updateSplineHandle, updateSplineNode } from "./index.js";
import type { Direction } from "@nodra/geometry";

const rectangle: RectangleElement = { type: "rectangle", id: elementId("r1"), layerId: layerId("default"), position: { x: 1, y: 2 }, size: { width: 10, height: 5 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
const document = createDocument("doc", [{ id: layerId("default"), name: "Default", visible: true, order: 0 }]);
const path: PathElement = { type: "path", id: elementId("path"), layerId: layerId("default"), nodes: [{ id: "a", anchor: { x: 0, y: 0 }, join: "corner" }, { id: "b", anchor: { x: 10, y: 0 }, join: "corner" }], segments: [{ type: "cubicBezier", startNodeId: "a", endNodeId: "b", control1: { x: 2, y: 4 }, control2: { x: 8, y: 4 } }], closed: false, style: rectangle.style };
const spline: SplineElement = { type: "spline", id: elementId("spline"), layerId: layerId("default"), nodes: [{ id: "a", anchor: { x: 0, y: 0 }, continuity: "smooth" }, { id: "b", anchor: { x: 10, y: 0 }, continuity: "smooth" }, { id: "c", anchor: { x: 10, y: 10 }, continuity: "smooth" }], closed: false, style: rectangle.style };
const text: TextElement = { type: "text", id: elementId("text"), layerId: layerId("default"), position: { x: 12, y: 18 }, size: { width: 32, height: 14 }, text: "Keep formatting", fontFamily: "Times New Roman", fontSize: 18, fontWeight: "bold", fontStyle: "italic", textAlign: "left", lineHeight: 1.2, rotation: 0, style: { stroke: "#123456", fill: "#654321", strokeWidth: 0.5 } };
const dimension: DimensionElement = { type: "dimension", id: elementId("dimension"), layerId: layerId("default"), kind: "horizontal", references: [{ kind: "node", elementId: rectangle.id, nodeIndex: 0 }, { kind: "node", elementId: rectangle.id, nodeIndex: 1 }], offset: { x: 0, y: -10 }, precision: 2, units: "mm", rotation: 0, style: rectangle.style };
const glyph: GlyphElement = { type: "glyph", id: elementId("glyph"), layerId: layerId("default"), position: { x: 0, y: 0 }, size: { width: 20, height: 20 }, glyph: "O", fillRule: "evenodd", rotation: 0, style: rectangle.style, contours: [{ nodes: [{ id: "ga", anchor: { x: 0, y: 0 }, join: "smooth" }, { id: "gb", anchor: { x: 10, y: 0 }, join: "smooth" }, { id: "gc", anchor: { x: 10, y: 10 }, join: "smooth" }, { id: "gd", anchor: { x: 0, y: 10 }, join: "smooth" }], segments: [{ type: "cubicBezier", startNodeId: "ga", endNodeId: "gb", control1: { x: 3, y: -2 }, control2: { x: 7, y: -2 } }, { type: "cubicBezier", startNodeId: "gb", endNodeId: "gc", control1: { x: 12, y: 3 }, control2: { x: 12, y: 7 } }, { type: "cubicBezier", startNodeId: "gc", endNodeId: "gd", control1: { x: 7, y: 12 }, control2: { x: 3, y: 12 } }, { type: "cubicBezier", startNodeId: "gd", endNodeId: "ga", control1: { x: -2, y: 7 }, control2: { x: -2, y: 3 } }] }] };

describe("editor core", () => {
  it("creates, edits, closes, styles, deletes, and restores native splines through document history", () => {
    let state = dispatch(createEditor(document), createElement(spline));
    state = dispatch(state, appendSplineNode(spline.id, { id: "d", anchor: { x: 0, y: 10 }, continuity: "smooth" }));
    state = dispatch(state, updateSplineNode(spline.id, "a", { x: 1, y: 2 }));
    state = dispatch(state, updateSplineHandle(spline.id, "a", "out", { x: 4, y: 2 }));
    state = dispatch(state, closeSplineElement(spline.id));
    state = dispatch(state, updateElementStyles([spline.id], { stroke: "#f00" }));
    expect(state.document.elements[0]).toMatchObject({ type: "spline", closed: true, style: { stroke: "#f00" } });
    state = dispatch(state, deleteElement(spline.id));
    expect(state.document.elements).toHaveLength(0);
    expect(redo(undo(state)).document.elements).toHaveLength(0);
    expect(undo(state).document.elements[0]).toMatchObject({ type: "spline", closed: true });
  });

  it("rejects invalid spline commands without history entries", () => {
    const initial = createEditor({ ...document, elements: [spline] });
    const state = dispatch(initial, closeSplineElement(elementId("missing")));
    expect(state).toBe(initial);
    expect(dispatch(state, updateSplineNode(spline.id, "missing", { x: 1, y: 1 }))).toBe(state);
  });

  it("previews spline handle movement and commits or cancels it as one gesture", () => {
    const initial = dispatch(createEditor({ ...document, elements: [spline] }), createElement(spline));
    const preview = previewGestureFromBase(beginGesture(initial), updateSplineHandle(spline.id, "a", "out", { x: 4, y: 3 }));
    expect(preview.gesture).toBeDefined();
    const previewElement = preview.document.elements[0];
    expect(previewElement?.type === "spline" ? previewElement.nodes[0] : undefined).toMatchObject({ outHandle: { dx: 4, dy: 3 } });
    expect(commitGesture(preview).undo).toHaveLength(initial.undo.length + 1);
    expect(cancelGesture(preview)).toMatchObject({ document: initial.document, gesture: undefined });
  });

  it("moves a spline with moveElement while preserving relative handles", () => {
    const source: SplineElement = {
      ...spline,
      nodes: spline.nodes.map((node, index) => ({
        ...node,
        ...(index === 0 ? { outHandle: { dx: 2, dy: 3 } } : {}),
        ...(index === 1 ? { inHandle: { dx: -2, dy: -3 } } : {}),
      })),
    };
    const state = dispatch(createEditor({ ...document, elements: [source] }), moveElement(source.id, { x: 5, y: -2 }));
    const moved = state.document.elements[0];
    expect(moved?.type).toBe("spline");
    if (moved?.type === "spline") {
      expect(moved.nodes[0]?.anchor).toEqual({ x: 5, y: -2 });
      expect(moved.nodes[0]?.outHandle).toEqual({ dx: 2, dy: 3 });
      expect(moved.nodes[1]?.anchor).toEqual({ x: 15, y: -2 });
      expect(moved.nodes[1]?.inHandle).toEqual({ dx: -2, dy: -3 });
    }
    expect(state.undo).toHaveLength(1);
  });

  it("moves text elements without changing their content or typography", () => {
    const state = dispatch(createEditor({ ...document, elements: [text] }), moveElements([text.id], { x: 7, y: -3 }));
    expect(state.document.elements[0]).toMatchObject({ ...text, position: { x: 19, y: 15 } });
    expect(state.undo).toHaveLength(1);
  });
  it("moves a dimension by changing only its placement offset and supports undo", () => {
    const dimension = { type: "dimension" as const, id: elementId("dimension-move"), layerId: rectangle.layerId, kind: "horizontal" as const, references: [{ elementId: rectangle.id, nodeIndex: 0 }, { elementId: rectangle.id, nodeIndex: 1 }] as const, offset: { x: 0, y: -8 }, precision: 2, units: "mm" as const, rotation: 0 as const, style: rectangle.style };
    const state = dispatch(createEditor({ ...document, elements: [rectangle, dimension] }), moveElements([dimension.id], { x: 3, y: 5 }));
    expect(state.document.elements[1]).toMatchObject({ type: "dimension", offset: { x: 3, y: -3 } });
    expect(undo(state).document.elements[1]).toEqual(dimension);
    expect(redo(undo(state)).document.elements[1]).toMatchObject({ offset: { x: 3, y: -3 } });
  });
  it("deletes contour nodes through validation and keeps a ring valid", () => {
    const contour = { type: "contour" as const, id: elementId("delete-contour-node"), layerId: rectangle.layerId, position: { x: 1, y: 2 }, size: { width: 10, height: 5 }, contours: [{ points: [{ x: 1, y: 2 }, { x: 11, y: 2 }, { x: 11, y: 7 }, { x: 1, y: 7 }, { x: 1, y: 2 }] }], fillRule: "evenodd" as const, rotation: 0, style: rectangle.style };
    const state = dispatch(createEditor({ ...document, elements: [contour] }), deleteContourNodes(contour.id, [{ ringIndex: 0, pointIndex: 1 }]));
    expect(state.document.elements[0]).toMatchObject({ type: "contour", contours: [{ points: [{ x: 1, y: 2 }, { x: 11, y: 7 }, { x: 1, y: 7 }, { x: 1, y: 2 }] }] });
    expect(state.undo).toHaveLength(1);
    expect(dispatch(state, deleteContourNodes(contour.id, [{ ringIndex: 0, pointIndex: 0 }, { ringIndex: 0, pointIndex: 1 }]))).toBe(state);
  });

  it("converts a primitive before deleting a Forma node", () => {
    const state = dispatch(createEditor({ ...document, elements: [rectangle] }), deleteElementNodes(rectangle.id, [0]));
    expect(state.document.elements[0]?.type).toBe("contour");
    expect(state.document.elements[0]?.type === "contour" ? state.document.elements[0].contours[0]?.points : []).toHaveLength(4);
  });

  it("deletes a glyph anchor without flattening its Bézier handles", () => {
    const state = dispatch(createEditor({ ...document, elements: [glyph] }), deleteElementNodes(glyph.id, [1]));
    const updated = state.document.elements[0];
    expect(updated?.type).toBe("glyph");
    if (updated?.type === "glyph") {
      expect(updated.contours[0]?.nodes.map((node) => node.id)).toEqual(["ga", "gc", "gd"]);
      expect(updated.contours[0]?.segments.every((segment) => segment.type === "cubicBezier")).toBe(true);
      expect(updated.contours[0]?.segments[0]).toMatchObject({ control1: { x: 3, y: -2 }, control2: { x: 12, y: 7 } });
    }
    expect(state.undo).toHaveLength(1);
  });
  it("moves a primitive Forma node through a validated command", () => {
    const state = dispatch(createEditor({ ...document, elements: [rectangle] }), updateElementNode(rectangle.id, 0, { x: 2, y: 3 }));
    expect(state.document.elements[0]).toMatchObject({ type: "rectangle", position: { x: 2, y: 3 }, size: { width: 10, height: 5 } });
    expect(state.undo).toHaveLength(1);
  });
  it("moves path nodes with adjacent handles and records one command", () => {
    let state = dispatch(createEditor(document), createElement(path));
    state = dispatch(state, movePathNode(path.id, "a", { x: 1, y: 2 }));
    const movedPath = state.document.elements[0];
    expect(movedPath?.type).toBe("path");
    if (movedPath?.type === "path") {
      expect(movedPath.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ anchor: { x: 1, y: 2 } })]));
      expect(movedPath.segments).toEqual(expect.arrayContaining([expect.objectContaining({ control1: { x: 3, y: 6 } })]));
    }
    state = dispatch(state, movePathHandle(path.id, 0, "control2", { x: 9, y: 3 }));
    expect(state.undo).toHaveLength(3);
    const closed = dispatch(state, closePath(path.id));
    expect(closed.document.elements[0]).toMatchObject({ closed: true });
    expect(dispatch(state, setPathJoin(path.id, "a", "smooth")).document.elements[0]).toBeDefined();
  });
  it("closes and reopens a path as independent undoable commands", () => {
    let state = dispatch(createEditor({ ...document, elements: [path] }), closePath(path.id));
    expect(state.document.elements[0]).toMatchObject({ closed: true, segments: [{ type: "cubicBezier" }, { type: "line", startNodeId: "b", endNodeId: "a" }] });
    expect(state.undo).toHaveLength(1);
    state = dispatch(state, openPath(path.id));
    expect(state.document.elements[0]).toMatchObject({ closed: false, segments: [{ type: "cubicBezier" }] });
    expect(state.undo).toHaveLength(2);
    expect(redo(undo(state)).document.elements).toEqual(state.document.elements);
  });
  it("deletes an open interior anchor and preserves neighboring cubic endpoint controls", () => {
    const three: PathElement = { ...path, nodes: [...path.nodes, { id: "c", anchor: { x: 20, y: 0 }, join: "corner" }], segments: [...path.segments, { type: "cubicBezier", startNodeId: "b", endNodeId: "c", control1: { x: 12, y: -4 }, control2: { x: 18, y: -4 } }] };
    const state = dispatch(createEditor({ ...document, elements: [three] }), deletePathNodes(three.id, ["b"]));
    expect(state.document.elements[0]).toMatchObject({ nodes: [{ id: "a" }, { id: "c" }], segments: [{ type: "cubicBezier", startNodeId: "a", endNodeId: "c", control1: { x: 2, y: 4 }, control2: { x: 18, y: -4 } }] });
    expect(state.undo).toHaveLength(1);
    expect(undo(state).document.elements).toEqual([three]);
  });
  it("deletes a closed anchor across the closing join and rejects minimums atomically", () => {
    const closed: PathElement = { ...path, closed: true, nodes: [...path.nodes, { id: "c", anchor: { x: 5, y: 10 }, join: "smooth" }, { id: "d", anchor: { x: -5, y: 10 }, join: "corner" }], segments: [{ type: "line", startNodeId: "a", endNodeId: "b" }, { type: "line", startNodeId: "b", endNodeId: "c" }, { type: "line", startNodeId: "c", endNodeId: "d" }, { type: "cubicBezier", startNodeId: "d", endNodeId: "a", control1: { x: -4, y: 8 }, control2: { x: -1, y: 2 } }] };
    const state = dispatch(createEditor({ ...document, elements: [closed] }), deletePathNodes(closed.id, ["a"]));
    expect(state.document.elements[0]).toMatchObject({ nodes: [{ id: "b" }, { id: "c" }, { id: "d" }], segments: [{ type: "line", startNodeId: "b", endNodeId: "c" }, { type: "line", startNodeId: "c", endNodeId: "d" }, { type: "cubicBezier", startNodeId: "d", endNodeId: "b", control1: { x: -4, y: 8 }, control2: { x: 5, y: 3.333333333333333 } }] });
    expect(dispatch(state, deletePathNodes(closed.id, ["b"]))).toBe(state);
  });
  it("changes each path join mode as one undoable command", () => {
    let state = dispatch(createEditor({ ...document, elements: [path] }), createElement(path));
    for (const join of ["smooth", "symmetric", "corner"] as const) {
      const before = state;
      state = dispatch(state, setPathJoin(path.id, "a", join));
      expect(state.undo).toHaveLength(before.undo.length + 1);
      expect(state.document.elements[0]?.type === "path" ? state.document.elements[0].nodes[0] : undefined).toMatchObject({ id: "a", join });
      const reverted = undo(state);
      const revertedElement = reverted.document.elements[0];
      const beforeElement = before.document.elements[0];
      expect(revertedElement?.type === "path" ? revertedElement.nodes[0] : undefined).toMatchObject({ id: "a", join: beforeElement?.type === "path" ? beforeElement.nodes[0]?.join : "corner" });
    }
  });
  it("splits line and cubic path segments at their midpoint as one undoable command", () => {
    const linePath: PathElement = { ...path, id: elementId("line-path"), nodes: [{ id: "a", anchor: { x: 0, y: 0 }, join: "smooth" }, { id: "b", anchor: { x: 10, y: 0 }, join: "symmetric" }], segments: [{ type: "line", startNodeId: "a", endNodeId: "b" }, { type: "line", startNodeId: "b", endNodeId: "a" }], closed: true };
    let state = dispatch(createEditor({ ...document, elements: [linePath] }), splitPathSegment(linePath.id, 0, "mid-line"));
    expect(state.document.elements[0]).toMatchObject({ type: "path", nodes: [{ id: "a", join: "smooth" }, { id: "mid-line", anchor: { x: 5, y: 0 }, join: "corner" }, { id: "b", join: "symmetric" }], segments: [{ type: "line", startNodeId: "a", endNodeId: "mid-line" }, { type: "line", startNodeId: "mid-line", endNodeId: "b" }, { type: "line", startNodeId: "b", endNodeId: "a" }], closed: true });
    expect(state.undo).toHaveLength(1);
    expect(redo(undo(state)).document.elements).toEqual(state.document.elements);

    state = dispatch(createEditor({ ...document, elements: [path] }), splitPathSegment(path.id, 0, "mid-cubic"));
    expect(state.document.elements[0]).toMatchObject({ segments: [{ type: "cubicBezier", endNodeId: "mid-cubic" }, { type: "cubicBezier", startNodeId: "mid-cubic", endNodeId: "b" }] });
    const splitPath = state.document.elements[0];
    expect(splitPath?.type === "path" ? splitPath.nodes.find((node) => node.id === "mid-cubic")?.anchor : undefined).toEqual({ x: 5, y: 3 });
  });
  it("appends a validated cubic pen node and commits the gesture once", () => {
    let state = beginGesture(createEditor({ ...document, elements: [path] }));
    state = previewGestureFromBase(state, createPathCubicNode(path.id, { id: "c", anchor: { x: 20, y: 10 }, join: "corner" }, { x: 4, y: 0 }, { x: 16, y: 8 }));
    state = commitGesture(state);
    expect(state.document.elements[0]).toMatchObject({ nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], segments: [{ type: "cubicBezier" }, { type: "cubicBezier", control1: { x: 4, y: 0 }, control2: { x: 16, y: 8 } }] });
    expect(state.undo).toHaveLength(1);
    expect(undo(state).document.elements).toEqual([path]);
  });
  it("cancels a cubic pen preview without leaving a partial path or history entry", () => {
    let state = beginGesture(createEditor({ ...document, elements: [path] }));
    state = previewGestureFromBase(state, createPathCubicNode(path.id, { id: "partial", anchor: { x: 20, y: 10 }, join: "corner" }, { x: 4, y: 0 }, { x: 16, y: 8 }));
    state = cancelGesture(state);
    expect(state.document.elements).toEqual([path]);
    expect(state.undo).toHaveLength(0);
    expect(state.gesture).toBeUndefined();
  });
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

  it("does not record a no-op layer visibility command", () => {
    const state = createEditor(document);
    const unchanged = dispatch(state, setLayerVisibility(layerId("default"), true));

    expect(unchanged).toBe(state);
    expect(unchanged.document).toEqual(document);
    expect(unchanged.document.revision).toBe(document.revision);
    expect(unchanged.undo).toEqual([]);
    expect(unchanged.redo).toEqual([]);
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
  it("commits grouped resize and rotation as one history entry each", () => {
    const second = { ...rectangle, id: elementId("r2"), position: { x: 20, y: 2 } };
    let state = createEditor({ ...document, elements: [rectangle, second] });
    state = beginGesture(state);
    state = previewGestureFromBase(state, resizeElements([rectangle.id, second.id], "se", { x: 40, y: 12 }));
    state = commitGesture(state);
    expect(state.undo).toHaveLength(1);
    state = beginGesture(state);
    state = previewGestureFromBase(state, rotateElementsAroundCenter([rectangle.id, second.id], Math.PI / 2));
    state = commitGesture(state);
    expect(state.undo).toHaveLength(2);
    expect((undo(state).document.elements[0] as RectangleElement).size.width).toBeGreaterThan(rectangle.size.width);
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

  it("updates one contour vertex through a validated gesture and preserves ring closure", () => {
    const contour = { type: "contour" as const, id: elementId("editable-contour"), layerId: rectangle.layerId, position: { x: 1, y: 2 }, size: { width: 10, height: 5 }, contours: [{ points: [{ x: 1, y: 2 }, { x: 11, y: 2 }, { x: 11, y: 7 }, { x: 1, y: 2 }] }], fillRule: "evenodd" as const, rotation: 0, style: rectangle.style };
    let state = beginGesture(createEditor({ ...document, elements: [contour] }));
    state = previewGestureFromBase(state, updateContourNode(contour.id, { ringIndex: 0, pointIndex: 0 }, { x: 2, y: 3 }));
    expect(state.document.elements[0]).toMatchObject({ type: "contour", contours: [{ points: [{ x: 2, y: 3 }, { x: 11, y: 2 }, { x: 11, y: 7 }, { x: 2, y: 3 }] }] });
    state = commitGesture(state);
    expect(state.undo).toHaveLength(1);
    expect(undo(state).document.elements).toEqual([contour]);
    expect(dispatch(state, updateContourNode(contour.id, { ringIndex: 4, pointIndex: 0 }, { x: 1, y: 1 }))).toBe(state);
  });

  it("inserts one contour vertex before the closing duplicate and supports undo", () => {
    const contour = { type: "contour" as const, id: elementId("insert-contour-node"), layerId: rectangle.layerId, position: { x: 1, y: 2 }, size: { width: 10, height: 5 }, contours: [{ points: [{ x: 1, y: 2 }, { x: 11, y: 2 }, { x: 11, y: 7 }, { x: 1, y: 2 }] }], fillRule: "evenodd" as const, rotation: 0, style: rectangle.style };
    const state = dispatch(createEditor({ ...document, elements: [contour] }), insertContourNode(contour.id, { ringIndex: 0, segmentIndex: 2 }, { x: 6, y: 4 }));
    expect(state.document.elements[0]).toMatchObject({ contours: [{ points: [{ x: 1, y: 2 }, { x: 11, y: 2 }, { x: 11, y: 7 }, { x: 6, y: 4 }, { x: 1, y: 2 }] }] });
    expect(state.undo).toHaveLength(1);
    expect(undo(state).document.elements).toEqual([contour]);
    expect(dispatch(state, insertContourNode(contour.id, { ringIndex: 0, segmentIndex: 9 }, { x: 1, y: 1 }))).toBe(state);
  });

  it("flips a complete single or multiple selection atomically", () => {
    const second = { ...rectangle, id: elementId("r2"), position: { x: 20, y: 2 }, flipY: true };
    let state = select(createEditor({ ...document, elements: [rectangle, second] }), [rectangle.id, second.id]);
    state = dispatch(state, flipElements(state.selection, "horizontal"));

    expect(state.undo).toHaveLength(1);
    expect(state.document.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: rectangle.id, flipX: true }),
      expect.objectContaining({ id: second.id, flipX: true, flipY: true }),
    ]));
    expect(state.document.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: rectangle.id, position: { x: 20, y: 2 } }),
      expect.objectContaining({ id: second.id, position: { x: 1, y: 2 } }),
    ]));
    expect(undo(state).document.elements).toEqual([rectangle, second]);
  });

  it("mirrors a single rotated object without changing its size or corner radius", () => {
    const rounded = { ...rectangle, cornerRadius: 3, rotation: Math.PI / 4 };
    const state = dispatch(select(createEditor({ ...document, elements: [rounded] }), [rounded.id]), flipElements([rounded.id], "vertical"));

    expect(state.document.elements[0]).toMatchObject({ position: rounded.position, size: rounded.size, cornerRadius: 3, rotation: -Math.PI / 4, flipY: true });
    expect(state.undo).toHaveLength(1);
  });

  it("replaces closed objects with one styled contour and keeps the operation atomic", () => {
    const second = { ...rectangle, id: elementId("r2"), position: { x: 6, y: 2 }, style: { stroke: "#f00", fill: "#0f0", strokeWidth: 2 } };
    let state = select(createEditor({ ...document, elements: [rectangle, second] }), [rectangle.id, second.id]);
    state = dispatch(state, shapeOperation(state.selection, "weld"));
    expect(state.document.elements).toHaveLength(1);
    expect(state.document.elements[0]).toMatchObject({ type: "contour", layerId: rectangle.layerId, style: rectangle.style });
    expect(state.undo).toHaveLength(1);
    expect(undo(state).document.elements).toEqual([rectangle, second]);
    expect(redo(undo(state)).document.elements[0]?.type).toBe("contour");
  });

  it("keeps welded glyph results editable with cubic handles", () => {
    const second = { ...glyph, id: elementId("glyph-2"), position: { x: 6, y: 0 }, contours: glyph.contours.map((contour) => ({ ...contour, nodes: contour.nodes.map((node) => ({ ...node, anchor: { x: node.anchor.x + 6, y: node.anchor.y } })), segments: contour.segments.map((segment) => segment.type === "cubicBezier" ? { ...segment, control1: { x: segment.control1.x + 6, y: segment.control1.y }, control2: { x: segment.control2.x + 6, y: segment.control2.y } } : segment) })) };
    const state = dispatch(select(createEditor({ ...document, elements: [glyph, second] }), [glyph.id, second.id]), shapeOperation([glyph.id, second.id], "weld"));
    const result = state.document.elements[0];
    expect(result?.type).toBe("glyph");
    if (result?.type === "glyph") expect(result.contours.every((contour) => contour.segments.every((segment) => segment.type === "cubicBezier"))).toBe(true);
  });

  it("uses the first selected object as cutter and the second as target", () => {
    const cutter = { ...rectangle, id: elementId("cutter"), position: { x: 6, y: 3 }, size: { width: 4, height: 3 } };
    let state = select(createEditor({ ...document, elements: [rectangle, cutter] }), [cutter.id, rectangle.id]);
    state = dispatch(state, shapeOperation(state.selection, "subtract"));
    expect(state.document.elements[0]).toMatchObject({ type: "contour", position: rectangle.position, size: rectangle.size });
    expect(state.document.elements[0]?.type === "contour" ? state.document.elements[0].contours : []).toHaveLength(2);
    expect(state.undo).toHaveLength(1);
  });

  it("applies every preceding selection as a cutter to the last selected target", () => {
    const firstCutter = { ...rectangle, id: elementId("cutter-1"), position: { x: 3, y: 3 }, size: { width: 2, height: 3 } };
    const secondCutter = { ...rectangle, id: elementId("cutter-2"), position: { x: 7, y: 3 }, size: { width: 2, height: 3 } };
    const target = { ...rectangle, id: elementId("target"), position: { x: 1, y: 2 }, size: { width: 10, height: 5 } };
    let state = select(createEditor({ ...document, elements: [firstCutter, secondCutter, target] }), [firstCutter.id, secondCutter.id, target.id]);
    state = dispatch(state, shapeOperation(state.selection, "subtract"));
    const result = state.document.elements[0];
    expect(state.document.elements).toHaveLength(1);
    expect(result?.type).toBe("contour");
    expect(result).toMatchObject({ position: target.position, size: target.size });
    expect(result?.type === "contour" ? result.contours : []).toHaveLength(3);
    expect(state.selection).toEqual([result!.id]);
    expect(state.undo).toHaveLength(1);
    expect(undo(state).document.elements).toEqual([firstCutter, secondCutter, target]);
    expect(redo(undo(state)).document.elements[0]?.type).toBe("contour");
  });

  it("keeps a non-overlapping target unchanged and orders multiple results deterministically", () => {
    const cutter = { ...rectangle, id: elementId("non-overlap-cutter"), position: { x: 100, y: 100 } };
    const target = { ...rectangle, id: elementId("non-overlap-target") };
    const source = { ...document, elements: [cutter, target] };
    const run = dispatch(select(createEditor(source), [cutter.id, target.id]), shapeOperation([cutter.id, target.id], "subtract"));
    const secondRun = dispatch(select(createEditor(source), [cutter.id, target.id]), shapeOperation([cutter.id, target.id], "subtract"));
    expect(run.document.elements[0]).toMatchObject({ position: target.position, size: target.size });
    expect(run.document.elements[0]?.type === "contour" ? run.document.elements[0].contours : []).toEqual(secondRun.document.elements[0]?.type === "contour" ? secondRun.document.elements[0].contours : []);
  });

  it("rejects full target consumption without changing document or history", () => {
    const cutter = { ...rectangle, id: elementId("full-cutter"), position: { x: 0, y: 0 }, size: { width: 20, height: 10 } };
    const target = { ...rectangle, id: elementId("full-target"), position: { x: 1, y: 2 } };
    const state = select(createEditor({ ...document, elements: [cutter, target] }), [cutter.id, target.id]);
    const result = dispatch(state, shapeOperation(state.selection, "subtract"));
    expect(result).toBe(state);
    expect(result.document.elements).toEqual([cutter, target]);
    expect(result.undo).toHaveLength(0);
  });

  it("rejects lines for shape operations", () => {
    const line = { type: "line" as const, id: elementId("shape-line"), layerId: rectangle.layerId, start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, rotation: 0, style: rectangle.style };
    expect(dispatch(select(createEditor({ ...document, elements: [rectangle, line] }), [rectangle.id, line.id]), shapeOperation([rectangle.id, line.id], "weld")).document.elements).toEqual([rectangle, line]);
    expect(dispatch(select(createEditor({ ...document, elements: [rectangle, line] }), [line.id, rectangle.id]), shapeOperation([line.id, rectangle.id], "subtract")).document.elements).toEqual([rectangle, line]);
  });

  it("ignores selected dimensions as geometry", () => {
    const dimension = { type: "dimension" as const, id: elementId("shape-dimension"), layerId: rectangle.layerId, kind: "horizontal" as const, references: [{ elementId: rectangle.id, nodeIndex: 0 }, { elementId: rectangle.id, nodeIndex: 1 }] as const, offset: { x: 0, y: -8 }, precision: 2, units: "mm" as const, rotation: 0 as const, style: rectangle.style };
    const second = { ...rectangle, id: elementId("shape-second"), position: { x: 6, y: 2 } };
    const initial = select(createEditor({ ...document, elements: [rectangle, dimension, second] }), [rectangle.id, dimension.id, second.id]);
    const result = dispatch(initial, shapeOperation(initial.selection, "weld"));
    expect(result.document.elements).toHaveLength(1);
    expect(result.document.elements[0]?.type).toBe("contour");
    expect(result.undo).toHaveLength(1);
  });

  it("removes invalid dimensions and preserves unrelated annotations", () => {
    const second = { ...rectangle, id: elementId("shape-invalid"), position: { x: 6, y: 2 } };
    const unrelated = { ...rectangle, id: elementId("shape-unrelated"), position: { x: 40, y: 2 } };
    const invalid = { ...dimension, id: elementId("invalid-dimension"), references: [{ kind: "node" as const, elementId: second.id, nodeIndex: 0 }, { kind: "node" as const, elementId: second.id, nodeIndex: 1 }] as const };
    const survivor = { ...dimension, id: elementId("surviving-dimension"), references: [{ kind: "node" as const, elementId: unrelated.id, nodeIndex: 0 }, { kind: "node" as const, elementId: unrelated.id, nodeIndex: 1 }] as const };
    const source = { ...document, elements: [rectangle, invalid, second, survivor, unrelated] };
    expect(invalidDimensionIdsForShapeOperation(source, [rectangle.id, second.id], "weld")).toEqual([invalid.id]);
    const result = dispatch(select(createEditor(source), [rectangle.id, second.id]), shapeOperation([rectangle.id, second.id], "weld"));
    expect(result.document.elements).toContainEqual(survivor);
    expect(result.document.elements).not.toContainEqual(invalid);
    expect(result.undo).toHaveLength(1);
    expect(undo(result).document.elements).toEqual(source.elements);
  });

  it("flips contour geometry, restores shape-operation selection on undo, and preserves stacking order", () => {
    const contour = { type: "contour" as const, id: elementId("contour-flip"), layerId: layerId("default"), position: { x: 10, y: 2 }, size: { width: 10, height: 5 }, contours: [{ points: [{ x: 10, y: 2 }, { x: 20, y: 2 }, { x: 20, y: 7 }, { x: 10, y: 7 }, { x: 10, y: 2 }] }], fillRule: "evenodd" as const, rotation: 0, style: rectangle.style };
    const unrelated = { ...rectangle, id: elementId("unrelated"), position: { x: 50, y: 2 } };
    let state = select(createEditor({ ...document, elements: [rectangle, unrelated, contour] }), [rectangle.id, contour.id]);
    state = dispatch(state, flipElements(state.selection, "horizontal"));
    expect(state.document.elements.find((element) => element.id === contour.id)?.type).toBe("contour");
    expect((state.document.elements.find((element) => element.id === contour.id) as Extract<(typeof state.document.elements)[number], { type: "contour" }>).contours[0]?.points).toContainEqual({ x: 1, y: 2 });
    state = select(state, [rectangle.id, unrelated.id]);
    state = dispatch(state, shapeOperation(state.selection, "weld"));
    const generated = state.document.elements.find((element) => element.type === "contour");
    expect(state.document.elements[0]?.id).toBe(generated?.id);
    expect(state.selection).toEqual([generated?.id]);
    const undone = undo(state);
    expect(undone.selection).toEqual([rectangle.id, unrelated.id]);
    expect(redo(undone).selection).toEqual([generated?.id]);
  });

  it("duplicates one object in every page-relative direction with edge spacing", () => {
    const directions: readonly { direction: Direction; x: number; y: number }[] = [
      { direction: "north-west", x: -15, y: -10 }, { direction: "north", x: 0, y: -10 }, { direction: "north-east", x: 15, y: -10 },
      { direction: "west", x: -15, y: 0 }, { direction: "center", x: 0, y: 0 }, { direction: "east", x: 15, y: 0 },
      { direction: "south-west", x: -15, y: 10 }, { direction: "south", x: 0, y: 10 }, { direction: "south-east", x: 15, y: 10 },
    ];
    for (const testCase of directions) {
      const state = select(createEditor({ ...document, elements: [rectangle] }), [rectangle.id]);
      const duplicated = dispatch(state, duplicateElements(state.selection, testCase.direction, 5, 1));
      expect(duplicated.document.elements).toHaveLength(2);
      expect(duplicated.document.elements[1]).toMatchObject({ position: { x: rectangle.position.x + testCase.x, y: rectangle.position.y + testCase.y }, size: rectangle.size, rotation: rectangle.rotation, style: rectangle.style });
      expect(duplicated.document.elements[1]?.id).not.toBe(rectangle.id);
      expect(duplicated.selection).toEqual([duplicated.document.elements[1]!.id]);
    }
  });

  it("duplicates multiple geometry types, counts copies, and undoes atomically", () => {
    const line = { type: "line" as const, id: elementId("duplicate-line"), layerId: rectangle.layerId, start: { x: 1, y: 2 }, end: { x: 4, y: 6 }, rotation: 0, style: rectangle.style };
    const contour = { type: "contour" as const, id: elementId("duplicate-contour"), layerId: rectangle.layerId, position: { x: 20, y: 2 }, size: { width: 4, height: 3 }, contours: [{ points: [{ x: 20, y: 2 }, { x: 24, y: 2 }, { x: 24, y: 5 }, { x: 20, y: 2 }] }], fillRule: "evenodd" as const, rotation: 0, style: rectangle.style };
    const state = select(createEditor({ ...document, elements: [rectangle, line, contour] }), [rectangle.id, line.id, contour.id]);
    const duplicated = dispatch(state, duplicateElements(state.selection, "south-east", 2, 2));
    expect(duplicated.document.elements).toHaveLength(9);
    const copiedLine = duplicated.document.elements.find((element) => element.type === "line" && element.id !== line.id);
    const copiedContour = duplicated.document.elements.find((element) => element.type === "contour" && element.id !== contour.id);
    expect(copiedLine).toMatchObject({ start: { x: 26, y: 9 }, end: { x: 29, y: 13 } });
    expect(copiedContour?.type === "contour" ? copiedContour.contours[0]?.points : []).toContainEqual({ x: 45, y: 9 });
    expect(duplicated.selection).toHaveLength(6);
    expect(duplicated.undo).toHaveLength(1);
    const undone = undo(duplicated);
    expect(undone.document.elements).toEqual([rectangle, line, contour]);
    expect(undone.selection).toEqual(state.selection);
    expect(redo(undone).selection).toHaveLength(6);
  });

  it("rejects invalid duplication input without mutation or history", () => {
    const state = select(createEditor({ ...document, elements: [rectangle] }), [rectangle.id]);
    expect(dispatch(state, duplicateElements(state.selection, "east", -1, 1))).toBe(state);
    expect(dispatch(state, duplicateElements(state.selection, "east", 1, 0))).toBe(state);
    expect(dispatch(state, duplicateElements(state.selection, "east", 1, 1.5))).toBe(state);
  });
});
