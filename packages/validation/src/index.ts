import { z } from "zod";
import { CURRENT_SCHEMA_VERSION, hasBounds, type DocumentSnapshot, type Element, type PointMm, type ProjectSnapshot, type SizeMm } from "@nodra/domain";

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
const circleConstraint = z.object({ id: nonEmptyId, kind: z.enum(["center-horizontal", "center-vertical", "radius", "diameter"]), value: finite, driving: z.boolean().optional() }).strict().superRefine((value, ctx) => {
  if ((value.kind === "radius" || value.kind === "diameter") && value.value <= 0) ctx.addIssue({ code: "custom", message: "Circle size constraints require a positive value", path: ["value"] });
});
const ellipse = z.object({ ...common, type: z.literal("ellipse"), position: point, size, circleConstraints: z.array(circleConstraint).optional() }).strict().superRefine((value, ctx) => {
  const constraints = value.circleConstraints ?? [];
  if (constraints.length > 0 && value.size.width !== value.size.height) ctx.addIssue({ code: "custom", message: "Circle constraints require a circular ellipse", path: ["circleConstraints"] });
  const ids = constraints.map((constraint) => constraint.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Circle constraint IDs must be unique", path: ["circleConstraints"] });
});
export const line = z.object({ ...common, type: z.literal("line"), start: point, end: point }).strict().superRefine((value, ctx) => {
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
const lineReference = z.object({ kind: z.literal("line"), elementId: nonEmptyId, edgeId: nonEmptyId.optional(), edgeIndex: finite.int().nonnegative().optional() }).strict();
const legacyNodeReference = z.object({ elementId: nonEmptyId, nodeIndex: finite.int().nonnegative(), nodeId: nonEmptyId.optional() }).strict().transform((reference) => ({ kind: "node" as const, ...reference }));
const dimensionReference = z.union([z.discriminatedUnion("kind", [nodeReference, lineReference]), legacyNodeReference]);
const dimension = z.object({ id: nonEmptyId, layerId: nonEmptyId, type: z.literal("dimension"), kind: z.enum(["aligned", "horizontal", "vertical", "angular", "radius", "diameter"]), references: z.tuple([dimensionReference, dimensionReference]), offset: point, precision: finite.int().min(0).max(6), units: z.literal("mm"), rotation: z.literal(0), style, driving: z.boolean().optional(), constraintId: nonEmptyId.optional() }).strict().superRefine((value, ctx) => {
  const [first, second] = value.references;
  if (value.kind === "angular") {
    if (first.kind !== "line" || second.kind !== "line") ctx.addIssue({ code: "custom", message: "Angular dimensions require line references", path: ["references"] });
     // Two identical line references represent an angle against the horizontal axis.
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
const sketchEdgeReference = z.object({ elementId: nonEmptyId, edgeId: nonEmptyId }).strict();
const sketchConstraintReference = z.union([sketchPointReference, sketchEdgeReference]);
const sketchConstraint = z.object({ id: nonEmptyId, kind: z.enum(["horizontal", "vertical", "coincident", "parallel", "perpendicular", "equal", "distance-horizontal", "distance-vertical", "distance", "angle", "fixed"]), references: z.array(sketchConstraintReference).min(1).max(4), value: finite.positive().optional() }).strict();
const sketch = z.object({ id: nonEmptyId, layerId: nonEmptyId, type: z.literal("sketch"), nodes: z.array(sketchNode).min(2), edges: z.array(sketchEdge).min(1), constraints: z.array(sketchConstraint).optional(), style, operation: operation.optional() }).strict().superRefine((value, ctx) => {
  const nodeIds = value.nodes.map((node) => node.id); const edgeIds = value.edges.map((edge) => edge.id);
  if (new Set(nodeIds).size !== nodeIds.length) ctx.addIssue({ code: "custom", message: "Sketch node IDs must be unique", path: ["nodes"] });
  if (new Set(edgeIds).size !== edgeIds.length) ctx.addIssue({ code: "custom", message: "Sketch edge IDs must be unique", path: ["edges"] });
  const known = new Set(nodeIds); const knownEdges = new Set(edgeIds);
  const constraints = value.constraints ?? [];
  const constraintIds = constraints.map((constraint) => constraint.id);
  if (new Set(constraintIds).size !== constraintIds.length) ctx.addIssue({ code: "custom", message: "Sketch constraint IDs must be unique", path: ["constraints"] });
  constraints.forEach((constraint, index) => {
    if (constraint.references.some((reference) => reference.elementId !== value.id || ("nodeId" in reference ? !known.has(reference.nodeId) : !knownEdges.has(reference.edgeId)))) ctx.addIssue({ code: "custom", message: "Sketch constraint references unknown geometry", path: ["constraints", index, "references"] });
    const segmentRelation = constraint.kind === "parallel" || constraint.kind === "perpendicular" || constraint.kind === "equal";
    const canonicalSegments = segmentRelation && constraint.references.length === 2 && constraint.references.every((reference) => "edgeId" in reference);
    const distinctCanonicalSegments = canonicalSegments && "edgeId" in constraint.references[0]! && "edgeId" in constraint.references[1]! && constraint.references[0].edgeId !== constraint.references[1].edgeId;
    const legacySegments = segmentRelation && constraint.references.length === 4 && constraint.references.every((reference) => "nodeId" in reference);
    const legacyEdges = legacySegments ? [[constraint.references[0], constraint.references[1]], [constraint.references[2], constraint.references[3]]].map(([first, second]) => value.edges.filter((edge) => "nodeId" in first! && "nodeId" in second! && (edge.startNodeId === first.nodeId && edge.endNodeId === second.nodeId || edge.startNodeId === second.nodeId && edge.endNodeId === first.nodeId))) : [];
    const distinctLegacySegments = legacyEdges.length === 2 && legacyEdges.every((matches) => matches.length === 1) && legacyEdges[0]![0]!.id !== legacyEdges[1]![0]!.id;
    const expectedReferences = constraint.kind === "fixed" ? 1 : 2;
    if (segmentRelation ? !distinctCanonicalSegments && !distinctLegacySegments : constraint.references.length !== expectedReferences || !constraint.references.every((reference) => "nodeId" in reference)) ctx.addIssue({ code: "custom", message: segmentRelation ? "Segment constraints require two edge references" : constraint.kind + " constraints require " + expectedReferences + " reference" + (expectedReferences === 1 ? "" : "s"), path: ["constraints", index, "references"] });
    if ((constraint.kind === "distance-horizontal" || constraint.kind === "distance-vertical" || constraint.kind === "distance" || constraint.kind === "angle") && (constraint.value === undefined || constraint.value <= 0)) ctx.addIssue({ code: "custom", message: "Distance constraints require a positive value", path: ["constraints", index, "value"] });
  });
  value.edges.forEach((edge, index) => {
    if (!known.has(edge.startNodeId) || !known.has(edge.endNodeId)) ctx.addIssue({ code: "custom", message: "Sketch edge references an unknown node", path: ["edges", index] });
    if (edge.startNodeId === edge.endNodeId) ctx.addIssue({ code: "custom", message: "Sketch edge endpoints must differ", path: ["edges", index] });
  });
});
const pathNode = z.object({ id: nonEmptyId, anchor: point, join: z.enum(["corner", "smooth", "symmetric"]) }).strict();
const pathLineSegment = z.object({ id: nonEmptyId, type: z.literal("line"), startNodeId: nonEmptyId, endNodeId: nonEmptyId }).strict();
const pathCubicSegment = z.object({ id: nonEmptyId, type: z.literal("cubicBezier"), startNodeId: nonEmptyId, endNodeId: nonEmptyId, control1: point, control2: point }).strict();
const pathSegment = z.discriminatedUnion("type", [pathLineSegment, pathCubicSegment]);
const path = z.object({ id: nonEmptyId, layerId: nonEmptyId, type: z.literal("path"), nodes: z.array(pathNode).min(2), segments: z.array(pathSegment).min(1), closed: z.boolean(), rotation: finite.optional(), flipX: z.boolean().optional(), flipY: z.boolean().optional(), style, operation: operation.optional() }).strict().superRefine((value, ctx) => {
  const nodeIds = value.nodes.map((node) => node.id); const segmentIds = value.segments.map((segment) => segment.id);
  if (new Set(nodeIds).size !== nodeIds.length) ctx.addIssue({ code: "custom", message: "Path node IDs must be unique", path: ["nodes"] });
  if (new Set(segmentIds).size !== segmentIds.length) ctx.addIssue({ code: "custom", message: "Path segment IDs must be unique", path: ["segments"] });
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
  const segmentIds = value.contours.flatMap((contour) => contour.segments.map((segment) => segment.id));
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Glyph node IDs must be unique across contours", path: ["contours"] });
  if (new Set(segmentIds).size !== segmentIds.length) ctx.addIssue({ code: "custom", message: "Glyph segment IDs must be unique across contours", path: ["contours"] });
});
export const elementSchema = z.discriminatedUnion("type", [rectangle, ellipse, line, sketch, dimension, contour, path, splineElementSchema, textElement, glyph]);
export const layerSchema = z.object({ id: nonEmptyId, name: z.string().min(1), visible: z.boolean(), order: finite.int().nonnegative() }).strict();
const documentFields = { id: nonEmptyId, revision: finite.int().nonnegative(), origin: z.literal("top-left"), units: z.literal("mm"), page: size, layers: z.array(layerSchema), elements: z.array(elementSchema), constraints: z.array(sketchConstraint).optional(), connections: z.array(explicitConnection).default([]) };
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
      const validNamed = address.kind === "named" && (element?.type === "rectangle" || element?.type === "ellipse" && ["center", "n", "e", "s", "w"].includes(address.name));
      const valid = element && (validNamed || (address.kind === "line" && element.type === "line") || (address.kind === "path" && element.type === "path") || (address.kind === "spline" && element.type === "spline") || (address.kind === "sketch" && element.type === "sketch"));
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
export const validateDocumentConstraints = (elements: readonly z.infer<typeof elementSchema>[], constraints: readonly z.infer<typeof sketchConstraint>[], ctx: z.RefinementCtx, path: readonly (string | number)[]) => {
  const sketches = new Map(elements.filter((element): element is Extract<typeof element, { type: "sketch" }> => element.type === "sketch").map((element) => [element.id, element]));
  const ids = new Set<string>();
  constraints.forEach((constraint, index) => {
    if (ids.has(constraint.id)) ctx.addIssue({ code: "custom", message: "Document constraint IDs must be unique", path: [...path, index, "id"] });
    ids.add(constraint.id);
    const segmentRelation = constraint.kind === "parallel" || constraint.kind === "perpendicular" || constraint.kind === "equal";
    const canonicalSegments = segmentRelation && constraint.references.length === 2 && constraint.references.every((reference) => "edgeId" in reference);
    const legacySegments = segmentRelation && constraint.references.length === 4 && constraint.references.every((reference) => "nodeId" in reference);
    const legacyEdges = legacySegments ? [[constraint.references[0], constraint.references[1]], [constraint.references[2], constraint.references[3]]].map(([first, second]) => { const sketch = sketches.get(first!.elementId); return sketch?.edges.filter((edge) => "nodeId" in first! && "nodeId" in second! && first.elementId === second.elementId && (edge.startNodeId === first.nodeId && edge.endNodeId === second.nodeId || edge.startNodeId === second.nodeId && edge.endNodeId === first.nodeId)) ?? []; }) : [];
    const distinctLegacySegments = legacyEdges.length === 2 && legacyEdges.every((matches) => matches.length === 1) && (legacyEdges[0]![0]!.id !== legacyEdges[1]![0]!.id || constraint.references[0]!.elementId !== constraint.references[2]!.elementId);
    const expectedReferences = constraint.kind === "fixed" ? 1 : 2;
    if (segmentRelation ? !canonicalSegments && !distinctLegacySegments : constraint.references.length !== expectedReferences || !constraint.references.every((reference) => "nodeId" in reference)) ctx.addIssue({ code: "custom", message: segmentRelation ? "Segment constraints require two edge references" : constraint.kind + " constraints require " + expectedReferences + " reference" + (expectedReferences === 1 ? "" : "s"), path: [...path, index, "references"] });
    const usesValue = constraint.kind === "distance-horizontal" || constraint.kind === "distance-vertical" || constraint.kind === "distance" || constraint.kind === "angle";
    if (usesValue && (constraint.value === undefined || constraint.value <= 0)) ctx.addIssue({ code: "custom", message: "Distance constraints require a positive value", path: [...path, index, "value"] });
    if (!usesValue && constraint.value !== undefined) ctx.addIssue({ code: "custom", message: "This constraint kind must not define a value", path: [...path, index, "value"] });
    if (constraint.references.some((reference, referenceIndex) => constraint.references.slice(0, referenceIndex).some((previous) => previous.elementId === reference.elementId && ("nodeId" in previous && "nodeId" in reference ? previous.nodeId === reference.nodeId : "edgeId" in previous && "edgeId" in reference && previous.edgeId === reference.edgeId)))) ctx.addIssue({ code: "custom", message: "Document constraint references must identify different geometry", path: [...path, index, "references"] });
    constraint.references.forEach((reference, referenceIndex) => {
      const target = sketches.get(reference.elementId);
      if (!target || ("nodeId" in reference ? !target.nodes.some((node) => node.id === reference.nodeId) : !target.edges.some((edge) => edge.id === reference.edgeId))) ctx.addIssue({ code: "custom", message: "Document constraint references unknown sketch geometry", path: [...path, index, "references", referenceIndex] });
    });
  });
};
const documentSchema = z.object({ schemaVersion: z.literal(CURRENT_SCHEMA_VERSION), ...documentFields, capabilities: z.object({ spline: z.literal(1).optional() }).strict().optional() }).strict().superRefine((value, ctx) => {
  const layerIds = new Set(value.layers.map((layer) => layer.id));
  const elementIds = new Set(value.elements.map((element) => element.id));
  if (layerIds.size !== value.layers.length) ctx.addIssue({ code: "custom", message: "Layer IDs must be unique", path: ["layers"] });
  if (elementIds.size !== value.elements.length) ctx.addIssue({ code: "custom", message: "Element IDs must be unique", path: ["elements"] });
  for (const [index, element] of value.elements.entries()) {
    if (!layerIds.has(element.layerId)) ctx.addIssue({ code: "custom", message: "Element references an unknown layer", path: ["elements", index, "layerId"] });
    if (element.type === "dimension") for (const [referenceIndex, reference] of element.references.entries()) {
      const target = value.elements.find((candidate) => candidate.id === reference.elementId);
      if (!elementIds.has(reference.elementId)) ctx.addIssue({ code: "custom", message: "Dimension references an unknown element", path: ["elements", index, "references", referenceIndex, "elementId"] });
       else if (reference.kind === "line") {
         const stableEdgeIndex = target?.type === "sketch" && reference.edgeId !== undefined ? target.edges.findIndex((edge) => edge.id === reference.edgeId) : undefined;
         const resolvedEdgeIndex = stableEdgeIndex ?? reference.edgeIndex ?? 0;
         const validSketchEdge = target?.type === "sketch" && resolvedEdgeIndex >= 0 && resolvedEdgeIndex < target.edges.length;
         if (target?.type !== "line" && !validSketchEdge) ctx.addIssue({ code: "custom", message: "Line dimension references require line or sketch-edge elements", path: ["elements", index, "references", referenceIndex] });
         else if (target.type === "line" && reference.edgeId !== undefined) ctx.addIssue({ code: "custom", message: "Native line references must not include a sketch edge ID", path: ["elements", index, "references", referenceIndex, "edgeId"] });
         else if (target.type === "line" && target.start.x === target.end.x && target.start.y === target.end.y) ctx.addIssue({ code: "custom", message: "Dimension line references must not be degenerate", path: ["elements", index, "references", referenceIndex] });
         else if (target?.type === "sketch") {
           if (reference.edgeId !== undefined && reference.edgeIndex !== undefined && reference.edgeIndex !== stableEdgeIndex) ctx.addIssue({ code: "custom", message: "Dimension sketch-edge ID and legacy index must identify the same edge", path: ["elements", index, "references", referenceIndex] });
           const edge = target.edges[resolvedEdgeIndex]; const nodes = new Map(target.nodes.map((node) => [node.id, node.point]));
           const start = edge ? nodes.get(edge.startNodeId) : undefined; const end = edge ? nodes.get(edge.endNodeId) : undefined;
           if (!start || !end || (start.x === end.x && start.y === end.y)) ctx.addIssue({ code: "custom", message: "Dimension sketch-edge references must not be degenerate", path: ["elements", index, "references", referenceIndex] });
         }
      } else {
        const nodeCount = target?.type === "line" ? 3 : target?.type === "sketch" ? target.nodes.length : target?.type === "rectangle" ? 9 : target?.type === "ellipse" || target?.type === "text" ? 5 : target?.type === "contour" ? target.contours.reduce((count, contour) => count + Math.max(0, contour.points.length - 1) * 2, 0) : target?.type === "path" ? target.nodes.length + target.segments.filter((segment) => segment.type === "cubicBezier").length * 2 : target?.type === "spline" ? target.nodes.reduce((count, node) => count + 1 + Number(node.inHandle !== undefined) + Number(node.outHandle !== undefined), 0) : target?.type === "glyph" ? target.contours.reduce((count, contour) => count + contour.nodes.length + contour.segments.filter((segment) => segment.type === "cubicBezier").length * 2, 0) : undefined;
        if (nodeCount === undefined || reference.nodeIndex >= nodeCount) ctx.addIssue({ code: "custom", message: "Dimension node reference is out of range", path: ["elements", index, "references", referenceIndex, "nodeIndex"] });
            if (reference.nodeId !== undefined) {
              const stableNodeIdsByIndex: readonly (string | undefined)[] = target?.type === "line" ? ["start", "center", "end"]
                : target?.type === "rectangle" ? ["nw", "ne", "se", "sw", "center", "n", "e", "s", "w"]
                  : target?.type === "ellipse" ? ["center", "n", "e", "s", "w"]
                    : target?.type === "sketch" ? target.nodes.map((node) => node.id)
                      : target?.type === "path" ? [...target.nodes.map((node) => node.id), ...target.segments.flatMap((segment) => segment.type === "cubicBezier" ? [undefined, undefined] : [])]
                        : target?.type === "spline" ? target.nodes.flatMap((node) => [node.id, ...(node.inHandle ? [undefined] : []), ...(node.outHandle ? [undefined] : [])])
                          : target?.type === "glyph" ? target.contours.flatMap((contour) => [...contour.nodes.map((node) => node.id), ...contour.segments.flatMap((segment) => segment.type === "cubicBezier" ? [undefined, undefined] : [])]) : [];
              if (!stableNodeIdsByIndex.includes(reference.nodeId)) ctx.addIssue({ code: "custom", message: "Dimension node reference id is unknown", path: ["elements", index, "references", referenceIndex, "nodeId"] });
            }
      }
    }
    if (element.type === "dimension" && (element.kind === "radius" || element.kind === "diameter")) {
      const [first, second] = element.references;
      const target = first.kind === "node" && second.kind === "node" && first.elementId === second.elementId ? value.elements.find((candidate) => candidate.id === first.elementId) : undefined;
      const nodeIds = target?.type === "ellipse" ? new Set(["center", "n", "e", "s", "w"]) : undefined;
      if (target?.type !== "ellipse" || first.kind !== "node" || second.kind !== "node" || first.nodeId === undefined || second.nodeId === undefined || !nodeIds?.has(first.nodeId) || !nodeIds.has(second.nodeId) || first.nodeId === second.nodeId || first.nodeId !== "center" && second.nodeId !== "center") ctx.addIssue({ code: "custom", message: "Radius dimensions require distinct center and cardinal nodes on one circle", path: ["elements", index, "references"] });
    }
    if (element.type === "dimension" && element.kind === "angular" && element.references.every((reference) => reference.kind === "line")) {
      const first = value.elements.find((candidate) => candidate.id === element.references[0].elementId);
      const second = value.elements.find((candidate) => candidate.id === element.references[1].elementId);
       const endpoints = (element: (typeof value.elements)[number] | undefined, reference: { readonly kind?: string; readonly edgeId?: string | undefined; readonly edgeIndex?: number | undefined }): readonly [PointMm, PointMm] | undefined => {
         if (reference.kind !== "line") return undefined;
         if (element?.type === "line") return visualLineEndpoints(element);
         if (element?.type !== "sketch") return undefined;
         const edge = reference.edgeId !== undefined ? element.edges.find((candidate) => candidate.id === reference.edgeId) : element.edges[reference.edgeIndex ?? 0]; const nodes = new Map(element.nodes.map((node) => [node.id, node.point]));
         const start = edge ? nodes.get(edge.startNodeId) : undefined; const end = edge ? nodes.get(edge.endNodeId) : undefined;
         return start && end ? [start, end] : undefined;
       };
       const points = endpoints(first, element.references[0]); const otherPoints = endpoints(second, element.references[1]);
       const [firstReference, secondReference] = element.references;
       const lineKey = (target: (typeof value.elements)[number] | undefined, reference: typeof firstReference): string | undefined => {
         if (reference.kind !== "line" || !target) return undefined;
         if (target.type === "line") return target.id;
         if (target.type !== "sketch") return undefined;
         const edge = reference.edgeId !== undefined ? target.edges.find((candidate) => candidate.id === reference.edgeId) : target.edges[reference.edgeIndex ?? 0];
         return edge ? `${target.id}:${edge.id}` : undefined;
       };
       const firstLineKey = lineKey(first, firstReference); const secondLineKey = lineKey(second, secondReference);
       const sameLineReference = firstLineKey !== undefined && firstLineKey === secondLineKey;
       if (points && otherPoints && !sameLineReference) {
         const connected = points.some((point) => otherPoints.some((other) => Math.hypot(point.x - other.x, point.y - other.y) <= 1e-6));
         if (!connected) ctx.addIssue({ code: "custom", message: "Angular dimension lines must share a visual endpoint", path: ["elements", index, "references"] });
      }
    }
  }
  validateDocumentConstraints(value.elements, value.constraints ?? [], ctx, ["constraints"]);
  validateConnections(value.elements, value.connections, ctx, ["connections"]);
});
const pageSchema = z.object({ id: nonEmptyId, page: size, layers: z.array(layerSchema), elements: z.array(elementSchema), constraints: z.array(sketchConstraint).optional(), connections: z.array(explicitConnection).default([]) }).strict();
const projectPreferencesSchema = z.object({ lineGuidesEnabled: z.boolean().default(true), lineGuideAngle: z.union([z.literal(15), z.literal(45)]).default(45).transform(() => 45) }).strict().default({ lineGuidesEnabled: true, lineGuideAngle: 45 });
export const projectSchema = z.object({ schemaVersion: z.literal(CURRENT_SCHEMA_VERSION), id: nonEmptyId, revision: finite.int().nonnegative(), origin: z.literal("top-left"), units: z.literal("mm"), capabilities: z.object({ spline: z.literal(1).optional() }).strict().optional(), preferences: projectPreferencesSchema, pages: z.array(pageSchema).min(1), activePageId: nonEmptyId }).strict().superRefine((value, ctx) => {
  if (!value.pages.some((page) => page.id === value.activePageId)) ctx.addIssue({ code: "custom", message: "Active page does not exist", path: ["activePageId"] });
  const pageIds = new Set(value.pages.map((page) => page.id));
  if (pageIds.size !== value.pages.length) ctx.addIssue({ code: "custom", message: "Page IDs must be unique", path: ["pages"] });
  value.pages.forEach((page, pageIndex) => {
    const layerIds = new Set(page.layers.map((layer) => layer.id)); const elementIds = new Set(page.elements.map((element) => element.id));
    if (layerIds.size !== page.layers.length) ctx.addIssue({ code: "custom", message: "Layer IDs must be unique within a page", path: ["pages", pageIndex, "layers"] });
    if (elementIds.size !== page.elements.length) ctx.addIssue({ code: "custom", message: "Element IDs must be unique within a page", path: ["pages", pageIndex, "elements"] });
    page.elements.forEach((element, elementIndex) => { if (!layerIds.has(element.layerId)) ctx.addIssue({ code: "custom", message: "Element references an unknown layer", path: ["pages", pageIndex, "elements", elementIndex, "layerId"] }); });
    validateDocumentConstraints(page.elements, page.constraints ?? [], ctx, ["pages", pageIndex, "constraints"]);
    validateConnections(page.elements, page.connections, ctx, ["pages", pageIndex, "connections"]);
  });
});
export type ValidationIssue = { readonly path: readonly (string | number)[]; readonly message: string };
export type ValidationResult = { readonly success: true; readonly data: DocumentSnapshot } | { readonly success: false; readonly issues: readonly ValidationIssue[]; readonly error: string };

export type JsonValue = object | boolean | number | string | null;
const migrateLegacySegments = (segments: unknown, prefix: string): unknown => {
  if (!Array.isArray(segments)) return segments;
  const used = new Set(segments.flatMap((segment) => {
    if (typeof segment !== "object" || segment === null || Array.isArray(segment)) return [];
    const id = (segment as Record<string, unknown>).id;
    return typeof id === "string" ? [id] : [];
  }));
  return segments.map((segment, index) => {
    if (typeof segment !== "object" || segment === null || Array.isArray(segment)) return segment;
    const candidate = segment as Record<string, unknown>;
    if (typeof candidate.id === "string") return segment;
    const base = `${prefix}:segment:${index}`;
    let id = base; let suffix = 1;
    while (used.has(id)) id = `${base}:${suffix++}`;
    used.add(id);
    return { ...candidate, id };
  });
};
const legacyStableNodeIndex = (target: Record<string, unknown>, nodeId: string): number | undefined => {
  const named = target.type === "line" ? ["start", "center", "end"] : target.type === "rectangle" ? ["nw", "ne", "se", "sw", "center", "n", "e", "s", "w"] : target.type === "ellipse" ? ["center", "n", "e", "s", "w"] : undefined;
  if (named) { const index = named.indexOf(nodeId); return index >= 0 ? index : undefined; }
  if (target.type === "sketch" || target.type === "path") {
    const nodes = Array.isArray(target.nodes) ? target.nodes : []; const index = nodes.findIndex((node) => typeof node === "object" && node !== null && !Array.isArray(node) && (node as Record<string, unknown>).id === nodeId);
    return index >= 0 ? index : undefined;
  }
  if (target.type === "spline") {
    const nodes = Array.isArray(target.nodes) ? target.nodes : []; let index = 0;
    for (const node of nodes) {
      if (typeof node !== "object" || node === null || Array.isArray(node)) continue;
      const candidate = node as Record<string, unknown>; if (candidate.id === nodeId) return index;
      index += 1 + Number(candidate.inHandle !== undefined) + Number(candidate.outHandle !== undefined);
    }
  }
  if (target.type === "glyph" && Array.isArray(target.contours)) {
    let index = 0;
    for (const contour of target.contours) {
      if (typeof contour !== "object" || contour === null || Array.isArray(contour)) continue;
      const current = contour as Record<string, unknown>; const nodes = Array.isArray(current.nodes) ? current.nodes : [];
      const nodeIndex = nodes.findIndex((node) => typeof node === "object" && node !== null && !Array.isArray(node) && (node as Record<string, unknown>).id === nodeId);
      if (nodeIndex >= 0) return index + nodeIndex;
      const segments = Array.isArray(current.segments) ? current.segments : [];
      index += nodes.length + segments.filter((segment) => typeof segment === "object" && segment !== null && !Array.isArray(segment) && (segment as Record<string, unknown>).type === "cubicBezier").length * 2;
    }
  }
  return undefined;
};
const migrateLegacyElements = (elements: unknown): unknown => {
  if (!Array.isArray(elements)) return elements;
  const normalized = elements.map((element) => {
    if (typeof element !== "object" || element === null || Array.isArray(element)) return element;
    const candidate = element as Record<string, unknown>;
    if (candidate.type === "sketch" && candidate.constraints === undefined) return { ...candidate, constraints: [] };
    if (candidate.type === "path" && typeof candidate.id === "string") return { ...candidate, segments: migrateLegacySegments(candidate.segments, candidate.id) };
    if (candidate.type === "glyph" && typeof candidate.id === "string" && Array.isArray(candidate.contours)) return { ...candidate, contours: candidate.contours.map((contour, contourIndex) => {
      if (typeof contour !== "object" || contour === null || Array.isArray(contour)) return contour;
      const current = contour as Record<string, unknown>;
      return { ...current, segments: migrateLegacySegments(current.segments, `${candidate.id}:contour:${contourIndex}`) };
    }) };
    return element;
  });
  const byId = new Map(normalized.flatMap((element) => {
    if (typeof element !== "object" || element === null || Array.isArray(element)) return [];
    const candidate = element as Record<string, unknown>;
    return typeof candidate.id === "string" ? [[candidate.id, candidate] as const] : [];
  }));
  return normalized.map((element) => {
    if (typeof element !== "object" || element === null || Array.isArray(element)) return element;
    const candidate = element as Record<string, unknown>;
    if (candidate.type !== "dimension" || !Array.isArray(candidate.references)) return element;
    const references = candidate.references.map((reference) => {
      if (typeof reference !== "object" || reference === null || Array.isArray(reference)) return reference;
      const current = reference as Record<string, unknown>;
      if (typeof current.elementId !== "string") return reference;
      const target = byId.get(current.elementId);
      if ((current.kind === "node" || current.kind === undefined) && typeof current.nodeId === "string" && target) {
        const nodeIndex = legacyStableNodeIndex(target, current.nodeId);
        return nodeIndex === undefined ? reference : { ...current, nodeIndex };
      }
      if (current.kind !== "line" || current.edgeId !== undefined) return reference;
      if (target?.type !== "sketch" || !Array.isArray(target.edges)) return reference;
      const edgeIndex = typeof current.edgeIndex === "number" ? current.edgeIndex : 0;
      const edge = target.edges[edgeIndex];
      if (typeof edge !== "object" || edge === null || Array.isArray(edge) || typeof (edge as Record<string, unknown>).id !== "string") return reference;
      return { ...current, edgeId: (edge as Record<string, unknown>).id, edgeIndex };
    });
    return { ...candidate, references };
  });
};
const normalizeStableDimensionReferences = (input: unknown): unknown => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const candidate = input as Record<string, unknown>;
  const normalizeElements = (elements: unknown): unknown => {
    if (!Array.isArray(elements)) return elements;
    const byId = new Map(elements.flatMap((element) => {
      if (typeof element !== "object" || element === null || Array.isArray(element)) return [];
      const id = (element as Record<string, unknown>).id;
      return typeof id === "string" ? [[id, element as Record<string, unknown>] as const] : [];
    }));
    return elements.map((element) => {
      if (typeof element !== "object" || element === null || Array.isArray(element)) return element;
      const current = element as Record<string, unknown>;
      if (current.type !== "dimension" || !Array.isArray(current.references)) return element;
      const references = current.references.map((reference) => {
        if (typeof reference !== "object" || reference === null || Array.isArray(reference)) return reference;
        const currentReference = reference as Record<string, unknown>;
        const target = byId.get(currentReference.elementId as string);
        if (!target) return reference;
        if (currentReference.kind === "line" && typeof currentReference.edgeId === "string" && target.type === "sketch" && Array.isArray(target.edges)) {
          const edgeIndex = target.edges.findIndex((edge) => typeof edge === "object" && edge !== null && !Array.isArray(edge) && (edge as Record<string, unknown>).id === currentReference.edgeId);
          return edgeIndex >= 0 ? { ...currentReference, edgeIndex } : reference;
        }
        if ((currentReference.kind === "node" || currentReference.kind === undefined) && typeof currentReference.nodeId === "string") {
          const nodeIndex = legacyStableNodeIndex(target, currentReference.nodeId);
          return nodeIndex === undefined ? reference : { ...currentReference, nodeIndex };
        }
        return reference;
      });
      return { ...current, references };
    });
  };
  if (Array.isArray(candidate.elements)) return { ...candidate, elements: normalizeElements(candidate.elements) };
  if (Array.isArray(candidate.pages)) return { ...candidate, pages: candidate.pages.map((page) => {
    if (typeof page !== "object" || page === null || Array.isArray(page)) return page;
    const currentPage = page as Record<string, unknown>;
    return { ...currentPage, elements: normalizeElements(currentPage.elements) };
  }) };
  return input;
};
const normalizeStableConstraintReferences = (input: unknown): unknown => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const normalizePage = (page: Record<string, unknown>): Record<string, unknown> => {
    if (!Array.isArray(page.elements)) return page;
    const byId = new Map(page.elements.flatMap((element) => typeof element === "object" && element !== null && !Array.isArray(element) && typeof (element as Record<string, unknown>).id === "string" ? [[(element as Record<string, unknown>).id as string, element as Record<string, unknown>] as const] : []));
    const normalizeConstraints = (constraints: unknown): unknown => !Array.isArray(constraints) ? constraints : constraints.map((constraint) => {
      if (typeof constraint !== "object" || constraint === null || Array.isArray(constraint)) return constraint;
      const current = constraint as Record<string, unknown>;
      if (!["parallel", "perpendicular", "equal"].includes(current.kind as string) || !Array.isArray(current.references) || current.references.length !== 4) return constraint;
      const references = current.references as unknown[];
      const edges = [[references[0], references[1]], [references[2], references[3]]].map((pair) => {
        if (pair.some((reference) => typeof reference !== "object" || reference === null || Array.isArray(reference))) return undefined;
        const [first, second] = pair as [Record<string, unknown>, Record<string, unknown>];
        if (typeof first.elementId !== "string" || first.elementId !== second.elementId || typeof first.nodeId !== "string" || typeof second.nodeId !== "string") return undefined;
        const sketch = byId.get(first.elementId);
        if (sketch?.type !== "sketch" || !Array.isArray(sketch.edges)) return undefined;
        const matches = sketch.edges.filter((edge) => { if (typeof edge !== "object" || edge === null || Array.isArray(edge)) return false; const candidate = edge as Record<string, unknown>; return candidate.startNodeId === first.nodeId && candidate.endNodeId === second.nodeId || candidate.startNodeId === second.nodeId && candidate.endNodeId === first.nodeId; });
        const edge = matches.length === 1 ? matches[0] as Record<string, unknown> : undefined;
        return edge && typeof edge.id === "string" ? { elementId: first.elementId, edgeId: edge.id } : undefined;
      });
      return edges.every((edge) => edge !== undefined) ? { ...current, references: edges } : constraint;
    });
    const elements = page.elements.map((element) => {
      if (typeof element !== "object" || element === null || Array.isArray(element)) return element;
      const current = element as Record<string, unknown>;
      return current.type === "sketch" && current.constraints !== undefined ? { ...current, constraints: normalizeConstraints(current.constraints) } : element;
    });
    return { ...page, elements, ...(page.constraints !== undefined ? { constraints: normalizeConstraints(page.constraints) } : {}) };
  };
  const candidate = input as Record<string, unknown>;
  if (Array.isArray(candidate.pages)) return { ...candidate, pages: candidate.pages.map((page) => typeof page === "object" && page !== null && !Array.isArray(page) ? normalizePage(page as Record<string, unknown>) : page) };
  return normalizePage(candidate);
};

const migrateLegacyPages = (pages: unknown): unknown => Array.isArray(pages) ? pages.map((page) => {
  if (typeof page !== "object" || page === null || Array.isArray(page)) return page;
  const candidate = page as Record<string, unknown>;
  return { ...candidate, elements: migrateLegacyElements(candidate.elements), connections: candidate.connections ?? [] };
}) : pages;
export function migrateDocument(input: JsonValue): JsonValue {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const candidate = input as Record<string, unknown>;
  if (candidate.schemaVersion === 1) return { ...candidate, schemaVersion: CURRENT_SCHEMA_VERSION, page: { width: 1200, height: 900 }, elements: migrateLegacyElements(candidate.elements), connections: [] };
  if (candidate.schemaVersion === 2 || candidate.schemaVersion === 3 || candidate.schemaVersion === 4 || candidate.schemaVersion === 5 || candidate.schemaVersion === 6) {
    return { ...candidate, schemaVersion: CURRENT_SCHEMA_VERSION, page: candidate.page ?? { width: 1200, height: 900 }, elements: migrateLegacyElements(candidate.elements), connections: candidate.connections ?? [] };
  }
  return input;
}

export type DocumentLoadResult = { readonly mode: "editable"; readonly document: DocumentSnapshot; readonly issues: readonly [] } | { readonly mode: "diagnostic" | "recovery"; readonly raw: unknown; readonly issues: readonly ValidationIssue[]; readonly error: string };
export function loadDocument(input: unknown): DocumentLoadResult { const checked = validateDocument(input); if (checked.success) return { mode: "editable", document: checked.data, issues: [] }; const candidate = typeof input === "object" && input !== null && !Array.isArray(input) ? input as Record<string, unknown> : undefined; const capabilities = candidate?.capabilities; const unknown = typeof capabilities === "object" && capabilities !== null && !Array.isArray(capabilities) && Object.keys(capabilities).some((key) => key !== "spline"); return { mode: unknown ? "diagnostic" : "recovery", raw: input, issues: checked.issues, error: checked.error }; }
export function validateDocument(input: unknown): ValidationResult {
  const migrated = normalizeStableConstraintReferences(normalizeStableDimensionReferences(migrateDocument(input as JsonValue)));
  const result = documentSchema.safeParse(migrated);
  if (result.success) { // SAFETY: documentSchema validated the complete shape; branded IDs are runtime strings.
    return { success: true, data: result.data as unknown as DocumentSnapshot };
  }
  const issues = result.error.issues.map((issue) => ({ path: issue.path.filter((part): part is string | number => typeof part === "string" || typeof part === "number"), message: issue.message }));
  return { success: false, issues, error: issues.map((issue) => `${issue.path.join(".") || "document"}: ${issue.message}`).join("; ") };
}

export function validateProject(input: unknown): { readonly success: true; readonly data: ProjectSnapshot } | { readonly success: false; readonly issues: readonly ValidationIssue[]; readonly error: string } {
  const migrated = normalizeStableConstraintReferences(normalizeStableDimensionReferences(migrateProject(input)));
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
  if (candidate.schemaVersion !== 1 && candidate.schemaVersion !== 2 && candidate.schemaVersion !== 3 && candidate.schemaVersion !== 4 && candidate.schemaVersion !== 5 && candidate.schemaVersion !== 6) return input;
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
    default: return hasBounds(element) ? [element.position, { x: element.position.x + element.size.width, y: element.position.y + element.size.height }] : [];
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
