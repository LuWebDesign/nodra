import { describe, expect, it } from "vitest";
import { createDocument, elementId, layerId, withElements, type Element, type SketchElement } from "@nodra/domain";
import { constraintStateForElement, parametricCapabilitiesForElement } from "./index.js";

const layer = { id: layerId("constraints"), name: "Croquis", visible: true, order: 0 } as const;
const style = { stroke: "#111827", strokeWidth: 1 } as const;

const sketch = (constraints: SketchElement["constraints"] = []): SketchElement => ({
  type: "sketch",
  id: elementId("sketch"),
  layerId: layer.id,
  nodes: [
    { id: "a", point: { x: 10, y: 10 } },
    { id: "b", point: { x: 30, y: 10 } },
  ],
  edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }],
  constraints,
  style,
});

const documentWith = (elements: readonly Element[]) => withElements(createDocument("constraint-state", [layer]), elements);

describe("parametric constraint boundary", () => {
  it("advertises only the capabilities implemented by each adapter", () => {
    const lineSketch = sketch();
    const circle = { type: "ellipse" as const, id: elementId("circle"), layerId: layer.id, position: { x: 0, y: 0 }, size: { width: 20, height: 20 }, rotation: 0, style };
    const ellipse = { ...circle, id: elementId("ellipse"), size: { width: 30, height: 20 } };

    expect(parametricCapabilitiesForElement(lineSketch)).toMatchObject({ entityKind: "sketch", constraintKinds: expect.arrayContaining(["coincident", "parallel", "distance"]) });
    expect(parametricCapabilitiesForElement(circle)).toEqual({ entityKind: "circle", constraintKinds: ["center-horizontal", "center-vertical", "radius", "diameter"] });
    expect(parametricCapabilitiesForElement(ellipse)).toBeUndefined();
  });

  it("normalizes sketch and circle solver states through one query", () => {
    const definedSketch = sketch([
      { id: "fixed-a", kind: "fixed", references: [{ elementId: elementId("sketch"), nodeId: "a" }] },
      { id: "horizontal", kind: "horizontal", references: [{ elementId: elementId("sketch"), nodeId: "a" }, { elementId: elementId("sketch"), nodeId: "b" }] },
      { id: "length", kind: "distance-horizontal", references: [{ elementId: elementId("sketch"), nodeId: "a" }, { elementId: elementId("sketch"), nodeId: "b" }], value: 20 },
    ]);
    const circle = {
      type: "ellipse" as const,
      id: elementId("circle"),
      layerId: layer.id,
      position: { x: 0, y: 0 },
      size: { width: 20, height: 20 },
      rotation: 0,
      style,
      circleConstraints: [
        { id: "center-x", kind: "center-horizontal" as const, value: 20 },
        { id: "center-y", kind: "center-vertical" as const, value: 20 },
        { id: "radius", kind: "radius" as const, value: 10 },
      ],
    };
    const document = documentWith([definedSketch, circle]);

    expect(constraintStateForElement(document, definedSketch.id)).toEqual({ elementId: definedSketch.id, entityKind: "sketch", state: "fully-defined", conflicts: [] });
    expect(constraintStateForElement(document, circle.id)).toEqual({ elementId: circle.id, entityKind: "circle", state: "fully-defined", conflicts: [] });
  });

  it("keeps unsupported and missing entities distinguishable", () => {
    const line = { type: "line" as const, id: elementId("line"), layerId: layer.id, start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style };
    const document = documentWith([line]);

    expect(constraintStateForElement(document, line.id)).toEqual({ elementId: line.id, state: "not-parametric", conflicts: [] });
    expect(constraintStateForElement(document, elementId("missing"))).toEqual({ elementId: elementId("missing"), state: "invalid", conflicts: ["element-not-found"] });
  });
});
