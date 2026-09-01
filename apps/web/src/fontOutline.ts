import opentype from "opentype.js";
import { type GlyphOutlineData } from "@nodra/editor-core";
import type { PathLineSegment, PathSegment, PointMm, TextElement } from "@nodra/domain";

export type FontSourceResolver = (fontFamily: string) => ArrayBuffer | undefined;
export type TextCurveMode = "editable" | "balanced" | "precise";
export class FontOutlineError extends Error { constructor(message: string) { super(message); this.name = "FontOutlineError"; } }
export const fontFamilyFromFileName = (fileName: string): string => fileName.replace(/\.(ttf|otf|woff|woff2)$/i, "").trim() || "Fuente cargada";
const defaultSimplificationToleranceMm = 0.01;
const curveModeSettings: Record<TextCurveMode, { readonly tolerance: number; readonly maxGlyphNodes: number; readonly maxContourNodes: number; readonly samplesPerCubic: number; readonly smoothness: number }> = {
  editable: { tolerance: 0.22, maxGlyphNodes: 20, maxContourNodes: 12, samplesPerCubic: 10, smoothness: 0.88 },
  balanced: { tolerance: 0.1, maxGlyphNodes: 36, maxContourNodes: 20, samplesPerCubic: 12, smoothness: 0.9 },
  precise: { tolerance: defaultSimplificationToleranceMm, maxGlyphNodes: Number.POSITIVE_INFINITY, maxContourNodes: Number.POSITIVE_INFINITY, samplesPerCubic: 0, smoothness: 0 },
};
const squaredDistance = (first: PointMm, second: PointMm): number => (first.x - second.x) ** 2 + (first.y - second.y) ** 2;
const pointLineDistance = (point: PointMm, start: PointMm, end: PointMm): number => {
  const lengthSquared = squaredDistance(start, end);
  if (lengthSquared === 0) return Math.sqrt(squaredDistance(point, start));
  const area = Math.abs((end.x - start.x) * (start.y - point.y) - (start.x - point.x) * (end.y - start.y));
  return area / Math.sqrt(lengthSquared);
};
const pointProjectsBetween = (point: PointMm, start: PointMm, end: PointMm, tolerance: number): boolean => {
  const dx = end.x - start.x; const dy = end.y - start.y;
  const lengthSquared = dx ** 2 + dy ** 2;
  if (lengthSquared === 0) return false;
  const projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const slack = tolerance / Math.sqrt(lengthSquared);
  return projection >= -slack && projection <= 1 + slack;
};
const cubicPoint = (start: PointMm, control1: PointMm, control2: PointMm, end: PointMm, t: number): PointMm => {
  const mt = 1 - t;
  return {
    x: mt ** 3 * start.x + 3 * mt ** 2 * t * control1.x + 3 * mt * t ** 2 * control2.x + t ** 3 * end.x,
    y: mt ** 3 * start.y + 3 * mt ** 2 * t * control1.y + 3 * mt * t ** 2 * control2.y + t ** 3 * end.y,
  };
};
const replacementLine = (startNodeId: string, endNodeId: string): PathLineSegment => ({ id: `glyph-segment:${startNodeId}:${endNodeId}`, type: "line", startNodeId, endNodeId });
const canRemoveLinearNode = (contour: GlyphOutlineData["contours"][number], index: number, tolerance: number): boolean => {
  const previousIndex = (index - 1 + contour.nodes.length) % contour.nodes.length;
  const previous = contour.nodes[previousIndex];
  const current = contour.nodes[index];
  const next = contour.nodes[(index + 1) % contour.nodes.length];
  const incoming = contour.segments[previousIndex];
  const outgoing = contour.segments[index];
  if (!previous || !current || !next || incoming?.type !== "line" || outgoing?.type !== "line") return false;
  const duplicateToleranceSquared = tolerance ** 2;
  if (squaredDistance(previous.anchor, current.anchor) <= duplicateToleranceSquared || squaredDistance(current.anchor, next.anchor) <= duplicateToleranceSquared) return true;
  return pointLineDistance(current.anchor, previous.anchor, next.anchor) <= tolerance && pointProjectsBetween(current.anchor, previous.anchor, next.anchor, tolerance);
};

export function simplifyGlyphContour(contour: GlyphOutlineData["contours"][number], tolerance = defaultSimplificationToleranceMm): GlyphOutlineData["contours"][number] {
  if (contour.nodes.length !== contour.segments.length || contour.nodes.length <= 2 || !Number.isFinite(tolerance) || tolerance < 0) return contour;
  let nodes = [...contour.nodes];
  let segments = [...contour.segments];
  let changed = true;
  while (changed && nodes.length > 2) {
    changed = false;
    for (let index = 0; index < nodes.length; index += 1) {
      const candidate = { nodes, segments } satisfies GlyphOutlineData["contours"][number];
      if (!canRemoveLinearNode(candidate, index, tolerance)) continue;
      const previousIndex = (index - 1 + nodes.length) % nodes.length;
      const nextIndex = (index + 1) % nodes.length;
      const replacement = replacementLine(nodes[previousIndex]!.id, nodes[nextIndex]!.id);
      nodes = nodes.filter((_, nodeIndex) => nodeIndex !== index);
      segments = segments.map((segment, segmentIndex) => segmentIndex === previousIndex ? replacement : segment).filter((_, segmentIndex) => segmentIndex !== index);
      changed = true;
      break;
    }
  }
  return { nodes, segments };
}

interface SamplePoint { readonly id: string; readonly point: PointMm }
const contourSamples = (contour: GlyphOutlineData["contours"][number], samplesPerCubic: number): SamplePoint[] => {
  const samples: SamplePoint[] = [];
  for (const [index, node] of contour.nodes.entries()) {
    const segment = contour.segments[index];
    const next = contour.nodes[(index + 1) % contour.nodes.length];
    if (!segment || !next) continue;
    if (!samples.length || squaredDistance(samples.at(-1)!.point, node.anchor) > 0) samples.push({ id: node.id, point: node.anchor });
    if (segment.type === "cubicBezier") {
      for (let step = 1; step < samplesPerCubic; step += 1) samples.push({ id: `${node.id}:sample:${step}`, point: cubicPoint(node.anchor, segment.control1, segment.control2, next.anchor, step / samplesPerCubic) });
    }
  }
  return samples;
};
const removalError = (points: readonly SamplePoint[], index: number): number => {
  const previous = points[(index - 1 + points.length) % points.length];
  const current = points[index];
  const next = points[(index + 1) % points.length];
  return previous && current && next && pointProjectsBetween(current.point, previous.point, next.point, 0) ? pointLineDistance(current.point, previous.point, next.point) : Number.POSITIVE_INFINITY;
};
const reduceClosedSamples = (samples: readonly SamplePoint[], tolerance: number, maxNodes: number): SamplePoint[] => {
  let points = samples.filter((point, index) => index === 0 || squaredDistance(point.point, samples[index - 1]!.point) > tolerance ** 2 / 16);
  while (points.length > 3) {
    const scored = points.map((_, index) => ({ index, error: removalError(points, index) })).sort((a, b) => a.error - b.error);
    const best = scored[0];
    if (!best || (points.length <= maxNodes && best.error > tolerance)) break;
    points = points.filter((_, index) => index !== best.index);
  }
  return points;
};
const smoothContourFromSamples = (samples: readonly SamplePoint[], smoothness: number): GlyphOutlineData["contours"][number] => {
  const isCorner = (index: number): boolean => {
    const previous = samples[(index - 1 + samples.length) % samples.length]!.point;
    const current = samples[index]!.point;
    const next = samples[(index + 1) % samples.length]!.point;
    const incoming = { x: current.x - previous.x, y: current.y - previous.y };
    const outgoing = { x: next.x - current.x, y: next.y - current.y };
    const incomingLength = Math.hypot(incoming.x, incoming.y);
    const outgoingLength = Math.hypot(outgoing.x, outgoing.y);
    if (incomingLength === 0 || outgoingLength === 0) return true;
    return (incoming.x * outgoing.x + incoming.y * outgoing.y) / (incomingLength * outgoingLength) < 0.75;
  };
  const corners = samples.map((_, index) => isCorner(index));
  const nodes = samples.map((sample, index) => ({ id: sample.id.replace(/[^A-Za-z0-9:_-]/g, "-"), anchor: sample.point, join: corners[index] ? "corner" as const : "smooth" as const }));
  const segments: PathSegment[] = nodes.map((node, index) => {
    const previous = nodes[(index - 1 + nodes.length) % nodes.length]!;
    const next = nodes[(index + 1) % nodes.length]!;
    const afterNext = nodes[(index + 2) % nodes.length]!;
    return {
      id: `glyph-segment:${node.id}:${next.id}`,
      type: "cubicBezier" as const,
      startNodeId: node.id,
      endNodeId: next.id,
      control1: corners[index] ? node.anchor : { x: node.anchor.x + (next.anchor.x - previous.anchor.x) * smoothness / 6, y: node.anchor.y + (next.anchor.y - previous.anchor.y) * smoothness / 6 },
      control2: corners[(index + 1) % corners.length] ? next.anchor : { x: next.anchor.x - (afterNext.anchor.x - node.anchor.x) * smoothness / 6, y: next.anchor.y - (afterNext.anchor.y - node.anchor.y) * smoothness / 6 },
    };
  });
  return { nodes, segments };
};
const contourNodeBudget = (sampleCount: number, totalSamples: number, settings: typeof curveModeSettings[TextCurveMode]): number => {
  if (!Number.isFinite(settings.maxGlyphNodes)) return settings.maxContourNodes;
  const proportional = Math.round(settings.maxGlyphNodes * sampleCount / Math.max(1, totalSamples));
  return Math.max(3, Math.min(settings.maxContourNodes, proportional));
};

export function simplifyGlyphContourForMode(contour: GlyphOutlineData["contours"][number], mode: TextCurveMode, maxNodes = curveModeSettings[mode].maxContourNodes): GlyphOutlineData["contours"][number] {
  const settings = curveModeSettings[mode];
  const precise = simplifyGlyphContour(contour, settings.tolerance);
  if (mode === "precise" || precise.nodes.length <= 3) return precise;
  // Existing cubic segments already contain the font's designed handles. Sampling
  // them into a polyline and fitting a new spline is visually worse than keeping
  // those handles, even when the result has fewer anchors.
  if (precise.segments.some((segment) => segment.type === "cubicBezier")) return precise;
  const samples = contourSamples(precise, settings.samplesPerCubic);
  const reduced = reduceClosedSamples(samples, settings.tolerance, maxNodes);
  return reduced.length >= 3 ? smoothContourFromSamples(reduced, settings.smoothness) : precise;
}

const simplifyGlyphContoursForMode = (contours: readonly GlyphOutlineData["contours"][number][], mode: TextCurveMode): readonly GlyphOutlineData["contours"][number][] => {
  const settings = curveModeSettings[mode];
  if (mode === "precise") return contours.map((contour) => simplifyGlyphContourForMode(contour, mode));
  const simplified = contours.map((contour) => simplifyGlyphContour(contour, settings.tolerance));
  const sampleCounts = simplified.map((contour) => contourSamples(contour, settings.samplesPerCubic).length);
  const totalSamples = sampleCounts.reduce((total, count) => total + count, 0);
  return simplified.map((contour, index) => simplifyGlyphContourForMode(contour, mode, contourNodeBudget(sampleCounts[index] ?? 0, totalSamples, settings)));
};

/** Web composition boundary: CSS font-family names are not font bytes and cannot be parsed. */
export function extractTextGlyphOutlines(text: TextElement, resolveFont: FontSourceResolver, mode: TextCurveMode = "editable"): readonly GlyphOutlineData[] {
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
    const finish = () => { if (nodes.length >= 2 && start && previous) { if (previous !== start) segments = [...segments, replacementLine(previous, start)]; contours.push({ nodes, segments }); } nodes = []; segments = []; start = undefined; previous = undefined; };
    for (const command of commands) {
      if (command.type === "M") { finish(); const node = { id: `glyph-${index}-node-${nodeCount++}`, anchor: transform({ x: command.x, y: command.y }), join: "corner" as const }; nodes = [node]; start = node.id; previous = node.id; }
      else if ((command.type === "L" || command.type === "C") && previous) {
        const end = { id: `glyph-${index}-node-${nodeCount++}`, anchor: transform({ x: command.x, y: command.y }), join: "corner" as const };
        segments = [...segments, command.type === "C" ? { id: `glyph-segment:${previous}:${end.id}`, type: "cubicBezier" as const, startNodeId: previous, endNodeId: end.id, control1: transform({ x: command.x1, y: command.y1 }), control2: transform({ x: command.x2, y: command.y2 }) } : replacementLine(previous, end.id)];
        nodes = [...nodes, end]; previous = end.id;
      } else if (command.type === "Q" && previous) {
        const end = { id: `glyph-${index}-node-${nodeCount++}`, anchor: transform({ x: command.x, y: command.y }), join: "corner" as const };
        const start = nodes.at(-1)!.anchor;
        const quadratic = transform({ x: command.x1, y: command.y1 });
        const c1 = { x: start.x + (quadratic.x - start.x) * 2 / 3, y: start.y + (quadratic.y - start.y) * 2 / 3 };
        const c2 = { x: end.anchor.x + (quadratic.x - end.anchor.x) * 2 / 3, y: end.anchor.y + (quadratic.y - end.anchor.y) * 2 / 3 };
        segments = [...segments, { id: `glyph-segment:${previous}:${end.id}`, type: "cubicBezier" as const, startNodeId: previous, endNodeId: end.id, control1: c1, control2: c2 }];
        nodes = [...nodes, end]; previous = end.id;
      } else if (command.type === "Z") finish();
    }
    finish();
    if (contours.length) {
      const outputContours = simplifyGlyphContoursForMode(contours, mode);
      const points = outputContours.flatMap((contour) => contour.nodes.map((node) => node.anchor));
      const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
      result.push({ glyph: glyph.name ?? String.fromCodePoint(...[...text.text].map((value) => value.codePointAt(0) ?? 0).slice(index, index + 1)), position: { x: Math.min(...xs), y: Math.min(...ys) }, size: { width: Math.max(0.001, Math.max(...xs) - Math.min(...xs)), height: Math.max(0.001, Math.max(...ys) - Math.min(...ys)) }, contours: outputContours });
    }
    advanceX += glyph.advanceWidth;
  }
  return result;
}
