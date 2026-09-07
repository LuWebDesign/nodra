import { describe, expect, it } from "vitest";
import type { PositionalNodeReference } from "./positionalSelection.js";
import { positionalConnectionPair } from "./positionalSelection.js";

const reference = (key: string, elementId: string, elementType: string, address: PositionalNodeReference["address"]): PositionalNodeReference => ({ key, elementId: elementId as PositionalNodeReference["elementId"], elementType, nodeIndex: 0, address });
const circle = (key = "circle:p:0", id = "circle-1") => reference(key, id, "circle", { kind: "named", name: "center" });
const sketch = (key = "sketch:p:0", id = "sketch-1") => reference(key, id, "sketch", { kind: "sketch", nodeId: "node-1" });

const pair = (...references: PositionalNodeReference[]) => positionalConnectionPair(references.map((item) => item.key), references);

describe("positionalConnectionPair", () => {
  it("preserves click order and permits a circular target", () => {
    const target = circle("circle:p:1", "circle-2");
    const result = pair(circle(), target);
    expect(result && [result.source.elementId, result.target.elementId]).toEqual(["circle-1", "circle-2"]);
  });

  it("requires the first selected anchor to be the circular source", () => {
    expect(pair(sketch(), circle())).toBeUndefined();
  });

  it("rejects handles, missing nodes, and selections with more or fewer than two nodes", () => {
    const handle = reference("path:p:1", "path-1", "path", { kind: "path", nodeId: "node-1", handle: "out" });
    expect(pair(circle(), handle)).toBeUndefined();
    expect(positionalConnectionPair(["circle:p:0", "missing"], [circle(), sketch()])).toBeUndefined();
    expect(positionalConnectionPair(["circle:p:0"], [circle(), sketch()])).toBeUndefined();
    expect(positionalConnectionPair(["circle:p:0", "sketch:p:0", "path:p:0"], [circle(), sketch(), reference("path:p:0", "path-1", "path", { kind: "path", nodeId: "node-2" })])).toBeUndefined();
  });
});
