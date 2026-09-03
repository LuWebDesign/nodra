import { describe, expect, it } from "vitest";
import { createDocument, elementId, layerId, withElements, type Element, type SketchElement } from "@nodra/domain";
import { constraintComponentStatesForDocument, constraintComponentsForDocument, constraintDofMetadataForDocument, constraintInputsForDocument, constraintResidualsForDocument, constraintStateForElement, normalizedConstraintsForDocument, parametricCapabilitiesForElement, solveConstraintComponents } from "./index.js";

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
    expect(constraintComponentStatesForDocument(document)).toEqual([{ nodeKeys: [JSON.stringify(["sketch", "a"]), JSON.stringify(["sketch", "b"])], state: "fully-defined", diagnostics: [] }]);
  });

  it("groups local and page-level constraints into connected components", () => {
    const first = sketch([{ id: "local", kind: "horizontal", references: [{ elementId: elementId("sketch"), nodeId: "a" }, { elementId: elementId("sketch"), nodeId: "b" }] }]);
    const second: SketchElement = { ...sketch(), id: elementId("second"), nodes: [{ id: "c", point: { x: 100, y: 10 } }, { id: "d", point: { x: 120, y: 10 } }], edges: [{ id: "cd", startNodeId: "c", endNodeId: "d" }] };
    const global = { id: "connect", kind: "coincident" as const, references: [{ elementId: first.id, nodeId: "b" }, { elementId: second.id, nodeId: "c" }] as const };
    const components = constraintComponentsForDocument({ ...documentWith([first, second]), constraints: [global] });
    expect(components).toHaveLength(2);
    const connected = components.find((component) => component.nodeKeys.length === 3);
    expect(connected?.nodeKeys.map((key) => JSON.parse(key) as string[])).toEqual([["second", "c"], ["sketch", "a"], ["sketch", "b"]]);
    expect(connected?.constraintIds).toEqual([JSON.stringify(["document", null, "connect"]), JSON.stringify(["local", "sketch", "local"])]);
    expect(components.find((component) => component.nodeKeys.length === 1)?.constraintIds).toEqual([]);
    expect(normalizedConstraintsForDocument({ ...documentWith([first, second]), constraints: [global] }).map((constraint) => constraint.scope)).toEqual(["document", "local"]);
    const input = constraintInputsForDocument({ ...documentWith([first, second]), constraints: [global] }).find((component) => component.nodes.length === 3);
    expect(input).toMatchObject({ coordinateCount: 6, coordinates: [{ x: 100, y: 10 }, { x: 10, y: 10 }, { x: 30, y: 10 }], constraints: expect.arrayContaining([expect.objectContaining({ scope: "document", kind: "coincident" })]) });
    expect(constraintDofMetadataForDocument({ ...documentWith([first, second]), constraints: [global] })).toEqual(expect.arrayContaining([{ nodeKeys: expect.any(Array), coordinateCount: 6, constraintCount: 2, status: "pending-solver" }]));
    expect(constraintResidualsForDocument({ ...documentWith([first, second]), constraints: [global] })).toEqual(expect.arrayContaining([expect.objectContaining({ constraintId: JSON.stringify(["document", null, "connect"]), residual: 70, satisfied: false, supported: true })]));
    const preview = solveConstraintComponents({ ...documentWith([first, second]), constraints: [global] });
    expect(preview.changed).toBe(true);
    expect((preview.document.elements[1] as SketchElement).nodes[0]?.point).toEqual({ x: 30, y: 10 });
    expect((second.nodes[0] as SketchElement["nodes"][number]).point).toEqual({ x: 100, y: 10 });
    const invalid = { ...global, id: "invalid", references: [global.references[0]!, { elementId: first.id, nodeId: "missing" }] as const };
    const crossSketchLocal = { ...global, id: "cross-local", references: [global.references[0]!, { elementId: second.id, nodeId: "d" }] as const };
    const withoutInvalid = constraintComponentsForDocument({ ...documentWith([{ ...first, constraints: [...(first.constraints ?? []), crossSketchLocal] }, second]), constraints: [invalid] });
    expect(withoutInvalid.every((component) => !component.constraintIds.some((id) => id.includes("invalid") || id.includes("cross-local")))).toBe(true);
    const bridgedInput = constraintInputsForDocument({ ...documentWith([{ ...first, constraints: [...(first.constraints ?? []), crossSketchLocal] }, second]), constraints: [global] }).find((component) => component.nodes.length === 3);
    expect(bridgedInput?.constraints.some((constraint) => constraint.id.includes("cross-local"))).toBe(false);
  });

  it("normalizes angular residuals across the signed-angle boundary", () => {
    const angularSketch: SketchElement = { ...sketch(), id: elementId("angular"), nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 10, y: -10 * Math.tan(Math.PI / 18) } }] };
    const angular = { id: "angle", kind: "angle" as const, value: 350, references: [{ elementId: angularSketch.id, nodeId: "a" }, { elementId: angularSketch.id, nodeId: "b" }] as const };
    const result = constraintResidualsForDocument({ ...documentWith([angularSketch]), constraints: [angular] });
    expect(result).toEqual([expect.objectContaining({ satisfied: true, supported: true })]);
  });

  it("solves a complete local component without mutating the input", () => {
    const movable: SketchElement = { ...sketch(), id: elementId("movable"), nodes: [{ id: "a", point: { x: 10, y: 10 } }, { id: "b", point: { x: 30, y: 20 } }], constraints: [{ id: "horizontal", kind: "horizontal", references: [{ elementId: elementId("movable"), nodeId: "a" }, { elementId: elementId("movable"), nodeId: "b" }] }] };
    const document = documentWith([movable]);
    const result = solveConstraintComponents(document);
    expect(result.changed).toBe(true);
    expect(result.document).not.toBe(document);
    expect((result.document.elements[0] as SketchElement).nodes[1]?.point).toEqual({ x: 30, y: 10 });
    expect((document.elements[0] as SketchElement).nodes[1]?.point).toEqual({ x: 30, y: 20 });
    expect(result.residuals[0]).toMatchObject({ satisfied: true, supported: true });
  });

  it("keeps unsupported and missing entities distinguishable", () => {
    const line = { type: "line" as const, id: elementId("line"), layerId: layer.id, start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style };
    const document = documentWith([line]);

    expect(constraintStateForElement(document, line.id)).toEqual({ elementId: line.id, state: "not-parametric", conflicts: [] });
    expect(constraintStateForElement(document, elementId("missing"))).toEqual({ elementId: elementId("missing"), state: "invalid", conflicts: ["element-not-found"] });
  });
});
