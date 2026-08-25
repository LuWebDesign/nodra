import { z } from "zod";
import { CURRENT_SCHEMA_VERSION, type DocumentSnapshot, type ProjectSnapshot } from "@nodra/domain";

const finite = z.number().finite();
const nonEmptyId = z.string().min(1);
const point = z.object({ x: finite, y: finite }).strict();
const size = z.object({ width: finite.gt(0), height: finite.gt(0) }).strict();
const style = z.object({ stroke: z.string().min(1), fill: z.string().min(1).optional(), strokeWidth: finite.gt(0) }).strict();
const operation = z.object({ operation: z.enum(["cut", "engrave", "score"]), order: finite.int().nonnegative(), power: finite.min(0).max(100).optional(), speed: finite.gt(0).optional() }).strict();
const common = { id: nonEmptyId, layerId: nonEmptyId, rotation: finite, flipX: z.boolean().default(false), flipY: z.boolean().default(false), style, operation: operation.optional() };
const rectangle = z.object({ ...common, type: z.literal("rectangle"), position: point, size, cornerRadius: finite.min(0).default(0) }).strict();
const ellipse = z.object({ ...common, type: z.literal("ellipse"), position: point, size }).strict();
const line = z.object({ ...common, type: z.literal("line"), start: point, end: point }).strict().superRefine((value, ctx) => {
  if (value.start.x === value.end.x && value.start.y === value.end.y) ctx.addIssue({ code: "custom", message: "Line endpoints must differ", path: ["end"] });
});
const dimensionReference = z.object({ elementId: nonEmptyId, nodeIndex: finite.int().nonnegative() }).strict();
const dimension = z.object({ id: nonEmptyId, layerId: nonEmptyId, type: z.literal("dimension"), kind: z.enum(["aligned", "horizontal", "vertical"]), references: z.tuple([dimensionReference, dimensionReference]), offset: point, precision: finite.int().min(0).max(6), units: z.literal("mm"), rotation: z.literal(0), style }).strict().superRefine((value, ctx) => {
  if (value.references[0].elementId === value.references[1].elementId && value.references[0].nodeIndex === value.references[1].nodeIndex) ctx.addIssue({ code: "custom", message: "Dimension references must differ", path: ["references"] });
});
const contour = z.object({ ...common, type: z.literal("contour"), position: point, size, contours: z.array(z.object({ points: z.array(point).min(3) }).strict()).min(1), fillRule: z.literal("evenodd") }).strict().superRefine((value, ctx) => {
  value.contours.forEach((ring, index) => {
    const first = ring.points[0];
    const last = ring.points.at(-1);
    if (!first || !last || first.x !== last.x || first.y !== last.y) ctx.addIssue({ code: "custom", message: "Contour rings must be closed", path: ["contours", index, "points"] });
  });
});
const pathNode = z.object({ id: nonEmptyId, anchor: point, join: z.enum(["corner", "smooth", "symmetric"]) }).strict();
const pathSegment = z.discriminatedUnion("type", [
  z.object({ type: z.literal("line"), startNodeId: nonEmptyId, endNodeId: nonEmptyId }).strict(),
  z.object({ type: z.literal("cubicBezier"), startNodeId: nonEmptyId, endNodeId: nonEmptyId, control1: point, control2: point }).strict(),
]);
const path = z.object({ ...common, type: z.literal("path"), nodes: z.array(pathNode).min(2), segments: z.array(pathSegment).min(1), closed: z.boolean() }).strict().superRefine((value, ctx) => {
  const ids = new Set(value.nodes.map((node) => node.id));
  if (ids.size !== value.nodes.length) ctx.addIssue({ code: "custom", message: "Path node IDs must be unique", path: ["nodes"] });
  const expected = value.closed ? value.nodes.length : value.nodes.length - 1;
  if (value.segments.length !== expected) ctx.addIssue({ code: "custom", message: "Path segment count does not match open/closed topology", path: ["segments"] });
  value.segments.forEach((segment, index) => {
    const start = value.nodes[index];
    const end = value.nodes[value.closed ? (index + 1) % value.nodes.length : index + 1];
    if (!start || !end || segment.startNodeId !== start.id || segment.endNodeId !== end.id) ctx.addIssue({ code: "custom", message: "Path segments must reference adjacent nodes in order", path: ["segments", index] });
    if (segment.startNodeId === segment.endNodeId) ctx.addIssue({ code: "custom", message: "Path segments cannot reference the same node", path: ["segments", index] });
  });
  value.nodes.forEach((node, index) => {
    const incoming = value.segments.some((segment) => segment.type === "cubicBezier" && segment.endNodeId === node.id);
    const outgoing = value.segments.some((segment) => segment.type === "cubicBezier" && segment.startNodeId === node.id);
    if (node.join === "symmetric" && incoming !== outgoing) ctx.addIssue({ code: "custom", message: "Symmetric joins require both cubic handles", path: ["nodes", index] });
  });
});
export const elementSchema = z.discriminatedUnion("type", [rectangle, ellipse, line, dimension, contour, path]);
export const layerSchema = z.object({ id: nonEmptyId, name: z.string().min(1), visible: z.boolean(), order: finite.int().nonnegative() }).strict();
const documentFields = { id: nonEmptyId, revision: finite.int().nonnegative(), origin: z.literal("top-left"), units: z.literal("mm"), page: size, layers: z.array(layerSchema), elements: z.array(elementSchema) };
export const documentSchema = z.object({ schemaVersion: z.literal(CURRENT_SCHEMA_VERSION), ...documentFields }).strict().superRefine((value, ctx) => {
  const layerIds = new Set(value.layers.map((layer) => layer.id));
  const elementIds = new Set(value.elements.map((element) => element.id));
  for (const [index, element] of value.elements.entries()) {
    if (!layerIds.has(element.layerId)) ctx.addIssue({ code: "custom", message: "Element references an unknown layer", path: ["elements", index, "layerId"] });
    if (element.type === "dimension") for (const [referenceIndex, reference] of element.references.entries()) if (!elementIds.has(reference.elementId)) ctx.addIssue({ code: "custom", message: "Dimension references an unknown element", path: ["elements", index, "references", referenceIndex, "elementId"] });
  }
});
const pageSchema = z.object({ id: nonEmptyId, page: size, layers: z.array(layerSchema), elements: z.array(elementSchema) }).strict();
export const projectSchema = z.object({ schemaVersion: z.literal(CURRENT_SCHEMA_VERSION), id: nonEmptyId, revision: finite.int().nonnegative(), origin: z.literal("top-left"), units: z.literal("mm"), pages: z.array(pageSchema).min(1), activePageId: nonEmptyId }).strict().superRefine((value, ctx) => {
  if (!value.pages.some((page) => page.id === value.activePageId)) ctx.addIssue({ code: "custom", message: "Active page does not exist", path: ["activePageId"] });
  const layerIds = new Set(value.pages.flatMap((page) => page.layers.map((layer) => layer.id)));
  value.pages.forEach((page, pageIndex) => {
    const elementIds = new Set(page.elements.map((element) => element.id));
    page.elements.forEach((element, elementIndex) => {
      if (!layerIds.has(element.layerId)) ctx.addIssue({ code: "custom", message: "Element references an unknown layer", path: ["pages", pageIndex, "elements", elementIndex, "layerId"] });
      if (element.type === "dimension") for (const [referenceIndex, reference] of element.references.entries()) if (!elementIds.has(reference.elementId)) ctx.addIssue({ code: "custom", message: "Dimension references an unknown element", path: ["pages", pageIndex, "elements", elementIndex, "references", referenceIndex, "elementId"] });
    });
  });
});
export type ValidationIssue = { readonly path: readonly (string | number)[]; readonly message: string };
export type ValidationResult = { readonly success: true; readonly data: DocumentSnapshot } | { readonly success: false; readonly issues: readonly ValidationIssue[]; readonly error: string };

export function migrateDocument(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const candidate = input as Record<string, unknown>;
  if (candidate.schemaVersion === 1) return { ...candidate, schemaVersion: CURRENT_SCHEMA_VERSION, page: { width: 1200, height: 900 } };
  if (candidate.schemaVersion === 2 || candidate.schemaVersion === 3) {
    return { ...candidate, schemaVersion: CURRENT_SCHEMA_VERSION, page: candidate.page ?? { width: 1200, height: 900 } };
  }
  return input;
}

export function validateDocument(input: unknown): ValidationResult {
  const migrated = migrateDocument(input);
  const result = documentSchema.safeParse(migrated);
  if (result.success) return { success: true, data: result.data as unknown as DocumentSnapshot };
  const issues = result.error.issues.map((issue) => ({ path: issue.path.filter((part): part is string | number => typeof part === "string" || typeof part === "number"), message: issue.message }));
  return { success: false, issues, error: issues.map((issue) => `${issue.path.join(".") || "document"}: ${issue.message}`).join("; ") };
}

export function migrateProject(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const candidate = input as Record<string, unknown>;
  if (candidate.schemaVersion === 3) return { ...candidate, schemaVersion: CURRENT_SCHEMA_VERSION };
  return input;
}

export function validateProject(input: unknown): { readonly success: true; readonly data: ProjectSnapshot } | { readonly success: false; readonly issues: readonly ValidationIssue[]; readonly error: string } {
  const result = projectSchema.safeParse(migrateProject(input));
  if (result.success) return { success: true, data: result.data as unknown as ProjectSnapshot };
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
