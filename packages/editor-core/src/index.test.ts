import { describe, expect, it } from "vitest";
import { createDocument, elementId, layerId, type DimensionElement, type Element, type EllipseElement, type LineElement, type GlyphElement, type PathElement, type PointMm, type RectangleElement, type SketchElement, type SplineElement, type TextElement } from "@nodra/domain";
import { addSketchConstraint, addSketchSegmentRelation, addToSelection, appendSketchEdge, appendSplineNode, beginGesture, cancelGesture, clearSelection, closePath, closeSplineElement, commitGesture, createEditor, createElement, createPathCubicNode, createSketchLine, cutLineAtPoint, cutPathSegment, cutSketchEdge, splitPathLineAt, deleteContourNodes, deleteElement, deleteElementNodes, deletePathNodes, deleteSketchConstraint, dispatch, duplicateElements, flipElements, insertContourNode, invalidDimensionIdsForShapeOperation, moveElement, moveElements, movePathNode, movePathHandle, openPath, previewGesture, previewGestureFromBase, redo, reversePath, removeFromSelection, reorderLayer, resizeElement, resizeElementToDimensions, resizeElements, resizeElementsToDimensions, rotateElementsAroundCenter, select, selectForPointerDown, setDimensionDriving, updateCircleConstraint, deleteCircleConstraint, solveCircle, setLayerVisibility, setPathJoin, shapeOperation, splitPathSegment, toggleSelection, topologyEditForPathSegmentReplacement, topologyReferenceKey, undo, updateContourNode, updateDimensionValue, updateElement, updateElementNode, updateElementStyles, updateSketchConstraint, updateSplineHandle, updateSplineNode } from "./index.js";
import { boundsOfElements } from "@nodra/geometry";
import type { Direction } from "@nodra/geometry";
import { appendLinePoint } from "./index.js";

const rectangle: RectangleElement = { type: "rectangle", id: elementId("r1"), layerId: layerId("default"), position: { x: 1, y: 2 }, size: { width: 10, height: 5 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
const ellipse: EllipseElement = { type: "ellipse", id: elementId("ellipse"), layerId: layerId("default"), position: { x: 11, y: 12 }, size: { width: 20, height: 10 }, rotation: 0, style: rectangle.style };
const document = createDocument("doc", [{ id: layerId("default"), name: "Default", visible: true, order: 0 }]);
const path: PathElement = { type: "path", id: elementId("path"), layerId: layerId("default"), nodes: [{ id: "a", anchor: { x: 0, y: 0 }, join: "corner" }, { id: "b", anchor: { x: 10, y: 0 }, join: "corner" }], segments: [{ id: "fixture-segment-1", type: "cubicBezier", startNodeId: "a", endNodeId: "b", control1: { x: 2, y: 4 }, control2: { x: 8, y: 4 } }], closed: false, style: rectangle.style };
const spline: SplineElement = { type: "spline", id: elementId("spline"), layerId: layerId("default"), nodes: [{ id: "a", anchor: { x: 0, y: 0 }, continuity: "smooth" }, { id: "b", anchor: { x: 10, y: 0 }, continuity: "smooth" }, { id: "c", anchor: { x: 10, y: 10 }, continuity: "smooth" }], closed: false, style: rectangle.style };
const text: TextElement = { type: "text", id: elementId("text"), layerId: layerId("default"), position: { x: 12, y: 18 }, size: { width: 32, height: 14 }, text: "Keep formatting", fontFamily: "Times New Roman", fontSize: 18, fontWeight: "bold", fontStyle: "italic", textAlign: "left", lineHeight: 1.2, rotation: 0, style: { stroke: "#123456", fill: "#654321", strokeWidth: 0.5 } };
const dimension: DimensionElement = { type: "dimension", id: elementId("dimension"), layerId: layerId("default"), kind: "horizontal", references: [{ kind: "node", elementId: rectangle.id, nodeIndex: 0 }, { kind: "node", elementId: rectangle.id, nodeIndex: 1 }], offset: { x: 0, y: -10 }, precision: 2, units: "mm", rotation: 0, style: rectangle.style };
const glyph: GlyphElement = { type: "glyph", id: elementId("glyph"), layerId: layerId("default"), position: { x: 0, y: 0 }, size: { width: 20, height: 20 }, glyph: "O", fillRule: "evenodd", rotation: 0, style: rectangle.style, contours: [{ nodes: [{ id: "ga", anchor: { x: 0, y: 0 }, join: "smooth" }, { id: "gb", anchor: { x: 10, y: 0 }, join: "smooth" }, { id: "gc", anchor: { x: 10, y: 10 }, join: "smooth" }, { id: "gd", anchor: { x: 0, y: 10 }, join: "smooth" }], segments: [{ id: "fixture-segment-2", type: "cubicBezier", startNodeId: "ga", endNodeId: "gb", control1: { x: 3, y: -2 }, control2: { x: 7, y: -2 } }, { id: "fixture-segment-3", type: "cubicBezier", startNodeId: "gb", endNodeId: "gc", control1: { x: 12, y: 3 }, control2: { x: 12, y: 7 } }, { id: "fixture-segment-4", type: "cubicBezier", startNodeId: "gc", endNodeId: "gd", control1: { x: 7, y: 12 }, control2: { x: 3, y: 12 } }, { id: "fixture-segment-5", type: "cubicBezier", startNodeId: "gd", endNodeId: "ga", control1: { x: -2, y: 7 }, control2: { x: -2, y: 3 } }] }] };

describe("editor core", () => {
  it("keys stable topology references without conflating edge and segment identities", () => {
    expect(topologyReferenceKey({ kind: "sketch-edge", elementId: elementId("shape"), edgeId: "shared" })).toBe("shape:edge:shared");
    expect(topologyReferenceKey({ kind: "path-segment", elementId: elementId("shape"), segmentId: "shared" })).toBe("shape:segment:shared");
  });
  it("reports path segment replacements through the shared topology contract", () => {
    const replacements = [{ id: "first", type: "line" as const, startNodeId: "a", endNodeId: "middle" }, { id: "second", type: "line" as const, startNodeId: "middle", endNodeId: "b" }];
    const edit = topologyEditForPathSegmentReplacement([path], path.id, path.segments[0]!.id, replacements);
    expect(edit.referenceMap.get(`${path.id}:segment:${path.segments[0]!.id}`)).toEqual({ kind: "replaced", references: [{ kind: "path-segment", elementId: path.id, segmentId: "first" }, { kind: "path-segment", elementId: path.id, segmentId: "second" }] });
    expect(edit.elements).toEqual([path]);
  });
  it("previews, commits, cancels, and undoes a sketch constraint as one transaction", () => {
        const sketch = createSketchLine(elementId("transaction-sketch"), layerId("default"), rectangle.style, { x: 0, y: 0 }, { x: 7, y: 4 });
        const [first, second] = sketch.nodes;
        if (!first || !second) throw new Error("Expected sketch nodes");
        const constraint = { id: "transaction-constraint", kind: "horizontal" as const, references: [{ elementId: sketch.id, nodeId: first.id }, { elementId: sketch.id, nodeId: second.id }] as const };
        const initial = createEditor({ ...document, elements: [sketch] });
        const preview = previewGesture(beginGesture(initial), addSketchConstraint(sketch.id, constraint));
        expect(preview.gesture).toBeDefined();
        expect((preview.document.elements[0] as SketchElement).constraints).toEqual([constraint]);
        expect(preview.undo).toHaveLength(0);
        expect(cancelGesture(preview).document).toEqual(initial.document);
        const committed = commitGesture(preview);
        expect(committed.undo).toHaveLength(1);
        expect(undo(committed).document).toEqual(initial.document);
      });

      it("updates and deletes sketch constraints through atomic commands", () => {
        const sketch = createSketchLine(elementId("constraint-sketch"), layerId("default"), rectangle.style, { x: 0, y: 0 }, { x: 7, y: 4 });
        const [first, second] = sketch.nodes;
        if (!first || !second) throw new Error("Expected sketch nodes");
        const reference = (nodeId: string) => ({ elementId: sketch.id, nodeId });
        const horizontal = { id: "horizontal", kind: "horizontal" as const, references: [reference(first.id), reference(second.id)] as const };
        const initial = createEditor({ ...document, elements: [sketch] });
        const constrained = dispatch(initial, addSketchConstraint(sketch.id, horizontal));
        expect((constrained.document.elements[0] as SketchElement).constraints).toEqual([horizontal]);
        const distance = { ...horizontal, kind: "distance-horizontal" as const, value: 20 };
        const updated = dispatch(constrained, updateSketchConstraint(sketch.id, horizontal.id, distance));
        expect((updated.document.elements[0] as SketchElement).nodes[1]?.point).toEqual({ x: 20, y: 0 });
        const removed = dispatch(updated, deleteSketchConstraint(sketch.id, distance.id));
        expect((removed.document.elements[0] as SketchElement).constraints).toEqual([]);
        expect(removed.undo).toHaveLength(3);
        expect(redo(undo(removed)).document).toEqual(removed.document);
      });

      it("adds explicit relations between two selected sketch segments", () => {
        const sketch: SketchElement = { type: "sketch", id: elementId("segment-relations"), layerId: layerId("default"), nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 10, y: 0 } }, { id: "c", point: { x: 0, y: 10 } }, { id: "d", point: { x: 3, y: 14 } }], edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }, { id: "cd", startNodeId: "c", endNodeId: "d" }], style: rectangle.style };
        const references = [{ elementId: sketch.id, nodeId: "a" }, { elementId: sketch.id, nodeId: "b" }, { elementId: sketch.id, nodeId: "c" }, { elementId: sketch.id, nodeId: "d" }] as const;
        const equal = dispatch(createEditor({ ...document, elements: [sketch] }), addSketchConstraint(sketch.id, { id: "equal", kind: "equal", references }));
        const equalSketch = equal.document.elements[0] as SketchElement;
        expect(Math.hypot(equalSketch.nodes[3]!.point.x - equalSketch.nodes[2]!.point.x, equalSketch.nodes[3]!.point.y - equalSketch.nodes[2]!.point.y)).toBeCloseTo(10);
        const parallel = dispatch(createEditor({ ...document, elements: [sketch] }), addSketchConstraint(sketch.id, { id: "parallel", kind: "parallel", references }));
        expect((parallel.document.elements[0] as SketchElement).nodes[3]?.point.y).toBeCloseTo(10);
        const perpendicular = dispatch(createEditor({ ...document, elements: [sketch] }), addSketchConstraint(sketch.id, { id: "perpendicular", kind: "perpendicular", references }));
        expect((perpendicular.document.elements[0] as SketchElement).nodes[3]?.point.x).toBeCloseTo(0);
      });

      it("merges two sketches when adding an explicit relation between their segments", () => {
        const first = createSketchLine(elementId("first-relation-sketch"), layerId("default"), rectangle.style, { x: 0, y: 0 }, { x: 10, y: 0 });
        const second = createSketchLine(elementId("second-relation-sketch"), layerId("default"), rectangle.style, { x: 0, y: 10 }, { x: 3, y: 14 });
        const relation = { id: "parallel", kind: "parallel" as const, references: [{ elementId: first.id, nodeId: first.nodes[0]!.id }, { elementId: first.id, nodeId: first.nodes[1]!.id }, { elementId: second.id, nodeId: second.nodes[0]!.id }, { elementId: second.id, nodeId: second.nodes[1]!.id }] as const };
        const state = dispatch(createEditor({ ...document, elements: [first, second] }), addSketchSegmentRelation(relation));
        expect(state.document.elements).toHaveLength(1);
        const merged = state.document.elements[0] as SketchElement;
        expect(merged.edges).toHaveLength(2);
        expect(merged.constraints?.some((constraint) => constraint.kind === "parallel")).toBe(true);
        expect(merged.nodes[3]?.point.y).toBeCloseTo(10);
      });

      it("merges two sketches for an explicit coincident node relation", () => {
        const first = createSketchLine(elementId("first-coincident-sketch"), layerId("default"), rectangle.style, { x: 0, y: 0 }, { x: 10, y: 0 });
        const second = createSketchLine(elementId("second-coincident-sketch"), layerId("default"), rectangle.style, { x: 20, y: 10 }, { x: 20, y: 20 });
        const relation = { id: "coincident-cross", kind: "coincident" as const, references: [{ elementId: first.id, nodeId: first.nodes[1]!.id }, { elementId: second.id, nodeId: second.nodes[0]!.id }] as const };
        const state = dispatch(createEditor({ ...document, elements: [first, second] }), addSketchSegmentRelation(relation));
        expect(state.document.elements).toHaveLength(1);
        const merged = state.document.elements[0] as SketchElement;
        expect(merged.constraints).toContainEqual(expect.objectContaining({ kind: "coincident" }));
        expect(merged.nodes.find((node) => node.id === `${second.id}:${second.nodes[0]!.id}`)?.point).toEqual(merged.nodes.find((node) => node.id === first.nodes[1]!.id)?.point);
      });

      it("deletes sketch nodes with their attached constraints while preserving the sketch model", () => {
        const baseSketch = createSketchLine(elementId("delete-constraint-sketch"), layerId("default"), rectangle.style, { x: 0, y: 0 }, { x: 10, y: 0 });
            const sketch = { ...baseSketch, nodes: [...baseSketch.nodes, { id: "third", point: { x: 10, y: 10 } }], edges: [...baseSketch.edges, { id: "second-third", startNodeId: baseSketch.nodes[1]!.id, endNodeId: "third" }] };
        const [first, second] = sketch.nodes;
        if (!first || !second) throw new Error("Expected sketch nodes");
        const constrained = { ...sketch, constraints: [{ id: "fixed", kind: "fixed" as const, references: [{ elementId: sketch.id, nodeId: first.id }] as const }] };
        const initial = createEditor({ ...document, elements: [constrained] });
        const updated = dispatch(initial, deleteElementNodes(sketch.id, [0]));
        expect(updated.document.elements[0]).toMatchObject({ type: "sketch", nodes: [{ id: second.id }, { id: "third" }], edges: [{ id: "second-third" }] });
        expect((updated.document.elements[0] as SketchElement).constraints).toEqual([]);
        expect(undo(updated).document).toEqual(initial.document);
      });

      it("creates sketch edges by reusing shared nodes", () => {
    const sketch = createSketchLine(elementId("sketch"), layerId("default"), rectangle.style, { x: 0, y: 0 }, { x: 10, y: 0 });
    const initial = createEditor({ ...document, elements: [sketch] });
    const branch = dispatch(initial, appendSketchEdge(sketch.id, sketch.nodes[1]!.id, { x: 10, y: 10 }));
    const branched = branch.document.elements[0] as SketchElement;
    const closed = dispatch(branch, appendSketchEdge(sketch.id, branched.nodes[2]!.id, branched.nodes[0]!.point, branched.nodes[0]!.id));
    expect(closed.document.elements[0]).toMatchObject({ type: "sketch", nodes: [{ id: sketch.nodes[0]!.id }, { id: sketch.nodes[1]!.id }, { point: { x: 10, y: 10 } }], edges: [{ startNodeId: sketch.nodes[0]!.id, endNodeId: sketch.nodes[1]!.id }, { startNodeId: sketch.nodes[1]!.id }, { startNodeId: branched.nodes[2]!.id, endNodeId: sketch.nodes[0]!.id }] });
    expect((closed.document.elements[0] as SketchElement).constraints?.map((constraint) => constraint.kind)).toEqual(["horizontal", "vertical", "perpendicular"]);
    const cut = dispatch(closed, cutSketchEdge(sketch.id, 1));
    expect(cut.document.elements[0]).toMatchObject({ type: "sketch", nodes: [{ id: sketch.nodes[0]!.id }, { id: sketch.nodes[1]!.id }, { point: { x: 10, y: 10 } }], edges: [{ startNodeId: sketch.nodes[0]!.id, endNodeId: sketch.nodes[1]!.id }, { startNodeId: branched.nodes[2]!.id, endNodeId: sketch.nodes[0]!.id }] });
  });
  it("splits a sketch segment at the cut point without deleting the whole line", () => {
     const sketch = createSketchLine(elementId("split-sketch"), layerId("default"), rectangle.style, { x: 0, y: 0 }, { x: 20, y: 0 });
     const state = dispatch(createEditor({ ...document, elements: [sketch] }), cutSketchEdge(sketch.id, 0, { x: 8, y: 0 }));
     const result = state.document.elements[0] as SketchElement;
     expect(result.nodes).toHaveLength(3);
     expect(result.edges).toHaveLength(2);
     expect(result.nodes.find((node) => node.point.x === 8)?.point).toEqual({ x: 8, y: 0 });
   });

  it("remaps stable sketch-edge dimension references when splitting an edge", () => {
     const sketch = createSketchLine(elementId("split-reference-sketch"), layerId("default"), rectangle.style, { x: 0, y: 0 }, { x: 20, y: 0 });
     const originalEdge = sketch.edges[0]!;
     const angle: DimensionElement = { type: "dimension", id: elementId("split-reference-angle"), layerId: sketch.layerId, kind: "angular", references: [{ kind: "line", elementId: sketch.id, edgeId: originalEdge.id, edgeIndex: 0 }, { kind: "line", elementId: sketch.id, edgeId: originalEdge.id, edgeIndex: 0 }], offset: { x: 8, y: -8 }, precision: 2, units: "mm", rotation: 0, style: rectangle.style };
     const state = dispatch(createEditor({ ...document, elements: [sketch, angle] }), cutSketchEdge(sketch.id, 0, { x: 8, y: 0 }));
     const result = state.document.elements.find((element): element is SketchElement => element.id === sketch.id)!;
     const remapped = state.document.elements.find((element): element is DimensionElement => element.id === angle.id)!;

     expect(result.edges).toHaveLength(2);
     expect(remapped.references).toEqual([{ kind: "line", elementId: sketch.id, edgeId: result.edges[0]!.id, edgeIndex: 0 }, { kind: "line", elementId: sketch.id, edgeId: result.edges[0]!.id, edgeIndex: 0 }]);
     expect(undo(state).document.elements).toEqual([sketch, angle]);
   });

  it("cuts a sketch segment at a crossing rectangle intersection instead of the click point", () => {
     const sketch = createSketchLine(elementId("intersection-sketch"), layerId("default"), rectangle.style, { x: 0, y: 0 }, { x: 20, y: 0 });
     const cutter = { ...rectangle, id: elementId("intersection-rectangle"), position: { x: 8, y: -5 }, size: { width: 4, height: 10 } };
     const state = dispatch(createEditor({ ...document, elements: [sketch, cutter] }), cutSketchEdge(sketch.id, 0, { x: 19, y: 0 }));
     const result = state.document.elements.find((element): element is SketchElement => element.id === sketch.id)!;
     expect(result.nodes.some((node) => node.point.x === 12 && node.point.y === 0)).toBe(true);
     expect(result.nodes.some((node) => node.point.x === 19)).toBe(false);
   });

  it("removes dimensions whose sketch node is removed by a cut", () => {
     const sketch = { ...createSketchLine(elementId("cut-dimension-sketch"), layerId("default"), rectangle.style, { x: 0, y: 0 }, { x: 10, y: 0 }), nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 10, y: 0 } }, { id: "c", point: { x: 20, y: 0 } }], edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }, { id: "bc", startNodeId: "b", endNodeId: "c" }] };
     const linked: DimensionElement = { ...dimension, id: elementId("cut-dimension"), references: [{ kind: "node", elementId: sketch.id, nodeIndex: 0, nodeId: "a" }, { kind: "node", elementId: sketch.id, nodeIndex: 2, nodeId: "c" }] };
     const state = dispatch(createEditor({ ...document, elements: [sketch, linked] }), cutSketchEdge(sketch.id, 1));
     expect(state.document.elements).toHaveLength(1);
     expect(state.document.elements[0]).toMatchObject({ type: "sketch", nodes: [{ id: "a" }, { id: "b" }] });
   });

  it("removes a dimension whose stable sketch edge is deleted", () => {
     const base = createSketchLine(elementId("delete-edge-reference"), layerId("default"), rectangle.style, { x: 0, y: 0 }, { x: 10, y: 0 });
     const sketch: SketchElement = { ...base, nodes: [...base.nodes, { id: "c", point: { x: 20, y: 0 } }], edges: [...base.edges, { id: "bc", startNodeId: base.nodes[1]!.id, endNodeId: "c" }] };
     const angle: DimensionElement = { type: "dimension", id: elementId("deleted-edge-angle"), layerId: sketch.layerId, kind: "angular", references: [{ kind: "line", elementId: sketch.id, edgeId: "bc", edgeIndex: 1 }, { kind: "line", elementId: sketch.id, edgeId: "bc", edgeIndex: 1 }], offset: { x: 8, y: -8 }, precision: 2, units: "mm", rotation: 0, style: rectangle.style };
     const state = dispatch(createEditor({ ...document, elements: [sketch, angle] }), cutSketchEdge(sketch.id, 1));

     expect(state.document.elements).toHaveLength(1);
     expect(state.document.elements[0]).toMatchObject({ type: "sketch", edges: [{ id: base.edges[0]!.id }] });
   });

it("converts a zero-radius rectangle to an open path when cutting one edge", () => {
    const state = dispatch(createEditor({ ...document, elements: [rectangle, dimension] }), cutPathSegment(rectangle.id, 0));
    expect(state.document.elements[0]).toMatchObject({ type: "path", closed: false, segments: [{ type: "line" }, { type: "line" }, { type: "line" }] });
    expect(state.document.elements[1]).toMatchObject({ type: "dimension", references: [{ kind: "node", elementId: rectangle.id }, { kind: "node", elementId: rectangle.id }] });
  });
  it("splits a straight path segment at an arbitrary parameter", () => {
    const cutPath: PathElement = { ...path, nodes: [...path.nodes, { id: "c", anchor: { x: 10, y: 10 }, join: "corner" }], segments: [...path.segments, { id: "fixture-segment-6", type: "line", startNodeId: "b", endNodeId: "c" }] };
    const state = dispatch(createEditor({ ...document, elements: [cutPath] }), splitPathLineAt(cutPath.id, 1, 0.25));
    expect(state.document.elements[0]).toMatchObject({ type: "path", nodes: [{ id: "a" }, { id: "b" }, { anchor: { x: 10, y: 2.5 } }, { id: "c" }] });
  });
  it("removes a single-segment path when it is cut", () => {
    const single: PathElement = { ...path, nodes: path.nodes.slice(0, 2), segments: [{ id: "fixture-segment-7", type: "line", startNodeId: "a", endNodeId: "b" }] };
    expect(dispatch(createEditor({ ...document, elements: [single] }), cutPathSegment(single.id, 0)).document.elements).toEqual([]);
  });
  it("rejects a curved cut atomically", () => {
    const initial = createEditor({ ...document, elements: [path] });
    const rejected = dispatch(initial, cutPathSegment(path.id, 0, { x: 5, y: 3 }));
    expect(rejected).toBe(initial);
  });
  it("rejects rectangles with corner radii atomically", () => {
    const rounded = { ...rectangle, cornerRadius: 2 };
    const perCorner = { ...rectangle, id: elementId("per-corner"), cornerRadii: { topLeft: 0, topRight: 2, bottomRight: 0, bottomLeft: 0 } };
    const roundedInitial = createEditor({ ...document, elements: [rounded] });
    const perCornerInitial = createEditor({ ...document, elements: [perCorner] });
    expect(dispatch(roundedInitial, cutPathSegment(rounded.id, 0))).toBe(roundedInitial);
    expect(dispatch(perCornerInitial, cutPathSegment(perCorner.id, 0))).toBe(perCornerInitial);
  });
  it("reconstructs a line-through-rectangle cut into filled faces and open remnants", () => {
    const filled = { ...rectangle, id: elementId("filled"), style: { ...rectangle.style, fill: "#f00" } };
    const divider = { type: "line" as const, id: elementId("divider"), layerId: rectangle.layerId, start: { x: 6, y: -2 }, end: { x: 6, y: 12 }, rotation: 0, style: rectangle.style };
    const initial = createEditor({ ...document, elements: [filled, divider] });
    const cut = dispatch(initial, cutLineAtPoint(divider.id, { x: 6, y: -1 }));
    expect(cut.document.elements.filter((element) => element.type === "path" && element.closed)).toHaveLength(2);
    expect(cut.document.elements.filter((element) => element.type === "path" && element.closed).every((element) => element.type === "path" && element.style.fill === "#f00")).toBe(true);
    expect(cut.document.elements.filter((element) => element.type === "path" && !element.closed)).toHaveLength(1);
    const interiorCut = dispatch(initial, cutLineAtPoint(divider.id, { x: 6, y: 5 }));
    expect(interiorCut.document.elements.filter((element) => element.type === "path" && element.closed)).toHaveLength(1);
    expect(interiorCut.document.elements.filter((element) => element.type === "path" && !element.closed)).toHaveLength(2);
    expect(cut.undo).toHaveLength(1);
    expect(redo(undo(cut)).document).toEqual(cut.document);
  });
  it("removes both coincident shared edges when cutting a previously split face", () => {
    const filled = { ...rectangle, id: elementId("filled-shared"), style: { ...rectangle.style, fill: "#f00" } };
    const divider = { type: "line" as const, id: elementId("divider-shared"), layerId: rectangle.layerId, start: { x: 6, y: -2 }, end: { x: 6, y: 12 }, rotation: 0, style: rectangle.style };
    const firstCut = dispatch(createEditor({ ...document, elements: [filled, divider] }), cutLineAtPoint(divider.id, { x: 6, y: -1 }));
    const face = firstCut.document.elements.find((element) => element.type === "path" && element.closed && element.segments.some((segment) => {
      const nodes = new Map(element.nodes.map((node) => [node.id, node.anchor]));
      const start = nodes.get(segment.startNodeId); const end = nodes.get(segment.endNodeId);
      return start?.x === 6 && end?.x === 6 && Math.min(start.y, end.y) === 2 && Math.max(start.y, end.y) === 7;
    }));
    expect(face?.type).toBe("path");
    const sharedSegment = face?.type === "path" ? face.segments.findIndex((segment) => {
      const nodes = new Map(face.nodes.map((node) => [node.id, node.anchor]));
      const start = nodes.get(segment.startNodeId); const end = nodes.get(segment.endNodeId);
      return start?.x === 6 && end?.x === 6 && Math.min(start.y, end.y) === 2 && Math.max(start.y, end.y) === 7;
    }) : -1;
    const secondCut = face?.type === "path" ? dispatch(firstCut, cutPathSegment(face.id, sharedSegment)) : firstCut;
    const sharedEdges = secondCut.document.elements.flatMap((element) => element.type === "path" ? element.segments.flatMap((segment) => {
      const nodes = new Map(element.nodes.map((node) => [node.id, node.anchor]));
      const start = nodes.get(segment.startNodeId); const end = nodes.get(segment.endNodeId);
      return start?.x === 6 && end?.x === 6 && Math.min(start.y, end.y) === 2 && Math.max(start.y, end.y) === 7 ? [segment] : [];
    }) : []);
    expect(secondCut).not.toBe(firstCut);
    expect(sharedEdges).toHaveLength(0);
    expect(secondCut.undo).toHaveLength(2);
  });
  it("uses circle intersections to keep a trimmed rectangle corner filled and closed", () => {
    const filled = { ...rectangle, id: elementId("circle-corner-rectangle"), position: { x: 0, y: 0 }, size: { width: 20, height: 20 }, style: { ...rectangle.style, fill: "#f00" } };
    const circle: EllipseElement = { type: "ellipse", id: elementId("corner-circle"), layerId: rectangle.layerId, position: { x: -5, y: -5 }, size: { width: 10, height: 10 }, rotation: 0, style: rectangle.style };
    const connection = { id: "corner-circle-connection", first: { elementId: circle.id, node: { kind: "named" as const, name: "center" as const } }, second: { elementId: filled.id, node: { kind: "named" as const, name: "nw" as const } } };
    const segmentWithEndpoints = (elements: readonly Element[], predicate: (start: PointMm, end: PointMm) => boolean): { readonly path: PathElement; readonly segmentIndex: number } | undefined => {
      for (const element of elements) if (element.type === "path") for (let segmentIndex = 0; segmentIndex < element.segments.length; segmentIndex += 1) {
        const nodes = new Map(element.nodes.map((node) => [node.id, node.anchor]));
        const segment = element.segments[segmentIndex]!; const start = nodes.get(segment.startNodeId); const end = nodes.get(segment.endNodeId);
        if (start && end && predicate(start, end)) return { path: element, segmentIndex };
      }
      return undefined;
    };
    let state = dispatch(createEditor({ ...document, elements: [filled, circle], connections: [connection] }), cutPathSegment(circle.id, 0, { x: 3.5, y: 3.5 }));
    expect(state.document.connections).toEqual([]);
    const curvedPieces = state.document.elements.filter((element) => element.type === "path" && element.segments.some((segment) => segment.type === "cubicBezier"));
    expect(curvedPieces.length).toBeGreaterThan(0);
    expect(Math.max(...curvedPieces.map((element) => element.type === "path" ? element.nodes.length : 0))).toBeLessThan(12);
    const top = segmentWithEndpoints(state.document.elements, (start, end) => start.y === 0 && end.y === 0 && Math.min(start.x, end.x) === 0 && Math.max(start.x, end.x) === 5);
    expect(top).toBeDefined();
    state = top ? dispatch(state, cutPathSegment(top.path.id, top.segmentIndex, { x: 2, y: 0 })) : state;
    const left = segmentWithEndpoints(state.document.elements, (start, end) => start.x === 0 && end.x === 0 && Math.min(start.y, end.y) === 0 && Math.max(start.y, end.y) === 5);
    expect(left).toBeDefined();
    state = left ? dispatch(state, cutPathSegment(left.path.id, left.segmentIndex, { x: 0, y: 2 })) : state;
    const closedFilled = state.document.elements.filter((element) => element.type === "path" && element.closed && element.style.fill === "#f00");
    expect(closedFilled.length).toBeGreaterThan(0);
    expect(closedFilled.some((element) => element.type === "path" && element.nodes.some((node) => node.anchor.x === 5 && node.anchor.y === 0))).toBe(true);
    expect(closedFilled.some((element) => element.type === "path" && element.nodes.some((node) => node.anchor.x === 0 && node.anchor.y === 5))).toBe(true);
    expect(state.undo).toHaveLength(3);
  });
  it("cuts a rotated rectangle without changing an unrelated element", () => {
    const rotated = { ...rectangle, id: elementId("rotated"), rotation: Math.PI / 4, style: { ...rectangle.style, fill: "#0f0" } };
    const unrelated = { ...rectangle, id: elementId("unrelated"), position: { x: 100, y: 100 } };
    const initial = createEditor({ ...document, elements: [rotated, unrelated] });
    const cut = dispatch(initial, cutPathSegment(rotated.id, 0, { x: 5.5, y: -0.5 }));
    expect(cut.document.elements.find((element) => element.id === unrelated.id)).toMatchObject(unrelated);
    expect(cut.document.elements.some((element) => element.id === rotated.id && element.type === "path" && !element.closed)).toBe(true);
  });
  it("converts a zero-radius rectangle to an open path when cutting one edge", () => {
        const state = dispatch(createEditor({ ...document, elements: [rectangle] }), cutPathSegment(rectangle.id, 0));
        expect(state.document.elements[0]).toMatchObject({ type: "path", closed: false, segments: [{ type: "line" }, { type: "line" }, { type: "line" }] });
        expect(state.undo).toHaveLength(1);
      });

      it("splits a straight path segment at an arbitrary parameter", () => {
        const cutPath: PathElement = { ...path, nodes: [...path.nodes, { id: "c", anchor: { x: 10, y: 10 }, join: "corner" }], segments: [...path.segments, { id: "fixture-segment-8", type: "line", startNodeId: "b", endNodeId: "c" }] };
        const state = dispatch(createEditor({ ...document, elements: [cutPath] }), splitPathLineAt(cutPath.id, 1, 0.25));
        const result = state.document.elements[0];
        expect(result).toMatchObject({ type: "path", nodes: [{ id: "a" }, { id: "b" }, { anchor: { x: 10, y: 2.5 } }, { id: "c" }] });
        expect(result?.type === "path" ? result.segments.slice(1) : []).toMatchObject([{ type: "line", startNodeId: "b", endNodeId: result?.type === "path" ? result.nodes[2]!.id : "" }, { type: "line", startNodeId: result?.type === "path" ? result.nodes[2]!.id : "", endNodeId: "c" }]);
        if (result?.type === "path") expect(result.segments.slice(1).every((segment) => segment.id !== "fixture-segment-8")).toBe(true);
      });

      it("removes a single-segment path when it is cut", () => {
        const single: PathElement = { ...path, nodes: path.nodes.slice(0, 2), segments: [{ id: "fixture-segment-11", type: "line", startNodeId: "a", endNodeId: "b" }] };
        const state = dispatch(createEditor({ ...document, elements: [single] }), cutPathSegment(single.id, 0));
        expect(state.document.elements).toEqual([]);
        expect(state.undo).toHaveLength(1);
      });

      it("cuts an isolated straight path segment without removing the path", () => {
        const cutPath: PathElement = { ...path, nodes: [...path.nodes, { id: "c", anchor: { x: 10, y: 10 }, join: "corner" }], segments: [...path.segments, { id: "fixture-segment-12", type: "line", startNodeId: "b", endNodeId: "c" }] };
        const state = dispatch(createEditor({ ...document, elements: [cutPath] }), cutPathSegment(cutPath.id, 1));
        expect(state.document.elements[0]).toMatchObject({ type: "path", closed: false, nodes: [{ id: "a" }, { id: "b" }], segments: [{ id: path.segments[0]!.id, type: "cubicBezier", startNodeId: "a", endNodeId: "b" }] });
        expect(state.undo).toHaveLength(1);
      });
      it("generalizes a committed native line when a third node is added", () => {
    const line = { type: "line" as const, id: elementId("click-line"), layerId: layerId("default"), start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style: rectangle.style };
    const state = dispatch(dispatch(createEditor(document), createElement(line)), appendLinePoint(line.id, { x: 10, y: 10 }));
    expect(state.document.elements[0]).toMatchObject({ type: "path", closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 10 } }] });
    expect(state.undo).toHaveLength(2);
  });
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
  it("keeps a connected left side fixed during property resize and undoes atomically", () => {
    const external = { ...rectangle, id: elementId("external"), position: { x: -9, y: 2 } };
    const connected = { id: "connection-left", first: { elementId: rectangle.id, node: { kind: "named" as const, name: "w" as const } }, second: { elementId: external.id, node: { kind: "named" as const, name: "e" as const } } };
    const initial = createEditor({ ...document, elements: [external, rectangle], connections: [connected] });
    const resized = dispatch(initial, resizeElementToDimensions(rectangle.id, "width", 20));
    expect(resized.document.elements.find((element) => element.id === rectangle.id)).toMatchObject({ position: { x: 1 }, size: { width: 20 } });
    expect(resized.undo).toHaveLength(1);
    expect(undo(resized).document).toEqual(initial.document);
    expect(redo(undo(resized)).document).toEqual(resized.document);
  });
  it("preserves centered fallback and rejects a resize that would break opposite connections", () => {
    const centered = dispatch(createEditor({ ...document, elements: [rectangle] }), resizeElementToDimensions(rectangle.id, "width", 20));
    expect(centered.document.elements[0]).toMatchObject({ position: { x: -4 }, size: { width: 20 } });
    const centeredHeight = dispatch(createEditor({ ...document, elements: [rectangle] }), resizeElementToDimensions(rectangle.id, "height", 15));
    expect(centeredHeight.document.elements[0]).toMatchObject({ position: { x: 1, y: -3 }, size: { width: 10, height: 15 } });
    const both = { ...document, elements: [rectangle], connections: [
      { id: "left", first: { elementId: rectangle.id, node: { kind: "named" as const, name: "w" as const } }, second: { elementId: elementId("other"), node: { kind: "named" as const, name: "e" as const } } },
      { id: "right", first: { elementId: rectangle.id, node: { kind: "named" as const, name: "e" as const } }, second: { elementId: elementId("other-2"), node: { kind: "named" as const, name: "w" as const } } },
    ] };
    expect(dispatch(createEditor(both), resizeElementToDimensions(rectangle.id, "width", 20)).document).toEqual(both);
  });
  it("anchors right, top, bottom, and proportional property resizes", () => {
    const other = { ...rectangle, id: elementId("other-anchor") };
    const makeConnection = (id: string, name: "e" | "n" | "s") => ({ id, first: { elementId: rectangle.id, node: { kind: "named" as const, name } }, second: { elementId: other.id, node: { kind: "named" as const, name: "center" as const } } });
    const right = dispatch(createEditor({ ...document, elements: [rectangle, other], connections: [makeConnection("right", "e")] }), resizeElementToDimensions(rectangle.id, "width", 20));
    expect(right.document.elements.find((element) => element.id === rectangle.id)).toMatchObject({ position: { x: -9 } });
    const top = dispatch(createEditor({ ...document, elements: [rectangle, other], connections: [makeConnection("top", "n")] }), resizeElementToDimensions(rectangle.id, "height", 20));
    expect(top.document.elements.find((element) => element.id === rectangle.id)).toMatchObject({ position: { y: 2 } });
    const bottom = dispatch(createEditor({ ...document, elements: [rectangle, other], connections: [makeConnection("bottom", "s")] }), resizeElementToDimensions(rectangle.id, "height", 20));
    expect(bottom.document.elements.find((element) => element.id === rectangle.id)).toMatchObject({ position: { y: -13 } });
    const proportional = dispatch(createEditor({ ...document, elements: [rectangle, other], connections: [makeConnection("left-proportional", "n")] }), resizeElementToDimensions(rectangle.id, "width", 20, true));
    expect(proportional.document.elements.find((element) => element.id === rectangle.id)).toMatchObject({ position: { x: -4, y: 2 }, size: { width: 20, height: 10 } });
  });
  it("resizes ellipses around their center on both axes", () => {
    const width = dispatch(createEditor({ ...document, elements: [ellipse] }), resizeElementToDimensions(ellipse.id, "width", 30));
    expect(width.document.elements[0]).toMatchObject({ position: { x: 6, y: 12 }, size: { width: 30, height: 10 } });
    const height = dispatch(createEditor({ ...document, elements: [ellipse] }), resizeElementToDimensions(ellipse.id, "height", 20));
    expect(height.document.elements[0]).toMatchObject({ position: { x: 11, y: 7 }, size: { width: 20, height: 20 } });
  });
  it("anchors both axes for connected rectangle corners, including proportional edits", () => {
    const other = { ...rectangle, id: elementId("corner-anchor") };
    const connection = { id: "north-west", first: { elementId: rectangle.id, node: { kind: "named" as const, name: "nw" as const } }, second: { elementId: other.id, node: { kind: "named" as const, name: "center" as const } } };
    const resized = dispatch(createEditor({ ...document, elements: [rectangle, other], connections: [connection] }), resizeElementToDimensions(rectangle.id, "width", 20, true));
    expect(resized.document.elements.find((element) => element.id === rectangle.id)).toMatchObject({ position: { x: 1, y: 2 }, size: { width: 20, height: 10 } });
    expect(resized.undo).toHaveLength(1);
    expect(redo(undo(resized)).document).toEqual(resized.document);

    const bottomRight = { ...rectangle, id: elementId("bottom-right-anchor") };
    const bottomConnection = { id: "south-east", first: { elementId: rectangle.id, node: { kind: "named" as const, name: "se" as const } }, second: { elementId: bottomRight.id, node: { kind: "named" as const, name: "center" as const } } };
    const resizedHeight = dispatch(createEditor({ ...document, elements: [rectangle, bottomRight], connections: [bottomConnection] }), resizeElementToDimensions(rectangle.id, "height", 10, true));
    expect(resizedHeight.document.elements.find((element) => element.id === rectangle.id)).toMatchObject({ position: { x: -9, y: -3 }, size: { width: 20, height: 10 } });
  });
  it("solves an ellipse with explicit circle constraints atomically", () => {
    const circle: EllipseElement = { type: "ellipse", id: elementId("parametric-circle"), layerId: rectangle.layerId, position: { x: 10, y: 20 }, size: { width: 20, height: 20 }, rotation: 0, style: rectangle.style, circleConstraints: [{ id: "cx", kind: "center-horizontal", value: 30 }, { id: "cy", kind: "center-vertical", value: 40 }, { id: "d", kind: "diameter", value: 50 }] };
    const state = dispatch(createEditor({ ...document, elements: [circle] }), solveCircle(circle.id));
    expect((state.document.elements[0] as EllipseElement).position).toEqual({ x: 5, y: 15 });
    expect((state.document.elements[0] as EllipseElement).size).toEqual({ width: 50, height: 50 });
    expect(state.undo).toHaveLength(1);
  });

  it("updates a circle radius through explicit center and rim references", () => {
    const circle: EllipseElement = { type: "ellipse", id: elementId("circle"), layerId: rectangle.layerId, position: { x: 10, y: 10 }, size: { width: 20, height: 20 }, rotation: 0, style: rectangle.style, circleConstraints: [{ id: "radius-driving-constraint", kind: "radius", value: 10, driving: true }] };
    const radius: DimensionElement = { type: "dimension", id: elementId("radius-driving"), layerId: rectangle.layerId, kind: "radius", driving: true, constraintId: "radius-driving-constraint", references: [{ kind: "node", elementId: circle.id, nodeIndex: 0, nodeId: "center" }, { kind: "node", elementId: circle.id, nodeIndex: 2, nodeId: "e" }], offset: { x: 8, y: 0 }, precision: 2, units: "mm", rotation: 0, style: rectangle.style };
    const state = dispatch(createEditor({ ...document, elements: [circle, radius] }), updateDimensionValue(radius.id, 15));
    expect((state.document.elements[0] as EllipseElement).size).toEqual({ width: 30, height: 30 });
    expect((state.document.elements[0] as EllipseElement).position).toEqual({ x: 5, y: 5 });
    expect(state.undo).toHaveLength(1);
  });

  it("updates a circle diameter through explicit center and rim references", () => {
        const circle: EllipseElement = { type: "ellipse", id: elementId("diameter-circle"), layerId: rectangle.layerId, position: { x: 10, y: 10 }, size: { width: 20, height: 20 }, rotation: 0, style: rectangle.style, circleConstraints: [{ id: "diameter-driving-constraint", kind: "diameter", value: 20, driving: true }] };
        const diameter: DimensionElement = { type: "dimension", id: elementId("diameter-driving"), layerId: rectangle.layerId, kind: "diameter", driving: true, constraintId: "diameter-driving-constraint", references: [{ kind: "node", elementId: circle.id, nodeIndex: 0, nodeId: "center" }, { kind: "node", elementId: circle.id, nodeIndex: 2, nodeId: "e" }], offset: { x: 8, y: 0 }, precision: 2, units: "mm", rotation: 0, style: rectangle.style };
        const state = dispatch(createEditor({ ...document, elements: [circle, diameter] }), updateDimensionValue(diameter.id, 30));
        expect((state.document.elements[0] as EllipseElement).size).toEqual({ width: 30, height: 30 });
        expect((state.document.elements[0] as EllipseElement).position).toEqual({ x: 5, y: 5 });
        expect(state.undo).toHaveLength(1);
      });

      it("updates and deletes circle constraints atomically", () => {
        const circle: EllipseElement = { type: "ellipse", id: elementId("circle-constraints"), layerId: rectangle.layerId, position: { x: 10, y: 10 }, size: { width: 20, height: 20 }, rotation: 0, style: rectangle.style, circleConstraints: [{ id: "radius", kind: "radius", value: 10 }] };
        const base = dispatch(createEditor({ ...document, elements: [circle] }), updateCircleConstraint(circle.id, "radius", { id: "radius", kind: "radius", value: 15 }));
        expect((base.document.elements[0] as EllipseElement).size.width).toBe(30);
        const removed = dispatch(base, deleteCircleConstraint(circle.id, "radius"));
        expect((removed.document.elements[0] as EllipseElement).circleConstraints).toEqual([]);
        expect(removed.undo).toHaveLength(2);
      });

      it("converts a circular dimension to a driving constraint", () => {
    const circle: EllipseElement = { type: "ellipse", id: elementId("circle-driving"), layerId: rectangle.layerId, position: { x: 10, y: 10 }, size: { width: 20, height: 20 }, rotation: 0, style: rectangle.style };
    const radius: DimensionElement = { type: "dimension", id: elementId("radius-driving-toggle"), layerId: rectangle.layerId, kind: "radius", references: [{ kind: "node", elementId: circle.id, nodeIndex: 0, nodeId: "center" }, { kind: "node", elementId: circle.id, nodeIndex: 2, nodeId: "e" }], offset: { x: 8, y: 0 }, precision: 2, units: "mm", rotation: 0, style: rectangle.style };
    const state = dispatch(createEditor({ ...document, elements: [circle, radius] }), setDimensionDriving(radius.id, true));
    expect(state.document.elements[1]).toMatchObject({ driving: true, constraintId: "dimension:" + radius.id });
    expect((state.document.elements[0] as EllipseElement).circleConstraints).toMatchObject([{ kind: "radius", value: 10, driving: true }]);
    const updated = dispatch(state, updateDimensionValue(radius.id, 15));
    expect((updated.document.elements[0] as EllipseElement).circleConstraints?.[0]?.value).toBe(15);
  });

  it("converts a sketch length dimension to a persistent driving constraint", () => {
    const sketch = createSketchLine(elementId("sketch-driving-length"), layerId("default"), rectangle.style, { x: 0, y: 0 }, { x: 10, y: 10 });
    const length: DimensionElement = { type: "dimension", id: elementId("sketch-driving-length-dimension"), layerId: sketch.layerId, kind: "aligned", references: [{ kind: "node", elementId: sketch.id, nodeIndex: 0, nodeId: sketch.nodes[0]!.id }, { kind: "node", elementId: sketch.id, nodeIndex: 1, nodeId: sketch.nodes[1]!.id }], offset: { x: 0, y: -8 }, precision: 2, units: "mm", rotation: 0, style: rectangle.style };
    const state = dispatch(createEditor({ ...document, elements: [sketch, length] }), setDimensionDriving(length.id, true));
    const constrained = state.document.elements[0] as SketchElement;
    expect(state.document.elements[1]).toMatchObject({ driving: true, constraintId: "dimension:" + length.id });
    expect(constrained.constraints?.[0]).toMatchObject({ kind: "distance", value: Math.sqrt(200) });
    const updated = dispatch(state, updateDimensionValue(length.id, 20));
    const solved = updated.document.elements[0] as SketchElement;
    expect(solved.constraints?.[0]?.value).toBe(20);
    expect(Math.hypot(solved.nodes[1]!.point.x - solved.nodes[0]!.point.x, solved.nodes[1]!.point.y - solved.nodes[0]!.point.y)).toBeCloseTo(20);
  });

  it("converts a sketch angle dimension to a persistent driving constraint", () => {
    const sketch = createSketchLine(elementId("sketch-driving-angle"), layerId("default"), rectangle.style, { x: 0, y: 0 }, { x: 10, y: 10 });
    const angle: DimensionElement = { type: "dimension", id: elementId("sketch-driving-angle-dimension"), layerId: sketch.layerId, kind: "angular", references: [{ kind: "line", elementId: sketch.id, edgeIndex: 0 }, { kind: "line", elementId: sketch.id, edgeIndex: 0 }], offset: { x: 8, y: -8 }, precision: 2, units: "mm", rotation: 0, style: rectangle.style };
    const state = dispatch(createEditor({ ...document, elements: [sketch, angle] }), setDimensionDriving(angle.id, true));
    expect((state.document.elements[0] as SketchElement).constraints?.[0]).toMatchObject({ kind: "angle", value: 45 });
    const updated = dispatch(state, updateDimensionValue(angle.id, 30));
    const solved = updated.document.elements[0] as SketchElement;
    expect(solved.constraints?.[0]?.value).toBe(30);
    const first = solved.nodes[0]!.point; const second = solved.nodes[1]!.point;
    expect(Math.atan2(second.y - first.y, second.x - first.x) * 180 / Math.PI).toBeCloseTo(30);
  });

  it("drives an edited path through explicit node references", () => {
     const linked: DimensionElement = { ...dimension, id: elementId("path-dimension"), references: [{ kind: "node", elementId: path.id, nodeIndex: 0, nodeId: "a" }, { kind: "node", elementId: path.id, nodeIndex: 1, nodeId: "b" }] };
     const state = dispatch(createEditor({ ...document, elements: [path, linked] }), updateDimensionValue(linked.id, 25));
     expect((state.document.elements[0] as PathElement).nodes[1]?.anchor).toEqual({ x: 25, y: 0 });
     expect(state.undo).toHaveLength(1);
   });

   it("allows reference dimensions between nodes from different objects", () => {
     const sketch = createSketchLine(elementId("reference-sketch"), layerId("default"), rectangle.style, { x: 0, y: 0 }, { x: 10, y: 10 });
     const linked: DimensionElement = { type: "dimension", id: elementId("cross-object-dimension"), layerId: sketch.layerId, kind: "aligned", references: [{ kind: "node", elementId: sketch.id, nodeIndex: 0, nodeId: sketch.nodes[0]!.id }, { kind: "node", elementId: rectangle.id, nodeIndex: 0, nodeId: "nw" }], offset: { x: 0, y: -8 }, precision: 2, units: "mm", rotation: 0, style: rectangle.style };
     const state = dispatch(createEditor({ ...document, elements: [sketch, rectangle, linked] }), updateDimensionValue(linked.id, 20));
     expect(state.document.elements[0]).toEqual(sketch);
     const movedCorner = (state.document.elements[1] as RectangleElement).position;
     expect(Math.hypot(movedCorner.x - sketch.nodes[0]!.point.x, movedCorner.y - sketch.nodes[0]!.point.y)).toBeCloseTo(20);
     expect(state.document.elements).toHaveLength(3);
   });

   it("drives the real length of an angled line while preserving its direction", () => {
     const line: LineElement = { type: "line", id: elementId("angled-line"), layerId: layerId("default"), start: { x: 10, y: 10 }, end: { x: 20, y: 20 }, rotation: 0, style: rectangle.style };
     const linked: DimensionElement = { type: "dimension", id: elementId("angled-line-dimension"), layerId: line.layerId, kind: "aligned", references: [{ kind: "node", elementId: line.id, nodeIndex: 0, nodeId: "start" }, { kind: "node", elementId: line.id, nodeIndex: 1, nodeId: "end" }], offset: { x: 0, y: -8 }, precision: 2, units: "mm", rotation: 0, style: rectangle.style };
     const state = dispatch(createEditor({ ...document, elements: [line, linked] }), updateDimensionValue(linked.id, 20));
     expect((state.document.elements[0] as LineElement).start).toEqual(line.start);
     expect((state.document.elements[0] as LineElement).end).toEqual({ x: 10 + Math.sqrt(200), y: 10 + Math.sqrt(200) });
     expect(state.undo).toHaveLength(1);
   });

it("updates an angled sketch line dimension without requiring a separate constraint", () => {
     const sketch = createSketchLine(elementId("sketch-line-dimension"), layerId("default"), rectangle.style, { x: 0, y: 0 }, { x: 10, y: 10 });
     const linked: DimensionElement = { type: "dimension", id: elementId("sketch-line-dimension-value"), layerId: sketch.layerId, kind: "aligned", references: [{ kind: "node", elementId: sketch.id, nodeIndex: 0, nodeId: sketch.nodes[0]!.id }, { kind: "node", elementId: sketch.id, nodeIndex: 1, nodeId: sketch.nodes[1]!.id }], offset: { x: 0, y: -8 }, precision: 2, units: "mm", rotation: 0, style: rectangle.style };
     const state = dispatch(createEditor({ ...document, elements: [sketch, linked] }), updateDimensionValue(linked.id, 20));
     const updated = state.document.elements[0] as SketchElement;
     expect(Math.hypot(updated.nodes[1]!.point.x - updated.nodes[0]!.point.x, updated.nodes[1]!.point.y - updated.nodes[0]!.point.y)).toBeCloseTo(20);
   });

it("preserves a horizontal sketch relation while changing an angular dimension", () => {
     const sketch: SketchElement = { type: "sketch", id: elementId("constrained-angular-sketch"), layerId: layerId("default"), nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 10, y: 0 } }, { id: "c", point: { x: 10, y: 10 } }], edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }, { id: "bc", startNodeId: "b", endNodeId: "c" }], constraints: [{ id: "horizontal", kind: "horizontal", references: [{ elementId: elementId("constrained-angular-sketch"), nodeId: "a" }, { elementId: elementId("constrained-angular-sketch"), nodeId: "b" }] }], style: rectangle.style };
     const angle: DimensionElement = { type: "dimension", id: elementId("constrained-angular-dimension"), layerId: sketch.layerId, kind: "angular", references: [{ kind: "line", elementId: sketch.id, edgeIndex: 0 }, { kind: "line", elementId: sketch.id, edgeIndex: 1 }], offset: { x: 5, y: -5 }, precision: 2, units: "mm", rotation: 0, style: rectangle.style };
     const state = dispatch(createEditor({ ...document, elements: [sketch, angle] }), updateDimensionValue(angle.id, 30));
     const updated = state.document.elements[0] as SketchElement;
     expect(updated.nodes[0]?.point.y).toBe(0);
     expect(updated.nodes[1]?.point.y).toBe(0);
   });

it("drives the angle between two connected lines while preserving the second length", () => {
     const first: LineElement = { type: "line", id: elementId("first-angle-line"), layerId: layerId("default"), start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style: rectangle.style };
     const second: LineElement = { type: "line", id: elementId("second-angle-line"), layerId: layerId("default"), start: { x: 0, y: 0 }, end: { x: 0, y: 10 }, rotation: 0, style: rectangle.style };
     const linked: DimensionElement = { type: "dimension", id: elementId("two-line-angle-dimension"), layerId: first.layerId, kind: "angular", references: [{ kind: "line", elementId: first.id }, { kind: "line", elementId: second.id }], offset: { x: 5, y: -5 }, precision: 2, units: "mm", rotation: 0, style: rectangle.style };
     const state = dispatch(createEditor({ ...document, elements: [first, second, linked] }), updateDimensionValue(linked.id, 30));
     const updated = state.document.elements.find((element): element is LineElement => element.id === second.id)!;
     expect(updated.start).toEqual(second.start);
     expect(Math.hypot(updated.end.x - updated.start.x, updated.end.y - updated.start.y)).toBeCloseTo(10);
     expect(Math.atan2(updated.end.y - updated.start.y, updated.end.x - updated.start.x) * 180 / Math.PI).toBeCloseTo(30);
   });

it("drives an individual line angle while preserving its length", () => {
     const line: LineElement = { type: "line", id: elementId("line-angle"), layerId: layerId("default"), start: { x: 0, y: 0 }, end: { x: 10, y: 10 }, rotation: 0, style: rectangle.style };
     const linked: DimensionElement = { type: "dimension", id: elementId("line-angle-dimension"), layerId: line.layerId, kind: "angular", references: [{ kind: "line", elementId: line.id }, { kind: "line", elementId: line.id }], offset: { x: 8, y: -8 }, precision: 2, units: "mm", rotation: 0, style: rectangle.style };
     const state = dispatch(createEditor({ ...document, elements: [line, linked] }), updateDimensionValue(linked.id, 30));
     const updated = state.document.elements[0] as LineElement;
     expect(Math.hypot(updated.end.x - updated.start.x, updated.end.y - updated.start.y)).toBeCloseTo(Math.sqrt(200));
     expect(Math.atan2(updated.end.y - updated.start.y, updated.end.x - updated.start.x) * 180 / Math.PI).toBeCloseTo(30);
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
  it("updates an explicitly linked sketch driving dimension", () => {
     const sketch = createSketchLine(elementId("driving-sketch"), layerId("default"), rectangle.style, { x: 0, y: 0 }, { x: 10, y: 0 });
     const first = sketch.nodes[0]!; const second = sketch.nodes[1]!;
     const constraint = { id: "distance", kind: "distance-horizontal" as const, references: [{ elementId: sketch.id, nodeId: first.id }, { elementId: sketch.id, nodeId: second.id }] as const, value: 10 };
     const driving = { type: "dimension" as const, id: elementId("driving-dimension"), layerId: "default" as typeof rectangle.layerId, kind: "horizontal" as const, references: [{ kind: "node" as const, elementId: sketch.id, nodeIndex: 0, nodeId: first.id }, { kind: "node" as const, elementId: sketch.id, nodeIndex: 1, nodeId: second.id }] as const, offset: { x: 0, y: -8 }, precision: 2, units: "mm" as const, rotation: 0 as const, style: rectangle.style, driving: true, constraintId: constraint.id };
     const initial = createEditor({ ...document, elements: [{ ...sketch, constraints: [constraint] }, driving] });
     const updated = dispatch(initial, updateDimensionValue(driving.id, 20));
     expect((updated.document.elements[0] as SketchElement).nodes[1]?.point).toEqual({ x: 20, y: 0 });
     expect(updated.undo).toHaveLength(1);
   });
   it("re-solves sketch constraints after moving a node", () => {
     const sketch = createSketchLine(elementId("move-constrained"), layerId("default"), rectangle.style, { x: 0, y: 0 }, { x: 10, y: 4 });
     const first = sketch.nodes[0]!; const second = sketch.nodes[1]!;
     const constrained = { ...sketch, constraints: [{ id: "horizontal", kind: "horizontal" as const, references: [{ elementId: sketch.id, nodeId: first.id }, { elementId: sketch.id, nodeId: second.id }] as const }] };
     const state = dispatch(createEditor({ ...document, elements: [constrained] }), updateElementNode(sketch.id, 1, { x: 20, y: 15 }));
     expect((state.document.elements[0] as SketchElement).nodes[1]?.point).toEqual({ x: 20, y: 0 });
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
  it("keeps symmetric path handles opposite around their shared anchor", () => {
    const symmetric: PathElement = {
      ...path,
      nodes: [{ id: "a", anchor: { x: 0, y: 0 }, join: "symmetric" }, { id: "b", anchor: { x: 10, y: 0 }, join: "corner" }, { id: "c", anchor: { x: 0, y: 10 }, join: "corner" }],
      segments: [
        { id: "fixture-segment-14", type: "cubicBezier", startNodeId: "a", endNodeId: "b", control1: { x: 2, y: 0 }, control2: { x: 8, y: 0 } },
        { id: "fixture-segment-15", type: "cubicBezier", startNodeId: "b", endNodeId: "c", control1: { x: 8, y: 4 }, control2: { x: 2, y: 8 } },
        { id: "fixture-segment-16", type: "cubicBezier", startNodeId: "c", endNodeId: "a", control1: { x: 0, y: 8 }, control2: { x: 0, y: 2 } },
      ],
      closed: true,
    };
    const state = dispatch(createEditor({ ...document, elements: [symmetric] }), movePathHandle(symmetric.id, 0, "control1", { x: 3, y: 4 }));
    const result = state.document.elements[0];
    expect(result?.type === "path" ? result.segments[2] : undefined).toMatchObject({ control2: { x: -3, y: -4 } });
  });
  it("keeps symmetric glyph handles opposite around their shared anchor", () => {
    const symmetricGlyph = { ...glyph, contours: glyph.contours.map((contour) => ({ ...contour, nodes: contour.nodes.map((node, index) => index === 0 ? { ...node, join: "symmetric" as const } : node) })) };
    const state = dispatch(createEditor({ ...document, elements: [symmetricGlyph] }), movePathHandle(glyph.id, 0, "control1", { x: 4, y: 3 }, 0));
    const result = state.document.elements[0];
    expect(result?.type).toBe("glyph");
    if (result?.type === "glyph") expect(result.contours[0]?.segments[3]).toMatchObject({ control2: { x: -4, y: -3 } });
  });
  it("reverses a path while preserving stable segment identities", () => {
    const reversible: PathElement = { ...path, nodes: [...path.nodes, { id: "c", anchor: { x: 20, y: 0 }, join: "corner" }], segments: [path.segments[0]!, { id: "reverse-bc", type: "line", startNodeId: "b", endNodeId: "c" }] };
    const state = dispatch(createEditor({ ...document, elements: [reversible] }), reversePath(reversible.id));
    const reversed = state.document.elements[0];
    expect(reversed?.type === "path" ? reversed.segments.map((segment) => segment.id) : []).toEqual(["reverse-bc", path.segments[0]!.id]);
    expect(reversed).toMatchObject({ nodes: [{ id: "c" }, { id: "b" }, { id: "a" }], segments: [{ startNodeId: "c", endNodeId: "b" }, { startNodeId: "b", endNodeId: "a" }] });
    expect(undo(state).document.elements).toEqual([reversible]);
  });
  it("closes and reopens a path as independent undoable commands", () => {
    let state = dispatch(createEditor({ ...document, elements: [path] }), closePath(path.id));
    expect(state.document.elements[0]).toMatchObject({ closed: true, segments: [{ id: path.segments[0]!.id, type: "cubicBezier" }, { type: "line", startNodeId: "b", endNodeId: "a" }] });
    expect(state.undo).toHaveLength(1);
    state = dispatch(state, openPath(path.id));
    expect(state.document.elements[0]).toMatchObject({ closed: false, segments: [{ type: "cubicBezier" }] });
    expect(state.undo).toHaveLength(2);
    expect(redo(undo(state)).document.elements).toEqual(state.document.elements);
  });
  it("deletes an open interior anchor and preserves neighboring cubic endpoint controls", () => {
    const three: PathElement = { ...path, nodes: [...path.nodes, { id: "c", anchor: { x: 20, y: 0 }, join: "corner" }], segments: [...path.segments, { id: "fixture-segment-19", type: "cubicBezier", startNodeId: "b", endNodeId: "c", control1: { x: 12, y: -4 }, control2: { x: 18, y: -4 } }] };
    const state = dispatch(createEditor({ ...document, elements: [three] }), deletePathNodes(three.id, ["b"]));
    expect(state.document.elements[0]).toMatchObject({ nodes: [{ id: "a" }, { id: "c" }], segments: [{ type: "cubicBezier", startNodeId: "a", endNodeId: "c", control1: { x: 2, y: 4 }, control2: { x: 18, y: -4 } }] });
    const rebuilt = state.document.elements[0];
    if (rebuilt?.type === "path") expect(three.segments.some((segment) => segment.id === rebuilt.segments[0]?.id)).toBe(false);
    expect(state.undo).toHaveLength(1);
    expect(undo(state).document.elements).toEqual([three]);
  });
  it("deletes a closed anchor across the closing join and rejects minimums atomically", () => {
    const closed: PathElement = { ...path, closed: true, nodes: [...path.nodes, { id: "c", anchor: { x: 5, y: 10 }, join: "smooth" }, { id: "d", anchor: { x: -5, y: 10 }, join: "corner" }], segments: [{ id: "fixture-segment-21", type: "line", startNodeId: "a", endNodeId: "b" }, { id: "fixture-segment-22", type: "line", startNodeId: "b", endNodeId: "c" }, { id: "fixture-segment-23", type: "line", startNodeId: "c", endNodeId: "d" }, { id: "fixture-segment-24", type: "cubicBezier", startNodeId: "d", endNodeId: "a", control1: { x: -4, y: 8 }, control2: { x: -1, y: 2 } }] };
    const state = dispatch(createEditor({ ...document, elements: [closed] }), deletePathNodes(closed.id, ["a"]));
    expect(state.document.elements[0]).toMatchObject({ nodes: [{ id: "b" }, { id: "c" }, { id: "d" }], segments: [{ id: "fixture-segment-22", type: "line", startNodeId: "b", endNodeId: "c" }, { id: "fixture-segment-23", type: "line", startNodeId: "c", endNodeId: "d" }, { type: "cubicBezier", startNodeId: "d", endNodeId: "b", control1: { x: -4, y: 8 }, control2: { x: 5, y: 3.333333333333333 } }] });
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
    const linePath: PathElement = { ...path, id: elementId("line-path"), nodes: [{ id: "a", anchor: { x: 0, y: 0 }, join: "smooth" }, { id: "b", anchor: { x: 10, y: 0 }, join: "symmetric" }], segments: [{ id: "fixture-segment-28", type: "line", startNodeId: "a", endNodeId: "b" }, { id: "fixture-segment-29", type: "line", startNodeId: "b", endNodeId: "a" }], closed: true };
    let state = dispatch(createEditor({ ...document, elements: [linePath] }), splitPathSegment(linePath.id, 0, "mid-line"));
    expect(state.document.elements[0]).toMatchObject({ type: "path", nodes: [{ id: "a", join: "smooth" }, { id: "mid-line", anchor: { x: 5, y: 0 }, join: "corner" }, { id: "b", join: "symmetric" }], segments: [{ type: "line", startNodeId: "a", endNodeId: "mid-line" }, { type: "line", startNodeId: "mid-line", endNodeId: "b" }, { id: "fixture-segment-29", type: "line", startNodeId: "b", endNodeId: "a" }], closed: true });
    const splitLine = state.document.elements[0];
    if (splitLine?.type === "path") expect(splitLine.segments.slice(0, 2).every((segment) => segment.id !== "fixture-segment-28")).toBe(true);
    expect(state.undo).toHaveLength(1);
    expect(redo(undo(state)).document.elements).toEqual(state.document.elements);

    state = dispatch(createEditor({ ...document, elements: [path] }), splitPathSegment(path.id, 0, "mid-cubic"));
    expect(state.document.elements[0]).toMatchObject({ segments: [{ type: "cubicBezier", endNodeId: "mid-cubic" }, { type: "cubicBezier", startNodeId: "mid-cubic", endNodeId: "b" }] });
    const splitCubic = state.document.elements[0];
    if (splitCubic?.type === "path") expect(splitCubic.segments.every((segment) => segment.id !== path.segments[0]!.id)).toBe(true);
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
  it("resizes grouped property dimensions around the selection center in one command", () => {
    const second = { ...rectangle, id: elementId("r2"), position: { x: 20, y: 2 } };
    let state = select(createEditor({ ...document, elements: [rectangle, second] }), [rectangle.id, second.id]);
    state = dispatch(state, resizeElementsToDimensions(state.selection, { width: 30, height: 10 }));
    const resized = boundsOfElements(state.document.elements.filter((element) => state.selection.includes(element.id)));
    expect(resized.x).toBeCloseTo(0.5);
    expect(resized.y).toBeCloseTo(-0.5);
    expect(resized.width).toBeCloseTo(30);
    expect(resized.height).toBeCloseTo(10);
    expect(resized.x + resized.width / 2).toBeCloseTo(15.5);
    expect(resized.y + resized.height / 2).toBeCloseTo(4.5);
    expect(state.undo).toHaveLength(1);
    expect(undo(state).document.elements).toEqual([rectangle, second]);
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
    if (result?.type === "glyph") {
      expect(result.contours.every((contour) => contour.segments.every((segment) => segment.type === "cubicBezier"))).toBe(true);
      expect(result.contours.reduce((count, contour) => count + contour.nodes.length, 0)).toBeLessThan(24);
    }
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
