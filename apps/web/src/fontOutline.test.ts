import { describe, expect, it } from "vitest";
import { FontOutlineError, extractTextGlyphOutlines, fontFamilyFromFileName } from "./fontOutline.js";
import { elementId, layerId, type TextElement } from "@nodra/domain";

describe("font outline adapter", () => {
  it("derives a stable family fallback for supported browser font files", () => {
    expect(fontFamilyFromFileName("My Font.WOFF2")).toBe("My Font");
    expect(fontFamilyFromFileName("font-without-extension")).toBe("font-without-extension");
  });
  it("fails clearly when CSS font metadata has no uploaded bytes", () => {
    const text: TextElement = { type: "text", id: elementId("text"), layerId: layerId("layer"), position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, text: "A", fontFamily: "Arial", fontSize: 10, fontWeight: "normal", fontStyle: "normal", textAlign: "left", lineHeight: 1.2, rotation: 0, style: { stroke: "#000", fill: "#000", strokeWidth: 1 } };
    expect(() => extractTextGlyphOutlines(text, () => undefined)).toThrow(FontOutlineError);
  });
});
