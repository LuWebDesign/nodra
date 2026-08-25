import { z } from "zod";
import { CURRENT_SCHEMA_VERSION, type DocumentSnapshot, type ProjectSnapshot } from "@nodra/domain";

const finite = z.number().finite();
const nonEmptyId = z.string().min(1);
const point = z.object({ x: finite, y: finite }).strict();
const size = z.object({ width: finite.gt(0), height: finite.gt(0) }).strict();
const style = z.object({ stroke: z.string().min(1), fill: z.string().min(1).optional(), strokeWidth: finite.gt(0) }).strict();
const operation = z.object({ operation: z.enum(["cut", "engrave", "score"]), order: finite.int().nonnegative(), power: finite.min(0).max(100).optional(), speed: finite.gt(0).optional() }).strict();
const common = { id: nonEmptyId, layerId: nonEmptyId, rotation: finite, flipX: z.boolean().default(false), flipY: z.boolean().default(false), style, operation: operation.optional() };
const cornerRadii = z.object({ topLeft: finite.min(0), topRight: finite.min(0), bottomRight: finite.min(0), bottomLeft: finite.min(0) }).strict();
const rectangle = z.object({ ...common, type: z.literal("rectangle"), position: point, size, cornerRadius: finite.min(0).default(0), cornerRadii: cornerRadii.optional() }).strict();
const ellipse = z.object({ ...common, type: z.literal("ellipse"), position: point, size }).strict();
const line = z.object({ ...common, type: z.literal("line"), start: point, end: point }).strict().superRefine((value, ctx) => {
  if (value.start.x === value.end.x && value.start.y === value.end.y) ctx.addIssue({ code: "custom", message: "Line endpoints must differ", path: ["end"] });
});
const contour = z.object({ ...common, type: z.literal("contour"), position: point, size, contours: z.array(z.object({ points: z.array(point).min(3) }).strict()).min(1), fillRule: z.literal("evenodd") }).strict().superRefine((value, ctx) => {
  value.contours.forEach((ring, index) => {
    const first = ring.points[0];
    const last = ring.points.at(-1);
    if (!first || !last || first.x !== last.x || first.y !== last.y) ctx.addIssue({ code: "custom", message: "Contour rings must be closed", path: ["contours", index, "points"] });
  });
});
const pathNode = z.object({ id: nonEmptyId, anchor: point, join: z.enum(["corner", "smooth", "symmetric"]) }).strict();
const pathLineSegment = z.object({ type: z.literal("line"), startNodeId: nonEmptyId, endNodeId: nonEmptyId }).strict();
const pathCubicSegment = z.object({ type: z.literal("cubicBezier"), startNodeId: nonEmptyId, endNodeId: nonEmptyId, control1: point, control2: point }).strict();
const pathSegment = z.discriminatedUnion("type", [pathLineSegment, pathCubicSegment]);
const path = z.object({ id: nonEmptyId, layerId: nonEmptyId, type: z.literal("path"), nodes: z.array(pathNode).min(2), segments: z.array(pathSegment).min(1), closed: z.boolean(), style, operation: operation.optional() }).strict().superRefine((value, ctx) => {
  const nodeIds = value.nodes.map((node) => node.id);
  if (new Set(nodeIds).size !== nodeIds.length) ctx.addIssue({ code: "custom", message: "Path node IDs must be unique", path: ["nodes"] });
  const expectedCount = value.closed ? value.nodes.length : value.nodes.length - 1;
  if (value.segments.length !== expectedCount) ctx.addIssue({ code: "custom", message: "Path segment count does not match topology", path: ["segments"] });
  const known = new Set(nodeIds);
  value.segments.forEach((segment, index) => {
    if (!known.has(segment.startNodeId) || !known.has(segment.endNodeId)) ctx.addIssue({ code: "custom", message: "Path segment references an unknown node", path: ["segments", index] });
    const start = value.nodes[index];
    const end = value.nodes[value.closed ? (index + 1) % value.nodes.length : index + 1];
    if (start && end && (segment.startNodeId !== start.id || segment.endNodeId !== end.id)) ctx.addIssue({ code: "custom", message: "Path segments must follow node order", path: ["segments", index] });
  });
});
export const splineNodeSchema = z.object({ id: nonEmptyId, anchor: point, continuity: z.enum(["corner", "smooth", "symmetric"]), inHandle: z.object({ dx: finite, dy: finite }).strict().optional(), outHandle: z.object({ dx: finite, dy: finite }).strict().optional() }).strict();
export const splineElementSchema = z.object({ id: nonEmptyId, layerId: nonEmptyId, type: z.literal("spline"), nodes: z.array(splineNodeSchema).min(2), closed: z.boolean(), style, operation: operation.optional() }).strict().superRefine((value, ctx) => {
  const nodeIds = value.nodes.map((node) => node.id);
  if (new Set(nodeIds).size !== nodeIds.length) ctx.addIssue({ code: "custom", message: "Spline node IDs must be unique", path: ["nodes"] });
});
const textElement = z.object({ ...common, type: z.literal("text"), position: point, size, text: z.string().min(1), fontFamily: z.string().min(1), fontSize: finite.gt(0), fontWeight: z.enum(["normal", "bold"]), fontStyle: z.enum(["normal", "italic"]), textAlign: z.enum(["left", "center", "right"]), lineHeight: finite.gt(0) }).strict();
export const elementSchema = z.discriminatedUnion("type", [rectangle, ellipse, line, contour, path, splineElementSchema, textElement]);
export const layerSchema = z.object({ id: nonEmptyId, name: z.string().min(1), visible: z.boolean(), order: finite.int().nonnegative() }).strict();
const documentFields = { id: nonEmptyId, revision: finite.int().nonnegative(), origin: z.literal("top-left"), units: z.literal("mm"), page: size, layers: z.array(layerSchema), elements: z.array(elementSchema) };
export const documentSchema = z.object({ schemaVersion: z.literal(CURRENT_SCHEMA_VERSION), ...documentFields, capabilities: z.object({ spline: z.literal(1).optional() }).strict().optional() }).strict().superRefine((value, ctx) => {
  const layerIds = new Set(value.layers.map((layer) => layer.id));
  for (const [index, element] of value.elements.entries()) if (!layerIds.has(element.layerId)) ctx.addIssue({ code: "custom", message: "Element references an unknown layer", path: ["elements", index, "layerId"] });
});
const pageSchema = z.object({ id: nonEmptyId, page: size, layers: z.array(layerSchema), elements: z.array(elementSchema) }).strict();
export const projectSchema = z.object({ schemaVersion: z.literal(CURRENT_SCHEMA_VERSION), id: nonEmptyId, revision: finite.int().nonnegative(), origin: z.literal("top-left"), units: z.literal("mm"), pages: z.array(pageSchema).min(1), activePageId: nonEmptyId }).strict().superRefine((value, ctx) => {
  if (!value.pages.some((page) => page.id === value.activePageId)) ctx.addIssue({ code: "custom", message: "Active page does not exist", path: ["activePageId"] });
  const layerIds = new Set(value.pages.flatMap((page) => page.layers.map((layer) => layer.id)));
  value.pages.forEach((page, pageIndex) => page.elements.forEach((element, elementIndex) => { if (!layerIds.has(element.layerId)) ctx.addIssue({ code: "custom", message: "Element references an unknown layer", path: ["pages", pageIndex, "elements", elementIndex, "layerId"] }); }));
});
export type ValidationIssue = { readonly path: readonly (string | number)[]; readonly message: string };
export type ValidationResult = { readonly success: true; readonly data: DocumentSnapshot } | { readonly success: false; readonly issues: readonly ValidationIssue[]; readonly error: string };

export type JsonValue = object | boolean | number | string | null;
export function migrateDocument(input: JsonValue): JsonValue {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const candidate = input as Record<string, unknown>;
  if (candidate.schemaVersion === 1) return { ...candidate, schemaVersion: CURRENT_SCHEMA_VERSION, page: { width: 1200, height: 900 } };
  if (candidate.schemaVersion === 2) {
    return { ...candidate, schemaVersion: CURRENT_SCHEMA_VERSION, page: candidate.page ?? { width: 1200, height: 900 } };
  }
  return input;
}

export type DocumentLoadResult = { readonly mode: "editable"; readonly document: DocumentSnapshot; readonly issues: readonly [] } | { readonly mode: "diagnostic" | "recovery"; readonly raw: unknown; readonly issues: readonly ValidationIssue[]; readonly error: string };
export function loadDocument(input: unknown): DocumentLoadResult { const checked = validateDocument(input); if (checked.success) return { mode: "editable", document: checked.data, issues: [] }; const candidate = typeof input === "object" && input !== null && !Array.isArray(input) ? input as Record<string, unknown> : undefined; const capabilities = candidate?.capabilities; const unknown = typeof capabilities === "object" && capabilities !== null && !Array.isArray(capabilities) && Object.keys(capabilities).some((key) => key !== "spline"); return { mode: unknown ? "diagnostic" : "recovery", raw: input, issues: checked.issues, error: checked.error }; }
export function validateDocument(input: unknown): ValidationResult {
  const migrated = migrateDocument(input as JsonValue);
  const result = documentSchema.safeParse(migrated);
  if (result.success) { // SAFETY: documentSchema validated the complete shape; branded IDs are runtime strings.
    return { success: true, data: result.data as unknown as DocumentSnapshot };
  }
  const issues = result.error.issues.map((issue) => ({ path: issue.path.filter((part): part is string | number => typeof part === "string" || typeof part === "number"), message: issue.message }));
  return { success: false, issues, error: issues.map((issue) => `${issue.path.join(".") || "document"}: ${issue.message}`).join("; ") };
}

export function validateProject(input: unknown): { readonly success: true; readonly data: ProjectSnapshot } | { readonly success: false; readonly issues: readonly ValidationIssue[]; readonly error: string } {
  const result = projectSchema.safeParse(input);
  if (result.success) { // SAFETY: projectSchema validated the complete shape; branded IDs are runtime strings.
    return { success: true, data: result.data as unknown as ProjectSnapshot };
  }
  const issues = result.error.issues.map((issue) => ({ path: issue.path.filter((part): part is string | number => typeof part === "string" || typeof part === "number"), message: issue.message }));
  return { success: false, issues, error: issues.map((issue) => `${issue.path.join(".") || "project"}: ${issue.message}`).join("; ") };
}

export function serializeDocument(document: DocumentSnapshot): string {
  const checked = validateDocument(document);
  if (!checked.success) throw new Error(`Cannot serialize invalid document: ${checked.error}`);
  return JSON.stringify(checked.data);
}

export function parseDocument(input: string): ValidationResult {
  try { return validateDocument(JSON.parse(input) as unknown); }
  catch { return { success: false, issues: [{ path: [], message: "Malformed JSON" }], error: "document: Malformed JSON" }; }
}
