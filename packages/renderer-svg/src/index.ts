import { CURRENT_SCHEMA_VERSION, type Element } from "@nodra/domain";
import { dimensionGeometry, mmToScreen, type Viewport } from "@nodra/geometry";
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
const transform = (element: Exclude<Element, { type: "dimension" }>, cx: number, cy: number): string => `translate(${number(cx)} ${number(cy)}) rotate(${degrees(element.rotation)}) scale(${element.flipX ? -1 : 1} ${element.flipY ? -1 : 1}) translate(${number(-cx)} ${number(-cy)})`;

function viewportResult(input: unknown): { success: true; data: Viewport } | { success: false; error: string } {
  if (typeof input !== "object" || input === null) return { success: false, error: "viewport must be an object" };
  const candidate = input as { zoom?: unknown; panMm?: { x?: unknown; y?: unknown } };
  if (typeof candidate.zoom !== "number" || !Number.isFinite(candidate.zoom) || candidate.zoom <= 0) return { success: false, error: "viewport.zoom must be positive and finite" };
  if (typeof candidate.panMm?.x !== "number" || !Number.isFinite(candidate.panMm.x) || typeof candidate.panMm?.y !== "number" || !Number.isFinite(candidate.panMm.y)) return { success: false, error: "viewport.panMm must contain finite coordinates" };
  return { success: true, data: { zoom: candidate.zoom, panMm: { x: candidate.panMm.x, y: candidate.panMm.y } } };
}

function visualAttributes(element: Element): string {
  const fill = element.style.fill === undefined ? "none" : escapeAttribute(element.style.fill);
  return `stroke="${escapeAttribute(element.style.stroke)}" stroke-width="${number(element.style.strokeWidth)}" fill="${fill}"`;
}

function renderElement(element: Element, viewport: Viewport, elements: readonly Element[]): string {
  const screen = (point: { x: number; y: number }) => mmToScreen(point, viewport);
  if (element.type === "dimension") {
    const geometry = dimensionGeometry(element, elements);
    if (!geometry) return "";
    const start = screen(geometry.start); const end = screen(geometry.end); const lineStart = screen(geometry.lineStart); const lineEnd = screen(geometry.lineEnd); const text = screen(geometry.text);
    const value = `${geometry.value.toFixed(element.precision)} ${element.units}`;
    const stroke = escapeAttribute(element.style.stroke);
    const width = number(element.style.strokeWidth);
    return `<g data-element-id="${escapeAttribute(element.id)}" data-dimension="${element.kind}" stroke="${stroke}" stroke-width="${width}" fill="none" vector-effect="non-scaling-stroke"><line x1="${number(start.x)}" y1="${number(start.y)}" x2="${number(lineStart.x)}" y2="${number(lineStart.y)}" /><line x1="${number(end.x)}" y1="${number(end.y)}" x2="${number(lineEnd.x)}" y2="${number(lineEnd.y)}" /><line x1="${number(lineStart.x)}" y1="${number(lineStart.y)}" x2="${number(lineEnd.x)}" y2="${number(lineEnd.y)}" /><circle cx="${number(lineStart.x)}" cy="${number(lineStart.y)}" r="2" fill="${stroke}" /><circle cx="${number(lineEnd.x)}" cy="${number(lineEnd.y)}" r="2" fill="${stroke}" /><text x="${number(text.x)}" y="${number(text.y - 4)}" text-anchor="middle" fill="${stroke}" stroke="none" font-size="12">${escapeAttribute(value)}</text></g>`;
  }
  if (element.type === "rectangle") {
    const position = screen(element.position);
    const width = element.size.width * viewport.zoom;
    const height = element.size.height * viewport.zoom;
    const center = { x: position.x + width / 2, y: position.y + height / 2 };
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
  if (element.type === "path") {
    const nodes = new Map(element.nodes.map((node) => [node.id, node.anchor]));
    const path = element.segments.map((segment, index) => {
      const start = nodes.get(segment.startNodeId); const end = nodes.get(segment.endNodeId);
      if (!start || !end) throw new Error("Validated path contains an unknown node");
      const a = screen(start); const b = screen(end);
      if (index === 0) {
        const prefix = `M${number(a.x)} ${number(a.y)}`;
        return segment.type === "line" ? `${prefix} L${number(b.x)} ${number(b.y)}` : `${prefix} C${number(screen(segment.control1).x)} ${number(screen(segment.control1).y)} ${number(screen(segment.control2).x)} ${number(screen(segment.control2).y)} ${number(b.x)} ${number(b.y)}`;
      }
      return segment.type === "line" ? `L${number(b.x)} ${number(b.y)}` : `C${number(screen(segment.control1).x)} ${number(screen(segment.control1).y)} ${number(screen(segment.control2).x)} ${number(screen(segment.control2).y)} ${number(b.x)} ${number(b.y)}`;
    }).join(" ") + (element.closed ? " Z" : "");
    return `<path data-element-id="${escapeAttribute(element.id)}" d="${escapeAttribute(path)}" ${visualAttributes(element)} />`;
  }
  const start = screen(element.start);
  const end = screen(element.end);
  const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  return `<line data-element-id="${escapeAttribute(element.id)}" x1="${number(start.x)}" y1="${number(start.y)}" x2="${number(end.x)}" y2="${number(end.y)}" transform="${transform(element, center.x, center.y)}" ${visualAttributes(element)} />`;
}

export function renderSvg(document: unknown, viewport: unknown): RenderResult {
  const checked = validateDocument(document);
  if (!checked.success) {
    const candidate = typeof document === "object" && document !== null ? document as { schemaVersion?: unknown; elements?: unknown } : undefined;
    const unsupported = !SUPPORTED_SCHEMA_VERSIONS.has(candidate?.schemaVersion as number) || (Array.isArray(candidate?.elements) && candidate.elements.some((element) => typeof element === "object" && element !== null && !["rectangle", "ellipse", "line", "dimension", "contour", "path"].includes((element as { type?: unknown }).type as string)));
    return { success: false, reason: unsupported ? "unsupported" : "invalid", error: checked.error.slice(0, 512), issues: checked.issues.slice(0, MAX_ISSUES).map((issue) => `${issue.path.join(".") || "document"}: ${issue.message}`) };
  }
  const checkedViewport = viewportResult(viewport);
  if (!checkedViewport.success) return { success: false, reason: "invalid", error: checkedViewport.error, issues: [checkedViewport.error] };

  const visibleLayers = new Set(checked.data.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const elements = [...checked.data.elements].filter((element) => visibleLayers.has(element.layerId));
  const orderedLayers = new Map([...checked.data.layers].sort((a, b) => a.order - b.order).map((layer, index) => [layer.id, index]));
  elements.sort((a, b) => (orderedLayers.get(a.layerId) ?? 0) - (orderedLayers.get(b.layerId) ?? 0));
  const contents = elements.map((element) => renderElement(element, checkedViewport.data, checked.data.elements)).join("");
  return { success: true, svg: `<svg xmlns="http://www.w3.org/2000/svg" data-units="mm" width="${number(checked.data.page.width)}" height="${number(checked.data.page.height)}" viewBox="0 0 ${number(checked.data.page.width)} ${number(checked.data.page.height)}"><g>${contents}</g></svg>`, renderedElementIds: elements.map((element) => element.id) };
}

export const svgRenderer: SvgRenderer = { render: renderSvg };
