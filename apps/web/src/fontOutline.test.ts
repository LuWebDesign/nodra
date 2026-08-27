import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FontOutlineError, extractTextGlyphOutlines, fontFamilyFromFileName, simplifyGlyphContour, simplifyGlyphContourForMode } from "./fontOutline.js";
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
  it("removes redundant linear glyph nodes without changing the closed contour", () => {
    const contour = simplifyGlyphContour({
      nodes: [
        { id: "a", anchor: { x: 0, y: 0 }, join: "corner" },
        { id: "b", anchor: { x: 5, y: 0.001 }, join: "corner" },
        { id: "c", anchor: { x: 10, y: 0 }, join: "corner" },
        { id: "d", anchor: { x: 10, y: 10 }, join: "corner" },
        { id: "e", anchor: { x: 0, y: 10 }, join: "corner" },
      ],
      segments: [
        { type: "line", startNodeId: "a", endNodeId: "b" },
        { type: "line", startNodeId: "b", endNodeId: "c" },
        { type: "line", startNodeId: "c", endNodeId: "d" },
        { type: "line", startNodeId: "d", endNodeId: "e" },
        { type: "line", startNodeId: "e", endNodeId: "a" },
      ],
    });
    expect(contour.nodes.map((node) => node.id)).toEqual(["a", "c", "d", "e"]);
    expect(contour.segments).toContainEqual({ type: "line", startNodeId: "a", endNodeId: "c" });
    expect(contour.segments).toHaveLength(contour.nodes.length);
  });
  it("keeps aligned nodes that do not project between their neighbours", () => {
    const contour = simplifyGlyphContour({
      nodes: [
        { id: "a", anchor: { x: 0, y: 0 }, join: "corner" },
        { id: "b", anchor: { x: 20, y: 0 }, join: "corner" },
        { id: "c", anchor: { x: 10, y: 0 }, join: "corner" },
        { id: "d", anchor: { x: 10, y: 10 }, join: "corner" },
        { id: "e", anchor: { x: 0, y: 10 }, join: "corner" },
      ],
      segments: [
        { type: "line", startNodeId: "a", endNodeId: "b" },
        { type: "line", startNodeId: "b", endNodeId: "c" },
        { type: "line", startNodeId: "c", endNodeId: "d" },
        { type: "line", startNodeId: "d", endNodeId: "e" },
        { type: "line", startNodeId: "e", endNodeId: "a" },
      ],
    });
    expect(contour.nodes.map((node) => node.id)).toContain("b");
  });
  it("rebuilds editable glyph contours as smooth cubic curves with fewer smart nodes", () => {
    const contour = simplifyGlyphContourForMode({
      nodes: Array.from({ length: 24 }, (_, index) => {
        const angle = index / 24 * Math.PI * 2;
        return { id: `n-${index}`, anchor: { x: Math.cos(angle) * 10, y: Math.sin(angle) * 10 }, join: "corner" as const };
      }),
      segments: Array.from({ length: 24 }, (_, index) => ({ type: "line" as const, startNodeId: `n-${index}`, endNodeId: `n-${(index + 1) % 24}` })),
    }, "editable");
    expect(contour.nodes.length).toBeLessThanOrEqual(20);
    expect(contour.segments.every((segment) => segment.type === "cubicBezier")).toBe(true);
  });
  it("keeps precise glyph contours closer to the source node count", () => {
    const source = {
      nodes: Array.from({ length: 24 }, (_, index) => {
        const angle = index / 24 * Math.PI * 2;
        return { id: `n-${index}`, anchor: { x: Math.cos(angle) * 10, y: Math.sin(angle) * 10 }, join: "corner" as const };
      }),
      segments: Array.from({ length: 24 }, (_, index) => ({ type: "line" as const, startNodeId: `n-${index}`, endNodeId: `n-${(index + 1) % 24}` })),
    };
    expect(simplifyGlyphContourForMode(source, "precise").nodes.length).toBeGreaterThan(simplifyGlyphContourForMode(source, "editable").nodes.length);
  });
  it("preserves cubic glyph handles while simplifying neighbouring lines", () => {
    const contour = simplifyGlyphContour({
      nodes: [
        { id: "a", anchor: { x: 0, y: 0 }, join: "corner" },
        { id: "b", anchor: { x: 5, y: 0 }, join: "corner" },
        { id: "c", anchor: { x: 10, y: 0 }, join: "corner" },
        { id: "d", anchor: { x: 10, y: 10 }, join: "corner" },
      ],
      segments: [
        { type: "line", startNodeId: "a", endNodeId: "b" },
        { type: "line", startNodeId: "b", endNodeId: "c" },
        { type: "cubicBezier", startNodeId: "c", endNodeId: "d", control1: { x: 12, y: 2 }, control2: { x: 12, y: 8 } },
        { type: "line", startNodeId: "d", endNodeId: "a" },
      ],
    });
    expect(contour.nodes.map((node) => node.id)).toEqual(["a", "c", "d"]);
    expect(contour.segments).toContainEqual({ type: "cubicBezier", startNodeId: "c", endNodeId: "d", control1: { x: 12, y: 2 }, control2: { x: 12, y: 8 } });
  });
  it("fails clearly when CSS font metadata has no uploaded bytes", () => {
    const text: TextElement = { type: "text", id: elementId("text"), layerId: layerId("layer"), position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, text: "A", fontFamily: "Arial", fontSize: 10, fontWeight: "normal", fontStyle: "normal", textAlign: "left", lineHeight: 1.2, rotation: 0, style: { stroke: "#000", fill: "#000", strokeWidth: 1 } };
    expect(() => extractTextGlyphOutlines(text, () => undefined)).toThrow(FontOutlineError);
  });
  it("keeps editable compound glyphs within a small node budget", () => {
    const fontPath = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
    if (!existsSync(fontPath)) return;
    const text: TextElement = { type: "text", id: elementId("text"), layerId: layerId("layer"), position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, text: "O", fontFamily: "DejaVuSans", fontSize: 10, fontWeight: "normal", fontStyle: "normal", textAlign: "left", lineHeight: 1.2, rotation: 0, style: { stroke: "#000", fill: "#000", strokeWidth: 1 } };
    const outline = extractTextGlyphOutlines(text, () => fontBytes(fontPath), "editable")[0]!;
    const nodeCount = outline.contours.reduce((count, contour) => count + contour.nodes.length, 0);
    expect(nodeCount).toBeLessThanOrEqual(24);
    expect(outline.contours.every((contour) => contour.segments.every((segment) => segment.type === "cubicBezier"))).toBe(true);
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
