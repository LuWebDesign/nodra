import { describe, expect, it } from "vitest";
import { createDocument, elementId, layerId } from "@nodra/domain";
import { parseDocument, serializeDocument, validateDocument } from "./index.js";

const glyph = { type: "glyph" as const, id: elementId("g"), layerId: layerId("layer"), position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, glyph: "O", fillRule: "evenodd" as const, rotation: 0, style: { stroke: "#000", fill: "#000", strokeWidth: 1 }, contours: [{ nodes: [{ id: "a", anchor: { x: 0, y: 0 }, join: "corner" as const }, { id: "b", anchor: { x: 10, y: 0 }, join: "corner" as const }, { id: "c", anchor: { x: 10, y: 10 }, join: "corner" as const }], segments: [{ type: "line" as const, startNodeId: "a", endNodeId: "b" }, { type: "line" as const, startNodeId: "b", endNodeId: "c" }, { type: "line" as const, startNodeId: "c", endNodeId: "a" }] }] };

describe("glyph persistence validation", () => {
  it("accepts and round-trips cubic compound glyph data", () => {
    const document = createDocument("doc", [{ id: layerId("layer"), name: "Design", visible: true, order: 0 }]);
    const source = { ...document, elements: [glyph] };
    const checked = validateDocument(source);
    expect(checked.success).toBe(true);
    expect(parseDocument(serializeDocument(source)).success).toBe(true);
  });
  it("rejects a contour whose segments do not close its node topology", () => {
    const document = createDocument("doc", [{ id: layerId("layer"), name: "Design", visible: true, order: 0 }]);
    expect(validateDocument({ ...document, elements: [{ ...glyph, contours: [{ ...glyph.contours[0]!, segments: glyph.contours[0]!.segments.slice(0, 2) }] }] }).success).toBe(false);
  });
});
