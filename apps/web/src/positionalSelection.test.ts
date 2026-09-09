import { describe, expect, it } from "vitest";
import type { PositionalNodeReference } from "./positionalSelection.js";
import { positionalConnectionPair } from "./positionalSelection.js";

const reference = (key: string, elementId: string, elementType: string, address: PositionalNodeReference["address"]): PositionalNodeReference => ({ key, elementId: elementId as PositionalNodeReference["elementId"], elementType, nodeIndex: 0, address });
const circle = (key = "circle:p:0", id = "circle-1") => reference(key, id, "circle", { kind: "named", name: "center" });
const sketch = (key = "sketch:p:0", id = "sketch-1") => reference(key, id, "sketch", { kind: "sketch", nodeId: "node-1" });

const pair = (...references: PositionalNodeReference[]) => positionalConnectionPair(references.map((item) => item.key), references);

describe("positionalConnectionPair", () => {
  it("preserves click order for every supported anchor type", () => {
    const refs = [
      reference("line:p:0", "line-1", "line", { kind: "line", name: "start" }),
      sketch(),
      reference("path:p:0", "path-1", "path", { kind: "path", nodeId: "node-1" }),
      circle(),
      reference("arc:p:0", "arc-1", "arc", { kind: "named", name: "start" }),
    ];
    for (const [source, target] of [[refs[0], refs[1]], [refs[1], refs[2]], [refs[2], refs[3]], [refs[3], refs[4]], [refs[4], refs[0]]]) {
      const result = pair(source!, target!);
      expect(result && [result.source.elementId, result.target.elementId]).toEqual([source!.elementId, target!.elementId]);
    }
  });

  it("does not reorder a target into an arbitrary circular source", () => {
    const result = pair(sketch(), circle());
    expect(result && [result.source.elementId, result.target.elementId]).toEqual(["sketch-1", "circle-1"]);
  });

  it("rejects handles, missing nodes, and selections with more or fewer than two nodes", () => {
    const handle = reference("path:p:1", "path-1", "path", { kind: "path", nodeId: "node-1", handle: "out" });
    expect(pair(circle(), handle)).toBeUndefined();
    expect(pair(reference("ellipse:p:0", "ellipse-1", "ellipse", { kind: "named", name: "center" }), sketch())).toBeUndefined();
    expect(positionalConnectionPair(["circle:p:0", "missing"], [circle(), sketch()])).toBeUndefined();
    expect(positionalConnectionPair(["circle:p:0"], [circle(), sketch()])).toBeUndefined();
    expect(positionalConnectionPair(["circle:p:0", "sketch:p:0", "path:p:0"], [circle(), sketch(), reference("path:p:0", "path-1", "path", { kind: "path", nodeId: "node-2" })])).toBeUndefined();
  });
});
