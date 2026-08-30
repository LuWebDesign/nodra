import { z } from "zod";
import { CURRENT_SCHEMA_VERSION, type DocumentSnapshot, type Element, type PointMm, type ProjectSnapshot, type SizeMm } from "@nodra/domain";

const finite = z.number().finite();
const nonEmptyId = z.string().min(1);
const point = z.object({ x: finite, y: finite }).strict();
const size = z.object({ width: finite.gt(0), height: finite.gt(0) }).strict();
const style = z.object({ stroke: z.string().min(1), fill: z.string().min(1).optional(), strokeWidth: finite.gt(0) }).strict();
const operation = z.object({ operation: z.enum(["cut", "engrave", "score"]), order: finite.int().nonnegative(), power: finite.min(0).max(100).optional(), speed: finite.gt(0).optional() }).strict();
const visualLineEndpoints = (line: { readonly start: PointMm; readonly end: PointMm; readonly rotation: number }): readonly [PointMm, PointMm] => {
  const center = { x: (line.start.x + line.end.x) / 2, y: (line.start.y + line.end.y) / 2 };
  const rotate = (point: PointMm): PointMm => ({ x: center.x + (point.x - center.x) * Math.cos(line.rotation) - (point.y - center.y) * Math.sin(line.rotation), y: center.y + (point.x - center.x) * Math.sin(line.rotation) + (point.y - center.y) * Math.cos(line.rotation) });
  return [rotate(line.start), rotate(line.end)];
};
const common = { id: nonEmptyId, layerId: nonEmptyId, rotation: finite, flipX: z.boolean().default(false), flipY: z.boolean().default(false), style, operation: operation.optional() };
const cornerRadii = z.object({ topLeft: finite.min(0), topRight: finite.min(0), bottomRight: finite.min(0), bottomLeft: finite.min(0) }).strict();
const rectangle = z.object({ ...common, type: z.literal("rectangle"), position: point, size, cornerRadius: finite.min(0).default(0), cornerRadii: cornerRadii.optional() }).strict();
const ellipse = z.object({ ...common, type: z.literal("ellipse"), position: point, size }).strict();
const line = z.object({ ...common, type: z.literal("line"), start: point, end: point }).strict().superRefine((value, ctx) => {
  if (value.start.x === value.end.x && value.start.y === value.end.y) ctx.addIssue({ code: "custom", message: "Line endpoints must differ", path: ["end"] });
});
const connectableAddress = z.union([
  z.object({ kind: z.literal("named"), name: z.enum(["nw", "n", "ne", "e", "se", "s", "sw", "w", "center"]) }).strict(),
  z.object({ kind: z.literal("line"), name: z.enum(["start", "end", "center"]) }).strict(),
  z.object({ kind: z.enum(["path", "spline", "sketch"]), nodeId: nonEmptyId, handle: z.enum(["in", "out"]).optional() }).strict(),
]);
const connectionReference = z.object({ elementId: nonEmptyId, node: connectableAddress }).strict();
const explicitConnection = z.object({ id: nonEmptyId, first: connectionReference, second: connectionReference }).strict();
const nodeReference = z.object({ kind: z.literal("node"), elementId: nonEmptyId, nodeIndex: finite.int().nonnegative(), nodeId: nonEmptyId.optional() }).strict();
const lineReference = z.object({ kind: z.literal("line"), elementId: nonEmptyId, edgeIndex: finite.int().nonnegative().optional() }).strict();
const legacyNodeReference = z.object({ elementId: nonEmptyId, nodeIndex: finite.int().nonnegative(), nodeId: nonEmptyId.optional() }).strict().transform((reference) => ({ kind: "node" as const, ...reference }));
const dimensionReference = z.union([z.discriminatedUnion("kind", [nodeReference, lineReference]), legacyNodeReference]);
const dimension = z.object({ id: nonEmptyId, layerId: nonEmptyId, type: z.literal("dimension"), kind: z.enum(["aligned", "horizontal", "vertical", "angular", "diameter"]), references: z.tuple([dimensionReference, dimensionReference]), offset: point, precision: finite.int().min(0).max(6), units: z.literal("mm"), rotation: z.literal(0), style, driving: z.boolean().optional(), constraintId: nonEmptyId.optional() }).strict().superRefine((value, ctx) => {
  const [first, second] = value.references;
  if (value.kind === "angular") {
    if (first.kind !== "line" || second.kind !== "line") ctx.addIssue({ code: "custom", message: "Angular dimensions require line references", path: ["references"] });
     if (first.kind === "line" && second.kind === "line" && first.elementId === second.elementId && (first.edgeIndex ?? 0) === (second.edgeIndex ?? 0)) ctx.addIssue({ code: "custom", message: "Angular dimension lines must differ", path: ["references"] });
  } else {
    if (first.kind !== "node" || second.kind !== "node") ctx.addIssue({ code: "custom", message: "Linear dimensions require node references", path: ["references"] });
    if (first.kind === "node" && second.kind === "node" && first.elementId === second.elementId && (first.nodeId !== undefined && second.nodeId !== undefined ? first.nodeId === second.nodeId : first.nodeIndex === second.nodeIndex)) ctx.addIssue({ code: "custom", message: "Dimension references must differ", path: ["references"] });
  }
});
const contour = z.object({ ...common, type: z.literal("contour"), position: point, size, contours: z.array(z.object({ points: z.array(point).min(3) }).strict()).min(1), fillRule: z.literal("evenodd") }).strict().superRefine((value, ctx) => {
  value.contours.forEach((ring, index) => {
    const first = ring.points[0];
    const last = ring.points.at(-1);
    if (!first || !last || first.x !== last.x || first.y !== last.y) ctx.addIssue({ code: "custom", message: "Contour rings must be closed", path: ["contours", index, "points"] });
  });
});
const sketchNode = z.object({ id: nonEmptyId, point }).strict();
const sketchEdge = z.object({ id: nonEmptyId, startNodeId: nonEmptyId, endNodeId: nonEmptyId }).strict();
const sketchPointReference = z.object({ elementId: nonEmptyId, nodeId: nonEmptyId }).strict();
const sketchConstraint = z.object({ id: nonEmptyId, kind: z.enum(["horizontal", "vertical", "coincident", "distance-horizontal", "distance-vertical", "fixed"]), references: z.array(sketchPointReference).min(1).max(2), value: finite.positive().optional() }).strict();
const sketch = z.object({ id: nonEmptyId, layerId: nonEmptyId, type: z.literal("sketch"), nodes: z.array(sketchNode).min(2), edges: z.array(sketchEdge).min(1), constraints: z.array(sketchConstraint).optional(), style, operation: operation.optional() }).strict().superRefine((value, ctx) => {
  const nodeIds = value.nodes.map((node) => node.id); const edgeIds = value.edges.map((edge) => edge.id);
  if (new Set(nodeIds).size !== nodeIds.length) ctx.addIssue({ code: "custom", message: "Sketch node IDs must be unique", path: ["nodes"] });
  if (new Set(edgeIds).size !== edgeIds.length) ctx.addIssue({ code: "custom", message: "Sketch edge IDs must be unique", path: ["edges"] });
  const known = new Set(nodeIds);
  const constraints = value.constraints ?? [];
  const constraintIds = constraints.map((constraint) => constraint.id);
  if (new Set(constraintIds).size !== constraintIds.length) ctx.addIssue({ code: "custom", message: "Sketch constraint IDs must be unique", path: ["constraints"] });
  constraints.forEach((constraint, index) => {
    if (constraint.references.some((reference) => reference.elementId !== value.id || !known.has(reference.nodeId))) ctx.addIssue({ code: "custom", message: "Sketch constraint references an unknown node", path: ["constraints", index, "references"] });
    const expectedReferences = constraint.kind === "fixed" ? 1 : 2;
    if (constraint.references.length !== expectedReferences) ctx.addIssue({ code: "custom", message: constraint.kind + " constraints require " + expectedReferences + " reference" + (expectedReferences === 1 ? "" : "s"), path: ["constraints", index, "references"] });
    if ((constraint.kind === "distance-horizontal" || constraint.kind === "distance-vertical") && (constraint.value === undefined || constraint.value <= 0)) ctx.addIssue({ code: "custom", message: "Distance constraints require a positive value", path: ["constraints", index, "value"] });
  });
  value.edges.forEach((edge, index) => {
    if (!known.has(edge.startNodeId) || !known.has(edge.endNodeId)) ctx.addIssue({ code: "custom", message: "Sketch edge references an unknown node", path: ["edges", index] });
    if (edge.startNodeId === edge.endNodeId) ctx.addIssue({ code: "custom", message: "Sketch edge endpoints must differ", path: ["edges", index] });
  });
});
const pathNode = z.object({ id: nonEmptyId, anchor: point, join: z.enum(["corner", "smooth", "symmetric"]) }).strict();
const pathLineSegment = z.object({ type: z.literal("line"), startNodeId: nonEmptyId, endNodeId: nonEmptyId }).strict();
const pathCubicSegment = z.object({ type: z.literal("cubicBezier"), startNodeId: nonEmptyId, endNodeId: nonEmptyId, control1: point, control2: point }).strict();
const pathSegment = z.discriminatedUnion("type", [pathLineSegment, pathCubicSegment]);
const path = z.object({ id: nonEmptyId, layerId: nonEmptyId, type: z.literal("path"), nodes: z.array(pathNode).min(2), segments: z.array(pathSegment).min(1), closed: z.boolean(), rotation: finite.optional(), flipX: z.boolean().optional(), flipY: z.boolean().optional(), style, operation: operation.optional() }).strict().superRefine((value, ctx) => {
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
const textElement = z.object({ ...common, type: z.literal("text"), position: point, size, text: z.string().min(1), fontFamily: z.string().min(1), fontSize: finite.gt(0), fontWeight: z.enum(["normal", "bold"]), fontStyle: z.enum(["normal", "italic"]), textAlign: z.enum(["left", "center", "right"]), lineHeight: finite.gt(0), scaleX: finite.gt(0).optional(), scaleY: finite.gt(0).optional() }).strict();
const glyphContour = z.object({ nodes: z.array(pathNode).min(2), segments: z.array(pathSegment).min(2) }).strict().superRefine((value, ctx) => {
  const nodeIds = value.nodes.map((node) => node.id);
  if (new Set(nodeIds).size !== nodeIds.length) ctx.addIssue({ code: "custom", message: "Glyph node IDs must be unique", path: ["nodes"] });
  if (value.segments.length !== value.nodes.length) ctx.addIssue({ code: "custom", message: "Glyph contour segment count must match node count", path: ["segments"] });
  const known = new Set(nodeIds);
  value.segments.forEach((segment, index) => {
    if (!known.has(segment.startNodeId) || !known.has(segment.endNodeId)) ctx.addIssue({ code: "custom", message: "Glyph segment references an unknown node", path: ["segments", index] });
    const start = value.nodes[index]; const end = value.nodes[(index + 1) % value.nodes.length];
    if (start && end && (segment.startNodeId !== start.id || segment.endNodeId !== end.id)) ctx.addIssue({ code: "custom", message: "Glyph segments must follow node order", path: ["segments", index] });
  });
});
const glyph = z.object({ ...common, type: z.literal("glyph"), position: point, size, glyph: z.string().min(1), contours: z.array(glyphContour).min(1), fillRule: z.literal("evenodd") }).strict().superRefine((value, ctx) => {
  const ids = value.contours.flatMap((contour) => contour.nodes.map((node) => node.id));
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Glyph node IDs must be unique across contours", path: ["contours"] });
});
export const elementSchema = z.discriminatedUnion("type", [rectangle, ellipse, line, sketch, dimension, contour, path, splineElementSchema, textElement, glyph]);
export const layerSchema = z.object({ id: nonEmptyId, name: z.string().min(1), visible: z.boolean(), order: finite.int().nonnegative() }).strict();
const documentFields = { id: nonEmptyId, revision: finite.int().nonnegative(), origin: z.literal("top-left"), units: z.literal("mm"), page: size, layers: z.array(layerSchema), elements: z.array(elementSchema), connections: z.array(explicitConnection).default([]) };
const validateConnections = (elements: readonly z.infer<typeof elementSchema>[], connections: readonly z.infer<typeof explicitConnection>[], ctx: z.RefinementCtx, path: (string | number)[] = []) => {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const ids = new Set<string>();
  connections.forEach((connection, index) => {
    if (ids.has(connection.id)) ctx.addIssue({ code: "custom", message: "Connection IDs must be unique", path: [...path, index, "id"] });
    ids.add(connection.id);
    const refs: readonly [typeof connection.first, typeof connection.second] = [connection.first, connection.second];
    if (refs[0].elementId === refs[1].elementId && JSON.stringify(refs[0].node) === JSON.stringify(refs[1].node)) ctx.addIssue({ code: "custom", message: "Connections must join two different nodes", path: [...path, index] });
    refs.forEach((reference, referenceIndex) => {
      const element = byId.get(reference.elementId);
      const address = reference.node;
      const valid = element && ((address.kind === "named" && (element.type === "rectangle" || element.type === "ellipse")) || (address.kind === "line" && element.type === "line") || (address.kind === "path" && element.type === "path") || (address.kind === "spline" && element.type === "spline") || (address.kind === "sketch" && element.type === "sketch"));
      if (!element) ctx.addIssue({ code: "custom", message: "Connection references an unknown element", path: [...path, index, referenceIndex === 0 ? "first" : "second", "elementId"] });
      else if (!valid) ctx.addIssue({ code: "custom", message: "Connection node address is invalid for its element", path: [...path, index, referenceIndex === 0 ? "first" : "second", "node"] });
      if ((address.kind === "path" || address.kind === "spline" || address.kind === "sketch") && element) {
        const nodes = element.type === "path" || element.type === "spline" ? element.nodes : element.type === "sketch" ? element.nodes : [];
        const node = nodes.find((candidate) => candidate.id === address.nodeId);
        if (!node) ctx.addIssue({ code: "custom", message: "Connection references an unknown node", path: [...path, index, referenceIndex === 0 ? "first" : "second", "node", "nodeId"] });
        else if (address.handle) {
          const hasHandle = address.kind === "spline" && element.type === "spline"
            ? address.handle === "in" ? element.nodes.find((candidate) => candidate.id === address.nodeId)?.inHandle !== undefined : element.nodes.find((candidate) => candidate.id === address.nodeId)?.outHandle !== undefined
            : address.kind === "path" && element.type === "path"
              ? element.segments.some((segment) => segment.type === "cubicBezier" && (address.handle === "in" ? segment.endNodeId : segment.startNodeId) === address.nodeId)
              : false;
          if (!hasHandle) ctx.addIssue({ code: "custom", message: "Connection references an unknown handle", path: [...path, index, referenceIndex === 0 ? "first" : "second", "node", "handle"] });
        }
      }
    });
  });
};
export const documentSchema = z.object({ schemaVersion: z.literal(CURRENT_SCHEMA_VERSION), ...documentFields, capabilities: z.object({ spline: z.literal(1).optional() }).strict().optional() }).strict().superRefine((value, ctx) => {
  const layerIds = new Set(value.layers.map((layer) => layer.id));
  const elementIds = new Set(value.elements.map((element) => element.id));
  for (const [index, element] of value.elements.entries()) {
    if (!layerIds.has(element.layerId)) ctx.addIssue({ code: "custom", message: "Element references an unknown layer", path: ["elements", index, "layerId"] });
    if (element.type === "dimension") for (const [referenceIndex, reference] of element.references.entries()) {
      const target = value.elements.find((candidate) => candidate.id === reference.elementId);
      if (!elementIds.has(reference.elementId)) ctx.addIssue({ code: "custom", message: "Dimension references an unknown element", path: ["elements", index, "references", referenceIndex, "elementId"] });
       else if (reference.kind === "line") {
         const validSketchEdge = target?.type === "sketch" && (reference.edgeIndex ?? 0) < target.edges.length;
         if (target?.type !== "line" && !validSketchEdge) ctx.addIssue({ code: "custom", message: "Line dimension references require line or sketch-edge elements", path: ["elements", index, "references", referenceIndex] });
         else if (target.type === "line" && target.start.x === target.end.x && target.start.y === target.end.y) ctx.addIssue({ code: "custom", message: "Dimension line references must not be degenerate", path: ["elements", index, "references", referenceIndex] });
         else if (target?.type === "sketch") {
           const edge = target.edges[reference.edgeIndex ?? 0]; const nodes = new Map(target.nodes.map((node) => [node.id, node.point]));
           const start = edge ? nodes.get(edge.startNodeId) : undefined; const end = edge ? nodes.get(edge.endNodeId) : undefined;
           if (!start || !end || (start.x === end.x && start.y === end.y)) ctx.addIssue({ code: "custom", message: "Dimension sketch-edge references must not be degenerate", path: ["elements", index, "references", referenceIndex] });
         }
      } else {
        const nodeCount = target?.type === "line" ? 3 : target?.type === "sketch" ? target.nodes.length : target?.type === "rectangle" ? 9 : target?.type === "ellipse" || target?.type === "text" ? 5 : target?.type === "contour" ? target.contours.reduce((count, contour) => count + Math.max(0, contour.points.length - 1) * 2, 0) : target?.type === "path" ? target.nodes.length + target.segments.filter((segment) => segment.type === "cubicBezier").length * 2 : target?.type === "spline" ? target.nodes.length + target.nodes.filter((node) => node.inHandle || node.outHandle).length : target?.type === "glyph" ? target.contours.reduce((count, contour) => count + contour.nodes.length + contour.segments.filter((segment) => segment.type === "cubicBezier").length * 2, 0) : undefined;
        if (nodeCount === undefined || reference.nodeIndex >= nodeCount) ctx.addIssue({ code: "custom", message: "Dimension node reference is out of range", path: ["elements", index, "references", referenceIndex, "nodeIndex"] });
            if (reference.nodeId !== undefined) {
              const stableNodeIds = target?.type === "line" ? ["start", "center", "end"] : target?.type === "rectangle" || target?.type === "ellipse" ? ["nw", "ne", "se", "sw", "center", "n", "e", "s", "w"] : target?.type === "sketch" || target?.type === "spline" || target?.type === "path" ? target.nodes.map((node) => node.id) : target?.type === "glyph" ? target.contours.flatMap((contour) => contour.nodes.map((node) => node.id)) : [];
              if (!stableNodeIds.includes(reference.nodeId)) ctx.addIssue({ code: "custom", message: "Dimension node reference id is unknown", path: ["elements", index, "references", referenceIndex, "nodeId"] });
            }
      }
    }
    if (element.type === "dimension" && element.kind === "angular" && element.references.every((reference) => reference.kind === "line")) {
      const first = value.elements.find((candidate) => candidate.id === element.references[0].elementId);
      const second = value.elements.find((candidate) => candidate.id === element.references[1].elementId);
       const endpoints = (element: (typeof value.elements)[number] | undefined, reference: { readonly kind?: string; readonly edgeIndex?: number | undefined }): readonly [PointMm, PointMm] | undefined => {
         if (reference.kind !== "line") return undefined;
         if (element?.type === "line") return visualLineEndpoints(element);
         if (element?.type !== "sketch") return undefined;
         const edge = element.edges[reference.edgeIndex ?? 0]; const nodes = new Map(element.nodes.map((node) => [node.id, node.point]));
         const start = edge ? nodes.get(edge.startNodeId) : undefined; const end = edge ? nodes.get(edge.endNodeId) : undefined;
         return start && end ? [start, end] : undefined;
       };
       const points = endpoints(first, element.references[0]); const otherPoints = endpoints(second, element.references[1]);
       if (points && otherPoints) {
         const connected = points.some((point) => otherPoints.some((other) => Math.hypot(point.x - other.x, point.y - other.y) <= 1e-6));
         if (!connected) ctx.addIssue({ code: "custom", message: "Angular dimension lines must share a visual endpoint", path: ["elements", index, "references"] });
      }
    }
  }
  validateConnections(value.elements, value.connections, ctx, ["connections"]);
});
const pageSchema = z.object({ id: nonEmptyId, page: size, layers: z.array(layerSchema), elements: z.array(elementSchema), connections: z.array(explicitConnection).default([]) }).strict();
const projectPreferencesSchema = z.object({ lineGuidesEnabled: z.boolean().default(true), lineGuideAngle: z.literal(15).default(15) }).strict().default({ lineGuidesEnabled: true, lineGuideAngle: 15 });
export const projectSchema = z.object({ schemaVersion: z.literal(CURRENT_SCHEMA_VERSION), id: nonEmptyId, revision: finite.int().nonnegative(), origin: z.literal("top-left"), units: z.literal("mm"), capabilities: z.object({ spline: z.literal(1).optional() }).strict().optional(), preferences: projectPreferencesSchema, pages: z.array(pageSchema).min(1), activePageId: nonEmptyId }).strict().superRefine((value, ctx) => {
  if (!value.pages.some((page) => page.id === value.activePageId)) ctx.addIssue({ code: "custom", message: "Active page does not exist", path: ["activePageId"] });
  const layerIds = new Set(value.pages.flatMap((page) => page.layers.map((layer) => layer.id)));
  value.pages.forEach((page, pageIndex) => { page.elements.forEach((element, elementIndex) => { if (!layerIds.has(element.layerId)) ctx.addIssue({ code: "custom", message: "Element references an unknown layer", path: ["pages", pageIndex, "elements", elementIndex, "layerId"] }); }); validateConnections(page.elements, page.connections, ctx, ["pages", pageIndex, "connections"]); });
});
export type ValidationIssue = { readonly path: readonly (string | number)[]; readonly message: string };
export type ValidationResult = { readonly success: true; readonly data: DocumentSnapshot } | { readonly success: false; readonly issues: readonly ValidationIssue[]; readonly error: string };

export type JsonValue = object | boolean | number | string | null;
const migrateLegacyElements = (elements: unknown): unknown => Array.isArray(elements) ? elements.map((element) => {
  if (typeof element !== "object" || element === null || Array.isArray(element)) return element;
  const candidate = element as Record<string, unknown>;
  return candidate.type === "sketch" && candidate.constraints === undefined ? { ...candidate, constraints: [] } : element;
}) : elements;
const migrateLegacyPages = (pages: unknown): unknown => Array.isArray(pages) ? pages.map((page) => {
  if (typeof page !== "object" || page === null || Array.isArray(page)) return page;
  const candidate = page as Record<string, unknown>;
  return { ...candidate, elements: migrateLegacyElements(candidate.elements), connections: candidate.connections ?? [] };
}) : pages;
export function migrateDocument(input: JsonValue): JsonValue {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const candidate = input as Record<string, unknown>;
  if (candidate.schemaVersion === 1) return { ...candidate, schemaVersion: CURRENT_SCHEMA_VERSION, page: { width: 1200, height: 900 }, elements: migrateLegacyElements(candidate.elements), connections: [] };
  if (candidate.schemaVersion === 2 || candidate.schemaVersion === 3 || candidate.schemaVersion === 4) {
    return { ...candidate, schemaVersion: CURRENT_SCHEMA_VERSION, page: candidate.page ?? { width: 1200, height: 900 }, elements: migrateLegacyElements(candidate.elements), connections: candidate.connections ?? [] };
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
  const migrated = migrateProject(input);
  const result = projectSchema.safeParse(migrated);
  if (result.success) { // SAFETY: projectSchema validated the complete shape; branded IDs are runtime strings.
    return { success: true, data: result.data as unknown as ProjectSnapshot };
  }
  const issues = result.error.issues.map((issue) => ({ path: issue.path.filter((part): part is string | number => typeof part === "string" || typeof part === "number"), message: issue.message }));
  return { success: false, issues, error: issues.map((issue) => `${issue.path.join(".") || "project"}: ${issue.message}`).join("; ") };
}

export function migrateProject(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const candidate = input as Record<string, unknown>;
  if (candidate.schemaVersion !== 1 && candidate.schemaVersion !== 2 && candidate.schemaVersion !== 3 && candidate.schemaVersion !== 4) return input;
  const pages = migrateLegacyPages(candidate.pages);
  return { ...candidate, schemaVersion: CURRENT_SCHEMA_VERSION, pages };
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

export type DesignValidation = {
  readonly ready: boolean;
  readonly openCurveCount: number;
  readonly duplicateLineCount: number;
  readonly outsideElementCount: number;
};

const elementPoints = (element: Element): readonly PointMm[] => {
  switch (element.type) {
    case "line": return [element.start, element.end];
    case "path": return element.nodes.map((node) => node.anchor);
    case "spline": return element.nodes.map((node) => node.anchor);
    case "sketch": return element.nodes.map((node) => node.point);
    case "contour": return element.contours.flatMap((contour) => contour.points);
    case "dimension": return [];
    default: return [element.position, { x: element.position.x + element.size.width, y: element.position.y + element.size.height }];
  }
};

const isOutsidePage = (points: readonly PointMm[], page: SizeMm): boolean => points.some((point) => point.x < 0 || point.y < 0 || point.x > page.width || point.y > page.height);

export function validateDesign(elements: readonly Element[], page: SizeMm): DesignValidation {
  const openCurveCount = elements.filter((element) => (element.type === "path" || element.type === "spline") && !element.closed).length;
  const lineKeys = new Set<string>();
  let duplicateLineCount = 0;
  for (const element of elements) {
    if (element.type !== "line") continue;
    const endpoints = [`${element.start.x},${element.start.y}`, `${element.end.x},${element.end.y}`].sort().join("|");
    if (lineKeys.has(endpoints)) duplicateLineCount += 1;
    lineKeys.add(endpoints);
  }
  const outsideElementCount = elements.filter((element) => isOutsidePage(elementPoints(element), page)).length;
  return { ready: openCurveCount === 0 && duplicateLineCount === 0 && outsideElementCount === 0, openCurveCount, duplicateLineCount, outsideElementCount };
}
