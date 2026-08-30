import { CURRENT_SCHEMA_VERSION, type Element, type PathElement, type SplineElement } from "@nodra/domain";
import { dimensionGeometry, mmToScreen, sketchClosedContours, type Viewport } from "@nodra/geometry";
import { validateDocument } from "@nodra/validation";

const MAX_ISSUES = 8;
const SUPPORTED_SCHEMA_VERSIONS = new Set([1, 2, 3, CURRENT_SCHEMA_VERSION]);

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
type TransformElement = Extract<Element, { type: "rectangle" | "ellipse" | "line" | "glyph" }>;
const transform = (element: TransformElement, cx: number, cy: number): string => `translate(${number(cx)} ${number(cy)}) rotate(${degrees(element.rotation)}) scale(${element.flipX ? -1 : 1} ${element.flipY ? -1 : 1}) translate(${number(-cx)} ${number(-cy)})`;

function viewportResult(input: unknown): { success: true; data: Viewport } | { success: false; error: string } {
  if (typeof input !== "object" || input === null) return { success: false, error: "viewport must be an object" };
  const candidate = input as { zoom?: unknown; panMm?: { x?: unknown; y?: unknown } };
  if (typeof candidate.zoom !== "number" || !Number.isFinite(candidate.zoom) || candidate.zoom <= 0) return { success: false, error: "viewport.zoom must be positive and finite" };
  if (typeof candidate.panMm?.x !== "number" || !Number.isFinite(candidate.panMm.x) || typeof candidate.panMm?.y !== "number" || !Number.isFinite(candidate.panMm.y)) return { success: false, error: "viewport.panMm must contain finite coordinates" };
  return { success: true, data: { zoom: candidate.zoom, panMm: { x: candidate.panMm.x, y: candidate.panMm.y } } };
}

const DEFAULT_FILL_OPACITY = 0.22;

function visualAttributes(element: Element): string {
  if (element.type === "dimension") return `stroke="${escapeAttribute(element.style.stroke)}" stroke-width="${number(element.style.strokeWidth)}" fill="none"`;
  const closed = element.type === "path" || element.type === "spline" ? element.closed : element.type !== "line" && element.type !== "sketch";
  const fill = closed ? escapeAttribute(element.style.fill ?? element.style.stroke) : "none";
  return `stroke="${escapeAttribute(element.style.stroke)}" stroke-width="${number(element.style.strokeWidth)}" fill="${fill}"${closed ? ` fill-opacity="${DEFAULT_FILL_OPACITY}"` : ""}`;
}

function renderElement(element: Element, viewport: Viewport): string {
  const screen = (point: { x: number; y: number }) => mmToScreen(point, viewport);
  if (element.type === "dimension") {
    const geometry = dimensionGeometry(element, []);
    if (!geometry) return "";
    const start = screen(geometry.start); const end = screen(geometry.end); const lineStart = screen(geometry.lineStart); const lineEnd = screen(geometry.lineEnd); const text = screen(geometry.text);
    if (geometry.kind === "angular") return renderAngularDimension(element, geometry, viewport);
    const value = `${geometry.kind === "diameter" ? "Ø" : ""}${geometry.value.toFixed(element.precision)} ${element.units}`;
    return `<g data-element-id="${escapeAttribute(element.id)}" data-dimension="${element.kind}" ${visualAttributes(element)}><line x1="${number(start.x)}" y1="${number(start.y)}" x2="${number(lineStart.x)}" y2="${number(lineStart.y)}" /><line x1="${number(end.x)}" y1="${number(end.y)}" x2="${number(lineEnd.x)}" y2="${number(lineEnd.y)}" /><line x1="${number(lineStart.x)}" y1="${number(lineStart.y)}" x2="${number(lineEnd.x)}" y2="${number(lineEnd.y)}" /><text x="${number(text.x)}" y="${number(text.y - 4)}" text-anchor="middle" fill="${escapeAttribute(element.style.stroke)}" stroke="none" font-size="12">${escapeAttribute(value)}</text></g>`;
  }
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
  if (element.type === "sketch") {
    const nodes = new Map(element.nodes.map((node) => [node.id, screen(node.point)]));
    const fill = escapeAttribute(element.style.fill ?? element.style.stroke);
    const contours = sketchClosedContours(element).map((contour) => contour.map((point, index) => { const current = screen(point); return `${index === 0 ? "M" : "L"}${number(current.x)} ${number(current.y)}`; }).join(" ") + " Z").join(" ");
    const faces = contours ? `<path data-sketch-fill="true" d="${escapeAttribute(contours)}" fill="${fill}" fill-opacity="${DEFAULT_FILL_OPACITY}" stroke="none" fill-rule="evenodd" />` : "";
    const lines = element.edges.map((edge) => { const start = nodes.get(edge.startNodeId); const end = nodes.get(edge.endNodeId); return start && end ? `<line x1="${number(start.x)}" y1="${number(start.y)}" x2="${number(end.x)}" y2="${number(end.y)}" />` : ""; }).join("");
    return `<g data-element-id="${escapeAttribute(element.id)}" ${visualAttributes(element)}>${faces}${lines}</g>`;
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
  if (element.type === "glyph") return renderGlyph(element, viewport);
  if (element.type === "text") {
    const position = screen(element.position);
    const fontSize = element.fontSize * viewport.zoom;
    const anchor = element.textAlign === "center" ? "middle" : element.textAlign === "right" ? "end" : "start";
    const x = element.textAlign === "center" ? position.x + element.size.width * viewport.zoom / 2 : element.textAlign === "right" ? position.x + element.size.width * viewport.zoom : position.x;
    const lines = element.text.split(/\r\n|\r|\n/).map((line, index) => `<tspan x="${number(x)}" dy="${number(index === 0 ? 0 : fontSize * element.lineHeight)}">${escapeAttribute(line)}</tspan>`).join("");
    return `<text data-element-id="${escapeAttribute(element.id)}" x="${number(x)}" y="${number(position.y + fontSize * 0.8)}" text-anchor="${anchor}" font-family="${escapeAttribute(element.fontFamily)}" font-size="${number(fontSize)}" font-weight="${element.fontWeight}" font-style="${element.fontStyle}" fill="${escapeAttribute(element.style.fill ?? "none")}" stroke="${escapeAttribute(element.style.stroke)}" stroke-width="${number(element.style.strokeWidth)}" transform="translate(${number(position.x)} ${number(position.y)}) rotate(${degrees(element.rotation)}) scale(${number(element.scaleX ?? 1)} ${number(element.scaleY ?? 1)}) translate(${number(-position.x)} ${number(-position.y)})">${lines}</text>`;
  }
  const start = screen(element.start);
  const end = screen(element.end);
  const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  return `<line data-element-id="${escapeAttribute(element.id)}" x1="${number(start.x)}" y1="${number(start.y)}" x2="${number(end.x)}" y2="${number(end.y)}" transform="${transform(element, center.x, center.y)}" ${visualAttributes(element)} />`;
}

function renderGlyph(element: Extract<Element, { type: "glyph" }>, viewport: Viewport): string {
  const screen = (point: { x: number; y: number }) => mmToScreen(point, viewport);
  const d = element.contours.map((contour) => {
    const first = contour.nodes[0];
    if (!first) return "";
    let path = `M${number(screen(first.anchor).x)} ${number(screen(first.anchor).y)}`;
    for (const segment of contour.segments) {
      const end = contour.nodes.find((node) => node.id === segment.endNodeId);
      if (!end) continue;
      if (segment.type === "line") path += ` L${number(screen(end.anchor).x)} ${number(screen(end.anchor).y)}`;
      else path += ` C${number(screen(segment.control1).x)} ${number(screen(segment.control1).y)} ${number(screen(segment.control2).x)} ${number(screen(segment.control2).y)} ${number(screen(end.anchor).x)} ${number(screen(end.anchor).y)}`;
    }
    return `${path} Z`;
  }).join(" ");
  const center = screen({ x: element.position.x + element.size.width / 2, y: element.position.y + element.size.height / 2 });
  return `<path data-element-id="${escapeAttribute(element.id)}" d="${escapeAttribute(d)}" fill-rule="evenodd" transform="${transform(element, center.x, center.y)}" ${visualAttributes(element)} />`;
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
         const unsupported = !SUPPORTED_SCHEMA_VERSIONS.has(candidate?.schemaVersion as number) || (Array.isArray(candidate?.elements) && candidate.elements.some((element) => typeof element === "object" && element !== null && !["rectangle", "ellipse", "line", "sketch", "dimension", "contour", "path", "spline", "text", "glyph"].includes((element as { type?: unknown }).type as string)));
    return { success: false, reason: unsupported ? "unsupported" : "invalid", error: checked.error.slice(0, 512), issues: checked.issues.slice(0, MAX_ISSUES).map((issue) => `${issue.path.join(".") || "document"}: ${issue.message}`) };
  }
  const checkedViewport = viewportResult(viewport);
  if (!checkedViewport.success) return { success: false, reason: "invalid", error: checkedViewport.error, issues: [checkedViewport.error] };

  const visibleLayers = new Set(checked.data.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const elements = [...checked.data.elements].filter((element) => visibleLayers.has(element.layerId));
  const orderedLayers = new Map([...checked.data.layers].sort((a, b) => a.order - b.order).map((layer, index) => [layer.id, index]));
  elements.sort((a, b) => (orderedLayers.get(a.layerId) ?? 0) - (orderedLayers.get(b.layerId) ?? 0));
  const contents = elements.map((element) => element.type === "dimension" ? renderDimension(element, checkedViewport.data, checked.data.elements) : renderElement(element, checkedViewport.data)).join("");
  return { success: true, svg: `<svg xmlns="http://www.w3.org/2000/svg" data-units="mm" width="${number(checked.data.page.width)}" height="${number(checked.data.page.height)}" viewBox="0 0 ${number(checked.data.page.width)} ${number(checked.data.page.height)}"><g>${contents}</g></svg>`, renderedElementIds: elements.map((element) => element.id) };
}

function renderDimension(element: Extract<Element, { type: "dimension" }>, viewport: Viewport, elements: readonly Element[]): string {
  const geometry = dimensionGeometry(element, elements);
  if (!geometry) return "";
  const screen = (point: { x: number; y: number }) => mmToScreen(point, viewport);
  const start = screen(geometry.start); const end = screen(geometry.end); const lineStart = screen(geometry.lineStart); const lineEnd = screen(geometry.lineEnd); const text = screen(geometry.text);
  if (geometry.kind === "angular") return renderAngularDimension(element, geometry, viewport);
  const value = `${geometry.kind === "diameter" ? "Ø" : ""}${geometry.value.toFixed(element.precision)} ${element.units}`;
  const stroke = escapeAttribute(element.style.stroke);
  const markerId = `dimension-arrow-${escapeAttribute(element.id)}`;
  return `<g data-element-id="${escapeAttribute(element.id)}" data-dimension="${element.kind}" stroke="${stroke}" stroke-width="${number(element.style.strokeWidth)}" fill="none" vector-effect="non-scaling-stroke"><defs><marker id="${markerId}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10 2.5 5Z" fill="${stroke}" stroke="none" /></marker></defs><line x1="${number(start.x)}" y1="${number(start.y)}" x2="${number(lineStart.x)}" y2="${number(lineStart.y)}" stroke-dasharray="4 3" opacity="0.7" /><line x1="${number(end.x)}" y1="${number(end.y)}" x2="${number(lineEnd.x)}" y2="${number(lineEnd.y)}" stroke-dasharray="4 3" opacity="0.7" /><line x1="${number(lineStart.x)}" y1="${number(lineStart.y)}" x2="${number(lineEnd.x)}" y2="${number(lineEnd.y)}" marker-start="url(#${markerId})" marker-end="url(#${markerId})" /><text x="${number(text.x)}" y="${number(text.y - 8)}" text-anchor="middle" dominant-baseline="middle" fill="${stroke}" stroke="#ffffff" stroke-width="3" paint-order="stroke" font-size="18" font-weight="600">${escapeAttribute(value)}</text></g>`;
}

function renderAngularDimension(element: Extract<Element, { type: "dimension" }>, geometry: Extract<ReturnType<typeof dimensionGeometry>, { kind: "angular" }>, viewport: Viewport): string {
  const screen = (point: { x: number; y: number }) => mmToScreen(point, viewport);
  const vertex = screen(geometry.vertex); const start = screen(geometry.start); const end = screen(geometry.end); const text = screen(geometry.text);
  const radius = geometry.radius * viewport.zoom; const stroke = escapeAttribute(element.style.stroke); const markerId = `dimension-arrow-${escapeAttribute(element.id)}`;
  const value = `${Number.isInteger(geometry.value) ? geometry.value.toFixed(0) : geometry.value.toFixed(element.precision)}°`; const path = `M ${number(start.x)} ${number(start.y)} A ${number(radius)} ${number(radius)} 0 0 ${geometry.sweep} ${number(end.x)} ${number(end.y)}`;
  return `<g data-element-id="${escapeAttribute(element.id)}" data-dimension="angular" stroke="${stroke}" stroke-width="${number(element.style.strokeWidth)}" fill="none" vector-effect="non-scaling-stroke"><defs><marker id="${markerId}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10 2.5 5Z" fill="${stroke}" stroke="none" /></marker></defs><line x1="${number(vertex.x)}" y1="${number(vertex.y)}" x2="${number(start.x)}" y2="${number(start.y)}" stroke-dasharray="4 3" opacity="0.7" /><line x1="${number(vertex.x)}" y1="${number(vertex.y)}" x2="${number(end.x)}" y2="${number(end.y)}" stroke-dasharray="4 3" opacity="0.7" /><path d="${path}" marker-start="url(#${markerId})" marker-end="url(#${markerId})" /><text x="${number(text.x)}" y="${number(text.y - 8)}" text-anchor="middle" dominant-baseline="middle" fill="${stroke}" stroke="#ffffff" stroke-width="3" paint-order="stroke" font-size="18" font-weight="600">${escapeAttribute(value)}</text></g>`;
}

export function renderSplineSvg(element: SplineElement, viewport: Viewport): string { return renderPath(splineToPathElement(element), viewport); }
export const svgRenderer: SvgRenderer = { render: renderSvg };
