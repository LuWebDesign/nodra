import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FontOutlineError, extractTextGlyphOutlines, fontFamilyFromFileName } from "./fontOutline.js";
import { createDocument, elementId, layerId, type TextElement } from "@nodra/domain";
import { validateDocument } from "@nodra/validation";

const fontBytes = (path: string): ArrayBuffer => {
  const buffer = readFileSync(path);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
};

describe("font outline adapter", () => {
  it("derives a stable family fallback for supported browser font files", () => {
    expect(fontFamilyFromFileName("My Font.WOFF2")).toBe("My Font");
    expect(fontFamilyFromFileName("font-without-extension")).toBe("font-without-extension");
  });
  it("fails clearly when CSS font metadata has no uploaded bytes", () => {
    const text: TextElement = { type: "text", id: elementId("text"), layerId: layerId("layer"), position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, text: "A", fontFamily: "Arial", fontSize: 10, fontWeight: "normal", fontStyle: "normal", textAlign: "left", lineHeight: 1.2, rotation: 0, style: { stroke: "#000", fill: "#000", strokeWidth: 1 } };
    expect(() => extractTextGlyphOutlines(text, () => undefined)).toThrow(FontOutlineError);
  });
  it("creates valid unique node IDs for compound glyphs", () => {
    const fontPath = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
    if (!existsSync(fontPath)) return;
    const text: TextElement = { type: "text", id: elementId("text"), layerId: layerId("layer"), position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, text: "O", fontFamily: "DejaVuSans", fontSize: 10, fontWeight: "normal", fontStyle: "normal", textAlign: "left", lineHeight: 1.2, rotation: 0, style: { stroke: "#000", fill: "#000", strokeWidth: 1 } };
    const outlines = extractTextGlyphOutlines(text, () => fontBytes(fontPath));
    expect(outlines[0]?.contours.length).toBeGreaterThan(1);
    const glyphs = outlines.map((outline, index) => ({ type: "glyph" as const, id: elementId(`glyph-${index}`), layerId: text.layerId, fillRule: "evenodd" as const, rotation: 0, style: text.style, ...outline }));
    expect(validateDocument({ ...createDocument("project", [{ id: text.layerId, name: "Layer", visible: true, order: 0 }]), elements: glyphs }).success).toBe(true);
  });
  it("preserves visual scale and top-to-bottom orientation", () => {
    const fontPath = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
    if (!existsSync(fontPath)) return;
    const text: TextElement = { type: "text", id: elementId("text"), layerId: layerId("layer"), position: { x: 10, y: 20 }, size: { width: 30, height: 12 }, text: "A", fontFamily: "DejaVuSans", fontSize: 10, fontWeight: "normal", fontStyle: "normal", textAlign: "left", lineHeight: 1.2, rotation: 0, scaleX: 2, scaleY: 3, style: { stroke: "#000", fill: "#000", strokeWidth: 1 } };
    const outline = extractTextGlyphOutlines(text, () => fontBytes(fontPath))[0]!;
    const points = outline.contours.flatMap((contour) => contour.nodes.map((node) => node.anchor));
    const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(text.position.x);
    expect(Math.max(...xs)).toBeGreaterThan(text.position.x + 10);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(text.position.y);
    expect(Math.max(...ys)).toBeGreaterThan(text.position.y + 20);
  });
});
