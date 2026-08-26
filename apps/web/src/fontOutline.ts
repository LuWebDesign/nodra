import opentype from "opentype.js";
import { type GlyphOutlineData } from "@nodra/editor-core";
import type { PointMm, TextElement } from "@nodra/domain";

export type FontSourceResolver = (fontFamily: string) => ArrayBuffer | undefined;
export class FontOutlineError extends Error { constructor(message: string) { super(message); this.name = "FontOutlineError"; } }
export const fontFamilyFromFileName = (fileName: string): string => fileName.replace(/\.(ttf|otf|woff|woff2)$/i, "").trim() || "Fuente cargada";

/** Web composition boundary: CSS font-family names are not font bytes and cannot be parsed. */
export function extractTextGlyphOutlines(text: TextElement, resolveFont: FontSourceResolver): readonly GlyphOutlineData[] {
  const bytes = resolveFont(text.fontFamily);
  if (!bytes) throw new FontOutlineError(`No font bytes are available for ${text.fontFamily}. Upload a TTF or OTF font first.`);
  let font: import("opentype.js").Font;
  try { font = opentype.parse(bytes); } catch (error) { throw new FontOutlineError(`The font source could not be parsed: ${error instanceof Error ? error.message : "unknown error"}`); }
  // Keep opentype.js glyph shaping: one output element may represent a ligature.
  const glyphs = font.stringToGlyphs(text.text);
  const kerning = glyphs.map((glyph, index) => index === 0 ? 0 : font.getKerningValue(glyphs[index - 1]!, glyph));
  const fontScale = text.fontSize / font.unitsPerEm;
  const totalAdvance = glyphs.reduce((sum, glyph, index) => sum + (kerning[index] ?? 0) + glyph.advanceWidth, 0) * fontScale;
  const alignmentOffset = text.textAlign === "center" ? (text.size.width - totalAdvance) / 2 : text.textAlign === "right" ? text.size.width - totalAdvance : 0;
  const baseline = text.fontSize * 0.8;
  const scaleX = text.scaleX ?? 1;
  const scaleY = text.scaleY ?? 1;
  let advanceX = 0;
  const transform = (point: PointMm): PointMm => {
    const unscaled = { x: text.position.x + alignmentOffset + advanceX * fontScale + point.x, y: text.position.y + point.y };
    const dx = (unscaled.x - text.position.x) * scaleX; const dy = (unscaled.y - text.position.y) * scaleY;
    return { x: text.position.x + dx * Math.cos(text.rotation) - dy * Math.sin(text.rotation), y: text.position.y + dx * Math.sin(text.rotation) + dy * Math.cos(text.rotation) };
  };
  const result: GlyphOutlineData[] = [];
  for (const [index, glyph] of glyphs.entries()) {
    advanceX += (kerning[index] ?? 0);
    const commands = glyph.getPath(0, baseline, text.fontSize).commands;
    const contours: Array<GlyphOutlineData["contours"][number]> = [];
    let nodes: { id: string; anchor: PointMm; join: "corner" }[] = [];
    let segments: GlyphOutlineData["contours"][number]["segments"] = [];
    let start: string | undefined; let previous: string | undefined; let nodeCount = 0;
    const finish = () => { if (nodes.length >= 2 && start && previous) { if (previous !== start) segments = [...segments, { type: "line", startNodeId: previous, endNodeId: start }]; contours.push({ nodes, segments }); } nodes = []; segments = []; start = undefined; previous = undefined; };
    for (const command of commands) {
      if (command.type === "M") { finish(); const node = { id: `glyph-${index}-node-${nodeCount++}`, anchor: transform({ x: command.x, y: command.y }), join: "corner" as const }; nodes = [node]; start = node.id; previous = node.id; }
      else if ((command.type === "L" || command.type === "C") && previous) {
        const end = { id: `glyph-${index}-node-${nodeCount++}`, anchor: transform({ x: command.x, y: command.y }), join: "corner" as const };
        segments = [...segments, command.type === "C" ? { type: "cubicBezier" as const, startNodeId: previous, endNodeId: end.id, control1: transform({ x: command.x1, y: command.y1 }), control2: transform({ x: command.x2, y: command.y2 }) } : { type: "line" as const, startNodeId: previous, endNodeId: end.id }];
        nodes = [...nodes, end]; previous = end.id;
      } else if (command.type === "Q" && previous) {
        const end = { id: `glyph-${index}-node-${nodeCount++}`, anchor: transform({ x: command.x, y: command.y }), join: "corner" as const };
        const start = nodes.at(-1)!.anchor;
        const quadratic = transform({ x: command.x1, y: command.y1 });
        const c1 = { x: start.x + (quadratic.x - start.x) * 2 / 3, y: start.y + (quadratic.y - start.y) * 2 / 3 };
        const c2 = { x: end.anchor.x + (quadratic.x - end.anchor.x) * 2 / 3, y: end.anchor.y + (quadratic.y - end.anchor.y) * 2 / 3 };
        segments = [...segments, { type: "cubicBezier" as const, startNodeId: previous, endNodeId: end.id, control1: c1, control2: c2 }];
        nodes = [...nodes, end]; previous = end.id;
      } else if (command.type === "Z") finish();
    }
    finish();
    if (contours.length) {
      const points = contours.flatMap((contour) => contour.nodes.map((node) => node.anchor));
      const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
      result.push({ glyph: glyph.name ?? String.fromCodePoint(...[...text.text].map((value) => value.codePointAt(0) ?? 0).slice(index, index + 1)), position: { x: Math.min(...xs), y: Math.min(...ys) }, size: { width: Math.max(0.001, Math.max(...xs) - Math.min(...xs)), height: Math.max(0.001, Math.max(...ys) - Math.min(...ys)) }, contours });
    }
    advanceX += glyph.advanceWidth;
  }
  return result;
}
