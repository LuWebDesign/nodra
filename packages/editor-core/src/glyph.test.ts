import { describe, expect, it } from "vitest";
import { createDocument, elementId, layerId, type TextElement } from "@nodra/domain";
import { convertTextToGlyphs, createEditor, dispatch, undo, redo, updateElementNode, type GlyphOutlineData } from "./index.js";

const style = { stroke: "#000", fill: "#000", strokeWidth: 0.1 };
const outline: GlyphOutlineData = {
  glyph: "O", position: { x: 10, y: 10 }, size: { width: 10, height: 10 },
  contours: [
    { nodes: [{ id: "outer-a", anchor: { x: 10, y: 10 }, join: "corner" }, { id: "outer-b", anchor: { x: 20, y: 10 }, join: "corner" }, { id: "outer-c", anchor: { x: 20, y: 20 }, join: "corner" }], segments: [{ type: "cubicBezier", startNodeId: "outer-a", endNodeId: "outer-b", control1: { x: 13, y: 7 }, control2: { x: 17, y: 7 } }, { type: "line", startNodeId: "outer-b", endNodeId: "outer-c" }, { type: "line", startNodeId: "outer-c", endNodeId: "outer-a" }] },
    { nodes: [{ id: "hole-a", anchor: { x: 13, y: 13 }, join: "corner" }, { id: "hole-b", anchor: { x: 17, y: 13 }, join: "corner" }, { id: "hole-c", anchor: { x: 17, y: 17 }, join: "corner" }], segments: [{ type: "line", startNodeId: "hole-a", endNodeId: "hole-b" }, { type: "line", startNodeId: "hole-b", endNodeId: "hole-c" }, { type: "line", startNodeId: "hole-c", endNodeId: "hole-a" }] },
  ],
};
const text: TextElement = { type: "text", id: elementId("text"), layerId: layerId("layer"), position: { x: 10, y: 10 }, size: { width: 10, height: 10 }, text: "O", fontFamily: "Uploaded", fontSize: 10, fontWeight: "normal", fontStyle: "normal", textAlign: "left", lineHeight: 1.2, rotation: Math.PI / 4, style };
const document = createDocument("doc", [{ id: text.layerId, name: "Design", visible: true, order: 0 }]);

describe("text-to-glyph conversion", () => {
  it("replaces one text element atomically, preserves compound contours, and selects glyphs", () => {
    const state = dispatch(createEditor({ ...document, elements: [text] }), convertTextToGlyphs(text.id, [outline, { ...outline, glyph: "!", position: { x: 22, y: 10 } }]));
    expect(state.document.elements.map((element) => element.type)).toEqual(["glyph", "glyph"]);
    expect(state.document.elements[0]).toMatchObject({ style, rotation: 0, contours: [{}, {}] });
    expect(state.selection).toEqual([elementId("text:glyph:0"), elementId("text:glyph:1")]);
    expect(undo(state).document.elements).toEqual([text]);
    expect(redo(undo(state)).selection).toEqual(state.selection);
  });

  it("rejects empty outlines without changing the document", () => {
    const initial = createEditor({ ...document, elements: [text] });
    expect(dispatch(initial, convertTextToGlyphs(text.id, []))).toBe(initial);
  });

  it("edits glyph anchors and cubic controls through the Forma node command", () => {
    const created = dispatch(createEditor({ ...document, elements: [text] }), convertTextToGlyphs(text.id, [outline]));
    const movedAnchor = dispatch(created, updateElementNode(elementId("text:glyph:0"), 0, { x: 11, y: 11 }));
    const movedControl = dispatch(movedAnchor, updateElementNode(elementId("text:glyph:0"), 3, { x: 14, y: 6 }));
    const glyph = movedControl.document.elements[0];
    expect(glyph?.type).toBe("glyph");
    if (glyph?.type === "glyph") expect(glyph.contours[0]?.segments[0]).toMatchObject({ control1: { x: 14, y: 6 } });
  });
});
