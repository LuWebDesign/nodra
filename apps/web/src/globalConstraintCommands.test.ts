import { describe, expect, it } from "vitest";
import { createDocument, elementId, layerId, type DocumentConstraint, type SketchElement } from "@nodra/domain";
import { createEditor, createElement, createSketchLine, dispatch, moveElement, redo, undo, type EditorCommand } from "@nodra/editor-core";
import { constraintResidualsForDocument } from "@nodra/constraints";
import {
  addSolvedDocumentConstraint,
  createGeometryWithDocumentConstraints,
  documentConstraintDiagnosticId,
  supportsGlobalConstraintKind,
  updateSolvedDocumentConstraint,
} from "./globalConstraintCommands.js";

const layer = { id: layerId("default"), name: "Default", visible: true, order: 0 };
const style = { stroke: "#000", strokeWidth: 1 };
const sketch = (id: string, y: number, x = 0): SketchElement => ({
  type: "sketch",
  id: elementId(id),
  layerId: layer.id,
  nodes: [
    { id: `${id}-a`, point: { x, y } },
    { id: `${id}-b`, point: { x: x + 10, y } },
  ],
  edges: [{ id: `${id}-edge`, startNodeId: `${id}-a`, endNodeId: `${id}-b` }],
  style,
});

const distanceConstraint = (first: SketchElement, second: SketchElement, value: number): DocumentConstraint => ({
  id: "global-distance",
  kind: "distance-horizontal",
  value,
  references: [
    { elementId: first.id, nodeId: first.nodes[1]!.id },
    { elementId: second.id, nodeId: second.nodes[0]!.id },
  ],
});

describe("global constraint commands", () => {
  it("adds, solves, commits, and undoes a cross-sketch distance atomically", () => {
    const first = sketch("first", 0);
    const second = sketch("second", 20);
    const initial = createEditor({ ...createDocument("global", [layer]), elements: [first, second] });
    const constraint = distanceConstraint(first, second, 40);

    const committed = dispatch(initial, addSolvedDocumentConstraint(constraint));

    expect(committed.document.constraints).toEqual([constraint]);
    expect((committed.document.elements[1] as SketchElement).nodes[0]!.point.x).toBe(-30);
    expect(committed.document.revision).toBe(1);
    expect(committed.undo).toHaveLength(1);
    expect(undo(committed).document).toEqual(initial.document);
  });

  it("updates solved geometry and restores the previous value with undo", () => {
    const first = sketch("first", 0);
    const second = sketch("second", 20);
    const initial = createEditor({ ...createDocument("global", [layer]), elements: [first, second] });
    const added = dispatch(initial, addSolvedDocumentConstraint(distanceConstraint(first, second, 40)));

    const updated = dispatch(added, updateSolvedDocumentConstraint(distanceConstraint(first, second, 60)));

    expect(updated.document.constraints?.[0]?.value).toBe(60);
    expect((updated.document.elements[1] as SketchElement).nodes[0]!.point.x).toBe(-50);
    const restored = undo(updated);
    expect(restored.document.constraints?.[0]?.value).toBe(40);
    expect((restored.document.elements[1] as SketchElement).nodes[0]!.point.x).toBe(-30);
  });

  it("rejects an unsatisfied global distance without changing history", () => {
    const first = sketch("first", 0);
    const second = sketch("second", 20);
    const coincidentXSecond = { ...second, nodes: second.nodes.map((node) => ({ ...node, point: { ...node.point, x: 10 } })) };
    const initial = createEditor({ ...createDocument("global", [layer]), elements: [first, coincidentXSecond] });

    const rejected = dispatch(initial, addSolvedDocumentConstraint(distanceConstraint(first, coincidentXSecond, 40)));

    expect(rejected).toBe(initial);
    expect(rejected.document.constraints).toBeUndefined();
    expect(rejected.undo).toHaveLength(0);
  });

  it("rejects an incompatible update and preserves the prior transaction", () => {
    const first = sketch("first", 0);
    const second = sketch("second", 0);
    const initial = createEditor({ ...createDocument("global", [layer]), elements: [first, second] });
    const constraint = distanceConstraint(first, second, 40);
    const added = dispatch(initial, addSolvedDocumentConstraint(constraint));

    const rejected = dispatch(added, updateSolvedDocumentConstraint({ ...constraint, kind: "distance-vertical" }));

    expect(rejected).toBe(added);
    expect(rejected.document.constraints?.[0]).toEqual(constraint);
    expect(rejected.undo).toHaveLength(1);
    expect(dispatch(added, updateSolvedDocumentConstraint(constraint))).toBe(added);
  });

  it("solves a global relation while preserving a compatible local constraint", () => {
    const first = sketch("first", 0);
    const secondBase = sketch("second", 0, 30);
    const second: SketchElement = {
      ...secondBase,
      nodes: [secondBase.nodes[0]!, { ...secondBase.nodes[1]!, point: { x: 30, y: 10 } }],
      constraints: [{
        id: "second-vertical",
        kind: "vertical",
        references: [
          { elementId: secondBase.id, nodeId: secondBase.nodes[0]!.id },
          { elementId: secondBase.id, nodeId: secondBase.nodes[1]!.id },
        ],
      }],
    };
    const initial = createEditor({ ...createDocument("global", [layer]), elements: [first, second] });

    const committed = dispatch(initial, addSolvedDocumentConstraint(distanceConstraint(first, second, 40)));

    expect(committed.document.constraints?.[0]?.id).toBe("global-distance");
    expect((committed.document.elements[1] as SketchElement).nodes.map((node) => node.point.x)).toEqual([50, 50]);
    expect(undo(committed).document).toEqual(initial.document);
  });

  it("rejects an incompatible local/global cycle without history", () => {
    const first = sketch("first", 0);
    const secondBase = sketch("second", 0, 30);
    const second: SketchElement = { ...secondBase, constraints: [{ id: "second-fixed", kind: "fixed", references: [{ elementId: secondBase.id, nodeId: secondBase.nodes[0]!.id }] }] };
    const initial = createEditor({ ...createDocument("global", [layer]), elements: [first, second] });

    const rejected = dispatch(initial, addSolvedDocumentConstraint(distanceConstraint(first, second, 40)));

    expect(rejected).toBe(initial);
    expect(rejected.document.constraints).toBeUndefined();
    expect(rejected.undo).toHaveLength(0);
  });

  it("rejects a locally overdefined mixed component even when residuals are satisfied", () => {
    const first = sketch("first", 0);
    const secondBase = sketch("second", 0, 30);
    const references = [
      { elementId: secondBase.id, nodeId: secondBase.nodes[0]!.id },
      { elementId: secondBase.id, nodeId: secondBase.nodes[1]!.id },
    ] as const;
    const second: SketchElement = { ...secondBase, constraints: [{ id: "horizontal-1", kind: "horizontal", references }, { id: "horizontal-2", kind: "horizontal", references }] };
    const initial = createEditor({ ...createDocument("global", [layer]), elements: [first, second] });

    const rejected = dispatch(initial, addSolvedDocumentConstraint(distanceConstraint(first, second, 20)));

    expect(rejected).toBe(initial);
    expect(rejected.undo).toHaveLength(0);
  });

  it("does not solve an unrelated global component", () => {
    const first = sketch("first", 0);
    const second = sketch("second", 20, 30);
    const third = sketch("third", 100, 100);
    const fourth = sketch("fourth", 120, 130);
    const unrelated: DocumentConstraint = {
      ...distanceConstraint(third, fourth, 80),
      id: "unrelated-distance",
    };
    const initial = createEditor({ ...createDocument("global", [layer]), elements: [first, second, third, fourth], constraints: [unrelated] });

    const committed = dispatch(initial, addSolvedDocumentConstraint(distanceConstraint(first, second, 40)));

    expect(committed).not.toBe(initial);
    expect((committed.document.elements[3] as SketchElement).nodes[0]!.point.x).toBe(130);
  });

  it.each([
    ["parallel", { x: Math.sqrt(200), y: 20 }],
    ["perpendicular", { x: 0, y: 20 + Math.sqrt(200) }],
    ["equal", { x: Math.sqrt(50), y: 20 + Math.sqrt(50) }],
  ] as const)("adds and solves a supported global %s relation", (kind, expected) => {
    const first = sketch("first", 0);
    const secondBase = sketch("second", 20);
    const second: SketchElement = { ...secondBase, nodes: [secondBase.nodes[0]!, { ...secondBase.nodes[1]!, point: { x: 10, y: 30 } }] };
    const constraint: DocumentConstraint = {
      id: `global-${kind}`,
      kind,
      references: [
        { elementId: first.id, nodeId: first.nodes[0]!.id },
        { elementId: first.id, nodeId: first.nodes[1]!.id },
        { elementId: second.id, nodeId: second.nodes[0]!.id },
        { elementId: second.id, nodeId: second.nodes[1]!.id },
      ],
    };
    const initial = createEditor({ ...createDocument("global", [layer]), elements: [first, second] });

    const committed = dispatch(initial, addSolvedDocumentConstraint(constraint));

    expect(committed.document.constraints).toEqual([{ id: `global-${kind}`, kind, references: [{ elementId: first.id, edgeId: first.edges[0]!.id }, { elementId: second.id, edgeId: second.edges[0]!.id }] }]);
    const point = (committed.document.elements[1] as SketchElement).nodes[1]!.point;
    expect(point.x).toBeCloseTo(expected.x, 8);
    expect(point.y).toBeCloseTo(expected.y, 8);
    expect(committed.undo).toHaveLength(1);
  });

  it("adds and solves a global angle relation", () => {
    const first = sketch("first", 0);
    const second = sketch("second", 20, 30);
    const angle: DocumentConstraint = {
      id: "global-angle",
      kind: "angle",
      value: 90,
      references: [
        { elementId: first.id, nodeId: first.nodes[1]!.id },
        { elementId: second.id, nodeId: second.nodes[0]!.id },
      ],
    };
    const initial = createEditor({ ...createDocument("global", [layer]), elements: [first, second] });

    const committed = dispatch(initial, addSolvedDocumentConstraint(angle));

    const firstPoint = (committed.document.elements[0] as SketchElement).nodes[1]!.point;
    const secondPoint = (committed.document.elements[1] as SketchElement).nodes[0]!.point;
    expect(secondPoint.x).toBeCloseTo(firstPoint.x, 8);
    expect(secondPoint.y).toBeGreaterThan(firstPoint.y);
    expect(committed.document.constraints).toEqual([angle]);
  });

      it("keeps diagnostics, references, and redo state valid after a kernel commit", () => {
        const first = sketch("first", 0);
        const second = sketch("second", 20);
        const initial = createEditor({ ...createDocument("global", [layer]), elements: [first, second] });
        const constraint = distanceConstraint(first, second, 40);
        const committed = dispatch(initial, addSolvedDocumentConstraint(constraint));

        expect(constraintResidualsForDocument(committed.document)).toEqual([{ constraintId: '["document",null,"global-distance"]', residual: 0, satisfied: true, supported: true }]);
        expect(redo(undo(committed)).document).toEqual(committed.document);
      });

      it("adds a native Line endpoint midpoint relation atomically with a move and undoes both", () => {
    const dependent = { type: "line" as const, id: elementId("dependent-line"), layerId: layer.id, start: { x: 1, y: 0 }, end: { x: 1, y: 10 }, rotation: 0, style };
    const source = { ...dependent, id: elementId("source-line"), start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    const initial = createEditor({ ...createDocument("atomic-line-endpoint-midpoint", [layer]), elements: [dependent, source] });
    const relation: DocumentConstraint = { id: "line-midpoint", kind: "line-endpoint-midpoint", references: [{ elementId: dependent.id, nodeId: "start", endpoint: "start" }], source: { kind: "line", elementId: source.id } };
    const command = createGeometryWithDocumentConstraints(moveElement(dependent.id, { x: 4, y: 0 }), () => [relation]);

    const committed = dispatch(initial, command);

    expect(committed.document.constraints).toEqual([relation]);
    expect(committed.document.elements.find((element) => element.id === dependent.id)).toMatchObject({ start: { x: 5, y: 0 }, end: { x: 5, y: 10 } });
    expect(committed.document.revision).toBe(1);
    expect(committed.undo).toHaveLength(1);
    expect(undo(committed).document).toEqual(initial.document);
  });

  it("atomically projects a Line endpoint onto a stable Path segment midpoint", () => {
    const dependent = { type: "line" as const, id: elementId("path-dependent-line"), layerId: layer.id, start: { x: 1, y: 0 }, end: { x: 1, y: 10 }, rotation: 0, style };
    const path = { type: "path" as const, id: elementId("midpoint-path"), layerId: layer.id, nodes: [{ id: "a", anchor: { x: 0, y: 0 }, join: "corner" as const }, { id: "b", anchor: { x: 10, y: 0 }, join: "corner" as const }], segments: [{ id: "stable-segment", type: "line" as const, startNodeId: "a", endNodeId: "b" }], closed: false, style };
    const initial = createEditor({ ...createDocument("path-endpoint-midpoint", [layer]), elements: [dependent, path] });
    const relation: DocumentConstraint = { id: "path-endpoint-midpoint", kind: "line-endpoint-midpoint", references: [{ elementId: dependent.id, nodeId: "start", endpoint: "start" }], source: { kind: "path-segment", elementId: path.id, segmentId: "stable-segment" } };
    const committed = dispatch(initial, createGeometryWithDocumentConstraints(moveElement(dependent.id, { x: 4, y: 0 }), () => [relation]));
    expect(committed.document.constraints).toEqual([relation]);
    expect(committed.document.elements.find((element) => element.id === dependent.id)).toMatchObject({ start: { x: 5, y: 0 }, end: { x: 5, y: 10 } });
    expect(committed.undo).toHaveLength(1);
    expect(undo(committed).document).toEqual(initial.document);
  });

  it("accepts and solves a global midpoint driven by a native line", () => {
    const dependent = sketch("dependent", 4, 3);
    const line = { type: "line" as const, id: elementId("native-source"), layerId: layer.id, start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style };
    const constraint: DocumentConstraint = { id: "native-midpoint", kind: "midpoint", references: [{ elementId: dependent.id, nodeId: dependent.nodes[0]!.id }], source: { kind: "line", elementId: line.id } };
    const initial = createEditor({ ...createDocument("native-midpoint", [layer]), elements: [dependent, line] });

    expect(supportsGlobalConstraintKind("midpoint")).toBe(true);
    const committed = dispatch(initial, addSolvedDocumentConstraint(constraint));

    expect(committed.document.constraints).toEqual([constraint]);
    expect((committed.document.elements[0] as SketchElement).nodes[0]!.point).toEqual({ x: 5, y: 0 });
    expect(committed.undo).toHaveLength(1);
    expect(undo(committed).document).toEqual(initial.document);
  });
  it("atomically creates geometry and a native-line midpoint relation in one history transaction", () => {
    const dependent = sketch("dependent", 4);
    const line = { type: "line" as const, id: elementId("source-line"), layerId: layer.id, start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style };
    const initial = createEditor({ ...createDocument("atomic-midpoint", [layer]), elements: [dependent, line] });
    const constraint: DocumentConstraint = { id: "created-midpoint", kind: "midpoint", references: [{ elementId: dependent.id, nodeId: dependent.nodes[0]!.id }], source: { kind: "line", elementId: line.id } };
    const command = createGeometryWithDocumentConstraints(createElement(createSketchLine(elementId("new-sketch"), layer.id, style, { x: 2, y: 3 }, { x: 5, y: 3 }, { kind: "none" })), () => [constraint]);

    const committed = dispatch(initial, command);

    expect(committed.document.constraints).toEqual([constraint]);
    expect(committed.document.revision).toBe(1);
    expect(committed.undo).toHaveLength(1);
    expect(undo(committed).document).toEqual(initial.document);
    expect(redo(undo(committed)).document).toEqual(committed.document);
    const committedLine = committed.document.elements.find((element) => element.id === line.id);
    expect(committedLine).toMatchObject({ start: line.start, end: line.end });
  });

  it.each(["hidden", "missing", "invalid"] as const)("leaves geometry and revision unchanged for a %s source", (caseName) => {
    const dependent = sketch("dependent", 4);
    const hiddenLayer = { ...layer, visible: false };
    const line = { type: "line" as const, id: elementId("source-line"), layerId: layer.id, start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style };
    const initial = createEditor({ ...createDocument("atomic-midpoint", [caseName === "hidden" ? hiddenLayer : layer]), elements: [dependent, line] });
    const sourceId = caseName === "missing" ? elementId("missing-line") : line.id;
    const constraint: DocumentConstraint = { id: "created-midpoint", kind: "midpoint", references: [{ elementId: dependent.id, nodeId: caseName === "invalid" ? "missing-node" : dependent.nodes[0]!.id }], source: { kind: "line", elementId: sourceId } };
    const command = createGeometryWithDocumentConstraints(createElement(createSketchLine(elementId("new-sketch"), layer.id, style, { x: 2, y: 3 }, { x: 5, y: 3 }, { kind: "none" })), () => [constraint]);

    const rejected = dispatch(initial, command);

    expect(rejected).toBe(initial);
    expect(rejected.document.revision).toBe(initial.document.revision);
    expect(rejected.document.elements).toEqual(initial.document.elements);
  });

  it.each(["missing", "hidden"] as const)("rejects a %s cross-sketch edge reference atomically", (caseName) => {
    const dependent = sketch("dependent", 4);
    const sourceSketch = sketch("source-sketch", 0);
    const hiddenLayer = { ...layer, id: layerId("hidden"), visible: false };
    const source = { ...sourceSketch, layerId: caseName === "hidden" ? hiddenLayer.id : layer.id };
    const initial = createEditor({ ...createDocument("cross-sketch-midpoint", caseName === "hidden" ? [layer, hiddenLayer] : [layer]), elements: [dependent, source] });
    const edgeId = caseName === "missing" ? "missing-edge" : source.edges[0]!.id;
    const relation: DocumentConstraint = { id: "cross-midpoint", kind: "midpoint", references: [{ elementId: dependent.id, nodeId: dependent.nodes[0]!.id }, { elementId: source.id, edgeId }] };
    const geometry = createElement(createSketchLine(elementId("new-sketch"), layer.id, style, { x: 2, y: 3 }, { x: 5, y: 3 }, { kind: "none" }));

    const rejected = dispatch(initial, createGeometryWithDocumentConstraints(geometry, () => [relation]));

    expect(rejected).toBe(initial);
    expect(rejected.document.revision).toBe(initial.document.revision);
    expect(rejected.document.elements).toEqual(initial.document.elements);
  });

  it("preserves no-op geometry dispatch state and rejects derived constraints on a no-op", () => {
    const initial = createEditor({ ...createDocument("atomic-midpoint", [layer]), elements: [] });
    const noop: EditorCommand = { name: "geometry-noop", apply: (document) => ({ success: true, document }) };
    const noConstraint = dispatch(initial, createGeometryWithDocumentConstraints(noop, () => []));
    expect(noConstraint).toBe(initial);
    expect(noConstraint.document.revision).toBe(initial.document.revision);
    expect(noConstraint.undo).toHaveLength(0);

    const dependent = sketch("dependent", 4);
    const source = sketch("source", 0);
    const withGeometry = createEditor({ ...createDocument("atomic-midpoint", [layer]), elements: [dependent, source] });
    const relation: DocumentConstraint = { id: "noop-midpoint", kind: "midpoint", references: [{ elementId: dependent.id, nodeId: dependent.nodes[0]!.id }, { elementId: source.id, edgeId: source.edges[0]!.id }] };
    const rejected = dispatch(withGeometry, createGeometryWithDocumentConstraints(noop, () => [relation]));
    expect(rejected).toBe(withGeometry);
  });

  it("rejects a conflicting second relation without retaining geometry or the first relation", () => {
    const dependent = sketch("dependent", 4);
    const line = { type: "line" as const, id: elementId("source-line"), layerId: layer.id, start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style };
    const initial = createEditor({ ...createDocument("atomic-midpoint", [layer]), elements: [dependent, line] });
    const first: DocumentConstraint = { id: "first-midpoint", kind: "midpoint", references: [{ elementId: dependent.id, nodeId: dependent.nodes[0]!.id }], source: { kind: "line", elementId: line.id } };
    const second: DocumentConstraint = { ...first, id: "second-midpoint", source: { kind: "line", elementId: elementId("missing-line") } };
    const command = createGeometryWithDocumentConstraints(createElement(createSketchLine(elementId("new-sketch"), layer.id, style, { x: 2, y: 3 }, { x: 5, y: 3 }, { kind: "none" })), () => [first, second]);

    const rejected = dispatch(initial, command);

    expect(rejected).toBe(initial);
    expect(rejected.document.constraints).toBeUndefined();
    expect(rejected.document.elements).toEqual(initial.document.elements);
  });

  it("fails closed when constraint derivation throws and allows caller-owned cancellation", () => {
    const initial = createEditor({ ...createDocument("atomic-midpoint", [layer]), elements: [] });
    const geometry = createElement(createSketchLine(elementId("new-sketch"), layer.id, style, { x: 2, y: 3 }, { x: 5, y: 3 }, { kind: "none" }));
    const failed = dispatch(initial, createGeometryWithDocumentConstraints(geometry, () => { throw new Error("midpoint became stale"); }));
    expect(failed).toBe(initial);
    expect(failed.document.elements).toEqual([]);
    const callerCanceled = dispatch(initial, geometry);
    expect(initial.document.elements).toEqual([]);
    expect(callerCanceled.document.elements).toHaveLength(1);
  });

  it("exposes supported kinds and normalized diagnostic identities", () => {
    expect(supportsGlobalConstraintKind("distance")).toBe(true);
    expect(supportsGlobalConstraintKind("parallel")).toBe(true);
    expect(supportsGlobalConstraintKind("perpendicular")).toBe(true);
    expect(supportsGlobalConstraintKind("equal")).toBe(true);
    expect(supportsGlobalConstraintKind("angle")).toBe(true);
    expect(documentConstraintDiagnosticId("constraint-1")).toBe('["document",null,"constraint-1"]');
  });
});
