import { describe, expect, it } from "vitest";
import { elementId, type DocumentConstraint, type SketchConstraint, type SketchElement } from "@nodra/domain";
import { halfArcLengthMidpoint, pathSegmentToCurve, solveSketchConstraints, splineSpanToCurve } from "@nodra/geometry";
import { constraintComponentStatesForDocument, constraintComponentsForDocument, constraintDofMetadataForDocument, constraintInputsForDocument, constraintResidualsForDocument, constraintStateForElement, normalizedConstraintsForDocument, parametricCapabilitiesForElement, solveConstraintComponents } from "./index.js";
import { documentWith, fixtureLayer, fixtureStyle, sketch } from "./test-fixtures.js";

describe("parametric constraint boundary", () => {
  it("advertises only the capabilities implemented by each adapter", () => {
    const lineSketch = sketch();
    const circle = { type: "circle" as const, id: elementId("circle"), layerId: fixtureLayer().id, center: { x: 10, y: 10 }, radius: 10, style: fixtureStyle() };
    const ellipse = { type: "ellipse" as const, id: elementId("ellipse"), layerId: fixtureLayer().id, position: { x: 0, y: 0 }, size: { width: 30, height: 20 }, rotation: 0, style: fixtureStyle() };

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
      type: "circle" as const,
      id: elementId("circle"),
      layerId: fixtureLayer().id,
      center: { x: 10, y: 10 },
      radius: 10,
      style: fixtureStyle(),
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

  it("projects a raw defined solver result to fully-defined without mutating the document", () => {
    const source = sketch([
      { id: "fixed-a", kind: "fixed", references: [{ elementId: elementId("sketch"), nodeId: "a" }] },
      { id: "join", kind: "coincident", references: [{ elementId: elementId("sketch"), nodeId: "a" }, { elementId: elementId("sketch"), nodeId: "b" }] },
    ]);
    const document = documentWith([source]);
    const before = structuredClone(document);

    expect(solveSketchConstraints(source).status).toBe("defined");
    expect(constraintStateForElement(document, source.id)).toMatchObject({ state: "fully-defined" });
    expect(document).toEqual(before);
  });

  it("recomputes component definition states deterministically without mutating the snapshot", () => {
    const source = sketch([
      { id: "fixed-a", kind: "fixed", references: [{ elementId: elementId("sketch"), nodeId: "a" }] },
      { id: "join", kind: "coincident", references: [{ elementId: elementId("sketch"), nodeId: "a" }, { elementId: elementId("sketch"), nodeId: "b" }] },
    ]);
    const document = documentWith([source]);
    const before = structuredClone(document);

    const first = constraintComponentStatesForDocument(document);
    const second = constraintComponentStatesForDocument(document);

    expect(first).toEqual(second);
    expect(first[0]?.state).toBe("fully-defined");
    expect(document).toEqual(before);
    expect(document.elements[0]).toBe(source);
  });

  it("retains supported construction edges in solver component states", () => {
    const construction = {
      ...sketch([
        { id: "fixed-a", kind: "fixed" as const, references: [{ elementId: elementId("sketch"), nodeId: "a" }] },
        { id: "join", kind: "coincident" as const, references: [{ elementId: elementId("sketch"), nodeId: "a" }, { elementId: elementId("sketch"), nodeId: "b" }] },
      ]),
      edges: [{ id: "construction-edge", startNodeId: "a", endNodeId: "b", role: "construction" as const }],
    };

    expect(constraintComponentStatesForDocument(documentWith([construction]))).toEqual([
      { nodeKeys: [JSON.stringify(["sketch", "a"]), JSON.stringify(["sketch", "b"])], state: "fully-defined", diagnostics: [] },
    ]);
  });

  it("derives a fully-defined local subcomponent without including unrelated sketch nodes", () => {
    const scoped: SketchElement = {
      ...sketch(),
      nodes: [...sketch().nodes, { id: "unrelated", point: { x: 100, y: 100 } }],
      constraints: [
        { id: "fixed-a", kind: "fixed", references: [{ elementId: elementId("sketch"), nodeId: "a" }] },
        { id: "horizontal", kind: "horizontal", references: [{ elementId: elementId("sketch"), nodeId: "a" }, { elementId: elementId("sketch"), nodeId: "b" }] },
        { id: "length", kind: "distance-horizontal", references: [{ elementId: elementId("sketch"), nodeId: "a" }, { elementId: elementId("sketch"), nodeId: "b" }], value: 20 },
      ],
    };

    const states = constraintComponentStatesForDocument(documentWith([scoped]));

    expect(states.find((state) => state.nodeKeys.length === 2)).toEqual({ nodeKeys: [JSON.stringify(["sketch", "a"]), JSON.stringify(["sketch", "b"])], state: "fully-defined", diagnostics: [] });
    expect(states.find((state) => state.nodeKeys.length === 1)).toMatchObject({ state: "underdefined", diagnostics: [] });
  });

  it("applies invalid, conflict, overdefined, underdefined, and fully-defined component precedence", () => {
    const references = [{ elementId: elementId("sketch"), nodeId: "a" }, { elementId: elementId("sketch"), nodeId: "b" }] as const;
    const unsupported = { id: "unsupported", kind: "horizontal" as const, references, value: 10 };
    const redundant = [{ id: "redundant-a", kind: "horizontal" as const, references }, { id: "redundant-b", kind: "horizontal" as const, references }];
    const conflict = { id: "conflict", kind: "distance-horizontal" as const, value: 30, references };
    const fixed = { id: "fixed-a", kind: "fixed" as const, references: [references[0]] as const };
    const joined = { id: "join", kind: "coincident" as const, references };
    const query = (localConstraints: readonly SketchConstraint[], globals: readonly DocumentConstraint[] = []) => constraintComponentStatesForDocument(documentWith([sketch(localConstraints)], globals))[0]?.state;

    expect(query([])).toBe("underdefined");
    expect(query([fixed, joined])).toBe("fully-defined");
    const redundantGlobals = redundant.map((constraint) => ({ ...constraint, id: `global-${constraint.id}` }));
    expect(constraintComponentStatesForDocument(documentWith([sketch()], redundantGlobals))[0]?.state).toBe("overdefined");
    expect(constraintComponentStatesForDocument(documentWith([sketch()], [...redundantGlobals, conflict]))[0]?.state).toBe("conflict");
    expect(query([unsupported], [...redundantGlobals, conflict])).toBe("invalid");
  });

  it("classifies an unsupported local constraint as invalid", () => {
    const invalid = sketch([{ id: "invalid-horizontal", kind: "horizontal", references: [{ elementId: elementId("sketch"), nodeId: "a" }, { elementId: elementId("sketch"), nodeId: "b" }], value: 10 }]);

    const state = constraintComponentStatesForDocument(documentWith([invalid]))[0];

    expect(state).toMatchObject({ state: "invalid", diagnostics: [expect.stringContaining("local-constraint-unsupported:")] });
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
    expect(constraintDofMetadataForDocument({ ...documentWith([first, second]), constraints: [global] })).toEqual(expect.arrayContaining([{ nodeKeys: expect.any(Array), coordinateCount: 6, constraintCount: 2, rank: 3, degreesOfFreedom: 3, status: "conflict" }]));
    expect(constraintResidualsForDocument({ ...documentWith([first, second]), constraints: [global] })).toEqual(expect.arrayContaining([expect.objectContaining({ constraintId: JSON.stringify(["document", null, "connect"]), residual: 70, satisfied: false, supported: true })]));
    const preview = solveConstraintComponents({ ...documentWith([first, second]), constraints: [global] });
    expect(preview).toMatchObject({ changed: true, degreesOfFreedom: 5, affectedElementIds: ["second", "sketch"], diagnostics: [] });
    expect((preview.document.elements[1] as SketchElement).nodes[0]?.point).toEqual({ x: 30, y: 10 });
    expect((second.nodes[0] as SketchElement["nodes"][number]).point).toEqual({ x: 100, y: 10 });
    const invalid = { ...global, id: "invalid", references: [global.references[0]!, { elementId: first.id, nodeId: "missing" }] as const };
    const crossSketchLocal = { ...global, id: "cross-local", references: [global.references[0]!, { elementId: second.id, nodeId: "d" }] as const };
    const withoutInvalid = constraintComponentsForDocument({ ...documentWith([{ ...first, constraints: [...(first.constraints ?? []), crossSketchLocal] }, second]), constraints: [invalid] });
    expect(withoutInvalid.every((component) => !component.constraintIds.some((id) => id.includes("invalid") || id.includes("cross-local")))).toBe(true);
    const bridgedInput = constraintInputsForDocument({ ...documentWith([{ ...first, constraints: [...(first.constraints ?? []), crossSketchLocal] }, second]), constraints: [global] }).find((component) => component.nodes.length === 3);
    expect(bridgedInput?.constraints.some((constraint) => constraint.id.includes("cross-local"))).toBe(false);
  });

  it.each([
    ["parallel", { x: 100 + Math.sqrt(200), y: 50 }],
    ["perpendicular", { x: 100, y: 50 + Math.sqrt(200) }],
    ["equal", { x: 100 + Math.sqrt(200), y: 50 + Math.sqrt(200) }],
  ] as const)("solves a global %s relation between sketches without mutating the input", (kind, expected) => {
    const first: SketchElement = { ...sketch(), id: elementId("first"), nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 20, y: 0 } }] };
    const second: SketchElement = { ...sketch(), id: elementId("second"), nodes: [{ id: "c", point: { x: 100, y: 50 } }, { id: "d", point: { x: 110, y: 60 } }], edges: [{ id: "cd", startNodeId: "c", endNodeId: "d" }] };
    const constraint = { id: `global-${kind}`, kind, references: [{ elementId: first.id, edgeId: first.edges[0]!.id }, { elementId: second.id, edgeId: second.edges[0]!.id }] as const };
    const document = { ...documentWith([first, second]), constraints: [constraint] };

    const preview = solveConstraintComponents(document);

    const point = (preview.document.elements[1] as SketchElement).nodes[1]!.point;
    expect(point.x).toBeCloseTo(expected.x, 8);
    expect(point.y).toBeCloseTo(expected.y, 8);
    expect(preview.residuals.find((residual) => residual.constraintId === JSON.stringify(["document", null, constraint.id]))).toMatchObject({ supported: true, satisfied: true });
    expect(document.elements).toEqual([first, second]);
  });

  it("preserves the nearest antiparallel orientation", () => {
    const first: SketchElement = { ...sketch(), id: elementId("first"), nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 20, y: 0 } }] };
    const second: SketchElement = { ...sketch(), id: elementId("second"), nodes: [{ id: "c", point: { x: 100, y: 50 } }, { id: "d", point: { x: 90, y: 60 } }], edges: [{ id: "cd", startNodeId: "c", endNodeId: "d" }] };
    const constraint = { id: "global-parallel", kind: "parallel" as const, references: [{ elementId: first.id, nodeId: "a" }, { elementId: first.id, nodeId: "b" }, { elementId: second.id, nodeId: "c" }, { elementId: second.id, nodeId: "d" }] as const };

    const preview = solveConstraintComponents({ ...documentWith([first, second]), constraints: [constraint] });

    const point = (preview.document.elements[1] as SketchElement).nodes[1]!.point;
    expect(point.x).toBeCloseTo(100 - Math.sqrt(200), 8);
    expect(point.y).toBeCloseTo(50, 8);
  });

  it("keeps a degenerate global segment relation unsupported and immutable", () => {
    const first: SketchElement = { ...sketch(), id: elementId("first"), nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 20, y: 0 } }] };
    const second: SketchElement = { ...sketch(), id: elementId("second"), nodes: [{ id: "c", point: { x: 100, y: 50 } }, { id: "d", point: { x: 100 + 5e-7, y: 50 } }], edges: [{ id: "cd", startNodeId: "c", endNodeId: "d" }] };
    const constraint = { id: "global-parallel", kind: "parallel" as const, references: [{ elementId: first.id, nodeId: "a" }, { elementId: first.id, nodeId: "b" }, { elementId: second.id, nodeId: "c" }, { elementId: second.id, nodeId: "d" }] as const };
    const document = { ...documentWith([first, second]), constraints: [constraint] };

    const preview = solveConstraintComponents(document);

    expect(preview.changed).toBe(false);
    expect(preview.document).toBe(document);
    expect(preview).toMatchObject({ converged: false, iterations: 1 });
    expect(preview.residuals[0]).toMatchObject({ supported: false, satisfied: false });
    expect(preview.states[0]).toMatchObject({ state: "invalid", diagnostics: [expect.stringContaining("global-constraint-unsupported:")] });
  });

  it("normalizes angular residuals across the signed-angle boundary", () => {
    const angularSketch: SketchElement = { ...sketch(), id: elementId("angular"), nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 10, y: -10 * Math.tan(Math.PI / 18) } }] };
    const angular = { id: "angle", kind: "angle" as const, value: 350, references: [{ elementId: angularSketch.id, nodeId: "a" }, { elementId: angularSketch.id, nodeId: "b" }] as const };
    const result = constraintResidualsForDocument({ ...documentWith([angularSketch]), constraints: [angular] });
    expect(result).toEqual([expect.objectContaining({ satisfied: true, supported: true })]);
  });

  it("solves a global angle while preserving vector length", () => {
    const first: SketchElement = { ...sketch(), id: elementId("first"), nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 10, y: 0 } }] };
    const second: SketchElement = { ...sketch(), id: elementId("second"), nodes: [{ id: "c", point: { x: 30, y: 20 } }, { id: "d", point: { x: 40, y: 20 } }], edges: [{ id: "cd", startNodeId: "c", endNodeId: "d" }] };
    const constraint = { id: "global-angle", kind: "angle" as const, value: 90, references: [{ elementId: first.id, nodeId: "b" }, { elementId: second.id, nodeId: "c" }] as const };
    const document = { ...documentWith([first, second]), constraints: [constraint] };
    const originalLength = Math.hypot(20, 20);

    const preview = solveConstraintComponents(document);

    const point = (preview.document.elements[1] as SketchElement).nodes[0]!.point;
    expect(point.x).toBeCloseTo(10, 8);
    expect(point.y).toBeCloseTo(originalLength, 8);
    expect(preview.residuals[0]).toMatchObject({ supported: true, satisfied: true });
    expect(document.elements).toEqual([first, second]);
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

  it("marks an overdefined local-only component as non-converged", () => {
    const references = [{ elementId: elementId("sketch"), nodeId: "a" }, { elementId: elementId("sketch"), nodeId: "b" }] as const;
    const overdefined = sketch([{ id: "horizontal-1", kind: "horizontal", references }, { id: "horizontal-2", kind: "horizontal", references }]);
    const document = documentWith([overdefined]);

    const preview = solveConstraintComponents(document);

    expect(preview.converged).toBe(false);
    expect(preview.nonConvergedComponents).toHaveLength(1);
    expect(preview.document).toBe(document);
  });

  it("solves independent local and global components within the same sketch", () => {
    const host: SketchElement = { ...sketch(), id: elementId("host"), nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 10, y: 0 } }, { id: "c", point: { x: 0, y: 20 } }, { id: "d", point: { x: 10, y: 30 } }], edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }, { id: "cd", startNodeId: "c", endNodeId: "d" }], constraints: [{ id: "local-horizontal", kind: "horizontal", references: [{ elementId: elementId("host"), nodeId: "c" }, { elementId: elementId("host"), nodeId: "d" }] }] };
    const other: SketchElement = { ...sketch(), id: elementId("other"), nodes: [{ id: "e", point: { x: 100, y: 50 } }, { id: "f", point: { x: 120, y: 50 } }], edges: [{ id: "ef", startNodeId: "e", endNodeId: "f" }] };
    const coincident = { id: "global-coincident", kind: "coincident" as const, references: [{ elementId: host.id, nodeId: "a" }, { elementId: other.id, nodeId: "e" }] as const };

    const preview = solveConstraintComponents({ ...documentWith([host, other]), constraints: [coincident] });

    expect(preview.converged).toBe(true);
    expect((preview.document.elements[0] as SketchElement).nodes[3]!.point.y).toBe(20);
    expect((preview.document.elements[1] as SketchElement).nodes[0]!.point).toEqual({ x: 0, y: 0 });
  });

  it("alternates compatible local and global constraints to a shared fixed point", () => {
    const first = sketch();
    const second: SketchElement = { ...sketch(), id: elementId("second"), nodes: [{ id: "c", point: { x: 100, y: 50 } }, { id: "d", point: { x: 120, y: 50 } }], edges: [{ id: "cd", startNodeId: "c", endNodeId: "d" }], constraints: [{ id: "local-horizontal", kind: "horizontal", references: [{ elementId: elementId("second"), nodeId: "c" }, { elementId: elementId("second"), nodeId: "d" }] }] };
    const coincident = { id: "global-coincident", kind: "coincident" as const, references: [{ elementId: first.id, nodeId: "a" }, { elementId: second.id, nodeId: "c" }] as const };

    const preview = solveConstraintComponents({ ...documentWith([first, second]), constraints: [coincident] });

    expect(preview).toMatchObject({ converged: true, iterations: 3 });
    expect((preview.document.elements[1] as SketchElement).nodes.map((node) => node.point.y)).toEqual([10, 10]);
    expect(preview.residuals.every((residual) => residual.satisfied)).toBe(true);
  });

  it("reports a cycle when a local constraint conflicts with a global relation", () => {
    const first = sketch();
    const second: SketchElement = { ...sketch(), id: elementId("second"), nodes: [{ id: "c", point: { x: 100, y: 50 } }, { id: "d", point: { x: 120, y: 50 } }], edges: [{ id: "cd", startNodeId: "c", endNodeId: "d" }], constraints: [{ id: "local-fixed", kind: "fixed", references: [{ elementId: elementId("second"), nodeId: "c" }] }] };
    const coincident = { id: "global-coincident", kind: "coincident" as const, references: [{ elementId: first.id, nodeId: "a" }, { elementId: second.id, nodeId: "c" }] as const };

    const preview = solveConstraintComponents({ ...documentWith([first, second]), constraints: [coincident] });

    expect(preview).toMatchObject({ converged: false, iterations: 2 });
    expect(preview.residuals).toEqual(expect.arrayContaining([expect.objectContaining({ constraintId: JSON.stringify(["local", "second", "local-fixed"]), satisfied: false })]));
  });

  it("iterates connected global constraints to a deterministic fixed point", () => {
    const first = sketch();
    const second: SketchElement = { ...sketch(), id: elementId("second"), nodes: [{ id: "c", point: { x: 100, y: 10 } }, { id: "d", point: { x: 120, y: 10 } }], edges: [{ id: "cd", startNodeId: "c", endNodeId: "d" }] };
    const third: SketchElement = { ...sketch(), id: elementId("third"), nodes: [{ id: "e", point: { x: 200, y: 10 } }, { id: "f", point: { x: 220, y: 10 } }], edges: [{ id: "ef", startNodeId: "e", endNodeId: "f" }] };
    const copySecondToThird = { id: "a-copy-second-to-third", kind: "coincident" as const, references: [{ elementId: second.id, nodeId: "c" }, { elementId: third.id, nodeId: "e" }] as const };
    const copyFirstToSecond = { id: "z-copy-first-to-second", kind: "coincident" as const, references: [{ elementId: first.id, nodeId: "a" }, { elementId: second.id, nodeId: "c" }] as const };
    const base = documentWith([first, second, third]);

    const forward = solveConstraintComponents({ ...base, constraints: [copySecondToThird, copyFirstToSecond] });
    const reversed = solveConstraintComponents({ ...base, constraints: [copyFirstToSecond, copySecondToThird] });

    expect((forward.document.elements[1] as SketchElement).nodes[0]!.point).toEqual({ x: 10, y: 10 });
    expect((forward.document.elements[2] as SketchElement).nodes[0]!.point).toEqual({ x: 10, y: 10 });
    expect(forward.residuals.every((residual) => residual.satisfied)).toBe(true);
    expect(forward).toMatchObject({ converged: true, iterations: 3 });
    expect(reversed.document.elements).toEqual(forward.document.elements);
    expect(base.elements[1]).toBe(second);
    expect(base.elements[2]).toBe(third);
  });

  it("reports exhaustion when a connected chain exceeds the iteration budget", () => {
    const sketches = Array.from({ length: 34 }, (_, index): SketchElement => ({
      ...sketch(),
      id: elementId(`chain-${index}`),
      nodes: [{ id: "value", point: { x: index * 10, y: 0 } }, { id: "spare", point: { x: index * 10, y: 10 } }],
      edges: [{ id: "edge", startNodeId: "value", endNodeId: "spare" }],
    }));
    const constraints = Array.from({ length: sketches.length - 1 }, (_, index): DocumentConstraint => ({
      id: `copy-${String(index).padStart(2, "0")}`,
      kind: "coincident",
      references: [{ elementId: sketches[index + 1]!.id, nodeId: "value" }, { elementId: sketches[index]!.id, nodeId: "value" }],
    }));

    const preview = solveConstraintComponents({ ...documentWith(sketches), constraints });

    expect(preview).toMatchObject({ converged: false, iterations: 32 });
    expect(preview.residuals.some((residual) => residual.supported && !residual.satisfied)).toBe(true);
  });

  it("reports competing global constraints as conflicts", () => {
    const first = sketch();
    const competing = [
      { id: "distance-20", kind: "distance-horizontal" as const, value: 20, references: [{ elementId: first.id, nodeId: "a" }, { elementId: first.id, nodeId: "b" }] as const },
      { id: "distance-30", kind: "distance-horizontal" as const, value: 30, references: [{ elementId: first.id, nodeId: "a" }, { elementId: first.id, nodeId: "b" }] as const },
    ];
    const preview = solveConstraintComponents({ ...documentWith([first]), constraints: competing });
    expect(preview).toMatchObject({ converged: false, iterations: 2 });
    expect(preview.states[0]).toMatchObject({ state: "conflict" });
    expect(preview.states[0]?.diagnostics.some((diagnostic) => diagnostic.startsWith("global-constraint-conflict:"))).toBe(true);
  });

  it("derives zero degrees of freedom from a full-rank local component", () => {
    const source = sketch([{ id: "fixed-a", kind: "fixed", references: [{ elementId: elementId("sketch"), nodeId: "a" }] }, { id: "join", kind: "coincident", references: [{ elementId: elementId("sketch"), nodeId: "a" }, { elementId: elementId("sketch"), nodeId: "b" }] }]);

    expect(constraintDofMetadataForDocument(documentWith([source]))).toEqual([{ nodeKeys: expect.any(Array), coordinateCount: 4, constraintCount: 2, rank: 4, degreesOfFreedom: 0, status: "fully-defined" }]);
  });

  it("rolls back valid local projections when the component also contains unsupported degeneracy", () => {
    const horizontal = { id: "degenerate-horizontal", kind: "horizontal" as const, references: [{ elementId: elementId("sketch"), nodeId: "a" }, { elementId: elementId("sketch"), nodeId: "b" }] as const };
    const source = sketch([horizontal, { id: "fixed-a", kind: "fixed", references: [horizontal.references[0]] }]);
    const degenerate = { ...source, nodes: source.nodes.map((node) => ({ ...node, point: { x: 5, y: 5 } })) };
    const document = documentWith([degenerate]);

    const preview = solveConstraintComponents(document);

    expect(preview).toMatchObject({ document, changed: false, converged: false, nonConvergedComponents: [] });
    expect(constraintDofMetadataForDocument(documentWith([{ ...degenerate, constraints: [horizontal] }])).find((component) => component.constraintCount === 1)).toMatchObject({ rank: 0, degreesOfFreedom: 4, status: "invalid" });
    expect(preview.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["constraint-conflict", "unsupported-constraint"]);
  });

  it("keeps malformed shared-node constraints out of non-converged component diagnostics", () => {
    const references = [{ elementId: elementId("sketch"), nodeId: "a" }, { elementId: elementId("sketch"), nodeId: "b" }] as const;
    const source = sketch([{ id: "horizontal-1", kind: "horizontal", references }, { id: "horizontal-2", kind: "horizontal", references }, { id: "malformed", kind: "horizontal", references: [references[0], { elementId: elementId("sketch"), nodeId: "missing" }] }]);

    const preview = solveConstraintComponents(documentWith([source]));
    const diagnostic = preview.diagnostics.find((candidate) => candidate.code === "non-converged-component");

    expect(diagnostic?.constraintIds).toEqual([JSON.stringify(["local", "sketch", "horizontal-1"]), JSON.stringify(["local", "sketch", "horizontal-2"])]);
    expect(preview.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "unsupported-constraint", constraintIds: [JSON.stringify(["local", "sketch", "malformed"])] })]));
  });

  it("omits non-finite constraints from Jacobian rank", () => {
    const source = sketch([{ id: "fixed-a", kind: "fixed", references: [{ elementId: elementId("sketch"), nodeId: "a" }] }]);
    const invalid = { ...source, nodes: [{ ...source.nodes[0]!, point: { x: Number.NaN, y: 0 } }, source.nodes[1]!] };

    expect(constraintDofMetadataForDocument(documentWith([invalid])).find((component) => component.constraintCount === 1)).toMatchObject({ rank: 0, degreesOfFreedom: 2, status: "invalid" });
  });

  it("classifies redundant global equations from component rank", () => {
    const first = sketch();
    const second: SketchElement = { ...sketch(), id: elementId("second"), nodes: [{ id: "c", point: { x: 100, y: 10 } }, { id: "d", point: { x: 120, y: 10 } }], edges: [{ id: "cd", startNodeId: "c", endNodeId: "d" }] };
    const references = [{ elementId: first.id, nodeId: "a" }, { elementId: second.id, nodeId: "c" }] as const;
    const document = { ...documentWith([first, second]), constraints: [{ id: "first-horizontal", kind: "horizontal" as const, references }, { id: "duplicate-horizontal", kind: "horizontal" as const, references }] };

    const preview = solveConstraintComponents(document);
    const metadata = constraintDofMetadataForDocument(document).find((component) => component.constraintCount === 2);

    expect(metadata).toMatchObject({ coordinateCount: 4, rank: 1, degreesOfFreedom: 3, status: "overdefined" });
    expect(preview.states.find((state) => state.nodeKeys.length === 2)).toMatchObject({ state: "overdefined", diagnostics: expect.arrayContaining(["component:overdefined"]) });
    expect(preview.diagnostics).toEqual([expect.objectContaining({ code: "redundant-component", constraintIds: [JSON.stringify(["document", null, "duplicate-horizontal"]), JSON.stringify(["document", null, "first-horizontal"])] })]);
  });

  it("rejects fixed constraints at document scope instead of silently ignoring them", () => {
    const source = sketch();
    const fixed = { id: "global-fixed", kind: "fixed" as const, references: [{ elementId: source.id, nodeId: "a" }] as const };

    const preview = solveConstraintComponents({ ...documentWith([source]), constraints: [fixed] });

    expect(preview.converged).toBe(false);
    expect(preview.nonConvergedComponents).toEqual([]);
    expect(constraintDofMetadataForDocument({ ...documentWith([source]), constraints: [fixed] }).find((component) => component.constraintCount === 1)).toMatchObject({ rank: 0, degreesOfFreedom: 2, status: "invalid" });
    expect(preview.residuals).toEqual([expect.objectContaining({ supported: false, satisfied: false })]);
    expect(preview.states[0]).toMatchObject({ state: "invalid", diagnostics: [expect.stringContaining("global-constraint-unsupported:")] });
    expect(preview.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "unsupported-constraint", constraintIds: [JSON.stringify(["document", null, "global-fixed"])], referenceKeys: [JSON.stringify(["sketch", "a"])] })]));
  });

  it("drives a local midpoint node from either ordered endpoint without mutating old snapshots", () => {
    const base = sketch();
    const source: SketchElement = {
      ...base,
      nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 10, y: 2 } }, { id: "c", point: { x: 8, y: 9 } }],
      edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }],
      constraints: [{ id: "mid-c", kind: "midpoint", references: [{ elementId: elementId("sketch"), nodeId: "c" }, { elementId: elementId("sketch"), edgeId: "ab" }] }],
    };
    const document = documentWith([source]);
    const solved = solveConstraintComponents(document);
    expect((solved.document.elements[0] as SketchElement).nodes[2]?.point).toEqual({ x: 5, y: 1 });
    expect(solved.residuals).toEqual([expect.objectContaining({ supported: true, satisfied: true, residual: 0 })]);
    expect(solveConstraintComponents(document).document.elements).toEqual(solved.document.elements);
    expect(source.nodes[2]?.point).toEqual({ x: 8, y: 9 });

    const moved = { ...source, nodes: [{ id: "a", point: { x: 10, y: 20 } }, { id: "b", point: { x: 30, y: 40 } }, source.nodes[2]!] };
    const afterMove = solveConstraintComponents(documentWith([moved]));
    expect((afterMove.document.elements[0] as SketchElement).nodes[2]?.point).toEqual({ x: 20, y: 30 });
    const reversed = { ...moved, edges: [{ id: "ab", startNodeId: "b", endNodeId: "a" }] };
    expect((solveConstraintComponents(documentWith([reversed])).document.elements[0] as SketchElement).nodes[2]?.point).toEqual({ x: 20, y: 30 });
    expect(constraintDofMetadataForDocument(documentWith([source]))[0]).toMatchObject({ rank: 2, degreesOfFreedom: 4 });
  });

  it("projects a document midpoint across sketches while leaving its source geometry untouched", () => {
    const dependent = sketch();
    const source: SketchElement = { ...sketch(), id: elementId("source-sketch"), nodes: [{ id: "s0", point: { x: 10, y: 2 } }, { id: "s1", point: { x: 30, y: 6 } }], edges: [{ id: "source-edge", startNodeId: "s0", endNodeId: "s1" }] };
    const relation = { id: "cross-midpoint", kind: "midpoint" as const, references: [{ elementId: dependent.id, nodeId: "a" }, { elementId: source.id, edgeId: "source-edge" }] as const };
    const document = { ...documentWith([dependent, source]), constraints: [relation] };
    const solved = solveConstraintComponents(document);
    const movedSource = { ...source, nodes: [{ id: "s0", point: { x: 20, y: 10 } }, { id: "s1", point: { x: 40, y: 30 } }] };
    const afterMove = solveConstraintComponents({ ...document, elements: [dependent, movedSource] });

    expect(normalizedConstraintsForDocument(document)[0]?.references).toHaveLength(3);
    expect((solved.document.elements[0] as SketchElement).nodes[0]?.point).toEqual({ x: 20, y: 4 });
    expect(source.nodes[0]?.point).toEqual({ x: 10, y: 2 });
    expect((afterMove.document.elements[0] as SketchElement).nodes[0]?.point).toEqual({ x: 30, y: 20 });
    expect(afterMove.document.elements[1]).toEqual(movedSource);
    expect(afterMove.residuals).toEqual([expect.objectContaining({ supported: true, satisfied: true })]);
  });

  it("projects a document midpoint from a native line snapshot without moving the source", () => {
    const dependent = sketch();
    const line = { type: "line" as const, id: elementId("native-line"), layerId: fixtureLayer().id, start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style: fixtureStyle() };
    const relation = { id: "native-mid", kind: "midpoint" as const, references: [{ elementId: dependent.id, nodeId: "a" }] as const, source: { kind: "line" as const, elementId: line.id } };
    const document = { ...documentWith([dependent, line]), constraints: [relation] };
    const first = solveConstraintComponents(document);
    const movedLine = { ...line, start: { x: 20, y: 10 }, end: { x: 40, y: 30 }, rotation: Math.PI / 2 };
    const second = solveConstraintComponents({ ...document, elements: [dependent, movedLine] });

    expect((first.document.elements[0] as SketchElement).nodes[0]?.point).toEqual({ x: 5, y: 0 });
    expect((second.document.elements[0] as SketchElement).nodes[0]?.point).not.toEqual((first.document.elements[0] as SketchElement).nodes[0]?.point);
    expect(second.residuals).toEqual([expect.objectContaining({ supported: true, satisfied: true })]);
    expect(second.document.elements[1]).toEqual(movedLine);
  });

  it("projects a valid tiny native-line midpoint and reports it as supported", () => {
    const dependent = sketch();
    const line = { type: "line" as const, id: elementId("tiny-native-line"), layerId: fixtureLayer().id, start: { x: 0, y: 0 }, end: { x: 1e-9, y: 0 }, rotation: 0, style: fixtureStyle() };
    const relation = { id: "tiny-native-mid", kind: "midpoint" as const, references: [{ elementId: dependent.id, nodeId: "a" }] as const, source: { kind: "line" as const, elementId: line.id } };
    const document = { ...documentWith([dependent, line]), constraints: [relation] };
    const before = JSON.stringify(document);
    const solved = solveConstraintComponents(document);

    expect((solved.document.elements[0] as SketchElement).nodes[0]?.point).toEqual({ x: 5e-10, y: 0 });
    expect(solved.residuals).toEqual([expect.objectContaining({ supported: true, satisfied: true, residual: 0 })]);
    expect(JSON.stringify(document)).toBe(before);
    expect(solved.document.elements[1]).toEqual(line);
  });

  it("drives an open native path segment by stable identity and geometric half length", () => {
    const dependent = sketch();
    const path = { type: "path" as const, id: elementId("native-path"), layerId: fixtureLayer().id, nodes: [{ id: "p0", anchor: { x: 0, y: 0 }, join: "corner" as const }, { id: "p1", anchor: { x: 10, y: 0 }, join: "corner" as const }, { id: "p2", anchor: { x: 20, y: 0 }, join: "corner" as const }], segments: [{ id: "first", type: "cubicBezier" as const, startNodeId: "p0", endNodeId: "p1", control1: { x: 0, y: 10 }, control2: { x: 10, y: 10 } }, { id: "second", type: "line" as const, startNodeId: "p1", endNodeId: "p2" }], closed: false, style: fixtureStyle() };
    const relation = { id: "path-mid", kind: "midpoint" as const, references: [{ elementId: dependent.id, nodeId: "a" }] as const, source: { kind: "path-segment" as const, elementId: path.id, segmentId: "first" } };
    const document = { ...documentWith([dependent, path]), constraints: [relation] };
    const midpoint = halfArcLengthMidpoint(pathSegmentToCurve(path, "first").curve)!;
    const solved = solveConstraintComponents(document);
    const shifted = { ...path, nodes: [{ id: "extra", anchor: { x: -10, y: 0 }, join: "corner" as const }, ...path.nodes], segments: [{ id: "extra-segment", type: "line" as const, startNodeId: "extra", endNodeId: "p0" }, ...path.segments] };
    const shiftedSolved = solveConstraintComponents({ ...document, elements: [dependent, shifted] });
    const moved = { ...path, nodes: path.nodes.map((node) => ({ ...node, anchor: { x: node.anchor.x + 5, y: node.anchor.y + 7 } })), segments: path.segments.map((segment) => segment.type === "cubicBezier" ? { ...segment, control1: { x: segment.control1.x + 5, y: segment.control1.y + 7 }, control2: { x: segment.control2.x + 5, y: segment.control2.y + 7 } } : segment) };
    const movedSolved = solveConstraintComponents({ ...document, elements: [dependent, moved] });

    expect(midpoint).not.toEqual({ x: 5, y: 0 });
    expect((solved.document.elements[0] as SketchElement).nodes[0]?.point).toEqual(midpoint);
    expect((shiftedSolved.document.elements[0] as SketchElement).nodes[0]?.point).toEqual(midpoint);
    expect((movedSolved.document.elements[0] as SketchElement).nodes[0]?.point).toEqual({ x: midpoint.x + 5, y: midpoint.y + 7 });
    expect(solved.document.elements[1]).toEqual(path);
    expect(solved.residuals).toEqual([expect.objectContaining({ supported: true, satisfied: true })]);
    expect(normalizedConstraintsForDocument(document)[0]).toMatchObject({ sourceKind: "path-segment", sourceSegmentId: "first" });
  });

  it("resolves spline-span midpoint sources by ordered stable node IDs", () => {
    const dependent = sketch();
    const spline = { type: "spline" as const, id: elementId("native-spline"), layerId: fixtureLayer().id, nodes: [{ id: "a", anchor: { x: 0, y: 0 }, continuity: "smooth" as const, outHandle: { dx: 2, dy: 1 } }, { id: "b", anchor: { x: 10, y: 0 }, continuity: "smooth" as const, inHandle: { dx: -2, dy: 1 } }, { id: "c", anchor: { x: 20, y: 0 }, continuity: "smooth" as const }], closed: false, style: fixtureStyle() };
    const relation = { id: "spline-mid", kind: "midpoint" as const, references: [{ elementId: dependent.id, nodeId: "a" }] as const, source: { kind: "spline-span" as const, elementId: spline.id, startNodeId: "a", endNodeId: "b" } };
    const document = { ...documentWith([dependent, spline]), constraints: [relation] };
    const solved = solveConstraintComponents(document);
    const prepended = { ...spline, nodes: [{ id: "new", anchor: { x: -10, y: 0 }, continuity: "smooth" as const }, ...spline.nodes] };
    const shifted = solveConstraintComponents({ ...document, elements: [dependent, prepended] });
    const moved = { ...spline, nodes: spline.nodes.map((node) => ({ ...node, anchor: { x: node.anchor.x + 7, y: node.anchor.y + 3 }, ...(node.inHandle ? { inHandle: { dx: node.inHandle.dx + 1, dy: node.inHandle.dy + 2 } } : {}), ...(node.outHandle ? { outHandle: { dx: node.outHandle.dx + 1, dy: node.outHandle.dy + 2 } } : {}) })) };
    const movedResult = solveConstraintComponents({ ...document, elements: [dependent, moved] });
    const movedMidpoint = halfArcLengthMidpoint(splineSpanToCurve(moved, 0).curve);
    const broken = { ...spline, nodes: [spline.nodes[0]!, { id: "inserted", anchor: { x: 5, y: 0 }, continuity: "smooth" as const }, ...spline.nodes.slice(1)] };
    const unsupported = constraintResidualsForDocument({ ...document, elements: [dependent, broken] });
    const midpoint = halfArcLengthMidpoint(splineSpanToCurve(spline, 0).curve);

    expect(normalizedConstraintsForDocument(document)[0]).toMatchObject({ sourceKind: "spline-span", sourceStartNodeId: "a", sourceEndNodeId: "b" });
    expect((solved.document.elements[0] as SketchElement).nodes[0]?.point).toEqual(midpoint);
    expect(midpoint).not.toEqual({ x: 5, y: 0 });
    expect((shifted.document.elements[0] as SketchElement).nodes[0]?.point).toEqual(midpoint);
    expect((movedResult.document.elements[0] as SketchElement).nodes[0]?.point).toEqual(movedMidpoint);
    expect(movedMidpoint).not.toEqual(midpoint);
    expect(unsupported).toEqual([expect.objectContaining({ residual: Number.POSITIVE_INFINITY, supported: false })]);
    expect(solveConstraintComponents({ ...document, elements: [dependent, broken] }).document.elements[0]).toEqual(dependent);
    expect(constraintResidualsForDocument({ ...document, elements: [dependent, { ...spline, closed: true }] })).toEqual([expect.objectContaining({ supported: false })]);
    expect(constraintResidualsForDocument({ ...document, elements: [dependent, { ...spline, nodes: [spline.nodes[1]!, spline.nodes[0]!] }] })).toEqual([expect.objectContaining({ supported: false })]);
    expect(constraintResidualsForDocument({ ...document, elements: [dependent, { ...spline, nodes: [spline.nodes[0]!, { ...spline.nodes[1]!, id: "a" }] }] })).toEqual([expect.objectContaining({ supported: false })]);
  });

  it.each(["closed", "missing", "degenerate"] as const)("fails closed for %s path sources", (failure) => {
    const dependent = sketch();
    const base = { type: "path" as const, id: elementId("native-path"), layerId: fixtureLayer().id, nodes: [{ id: "p0", anchor: { x: 0, y: 0 }, join: "corner" as const }, { id: "p1", anchor: { x: 10, y: 0 }, join: "corner" as const }], segments: [{ id: "segment", type: "line" as const, startNodeId: "p0", endNodeId: "p1" }], closed: false, style: fixtureStyle() };
    const path = failure === "closed" ? { ...base, closed: true } : failure === "degenerate" ? { ...base, nodes: base.nodes.map((node) => ({ ...node, anchor: { x: 0, y: 0 } })) } : base;
    const relation = { id: "path-mid", kind: "midpoint" as const, references: [{ elementId: dependent.id, nodeId: "a" }] as const, source: { kind: "path-segment" as const, elementId: path.id, segmentId: failure === "missing" ? "absent" : "segment" } };
    const document = { ...documentWith([dependent, path]), constraints: [relation] };
    expect(constraintResidualsForDocument(document)).toEqual([expect.objectContaining({ residual: Number.POSITIVE_INFINITY, satisfied: false, supported: false })]);
    expect(solveConstraintComponents(document).document.elements[1]).toEqual(path);
  });

  it("keeps unsupported and missing entities distinguishable", () => {
    const line = { type: "line" as const, id: elementId("line"), layerId: fixtureLayer().id, start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style: fixtureStyle() };
    const document = documentWith([line]);

    expect(constraintStateForElement(document, line.id)).toEqual({ elementId: line.id, state: "not-parametric", conflicts: [] });
    expect(constraintStateForElement(document, elementId("missing"))).toEqual({ elementId: elementId("missing"), state: "invalid", conflicts: ["element-not-found"] });
  });
});
