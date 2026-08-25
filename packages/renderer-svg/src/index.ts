import { CURRENT_SCHEMA_VERSION, type Element, type PathElement, type SplineElement } from "@nodra/domain";
import { mmToScreen, type Viewport } from "@nodra/geometry";
import { validateDocument } from "@nodra/validation";

const MAX_ISSUES = 8;
const SUPPORTED_SCHEMA_VERSIONS = new Set([1, 2, CURRENT_SCHEMA_VERSION]);

export interface SvgRenderer {
  render(document: unknown, viewport: unknown): RenderResult;
}

export type RenderResult =
  | { readonly success: true; readonly svg: string; readonly renderedElementIds: readonly string[] }
  | {
      readonly success: false;
      readonly reason: "invalid" | "unsupported";
      readonly error: string;
      readonly issues: readonly string[];
    };

const escapeAttribute = (value: string): string => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const number = (value: number): string => Number(value.toFixed(6)).toString();
const degrees = (radians: number): string => number((radians * 180) / Math.PI);
type TransformElement = Extract<Element, { type: "rectangle" | "ellipse" | "line" }>;
const transform = (element: TransformElement, cx: number, cy: number): string => `translate(${number(cx)} ${number(cy)}) rotate(${degrees(element.rotation)}) scale(${element.flipX ? -1 : 1} ${element.flipY ? -1 : 1}) translate(${number(-cx)} ${number(-cy)})`;

function viewportResult(input: unknown): { success: true; data: Viewport } | { success: false; error: string } {
  if (typeof input !== "object" || input === null) return { success: false, error: "viewport must be an object" };
  const candidate = input as { zoom?: unknown; panMm?: { x?: unknown; y?: unknown } };
  if (typeof candidate.zoom !== "number" || !Number.isFinite(candidate.zoom) || candidate.zoom <= 0) return { success: false, error: "viewport.zoom must be positive and finite" };
  if (typeof candidate.panMm?.x !== "number" || !Number.isFinite(candidate.panMm.x) || typeof candidate.panMm?.y !== "number" || !Number.isFinite(candidate.panMm.y)) return { success: false, error: "viewport.panMm must contain finite coordinates" };
  return { success: true, data: { zoom: candidate.zoom, panMm: { x: candidate.panMm.x, y: candidate.panMm.y } } };
}

const DEFAULT_CLOSED_FILL = "rgba(101,217,255,0.22)";

function visualAttributes(element: Element): string {
  const closed = element.type === "path" || element.type === "spline" ? element.closed : element.type !== "line";
  const fill = closed ? escapeAttribute(element.style.fill ?? DEFAULT_CLOSED_FILL) : "none";
  return `stroke="${escapeAttribute(element.style.stroke)}" stroke-width="${number(Math.max(element.style.strokeWidth, 1))}" fill="${fill}"`;
}

function renderElement(element: Element, viewport: Viewport): string {
  const screen = (point: { x: number; y: number }) => mmToScreen(point, viewport);
  if (element.type === "rectangle") {
    const position = screen(element.position);
    const width = element.size.width * viewport.zoom;
    const height = element.size.height * viewport.zoom;
    const center = { x: position.x + width / 2, y: position.y + height / 2 };
    if (element.cornerRadii) {
      const limit = Math.min(width, height) / 2;
      const radii = { tl: Math.min(element.cornerRadii.topLeft * viewport.zoom, limit), tr: Math.min(element.cornerRadii.topRight * viewport.zoom, limit), br: Math.min(element.cornerRadii.bottomRight * viewport.zoom, limit), bl: Math.min(element.cornerRadii.bottomLeft * viewport.zoom, limit) };
      const x = position.x; const y = position.y; const right = x + width; const bottom = y + height;
      const d = `M${number(x + radii.tl)} ${number(y)} H${number(right - radii.tr)} Q${number(right)} ${number(y)} ${number(right)} ${number(y + radii.tr)} V${number(bottom - radii.br)} Q${number(right)} ${number(bottom)} ${number(right - radii.br)} ${number(bottom)} H${number(x + radii.bl)} Q${number(x)} ${number(bottom)} ${number(x)} ${number(bottom - radii.bl)} V${number(y + radii.tl)} Q${number(x)} ${number(y)} ${number(x + radii.tl)} ${number(y)} Z`;
      return `<path data-element-id="${escapeAttribute(element.id)}" d="${d}" transform="${transform(element, center.x, center.y)}" ${visualAttributes(element)} />`;
    }
    const radius = Math.min(element.cornerRadius * viewport.zoom, width / 2, height / 2);
    return `<rect data-element-id="${escapeAttribute(element.id)}" x="${number(position.x)}" y="${number(position.y)}" width="${number(width)}" height="${number(height)}" rx="${number(radius)}" ry="${number(radius)}" transform="${transform(element, center.x, center.y)}" ${visualAttributes(element)} />`;
  }
  if (element.type === "ellipse") {
    const position = screen(element.position);
    const width = element.size.width * viewport.zoom;
    const height = element.size.height * viewport.zoom;
    return `<ellipse data-element-id="${escapeAttribute(element.id)}" cx="${number(position.x + width / 2)}" cy="${number(position.y + height / 2)}" rx="${number(width / 2)}" ry="${number(height / 2)}" transform="${transform(element, position.x + width / 2, position.y + height / 2)}" ${visualAttributes(element)} />`;
  }
  if (element.type === "contour") {
    const path = element.contours.map((contour) => contour.points.map((point, index) => {
      const screenPoint = screen(point);
      return `${index === 0 ? "M" : "L"}${number(screenPoint.x)} ${number(screenPoint.y)}`;
    }).join(" ") + " Z").join(" ");
    return `<path data-element-id="${escapeAttribute(element.id)}" d="${escapeAttribute(path)}" fill-rule="${element.fillRule}" ${visualAttributes(element)} />`;
  }
  if (element.type === "path") return renderPath(element, viewport);
  if (element.type === "spline") return renderPath(splineToPathElement(element), viewport);
  if (element.type === "text") {
    const position = screen(element.position);
    const fontSize = element.fontSize * viewport.zoom;
    const anchor = element.textAlign === "center" ? "middle" : element.textAlign === "right" ? "end" : "start";
    const x = element.textAlign === "center" ? position.x + element.size.width * viewport.zoom / 2 : element.textAlign === "right" ? position.x + element.size.width * viewport.zoom : position.x;
    const lines = element.text.split("\\n").map((line, index) => `<tspan x="${number(x)}" dy="${number(index === 0 ? fontSize : fontSize * element.lineHeight)}">${escapeAttribute(line)}</tspan>`).join("");
    return `<text data-element-id="${escapeAttribute(element.id)}" x="${number(x)}" y="${number(position.y)}" text-anchor="${anchor}" font-family="${escapeAttribute(element.fontFamily)}" font-size="${number(fontSize)}" font-weight="${element.fontWeight}" font-style="${element.fontStyle}" fill="${escapeAttribute(element.style.fill ?? "none")}" stroke="${escapeAttribute(element.style.stroke)}" stroke-width="${number(Math.max(element.style.strokeWidth, 1))}" transform="rotate(${degrees(element.rotation)} ${number(position.x)} ${number(position.y)})">${lines}</text>`;
  }
  const start = screen(element.start);
  const end = screen(element.end);
  const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  return `<line data-element-id="${escapeAttribute(element.id)}" x1="${number(start.x)}" y1="${number(start.y)}" x2="${number(end.x)}" y2="${number(end.y)}" transform="${transform(element, center.x, center.y)}" ${visualAttributes(element)} />`;
}

/** Convert the native spline model to the canonical path renderer boundary. */
function splineToPathElement(element: SplineElement): PathElement {
  const segmentFor = (startIndex: number, endIndex: number) => {
    const start = element.nodes[startIndex]!;
    const end = element.nodes[endIndex]!;
    const control1 = start.outHandle ? { x: start.anchor.x + start.outHandle.dx, y: start.anchor.y + start.outHandle.dy } : start.anchor;
    const control2 = end.inHandle ? { x: end.anchor.x + end.inHandle.dx, y: end.anchor.y + end.inHandle.dy } : end.anchor;
    return start.outHandle || end.inHandle
      ? { type: "cubicBezier" as const, startNodeId: start.id, endNodeId: end.id, control1, control2 }
      : { type: "line" as const, startNodeId: start.id, endNodeId: end.id };
  };
  const segments = element.nodes.slice(1).map((_, index) => segmentFor(index, index + 1));
  if (element.closed) segments.push(segmentFor(element.nodes.length - 1, 0));
  return {
    type: "path",
    id: element.id,
    layerId: element.layerId,
    nodes: element.nodes.map((node) => ({ id: node.id, anchor: node.anchor, join: node.continuity })),
    segments,
    closed: element.closed,
    style: element.style,
    ...(element.operation ? { operation: element.operation } : {}),
  };
}

function renderPath(element: PathElement, viewport: Viewport): string {
  const screen = (point: { x: number; y: number }) => mmToScreen(point, viewport);
  const nodes = new Map(element.nodes.map((node) => [node.id, node.anchor]));
  const first = nodes.get(element.nodes[0]!.id)!;
  let path = `M${number(screen(first).x)} ${number(screen(first).y)}`;
  for (const segment of element.segments) {
    const end = screen(nodes.get(segment.endNodeId)!);
    if (segment.type === "line") path += ` L${number(end.x)} ${number(end.y)}`;
    else { const c1 = screen(segment.control1); const c2 = screen(segment.control2); path += ` C${number(c1.x)} ${number(c1.y)} ${number(c2.x)} ${number(c2.y)} ${number(end.x)} ${number(end.y)}`; }
  }
  if (element.closed) path += " Z";
  return `<path data-element-id="${escapeAttribute(element.id)}" d="${escapeAttribute(path)}" ${visualAttributes(element)} />`;
}

export function renderSvg(document: unknown, viewport: unknown): RenderResult {
  const checked = validateDocument(document);
  if (!checked.success) {
    const candidate = typeof document === "object" && document !== null ? document as { schemaVersion?: unknown; elements?: unknown } : undefined;
    const unsupported = !SUPPORTED_SCHEMA_VERSIONS.has(candidate?.schemaVersion as number) || (Array.isArray(candidate?.elements) && candidate.elements.some((element) => typeof element === "object" && element !== null && !["rectangle", "ellipse", "line", "contour", "path", "spline", "text"].includes((element as { type?: unknown }).type as string)));
    return { success: false, reason: unsupported ? "unsupported" : "invalid", error: checked.error.slice(0, 512), issues: checked.issues.slice(0, MAX_ISSUES).map((issue) => `${issue.path.join(".") || "document"}: ${issue.message}`) };
  }
  const checkedViewport = viewportResult(viewport);
  if (!checkedViewport.success) return { success: false, reason: "invalid", error: checkedViewport.error, issues: [checkedViewport.error] };

  const visibleLayers = new Set(checked.data.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const elements = [...checked.data.elements].filter((element) => visibleLayers.has(element.layerId));
  const orderedLayers = new Map([...checked.data.layers].sort((a, b) => a.order - b.order).map((layer, index) => [layer.id, index]));
  elements.sort((a, b) => (orderedLayers.get(a.layerId) ?? 0) - (orderedLayers.get(b.layerId) ?? 0));
  const contents = elements.map((element) => renderElement(element, checkedViewport.data)).join("");
  return { success: true, svg: `<svg xmlns="http://www.w3.org/2000/svg" data-units="mm" width="${number(checked.data.page.width)}" height="${number(checked.data.page.height)}" viewBox="0 0 ${number(checked.data.page.width)} ${number(checked.data.page.height)}"><g>${contents}</g></svg>`, renderedElementIds: elements.map((element) => element.id) };
}

export function renderSplineSvg(element: SplineElement, viewport: Viewport): string { return renderPath(splineToPathElement(element), viewport); }
export const svgRenderer: SvgRenderer = { render: renderSvg };
