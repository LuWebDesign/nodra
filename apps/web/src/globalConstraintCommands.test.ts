import { describe, expect, it } from "vitest";
import { createDocument, elementId, layerId, type DocumentConstraint, type SketchElement } from "@nodra/domain";
import { createEditor, dispatch, undo } from "@nodra/editor-core";
import {
  addSolvedDocumentConstraint,
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

  it("rejects a global solve that would break a local constraint", () => {
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

    const rejected = dispatch(initial, addSolvedDocumentConstraint(distanceConstraint(first, second, 40)));

    expect(rejected).toBe(initial);
    expect(rejected.document.constraints).toBeUndefined();
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

    expect(committed.document.constraints).toEqual([constraint]);
    const point = (committed.document.elements[1] as SketchElement).nodes[1]!.point;
    expect(point.x).toBeCloseTo(expected.x, 8);
    expect(point.y).toBeCloseTo(expected.y, 8);
    expect(committed.undo).toHaveLength(1);
  });

  it("exposes supported kinds and normalized diagnostic identities", () => {
    expect(supportsGlobalConstraintKind("distance")).toBe(true);
    expect(supportsGlobalConstraintKind("parallel")).toBe(true);
    expect(supportsGlobalConstraintKind("perpendicular")).toBe(true);
    expect(supportsGlobalConstraintKind("equal")).toBe(true);
    expect(supportsGlobalConstraintKind("angle")).toBe(false);
    expect(documentConstraintDiagnosticId("constraint-1")).toBe('["document",null,"constraint-1"]');
  });
});
