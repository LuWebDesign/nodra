import { describe, expect, it } from "vitest";
import { createDocument, elementId, layerId, revision, withElements } from "./index.js";

describe("domain contracts", () => {
  it("creates immutable-shaped versioned documents and increments revisions", () => {
    const layer = { id: layerId("design"), name: "Design", visible: true, order: 0 } as const;
    const document = createDocument("doc-1", [layer]);
    const element = { type: "line" as const, id: elementId("line-1"), layerId: layer.id, start: { x: 0, y: 0 }, end: { x: 10, y: 4 }, rotation: 0, style: { stroke: "#000", strokeWidth: 0.2 } };
    const next = withElements(document, [element]);
    expect(document.revision).toBe(revision(0));
    expect(next.revision).toBe(revision(1));
    expect(next.elements).toEqual([element]);
  });
});
