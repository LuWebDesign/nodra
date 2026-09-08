import { describe, expect, it } from "vitest";
import { createDocument, elementId } from "@nodra/domain";
import { documentWith, sketch } from "./test-fixtures.js";

describe("constraint test fixtures", () => {
  it("builds independent deterministic sketches and documents", () => {
    const first = sketch();
    const second = sketch();

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.nodes).not.toBe(second.nodes);
    expect(first.nodes[0]).not.toBe(second.nodes[0]);
    const document = documentWith([first]);
    expect(document.schemaVersion).toBe(createDocument("constraint-state").schemaVersion);
    expect(document.elements).toEqual([first]);
    expect(document.layers).toEqual([{ id: "constraints", name: "Croquis", visible: true, order: 0 }]);
  });

  it("accepts typed node and edge overrides without changing stable defaults", () => {
    const overridden = sketch({
      nodes: [{ id: "start", point: { x: 0, y: 0 } }, { id: "finish", point: { x: 5, y: 5 } }],
      edges: [{ id: "segment", startNodeId: "start", endNodeId: "finish" }],
    });

    expect(overridden.nodes).toEqual([{ id: "start", point: { x: 0, y: 0 } }, { id: "finish", point: { x: 5, y: 5 } }]);
    expect(sketch().nodes).toEqual([{ id: "a", point: { x: 10, y: 10 } }, { id: "b", point: { x: 30, y: 10 } }]);
  });

  it("preserves boundary, conflict, and malformed constraint records explicitly", () => {
    const constraints = [
      { id: "boundary", kind: "distance" as const, references: [{ elementId: elementId("sketch"), nodeId: "a" }, { elementId: elementId("sketch"), nodeId: "b" }] as const, value: 0 },
      { id: "conflict", kind: "horizontal" as const, references: [{ elementId: elementId("sketch"), nodeId: "a" }, { elementId: elementId("sketch"), nodeId: "b" }] as const },
      { id: "malformed", kind: "horizontal" as const, references: [{ elementId: elementId("sketch"), nodeId: "missing" }, { elementId: elementId("sketch"), nodeId: "b" }] as const },
    ];
    const fixture = sketch({ constraints });

    expect(fixture.constraints).toEqual(constraints);
    expect(fixture.constraints?.[2]?.references[0]).toEqual({ elementId: "sketch", nodeId: "missing" });
    expect(fixture.constraints).not.toBe(constraints);
  });
});
