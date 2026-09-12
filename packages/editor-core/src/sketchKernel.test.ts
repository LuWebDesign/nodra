import { describe, expect, it } from "vitest";
import { createDocument, elementId, layerId, type CircleElement, type Element, type SketchConstraint, type SketchElement } from "@nodra/domain";
import { validateDocument } from "@nodra/validation";
import { recomputeSketchKernel } from "./sketchKernel.js";

const layer = { id: layerId("default"), name: "Default", visible: true, order: 0 };
const style = { stroke: "#000", strokeWidth: 1 };
const square = (constraints?: readonly SketchConstraint[]): SketchElement => ({
  type: "sketch", id: elementId("square"), layerId: layer.id,
  nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 10, y: 0 } }, { id: "c", point: { x: 10, y: 10 } }, { id: "d", point: { x: 0, y: 10 } }],
  edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }, { id: "bc", startNodeId: "b", endNodeId: "c" }, { id: "cd", startNodeId: "c", endNodeId: "d" }, { id: "da", startNodeId: "d", endNodeId: "a" }],
  ...(constraints ? { constraints } : {}), style,
});
const documentFor = (...elements: readonly Element[]): ReturnType<typeof createDocument> => ({ ...createDocument("doc", [layer]), elements });
    const circle = (circleConstraints?: CircleElement["circleConstraints"]): CircleElement => ({ type: "circle", id: elementId("circle"), layerId: layer.id, center: { x: 1, y: 2 }, radius: 3, style, ...(circleConstraints ? { circleConstraints } : {}) });

const fixed = (id: string, nodeId: string): SketchConstraint => ({ id, kind: "fixed", references: [{ elementId: elementId("square"), nodeId }] });

describe("sketch kernel", () => {
  it("recomputes a closed profile without mutating or revising the input", () => {
    const input = documentFor(square());
    const before = JSON.stringify(input);
    const result = recomputeSketchKernel(input);
    expect(result.committed).toBe(true);
    expect(result.profileReady).toBe(true);
    expect(result.contours).toHaveLength(1);
    expect(result.document.revision).toBe(input.revision);
    expect(validateDocument(result.document).success).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("derives deterministic mixed line/circle and circle/circle intersections without mutating elements", () => {
            const first = { ...circle(), id: elementId("circle-a"), center: { x: 0, y: 0 }, radius: 5 };
            const second = { ...circle(), id: elementId("circle-b"), center: { x: 8, y: 0 }, radius: 5 };
            const line = { type: "line" as const, id: elementId("mixed-line"), layerId: layer.id, start: { x: -10, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style };
            const input = documentFor(first, second, line);
            const before = JSON.stringify(input);
            const result = recomputeSketchKernel(input);
            expect(result.derivedMixedTopology.pieces).toHaveLength(3);
            expect(result.derivedMixedTopology.intersections).toHaveLength(3);
            expect(result.derivedMixedTopology.intersections.some((pair) => pair.kind === "points")).toBe(true);
            expect(recomputeSketchKernel(input).derivedMixedTopology).toEqual(result.derivedMixedTopology);
            expect(JSON.stringify(input)).toBe(before);
          });

          it("reports native circle overlap as derived metadata and never persists topology", () => {
            const first = { ...circle(), id: elementId("overlap-a"), center: { x: 0, y: 0 }, radius: 5 };
            const second = { ...circle(), id: elementId("overlap-b"), center: { x: 0, y: 0 }, radius: 5 };
            const input = documentFor(first, second);
            const result = recomputeSketchKernel(input);
            expect(result.derivedMixedTopology.intersections[0]?.kind).toBe("overlap");
            expect(result.derivedMixedTopology.diagnostics.map((diagnostic) => diagnostic.code)).toContain("overlap");
            expect(result.document).toEqual(input);
          });

      it("recomputes constrained native circles without treating them as sketch topology", () => {
        const input = documentFor(circle([{ id: "cx", kind: "center-horizontal", value: 10 }, { id: "diameter", kind: "diameter", value: 8 }]));
        const result = recomputeSketchKernel(input);
        expect(result.committed).toBe(true);
        expect(result.document.elements[0]).toMatchObject({ type: "circle", center: { x: 10, y: 2 }, radius: 4 });
        expect(result.circleConstraintDiagnostics).toEqual([]);
        expect(result.profileReady).toBe(false);
      });

      it("rolls back atomically and reports deterministic native circle conflicts", () => {
        const input = documentFor(circle([{ id: "z", kind: "radius", value: 4 }, { id: "a", kind: "diameter", value: 10 }]));
        const result = recomputeSketchKernel(input);
        expect(result.rollback).toBe(true);
        expect(result.document).toEqual(input);
        expect(result.circleConstraintDiagnostics).toEqual([{ code: "circle-constraint-conflict", circleId: circle().id, constraintIds: ["z"], message: "Circle constraints are in conflict: z" }]);
      });

      it("preserves unconstrained native circles", () => {
        const input = documentFor(circle());
        const result = recomputeSketchKernel(input);
        expect(result.document.elements).toEqual(input.elements);
      });

      it("keeps circle recomputation revision-immutable", () => {
        const input = documentFor(circle([{ id: "radius", kind: "radius", value: 9 }]));
        const before = JSON.stringify(input);
        const result = recomputeSketchKernel(input);
        expect(result.document.revision).toBe(input.revision);
        expect(JSON.stringify(input)).toBe(before);
      });

      it("reports an open sketch as not profile-ready", () => {
    const input = documentFor({ ...square(), edges: square().edges.slice(0, 2) });
    const result = recomputeSketchKernel(input);
    expect(result.committed).toBe(true);
    expect(result.profileReady).toBe(false);
    expect(result.topologyDiagnostics.map((diagnostic) => diagnostic.code)).toContain("open-profile");
  });

  it("keeps collinear overlapping segments out of profile-ready topology", () => {
        const input = documentFor({
          ...square(),
          nodes: [...square().nodes, { id: "e", point: { x: 5, y: 0 } }, { id: "f", point: { x: 15, y: 0 } }],
          edges: [...square().edges, { id: "ef", startNodeId: "e", endNodeId: "f" }],
        });
        const result = recomputeSketchKernel(input);
        expect(result.profileReady).toBe(false);
        expect(result.topologyDiagnostics[0]?.code).toBe("invalid-topology");
      });

      it("keeps closed faces editable when the sketch also has an open piece", () => {
    const input = documentFor({
      ...square(),
      nodes: [...square().nodes, { id: "e", point: { x: 20, y: 0 } }],
      edges: [...square().edges, { id: "be", startNodeId: "b", endNodeId: "e" }],
    });
    const result = recomputeSketchKernel(input);
    expect(result.committed).toBe(true);
    expect(result.rollback).toBe(false);
    expect(result.profileReady).toBe(false);
    expect(result.contours).toHaveLength(1);
    expect(result.topologyDiagnostics[0]?.code).toBe("open-profile");
  });

  it("uses split graph faces for intersecting line segments", () => {
    const input = documentFor({
      ...square(),
      edges: [...square().edges, { id: "ac", startNodeId: "a", endNodeId: "c" }],
    });
    const result = recomputeSketchKernel(input);
    expect(result.committed).toBe(true);
    expect(result.profileReady).toBe(true);
    expect(result.contours).toHaveLength(2);
  });

  it("rolls back conflicting constraints", () => {
    const input = documentFor(square([fixed("fixed-a", "a"), fixed("fixed-b", "a")]));
    const result = recomputeSketchKernel(input);
    expect(result.rollback).toBe(true);
    expect(result.committed).toBe(false);
    expect(result.document).toEqual(input);
    expect(result.constraintDiagnostics.length).toBeGreaterThan(0);
  });

  it("returns stable output ordering", () => {
    const input = documentFor(square());
    expect(recomputeSketchKernel(input)).toEqual(recomputeSketchKernel(input));
  });

  it("fails closed for invalid input", () => {
    const result = recomputeSketchKernel({ nope: true });
    expect(result.rollback).toBe(true);
    expect(result.profileReady).toBe(false);
    expect(result.topologyDiagnostics[0]?.code).toBe("invalid-input");
  });
});
