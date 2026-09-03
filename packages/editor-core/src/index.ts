import {
  type DocumentSnapshot,
  type Element,
  type ElementId,
  type DimensionElement,
  type CircleConstraint,
  type DocumentConstraint,
      type SketchConstraint,
  type Layer,
  type LayerId,
  type LineElement,
  type PointMm,
  type SizeMm,
  type VisualStyle,
  type OperationMetadata,
  type PathElement,
  type PathSegment,
  type PathNode,
  type PathJoin,
  type GlyphElement,
  type SplineElement,
  type SketchElement,
  type ConnectableNodeAddress,
  type ExplicitConnection,
  elementId,
  nextRevision,
  revision,
  withElements,
} from "@nodra/domain";
import { validateDocument } from "@nodra/validation";
import { boundsOfElements, connectableNodeAddress, contourWithPoints, directionVector, elementCenter, elementToContour, dimensionGeometry, glyphGeometryNodes, groupCenter, mirrorHandleOffset, realGeometryNodes, resizeGroup, rotateElements, shapeResultContours, transformPoint, splitCuttableSegments, classifyCutGraph, cuttableSegments, lineSegmentIntersection, sketchEdgeAtAddress, sketchEdgeIndexAtAddress, solveSketchConstraints, solveCircleConstraints, type Direction } from "@nodra/geometry";
import { insertSplineNode, moveSplineHandle as moveSplineHandleData, moveSplineNode as moveSplineNodeData } from "./spline.js";
import { topologyReferenceKey, type ReferenceResolution, type TopologyEditResult, type TopologyReference } from "./topology.js";

export * from "./spline.js";
export * from "./topology.js";

export type ElementPatch = { readonly position?: PointMm; readonly size?: SizeMm; readonly rotation?: number; readonly cornerRadius?: number; readonly cornerRadii?: { readonly topLeft: number; readonly topRight: number; readonly bottomRight: number; readonly bottomLeft: number }; readonly style?: VisualStyle; readonly operation?: OperationMetadata; readonly start?: PointMm; readonly end?: PointMm; readonly text?: string; readonly fontFamily?: string; readonly fontSize?: number; readonly fontWeight?: "normal" | "bold"; readonly fontStyle?: "normal" | "italic"; readonly textAlign?: "left" | "center" | "right"; readonly lineHeight?: number; readonly scaleX?: number; readonly scaleY?: number };
export interface ContourNodeAddress { readonly ringIndex: number; readonly pointIndex: number }
export interface ContourSegmentAddress { readonly ringIndex: number; readonly segmentIndex: number }
export type StylePatch = { readonly stroke?: string; readonly fill?: string | null; readonly strokeWidth?: number };
export type GlyphOutlineData = Pick<GlyphElement, "glyph" | "position" | "size" | "contours">;
export type EditorCommand = { readonly name: string; readonly apply: (document: DocumentSnapshot) => CommandResult };
export type CommandResult = { readonly success: true; readonly document: DocumentSnapshot; readonly topology?: TopologyEditResult } | { readonly success: false; readonly error: string };
export interface Transaction { readonly command: string; readonly before: DocumentSnapshot; readonly after: DocumentSnapshot; readonly selectionBefore: readonly ElementId[]; readonly selectionAfter: readonly ElementId[] }
export interface EditorState {
  readonly document: DocumentSnapshot;
  readonly selection: readonly ElementId[];
  readonly undo: readonly Transaction[];
  readonly redo: readonly Transaction[];
  readonly gesture: { readonly base: DocumentSnapshot; readonly preview: DocumentSnapshot } | undefined;
}

const result = (document: DocumentSnapshot): CommandResult => {
  const checked = validateDocument(document);
  return checked.success ? { success: true, document: checked.data } : { success: false, error: checked.error };
};
const withoutDanglingDocumentConstraints = (document: DocumentSnapshot, elements: readonly Element[]): DocumentSnapshot => {
  if (!document.constraints?.length) return document;
  const sketchNodes = new Map(elements.filter((element): element is SketchElement => element.type === "sketch").map((sketch) => [sketch.id, new Set(sketch.nodes.map((node) => node.id))]));
  const constraints = document.constraints.filter((constraint) => constraint.references.every((reference) => sketchNodes.get(reference.elementId)?.has(reference.nodeId) === true));
  return constraints.length === document.constraints.length ? document : { ...document, constraints };
};
const replaceElements = (document: DocumentSnapshot, elements: readonly Element[]): CommandResult => result(withElements(withoutDanglingDocumentConstraints(document, elements), elements));
const replaceTopology = (document: DocumentSnapshot, edit: TopologyEditResult): CommandResult => {
  const checked = result(withElements(withoutDanglingDocumentConstraints(document, edit.elements), edit.elements));
  return checked.success ? { ...checked, topology: { ...edit, elements: checked.document.elements } } : checked;
};
const removeConnectionsFor = (document: DocumentSnapshot, ids: ReadonlySet<ElementId>): DocumentSnapshot => ({ ...document, connections: (document.connections ?? []).filter((connection) => !ids.has(connection.first.elementId) && !ids.has(connection.second.elementId)) });
const elementIndex = (document: DocumentSnapshot, id: ElementId): number => document.elements.findIndex((element) => element.id === id);

export const createElement = (element: Element, connections: readonly ExplicitConnection[] = []): EditorCommand => ({
  name: `create:${element.type}`,
  apply: (document) => document.elements.some((current) => current.id === element.id)
    ? { success: false, error: `Element already exists: ${element.id}` }
     : replaceElements({ ...document, connections: [...(document.connections ?? []), ...connections] }, [...document.elements, { ...element }]),
});

const sketchNodeId = (): string => `sketch-node-${crypto.randomUUID()}`;
const sketchEdgeId = (): string => `sketch-edge-${crypto.randomUUID()}`;
const pathSegmentId = (): string => `path-segment-${crypto.randomUUID()}`;
const sketchEdgeReference = (elementIdValue: ElementId, edgeId: string): TopologyReference => ({ kind: "sketch-edge", elementId: elementIdValue, edgeId });
const pathSegmentReference = (elementIdValue: ElementId, segmentId: string): TopologyReference => ({ kind: "path-segment", elementId: elementIdValue, segmentId });
const topologyEditForReferenceDestinations = (elements: readonly Element[], sources: readonly TopologyReference[], destinations: ReadonlyMap<string, readonly TopologyReference[]>, removedReason: string): TopologyEditResult => {
  const referenceMap = new Map<string, ReferenceResolution>(); const diagnostics: TopologyEditResult["diagnostics"][number][] = [];
  for (const source of sources) {
    const key = topologyReferenceKey(source); const outputs = [...new Map((destinations.get(key) ?? []).map((reference) => [topologyReferenceKey(reference), reference])).values()];
    if (outputs.length === 0) {
      referenceMap.set(key, { kind: "removed", reason: removedReason });
      diagnostics.push({ code: "reference-removed", referenceKey: key, message: removedReason });
    } else if (outputs.length === 1 && topologyReferenceKey(outputs[0]!) === key) referenceMap.set(key, { kind: "preserved", reference: outputs[0]! });
    else referenceMap.set(key, { kind: "replaced", references: outputs });
  }
  return { elements, referenceMap, diagnostics };
};
export const topologyEditForPathSegmentReplacement = (elements: readonly Element[], pathId: ElementId, originalSegmentId: string, replacements: readonly PathSegment[]): TopologyEditResult => {
  const originalReference = pathSegmentReference(pathId, originalSegmentId);
  return topologyEditForReferenceDestinations(elements, [originalReference], new Map([[topologyReferenceKey(originalReference), replacements.map((segment) => pathSegmentReference(pathId, segment.id))]]), "Path segment was removed");
};
export const createSketchLine = (sketchId: ElementId, layer: LayerId, style: VisualStyle, start: PointMm, end: PointMm): SketchElement => {
  const startNodeId = sketchNodeId(); const endNodeId = sketchNodeId();
  const edgeId = sketchEdgeId(); const dx = Math.abs(end.x - start.x); const dy = Math.abs(end.y - start.y);
  const relationKind = dy <= dx * 0.1 ? "horizontal" : dx <= dy * 0.1 ? "vertical" : undefined;
  const relation: SketchConstraint | undefined = relationKind ? { id: `auto:${edgeId}:${relationKind}`, kind: relationKind, references: [{ elementId: sketchId, nodeId: startNodeId }, { elementId: sketchId, nodeId: endNodeId }] } : undefined;
  return { type: "sketch", id: sketchId, layerId: layer, nodes: [{ id: startNodeId, point: start }, { id: endNodeId, point: end }], edges: [{ id: edgeId, startNodeId, endNodeId }], ...(relation ? { constraints: [relation] } : {}), style };
};
const documentConstraintsEqual = (first: DocumentConstraint, second: DocumentConstraint): boolean => first.id === second.id && first.kind === second.kind && first.value === second.value && first.references.length === second.references.length && first.references.every((reference, index) => reference.elementId === second.references[index]?.elementId && reference.nodeId === second.references[index]?.nodeId);
const replaceDocumentConstraints = (document: DocumentSnapshot, constraints: readonly DocumentConstraint[]): CommandResult => result({ ...document, revision: nextRevision(document.revision), ...(constraints.length || document.constraints ? { constraints: [...constraints] } : {}) });

export const addDocumentConstraint = (constraint: DocumentConstraint): EditorCommand => ({
  name: `document-constraint-add:${constraint.id}`,
  apply: (document) => (document.constraints ?? []).some((current) => current.id === constraint.id)
    ? { success: false, error: `Document constraint already exists: ${constraint.id}` }
    : replaceDocumentConstraints(document, [...(document.constraints ?? []), constraint]),
});

export const updateDocumentConstraint = (constraint: DocumentConstraint): EditorCommand => ({
  name: `document-constraint-update:${constraint.id}`,
  apply: (document) => {
    const constraints = document.constraints ?? [];
    if (!constraints.some((current) => current.id === constraint.id)) return { success: false, error: `Document constraint not found: ${constraint.id}` };
    if (constraints.some((current) => current.id === constraint.id && documentConstraintsEqual(current, constraint))) return { success: true, document };
    return replaceDocumentConstraints(document, constraints.map((current) => current.id === constraint.id ? constraint : current));
  },
});

export const deleteDocumentConstraint = (constraintId: string): EditorCommand => ({
  name: `document-constraint-delete:${constraintId}`,
  apply: (document) => {
    const constraints = document.constraints ?? [];
    if (!constraints.some((constraint) => constraint.id === constraintId)) return { success: false, error: `Document constraint not found: ${constraintId}` };
    return replaceDocumentConstraints(document, constraints.filter((constraint) => constraint.id !== constraintId));
  },
});

export const appendSketchEdge = (sketchId: ElementId, fromNodeId: string, point: PointMm, toNodeId?: string): EditorCommand => ({
  name: `sketch-create-edge:${sketchId}`,
  apply: (document) => {
    const sketch = document.elements.find((element): element is SketchElement => element.id === sketchId && element.type === "sketch");
    if (!sketch) return { success: false, error: "Sketch not found" };
    if (!sketch.nodes.some((node) => node.id === fromNodeId)) return { success: false, error: "Sketch start node not found" };
    const existingTarget = toNodeId ? sketch.nodes.find((node) => node.id === toNodeId) : undefined;
    const endNodeId = existingTarget?.id ?? sketchNodeId();
    if (endNodeId === fromNodeId) return { success: false, error: "Sketch edge endpoints must differ" };
    const duplicate = sketch.edges.some((edge) => (edge.startNodeId === fromNodeId && edge.endNodeId === endNodeId) || (edge.startNodeId === endNodeId && edge.endNodeId === fromNodeId));
    if (duplicate) return { success: false, error: "Sketch edge already exists" };
    const edgeId = sketchEdgeId();
    const start = sketch.nodes.find((node) => node.id === fromNodeId)!.point;
    const end = existingTarget?.point ?? point;
    const dx = Math.abs(end.x - start.x); const dy = Math.abs(end.y - start.y);
    const relationKind = dy <= dx * 0.1 ? "horizontal" : dx <= dy * 0.1 ? "vertical" : undefined;
    const relation: SketchConstraint | undefined = relationKind ? { id: `auto:${edgeId}:${relationKind}`, kind: relationKind, references: [{ elementId: sketch.id, nodeId: fromNodeId }, { elementId: sketch.id, nodeId: endNodeId }] } : undefined;
    const previous = sketch.edges.at(-1);
    const previousStart = previous ? sketch.nodes.find((node) => node.id === previous.startNodeId)?.point : undefined;
    const previousEnd = previous ? sketch.nodes.find((node) => node.id === previous.endNodeId)?.point : undefined;
    const previousDx = previousEnd && previousStart ? previousEnd.x - previousStart.x : 0; const previousDy = previousEnd && previousStart ? previousEnd.y - previousStart.y : 0;
    const currentDx = end.x - start.x; const currentDy = end.y - start.y;
    const perpendicular = previous && previousEnd && previousStart && Math.hypot(previousDx, previousDy) > 1e-9 && Math.hypot(currentDx, currentDy) > 1e-9 && Math.abs(previousDx * currentDx + previousDy * currentDy) <= Math.hypot(previousDx, previousDy) * Math.hypot(currentDx, currentDy) * 0.1 ? { id: `auto:${edgeId}:perpendicular`, kind: "perpendicular" as const, references: [{ elementId: sketch.id, nodeId: previous.startNodeId }, { elementId: sketch.id, nodeId: previous.endNodeId }, { elementId: sketch.id, nodeId: fromNodeId }, { elementId: sketch.id, nodeId: endNodeId }] as const } : undefined;
    const autoRelations = [relation, perpendicular].filter((candidate): candidate is SketchConstraint => candidate !== undefined);
    const next: SketchElement = { ...sketch, nodes: existingTarget ? sketch.nodes : [...sketch.nodes, { id: endNodeId, point }], edges: [...sketch.edges, { id: edgeId, startNodeId: fromNodeId, endNodeId }], ...(autoRelations.length ? { constraints: [...(sketch.constraints ?? []), ...autoRelations] } : {}) };
    return replaceElements(document, document.elements.map((element) => element.id === sketchId ? next : element));
  },
});
const remapSketchEdgeDimensionReferences = (edit: TopologyEditResult, sketchId: ElementId, beforeEdges: SketchElement["edges"], afterEdges: SketchElement["edges"]): readonly Element[] => edit.elements.flatMap<Element>((element) => {
  if (element.type !== "dimension") return [element];
  const remap = (reference: DimensionElement["references"][number]): DimensionElement["references"][number] | undefined => {
    if (!("kind" in reference) || reference.kind !== "line" || reference.elementId !== sketchId) return reference;
    const oldIndex = reference.edgeId !== undefined ? beforeEdges.findIndex((edge) => edge.id === reference.edgeId) : reference.edgeIndex ?? 0;
    const oldEdge = beforeEdges[oldIndex];
    if (!oldEdge) return undefined;
    const resolution = edit.referenceMap.get(topologyReferenceKey(sketchEdgeReference(sketchId, oldEdge.id)));
    const nextReference = resolution?.kind === "replaced" ? resolution.references[0] : resolution?.kind === "preserved" ? resolution.reference : resolution?.kind === "removed" ? undefined : sketchEdgeReference(sketchId, oldEdge.id);
    if (!nextReference || nextReference.kind !== "sketch-edge") return undefined;
    const nextEdgeIndex = afterEdges.findIndex((edge) => edge.id === nextReference.edgeId);
    return nextEdgeIndex < 0 ? undefined : { ...reference, edgeId: nextReference.edgeId, edgeIndex: nextEdgeIndex };
  };
  const first = remap(element.references[0]); const second = remap(element.references[1]);
  return first && second ? [{ ...element, references: [first, second] }] : [];
});

export const cutSketchEdge = (sketchId: ElementId, segmentIndex: number, cutPoint?: PointMm): EditorCommand => ({
  name: `sketch-cut-edge:${sketchId}:${segmentIndex}`,
  apply: (document) => {
    const sketch = document.elements.find((element): element is SketchElement => element.id === sketchId && element.type === "sketch");
    if (!sketch) return { success: false, error: "Sketch not found" };
    if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= sketch.edges.length) return { success: false, error: "Sketch edge not found" };
    const edge = sketch.edges[segmentIndex]!;
    const startNode = sketch.nodes.find((node) => node.id === edge.startNodeId)!;
    const endNode = sketch.nodes.find((node) => node.id === edge.endNodeId)!;
    if (cutPoint) {
      const crossingSegments = document.elements.filter((element) => element.id !== sketch.id && element.type !== "dimension").flatMap((element) => cuttableSegments(element));
      const intersections = crossingSegments.flatMap((segment) => {
        const hit = lineSegmentIntersection(startNode.point, endNode.point, segment.start, segment.end, 1e-7);
        return hit ? [hit.point] : [];
      });
      const intersection = intersections.sort((first, second) => Math.hypot(first.x - cutPoint.x, first.y - cutPoint.y) - Math.hypot(second.x - cutPoint.x, second.y - cutPoint.y))[0];
      const requestedPoint = intersection ?? cutPoint;
      const vx = endNode.point.x - startNode.point.x; const vy = endNode.point.y - startNode.point.y; const lengthSquared = vx * vx + vy * vy;
      if (lengthSquared <= 1e-12) return { success: false, error: "Cannot split a zero-length sketch edge" };
      const parameter = ((requestedPoint.x - startNode.point.x) * vx + (requestedPoint.y - startNode.point.y) * vy) / lengthSquared;
      if (parameter <= 1e-6 || parameter >= 1 - 1e-6) return { success: false, error: "Cut point must be inside the sketch segment" };
      const splitNodeId = sketchNodeId(); const splitEdgeA = { id: sketchEdgeId(), startNodeId: edge.startNodeId, endNodeId: splitNodeId }; const splitEdgeB = { id: sketchEdgeId(), startNodeId: splitNodeId, endNodeId: edge.endNodeId };
      const splitPoint = { x: startNode.point.x + vx * parameter, y: startNode.point.y + vy * parameter };
      const edges = sketch.edges.flatMap((candidate, index) => index === segmentIndex ? [splitEdgeA, splitEdgeB] : [candidate]);
      const nodes = [...sketch.nodes, { id: splitNodeId, point: splitPoint }];
      const nextSketch = { ...sketch, nodes, edges };
      const originalReference = sketchEdgeReference(sketchId, edge.id);
      const referenceMap = new Map<string, ReferenceResolution>([[topologyReferenceKey(originalReference), { kind: "replaced", references: [sketchEdgeReference(sketchId, splitEdgeA.id), sketchEdgeReference(sketchId, splitEdgeB.id)] }]]);
      const edit: TopologyEditResult = { elements: document.elements.map((element) => element.id === sketchId ? nextSketch : element), referenceMap, diagnostics: [] };
      const elements = remapSketchEdgeDimensionReferences(edit, sketchId, sketch.edges, edges);
      return replaceTopology(document, { ...edit, elements });
    }
    const edges = sketch.edges.filter((_, index) => index !== segmentIndex);
    if (edges.length === 0) {
      const originalReference = sketchEdgeReference(sketchId, edge.id); const referenceKey = topologyReferenceKey(originalReference);
      const edit: TopologyEditResult = { elements: document.elements.filter((element) => element.id !== sketchId && !(element.type === "dimension" && element.references.some((reference) => reference.elementId === sketchId))), referenceMap: new Map([[referenceKey, { kind: "removed", reason: "Sketch edge was deleted" }]]), diagnostics: [{ code: "reference-removed", referenceKey, message: "Sketch edge was deleted" }] };
      return replaceTopology(document, edit);
    }
    const usedNodeIds = new Set(edges.flatMap((edge) => [edge.startNodeId, edge.endNodeId]));
    const nodes = sketch.nodes.filter((node) => usedNodeIds.has(node.id));
    const constraints = sketch.constraints?.filter((constraint) => constraint.references.every((reference) => usedNodeIds.has(reference.nodeId)));
    const nextSketch = { ...sketch, nodes, edges, ...(constraints ? { constraints } : {}) };
    const withoutRemovedNodeDimensions = document.elements.flatMap<Element>((element) => {
      if (element.type !== "dimension") return [element];
      const remap = (reference: DimensionElement["references"][number]): DimensionElement["references"][number] | undefined => {
        if (!("nodeIndex" in reference) || reference.elementId !== sketchId) return reference;
        const oldNode = reference.nodeId !== undefined ? sketch.nodes.find((node) => node.id === reference.nodeId) : sketch.nodes[reference.nodeIndex];
        const nextIndex = oldNode ? nodes.findIndex((node) => node.id === oldNode.id) : -1;
        return oldNode && nextIndex >= 0 ? { kind: "node", elementId: sketchId, nodeIndex: nextIndex, nodeId: oldNode.id } : undefined;
      };
      const first = remap(element.references[0]); const second = remap(element.references[1]);
      return first && second ? [{ ...element, references: [first, second] }] : [];
    });
    const originalReference = sketchEdgeReference(sketchId, edge.id);
    const referenceKey = topologyReferenceKey(originalReference);
    const referenceMap = new Map<string, ReferenceResolution>([[referenceKey, { kind: "removed", reason: "Sketch edge was deleted" }]]);
    const edit: TopologyEditResult = { elements: withoutRemovedNodeDimensions.map((element) => element.id === sketchId ? nextSketch : element), referenceMap, diagnostics: [{ code: "reference-removed", referenceKey, message: "Sketch edge was deleted" }] };
    const elements = remapSketchEdgeDimensionReferences(edit, sketchId, sketch.edges, edges);
    return replaceTopology(document, { ...edit, elements });
  },
});

/** Extends a native two-endpoint line into an editable open path. */
export const appendLinePoint = (lineId: ElementId, point: PointMm): EditorCommand => ({
  name: `line-create-node:${lineId}`,
  apply: (document) => {
    const line = document.elements.find((element): element is Extract<Element, { type: "line" }> => element.id === lineId && element.type === "line");
    if (!line) return { success: false, error: "Line not found" };
    const startId = `${line.id}:start`;
    const endId = `${line.id}:end`;
    const nodeId = `${line.id}:node:${crypto.randomUUID()}`;
    const path: PathElement = { type: "path", id: line.id, layerId: line.layerId, nodes: [{ id: startId, anchor: line.start, join: "corner" }, { id: endId, anchor: line.end, join: "corner" }, { id: nodeId, anchor: point, join: "corner" }], segments: [{ id: pathSegmentId(), type: "line", startNodeId: startId, endNodeId: endId }, { id: pathSegmentId(), type: "line", startNodeId: endId, endNodeId: nodeId }], closed: false, style: line.style, ...(line.operation ? { operation: line.operation } : {}) };
    return replaceElements(document, document.elements.map((element) => element.id === line.id ? path : element));
  },
});

/** Replaces one text object atomically. Outline coordinates must already be in document space. */
export const convertTextToGlyphs = (textId: ElementId, outlines: readonly GlyphOutlineData[]): EditorCommand => ({
  name: `text-to-glyphs:${textId}`,
  apply: (document) => {
    const text = document.elements.find((element): element is Extract<Element, { type: "text" }> => element.id === textId && element.type === "text");
    if (!text) return { success: false, error: "Text element not found" };
    if (!Array.isArray(outlines) || !outlines.length) return { success: false, error: "The text outline contains no visible glyphs" };
    const existing = new Set(document.elements.map((element) => element.id));
    let glyphs: GlyphElement[];
    try {
      glyphs = outlines.map((outline, index) => ({
        type: "glyph", id: elementId(`${text.id}:glyph:${index}`), layerId: text.layerId, position: outline.position, size: outline.size,
        glyph: outline.glyph, contours: outline.contours, fillRule: "evenodd", rotation: 0, style: text.style,
        ...(text.operation ? { operation: text.operation } : {}),
      }));
    } catch { return { success: false, error: "Invalid text outline data" }; }
    if (glyphs.some((glyph) => existing.has(glyph.id)) || new Set(glyphs.map((glyph) => glyph.id)).size !== glyphs.length) return { success: false, error: "Generated glyph IDs collide with the document" };
    const index = document.elements.findIndex((element) => element.id === text.id);
    const elements = [...document.elements]; elements.splice(index, 1, ...glyphs);
    return replaceElements(removeConnectionsFor(document, new Set([text.id])), elements);
  },
});

export const deleteElement = (id: ElementId): EditorCommand => ({
  name: `delete:${id}`,
  apply: (document) => document.elements.some((element) => element.id === id)
    ? replaceElements(removeConnectionsFor(document, new Set([id])), document.elements.filter((element) => element.id !== id && !(element.type === "dimension" && element.references.some((reference) => reference.elementId === id))))
    : { success: false, error: `Element not found: ${id}` },
});

export const updateElement = (id: ElementId, patch: ElementPatch): EditorCommand => ({
  name: `update:${id}`,
  apply: (document) => {
    const index = elementIndex(document, id);
    if (index < 0) return { success: false, error: `Element not found: ${id}` };
    const elements = [...document.elements];
    elements[index] = { ...elements[index], ...patch } as Element;
    return replaceElements(document, elements);
  },
});

export const moveElement = (id: ElementId, delta: PointMm): EditorCommand => ({
  name: `move:${id}`,
  apply: (document) => {
    const element = document.elements.find((current) => current.id === id);
    if (!element) return { success: false, error: `Element not found: ${id}` };
    if (element.type === "dimension") return replaceElements(document, document.elements.map((current) => current.id === id && current.type === "dimension" ? { ...current, offset: { x: current.offset.x + delta.x, y: current.offset.y + delta.y } } : current));
    if (element.type === "line") return replaceElements(document, document.elements.map((current) => current.id === id && current.type === "line" ? { ...current, start: { x: current.start.x + delta.x, y: current.start.y + delta.y }, end: { x: current.end.x + delta.x, y: current.end.y + delta.y } } : current));
    if (element.type === "contour") return replaceElements(document, document.elements.map((current) => current.id === id && current.type === "contour" ? contourWithPoints(current, current.contours.map((contour) => contour.points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y })))) : current));
    if (element.type === "path") return replaceElements(document, document.elements.map((current) => current.id === id && current.type === "path" ? translatePath(current, delta) : current));
    if (element.type === "glyph") return replaceElements(document, document.elements.map((current) => current.id === id && current.type === "glyph" ? translateGlyph(current, delta) : current));
    if (element.type === "text") return replaceElements(document, document.elements.map((current) => current.id === id && current.type === "text" ? { ...current, position: { x: current.position.x + delta.x, y: current.position.y + delta.y } } : current));
    if (element.type === "spline") return replaceElements(document, document.elements.map((current) => current.id === id && current.type === "spline" ? { ...current, nodes: current.nodes.map((node) => ({ ...node, anchor: { x: node.anchor.x + delta.x, y: node.anchor.y + delta.y } })) } : current));
    if (element.type === "sketch") return replaceElements(document, document.elements.map((current) => current.id === id && current.type === "sketch" ? { ...current, nodes: current.nodes.map((node) => ({ ...node, point: { x: node.point.x + delta.x, y: node.point.y + delta.y } })) } : current));
    return replaceElements(document, document.elements.map((current) => current.id === id && (current.type === "rectangle" || current.type === "ellipse") ? { ...current, position: { x: current.position.x + delta.x, y: current.position.y + delta.y } } : current));
  },
});

export const moveElements = (ids: readonly ElementId[], delta: PointMm): EditorCommand => ({
  name: `move:${[...new Set(ids)].join(",")}`,
  apply: (document) => {
    const selected = new Set(ids);
    const known = document.elements.filter((element) => selected.has(element.id));
    if (known.length !== selected.size) return { success: false, error: "One or more elements were not found" };
    if (known.length === 0) return { success: false, error: "No elements selected" };
    return replaceElements(document, document.elements.map((element) => {
       if (!selected.has(element.id)) return element;
       if (element.type === "dimension") return { ...element, offset: { x: element.offset.x + delta.x, y: element.offset.y + delta.y } };
       if (element.type === "line") return { ...element, start: { x: element.start.x + delta.x, y: element.start.y + delta.y }, end: { x: element.end.x + delta.x, y: element.end.y + delta.y } };
      if (element.type === "contour") return contourWithPoints(element, element.contours.map((contour) => contour.points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y }))));
      if (element.type === "path") return translatePath(element, delta);
      if (element.type === "glyph") return translateGlyph(element, delta);
      if (element.type === "text") return { ...element, position: { x: element.position.x + delta.x, y: element.position.y + delta.y } };
      if (element.type === "spline") return { ...element, nodes: element.nodes.map((node) => ({ ...node, anchor: { x: node.anchor.x + delta.x, y: node.anchor.y + delta.y } })) };
      if (element.type === "sketch") return { ...element, nodes: element.nodes.map((node) => ({ ...node, point: { x: node.point.x + delta.x, y: node.point.y + delta.y } })) };
      if (element.type === "rectangle" || element.type === "ellipse") return { ...element, position: { x: element.position.x + delta.x, y: element.position.y + delta.y } };
      return element;
    }));
  },
});
export const resizeElements = (ids: readonly ElementId[], handle: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w", pointer: PointMm, aspectLock = false): EditorCommand => ({ name: `resize-group:${ids.join(",")}`, apply: (document) => { const selected = new Set(ids); const elements = document.elements.filter((e) => selected.has(e.id)); if (!elements.length || elements.length !== selected.size) return { success: false, error: "Invalid group selection" }; const next = resizeGroup(elements, handle, pointer, 1, aspectLock); return replaceElements(document, document.elements.map((e) => next.find((n) => n.id === e.id) ?? e)); } });
export const resizeElementsToDimensions = (ids: readonly ElementId[], size: SizeMm, aspectLock = false): EditorCommand => ({ name: `resize-group-centered:${ids.join(",")}`, apply: (document) => {
  const selected = new Set(ids);
  const elements = document.elements.filter((element) => selected.has(element.id));
  if (!elements.length || elements.length !== selected.size) return { success: false, error: "Invalid group selection" };
  const bounds = boundsOfElements(elements);
  const target = aspectLock
    ? (size.width / size.height >= bounds.width / bounds.height ? { width: size.width, height: size.width * bounds.height / bounds.width } : { width: size.height * bounds.width / bounds.height, height: size.height })
    : size;
  if (![target.width, target.height].every(Number.isFinite) || target.width <= 0 || target.height <= 0) return { success: false, error: "Group dimensions must be positive" };
  const next = resizeGroup(elements, "se", { x: bounds.x + target.width, y: bounds.y + target.height }, 1, false, true);
  return replaceElements(document, document.elements.map((element) => next.find((candidate) => candidate.id === element.id) ?? element));
} });
export const rotateElementsAroundCenter = (ids: readonly ElementId[], delta: number): EditorCommand => ({ name: `rotate-group:${ids.join(",")}`, apply: (document) => { const selected = new Set(ids); const elements = document.elements.filter((e) => selected.has(e.id)); if (!elements.length || elements.length !== selected.size) return { success: false, error: "Invalid group selection" }; const next = rotateElements(elements, groupCenter(boundsOfElements(elements)), delta); return replaceElements(document, document.elements.map((e) => next.find((n) => n.id === e.id) ?? e)); } });

export const resizeElement = (id: ElementId, position: PointMm, size: SizeMm): EditorCommand => updateElement(id, { position, size });
const connectedSide = (document: DocumentSnapshot, id: ElementId, axis: "x" | "y"): { leftOrTop: boolean; rightOrBottom: boolean } => {
  const result = { leftOrTop: false, rightOrBottom: false };
  const sides = (address: ConnectableNodeAddress): readonly ("left" | "right" | "top" | "bottom")[] => {
    if (address.kind !== "named") return [];
    if (address.name === "nw") return ["left", "top"];
    if (address.name === "ne") return ["right", "top"];
    if (address.name === "se") return ["right", "bottom"];
    if (address.name === "sw") return ["left", "bottom"];
    if (address.name === "w") return ["left"];
    if (address.name === "e") return ["right"];
    if (address.name === "n") return ["top"];
    if (address.name === "s") return ["bottom"];
    return [];
  };
  for (const connection of document.connections ?? []) for (const reference of [connection.first, connection.second]) if (reference.elementId === id) {
    for (const value of sides(reference.node)) {
      if (value === (axis === "x" ? "left" : "top")) result.leftOrTop = true;
      if (value === (axis === "x" ? "right" : "bottom")) result.rightOrBottom = true;
    }
  }
  return result;
};
/** Inspector resize: a connected side is fixed; otherwise the dimension is resized around its center. */
export const resizeElementToDimensions = (id: ElementId, field: "width" | "height", value: number, aspectLock = false): EditorCommand => ({
  name: `resize-property:${id}:${field}`,
  apply: (document) => {
    const element = document.elements.find((candidate): candidate is Extract<Element, { type: "rectangle" | "ellipse" }> => candidate.id === id && (candidate.type === "rectangle" || candidate.type === "ellipse"));
    if (!element || !Number.isFinite(value) || value <= 0) return { success: false, error: "Dimensions must be positive" };
    const target = aspectLock ? (field === "width" ? { width: value, height: value * element.size.height / element.size.width } : { width: value * element.size.width / element.size.height, height: value }) : { ...element.size, [field]: value };
    if (![target.width, target.height].every((candidate) => Number.isFinite(candidate) && candidate > 0)) return { success: false, error: "Dimensions must be positive" };
    const horizontal = connectedSide(document, id, "x");
    const vertical = connectedSide(document, id, "y");
    if (field === "width" && horizontal.leftOrTop && horizontal.rightOrBottom) return { success: false, error: "Width resize would break both horizontal connections" };
    if (field === "height" && vertical.leftOrTop && vertical.rightOrBottom) return { success: false, error: "Height resize would break both vertical connections" };
    const x = horizontal.leftOrTop ? element.position.x : horizontal.rightOrBottom ? element.position.x + element.size.width - target.width : element.position.x + (element.size.width - target.width) / 2;
    const y = vertical.leftOrTop ? element.position.y : vertical.rightOrBottom ? element.position.y + element.size.height - target.height : element.position.y + (element.size.height - target.height) / 2;
    if (x === element.position.x && y === element.position.y && target.width === element.size.width && target.height === element.size.height) return { success: true, document };
    return replaceElements(document, document.elements.map((candidate) => candidate.id === id ? { ...candidate, position: { x, y }, size: target } : candidate));
  },
});
export const rotateElement = (id: ElementId, rotation: number): EditorCommand => ({ name: `rotate:${id}`, apply: (document) => {
  const current = document.elements.find((element) => element.id === id);
  if (!current) return { success: false, error: `Element not found: ${id}` };
   if (current.type === "glyph") return replaceElements(document, document.elements.map((element) => element.id === id && element.type === "glyph" ? rotateElements([element], elementCenter(element), rotation - element.rotation)[0]! : element));
   if (current.type === "dimension" || current.type === "path" || current.type === "spline") return { success: false, error: "Element rotation is not supported" };
   if (current.type !== "contour") return updateElement(id, { rotation }).apply(document);
  const center = elementCenter(current);
  return replaceElements(document, document.elements.map((element) => element.id === id && element.type === "contour" ? contourWithPoints(element, element.contours.map((contour) => contour.points.map((point) => transformPoint({ x: point.x - center.x, y: point.y - center.y }, center, rotation - current.rotation)))) : element));
} });

export type ShapeOperation = "weld" | "subtract" | "outline";
const isClosedShape = (element: Element): boolean => {
  if (element.type === "line" || element.type === "dimension" || element.type === "text") return false;
  if (element.type === "path" || element.type === "spline") return element.closed;
  return true;
};

const dimensionReferencesElement = (dimension: Extract<Element, { type: "dimension" }>, ids: ReadonlySet<ElementId>): boolean =>
  dimension.references.some((reference) => ids.has(reference.elementId));

/** Returns dimensions whose references would disappear in a weld or subtract operation. */
export const invalidDimensionIdsForShapeOperation = (document: DocumentSnapshot, ids: readonly ElementId[], operation: ShapeOperation): readonly ElementId[] => {
  if (operation === "outline") return [];
  const affected = new Set(document.elements
    .filter((element) => ids.includes(element.id) && element.type !== "dimension" && isClosedShape(element))
    .map((element) => element.id));
  if (!affected.size) return [];
  return document.elements
    .filter((element): element is Extract<Element, { type: "dimension" }> => element.type === "dimension" && dimensionReferencesElement(element, affected))
    .map((dimension) => dimension.id);
};

interface SourceCubic {
  readonly p0: PointMm;
  readonly p1: PointMm;
  readonly p2: PointMm;
  readonly p3: PointMm;
}
const normalizeVector = (vector: PointMm): PointMm | undefined => {
  const length = Math.hypot(vector.x, vector.y);
  return length > 1e-9 ? { x: vector.x / length, y: vector.y / length } : undefined;
};
const cubicAt = (curve: SourceCubic, t: number): PointMm => {
  const mt = 1 - t;
  return { x: mt ** 3 * curve.p0.x + 3 * mt ** 2 * t * curve.p1.x + 3 * mt * t ** 2 * curve.p2.x + t ** 3 * curve.p3.x, y: mt ** 3 * curve.p0.y + 3 * mt ** 2 * t * curve.p1.y + 3 * mt * t ** 2 * curve.p2.y + t ** 3 * curve.p3.y };
};
const cubicTangentAt = (curve: SourceCubic, t: number): PointMm => {
  const mt = 1 - t;
  return { x: 3 * mt ** 2 * (curve.p1.x - curve.p0.x) + 6 * mt * t * (curve.p2.x - curve.p1.x) + 3 * t ** 2 * (curve.p3.x - curve.p2.x), y: 3 * mt ** 2 * (curve.p1.y - curve.p0.y) + 6 * mt * t * (curve.p2.y - curve.p1.y) + 3 * t ** 2 * (curve.p3.y - curve.p2.y) };
};
const sourceCubics = (elements: readonly Element[]): SourceCubic[] => elements.flatMap((element) => {
  const contours = element.type === "glyph" ? element.contours : element.type === "path" ? [{ nodes: element.nodes, segments: element.segments }] : [];
  return contours.flatMap((contour) => contour.segments.flatMap((segment) => {
    if (segment.type !== "cubicBezier") return [];
    const start = contour.nodes.find((node) => node.id === segment.startNodeId)?.anchor;
    const end = contour.nodes.find((node) => node.id === segment.endNodeId)?.anchor;
    return start && end ? [{ p0: start, p1: segment.control1, p2: segment.control2, p3: end }] : [];
  }));
});
interface SourceHit { readonly curve: SourceCubic; readonly t: number; readonly distance: number }
const nearestSourcePoint = (point: PointMm, curves: readonly SourceCubic[]): SourceHit | undefined => {
  let best: SourceHit | undefined;
  for (const curve of curves) for (let step = 0; step <= 32; step += 1) {
    const t = step / 32; const candidate = cubicAt(curve, t); const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (!best || distance < best.distance) best = { curve, t, distance };
  }
  return best;
};
const sourceCurveAt = (start: PointMm, end: PointMm, curves: readonly SourceCubic[], tolerance: number): { readonly curve: SourceCubic; readonly start: SourceHit; readonly end: SourceHit } | undefined => {
  const startHit = nearestSourcePoint(start, curves); const endHit = nearestSourcePoint(end, curves);
  if (startHit && endHit && startHit.curve === endHit.curve && startHit.distance <= tolerance && endHit.distance <= tolerance && Math.abs(startHit.t - endHit.t) > 0.01) return { curve: startHit.curve, start: startHit, end: endHit };
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }; const midpointHit = nearestSourcePoint(midpoint, curves);
  return midpointHit && midpointHit.distance <= tolerance ? { curve: midpointHit.curve, start: midpointHit, end: midpointHit } : undefined;
};
const splitSourceCubic = (curve: SourceCubic, t: number): readonly [SourceCubic, SourceCubic] => {
  const lerp = (a: PointMm, b: PointMm): PointMm => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const a = lerp(curve.p0, curve.p1); const b = lerp(curve.p1, curve.p2); const c = lerp(curve.p2, curve.p3); const d = lerp(a, b); const e = lerp(b, c); const middle = lerp(d, e);
  return [{ p0: curve.p0, p1: a, p2: d, p3: middle }, { p0: middle, p1: e, p2: c, p3: curve.p3 }];
};
const sourceSubcurve = (curve: SourceCubic, from: number, to: number): SourceCubic => {
  if (from <= to) {
    const left = splitSourceCubic(curve, to)[0];
    return splitSourceCubic(left!, from / Math.max(to, 1e-9))[1]!;
  }
  const reversed = sourceSubcurve(curve, to, from);
  return { p0: reversed.p3, p1: reversed.p2, p2: reversed.p1, p3: reversed.p0 };
};

const contourToEditableGlyphContour = (contour: { readonly points: readonly PointMm[] }, index: number, sourceCurves: readonly SourceCubic[] = []): GlyphElement["contours"][number] => {
  const source = contour.points.length > 1 && contour.points.at(-1)?.x === contour.points[0]?.x && contour.points.at(-1)?.y === contour.points[0]?.y ? contour.points.slice(0, -1) : contour.points;
  const extent = source.reduce((bounds, point) => ({ minX: Math.min(bounds.minX, point.x), maxX: Math.max(bounds.maxX, point.x), minY: Math.min(bounds.minY, point.y), maxY: Math.max(bounds.maxY, point.y) }), { minX: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY });
  const extentSize = Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY);
  const tolerance = Math.max(0.005, Math.min(0.05, extentSize * 0.0005));
  const distanceToSegment = (point: PointMm, start: PointMm, end: PointMm): number => {
    const dx = end.x - start.x; const dy = end.y - start.y; const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
    return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
  };
  const sourceHitCache = new Map<string, SourceHit | undefined>();
  const cachedSourcePoint = (point: PointMm): SourceHit | undefined => {
    const key = `${point.x}:${point.y}`;
    if (!sourceHitCache.has(key)) sourceHitCache.set(key, nearestSourcePoint(point, sourceCurves));
    return sourceHitCache.get(key);
  };
  const points = [...source];
  const hits: Array<SourceHit | undefined> = points.map(cachedSourcePoint);
  let collapsed = true;
  while (collapsed && points.length > 3) {
    collapsed = false;
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      const previousIndex = (pointIndex - 1 + points.length) % points.length;
      const nextIndex = (pointIndex + 1) % points.length;
      const previousHit = hits[previousIndex]; const currentHit = hits[pointIndex]; const nextHit = hits[nextIndex];
      const followsSourceCurve = previousHit && currentHit && nextHit && previousHit.curve === currentHit.curve && currentHit.curve === nextHit.curve && currentHit.t >= Math.min(previousHit.t, nextHit.t) - 0.03 && currentHit.t <= Math.max(previousHit.t, nextHit.t) + 0.03 && currentHit.distance <= 0.2 && previousHit.distance <= 0.2 && nextHit.distance <= 0.2;
      if (!followsSourceCurve) continue;
      points.splice(pointIndex, 1); hits.splice(pointIndex, 1); collapsed = true; break;
    }
  }
  while (points.length > 3) {
    let candidate = -1; let error = Number.POSITIVE_INFINITY;
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      const previousIndex = (pointIndex - 1 + points.length) % points.length;
      const nextIndex = (pointIndex + 1) % points.length;
      const previous = points[previousIndex]!;
      const current = points[pointIndex]!;
      const next = points[nextIndex]!;
      const previousHit = hits[previousIndex];
      const currentHit = hits[pointIndex];
      const nextHit = hits[nextIndex];
      const followsSourceCurve = previousHit && currentHit && nextHit && previousHit.curve === currentHit.curve && currentHit.curve === nextHit.curve && currentHit.t >= Math.min(previousHit.t, nextHit.t) - 0.03 && currentHit.t <= Math.max(previousHit.t, nextHit.t) + 0.03 && currentHit.distance <= 0.2 && previousHit.distance <= 0.2 && nextHit.distance <= 0.2;
      const distance = followsSourceCurve ? 0 : distanceToSegment(current, previous, next);
      if (distance < error) { error = distance; candidate = pointIndex; }
    }
    if (candidate < 0 || error > tolerance) break;
    points.splice(candidate, 1);
    hits.splice(candidate, 1);
  }
  const isCorner = (pointIndex: number): boolean => {
    const previous = points[(pointIndex - 1 + points.length) % points.length]!;
    const current = points[pointIndex]!;
    const next = points[(pointIndex + 1) % points.length]!;
    const incoming = { x: current.x - previous.x, y: current.y - previous.y };
    const outgoing = { x: next.x - current.x, y: next.y - current.y };
    const lengths = Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y);
    return lengths === 0 || (incoming.x * outgoing.x + incoming.y * outgoing.y) / lengths < 0.75;
  };
  const corners = points.map((_, pointIndex) => isCorner(pointIndex));
  const nodes = points.map((anchor, nodeIndex) => ({ id: `shape-${index}-node-${nodeIndex}`, anchor, join: corners[nodeIndex] ? "corner" as const : "smooth" as const }));
  const segments = nodes.map((node, nodeIndex) => {
    const previous = nodes[(nodeIndex - 1 + nodes.length) % nodes.length]!;
    const end = nodes[(nodeIndex + 1) % nodes.length]!;
    const afterEnd = nodes[(nodeIndex + 2) % nodes.length]!;
    const source = sourceCurveAt(node.anchor, end.anchor, sourceCurves, Math.max(0.05, Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY) * 0.002));
    const sourceSegment = source && source.start.curve === source.end.curve && source.start !== source.end ? sourceSubcurve(source.curve, source.start.t, source.end.t) : undefined;
    const sourceTangentPoint = sourceSegment ? { x: sourceSegment.p3.x - sourceSegment.p0.x, y: sourceSegment.p3.y - sourceSegment.p0.y } : source ? cubicTangentAt(source.curve, source.start.t || 0.5) : undefined;
    const tangent = sourceTangentPoint ? normalizeVector(sourceTangentPoint) : undefined;
    const edge = { x: end.anchor.x - node.anchor.x, y: end.anchor.y - node.anchor.y };
    const sourceTangent = tangent && tangent.x * edge.x + tangent.y * edge.y >= 0 ? tangent : tangent ? { x: -tangent.x, y: -tangent.y } : undefined;
    const edgeLength = Math.hypot(edge.x, edge.y);
    const sourceControl1 = sourceSegment ? { x: node.anchor.x + sourceSegment.p1.x - sourceSegment.p0.x, y: node.anchor.y + sourceSegment.p1.y - sourceSegment.p0.y } : sourceTangent ? { x: node.anchor.x + sourceTangent.x * edgeLength / 3, y: node.anchor.y + sourceTangent.y * edgeLength / 3 } : undefined;
    const sourceControl2 = sourceSegment ? { x: end.anchor.x + sourceSegment.p2.x - sourceSegment.p3.x, y: end.anchor.y + sourceSegment.p2.y - sourceSegment.p3.y } : sourceTangent ? { x: end.anchor.x - sourceTangent.x * edgeLength / 3, y: end.anchor.y - sourceTangent.y * edgeLength / 3 } : undefined;
    return { id: pathSegmentId(), type: "cubicBezier" as const, startNodeId: node.id, endNodeId: end.id, control1: corners[nodeIndex] ? node.anchor : sourceControl1 ?? { x: node.anchor.x + (end.anchor.x - previous.anchor.x) / 6, y: node.anchor.y + (end.anchor.y - previous.anchor.y) / 6 }, control2: corners[(nodeIndex + 1) % corners.length] ? end.anchor : sourceControl2 ?? { x: end.anchor.x - (afterEnd.anchor.x - node.anchor.x) / 6, y: end.anchor.y - (afterEnd.anchor.y - node.anchor.y) / 6 } };
  });
  return { nodes, segments };
};

export const shapeOperation = (ids: readonly ElementId[], operation: ShapeOperation): EditorCommand => ({
  name: `shape-${operation}:${ids.join(",")}`,
  apply: (document) => {
    const selected = ids.map((id) => document.elements.find((element) => element.id === id));
    const known = selected.filter((element): element is Element => Boolean(element));
    if (known.length !== selected.length || !known.length) return { success: false, error: "No valid objects selected" };
    const geometry = operation === "weld" || operation === "subtract" ? known.filter((element) => element.type !== "dimension") : known;
    if (geometry.some((element) => !isClosedShape(element))) return { success: false, error: "Shape operations require closed objects" };
    if (geometry.length === 0) return { success: false, error: "No closed objects selected" };
    if (operation === "subtract" && geometry.length < 2) return { success: false, error: "Recortar requires at least two objects" };
    const first = geometry[0]!;
    const contours = shapeResultContours(operation === "subtract" ? "difference" : "union", operation === "subtract" ? [geometry.at(-1)!, ...geometry.slice(0, -1)] : geometry);
    if (!contours.length) return { success: false, error: "The shape operation produced an empty result" };
    const points = contours.flatMap((contour) => contour.points);
    const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
    const resultId = elementId(`shape-${crypto.randomUUID()}`);
    const resultElement = geometry.some((element) => element.type === "glyph" || element.type === "path")
      ? {
          type: "glyph" as const,
          id: resultId,
          layerId: first.layerId,
          position: { x: Math.min(...xs), y: Math.min(...ys) },
          size: { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) },
          glyph: "shape-operation",
          contours: contours.map((contour, index) => contourToEditableGlyphContour(contour, index, sourceCubics(geometry))),
          fillRule: "evenodd" as const,
          rotation: 0 as const,
          style: first.style,
          ...( "operation" in first && first.operation ? { operation: first.operation } : {}),
        }
      : {
          type: "contour" as const,
          id: resultId,
          layerId: first.layerId,
          position: { x: Math.min(...xs), y: Math.min(...ys) },
          size: { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) },
          contours,
          fillRule: "evenodd" as const,
          rotation: 0 as const,
          style: first.style,
          ...( "operation" in first && first.operation ? { operation: first.operation } : {}),
        };
    const removed = new Set(geometry.map((element) => element.id));
    const invalidDimensions = new Set(invalidDimensionIdsForShapeOperation(document, ids, operation));
    const firstIndex = Math.min(...geometry.map((element) => elementIndex(document, element.id)));
    const elements = document.elements.filter((element) => !removed.has(element.id) && !invalidDimensions.has(element.id));
    elements.splice(firstIndex, 0, resultElement);
    return replaceElements(removeConnectionsFor(document, new Set([...removed, ...invalidDimensions])), elements);
  },
});
export const createPath = (path: PathElement): EditorCommand => createElement(path);

const pathAt = (document: DocumentSnapshot, id: ElementId): PathElement | undefined => document.elements.find((element): element is PathElement => element.id === id && element.type === "path");
const glyphAt = (document: DocumentSnapshot, id: ElementId): GlyphElement | undefined => document.elements.find((element): element is GlyphElement => element.id === id && element.type === "glyph");
const splineAt = (document: DocumentSnapshot, id: ElementId): SplineElement | undefined => document.elements.find((element): element is SplineElement => element.id === id && element.type === "spline");
const updateSpline = (document: DocumentSnapshot, id: ElementId, apply: (spline: SplineElement) => CommandResult): CommandResult => {
  const spline = splineAt(document, id);
  if (!spline) return { success: false, error: "Spline not found" };
  return apply(spline);
};
const replaceSpline = (document: DocumentSnapshot, spline: Extract<Element, { type: "spline" }>): CommandResult =>
  replaceElements(document, document.elements.map((element) => element.id === spline.id ? spline : element));

export const appendSplineNode = (splineId: ElementId, node: Extract<Element, { type: "spline" }>["nodes"][number]): EditorCommand => ({
  name: `spline-create-node:${splineId}`,
  apply: (document) => updateSpline(document, splineId, (spline) => {
    const result = insertSplineNode(spline, node);
    if (!result.success) return { success: false, error: result.error };
    const nodes = result.spline.nodes.map((current, index, all) => {
      const previous = all[index - 1]?.anchor ?? current.anchor;
      const next = all[index + 1]?.anchor ?? current.anchor;
      const tangent = { dx: (next.x - previous.x) / 6, dy: (next.y - previous.y) / 6 };
      return { ...current, ...(index > 0 ? { inHandle: { dx: -tangent.dx, dy: -tangent.dy } } : {}), ...(index < all.length - 1 ? { outHandle: tangent } : {}) };
    });
    return replaceSpline(document, { ...result.spline, nodes });
  }),
});

export const replaceSplineElement = (spline: Extract<Element, { type: "spline" }>): EditorCommand => ({
  name: `spline-update:${spline.id}`,
  apply: (document) => replaceSpline(document, spline),
});

export const updateSplineNode = (splineId: ElementId, nodeId: string, anchor: PointMm): EditorCommand => ({
  name: `spline-move-node:${splineId}:${nodeId}`,
  apply: (document) => updateSpline(document, splineId, (spline) => {
    const result = moveSplineNodeData(spline, nodeId, anchor);
    return result.success ? replaceSpline(document, result.spline) : { success: false, error: result.error };
  }),
});

export const updateSplineHandle = (splineId: ElementId, nodeId: string, handle: "in" | "out", point: PointMm): EditorCommand => ({
  name: `spline-move-handle:${splineId}:${nodeId}:${handle}`,
  apply: (document) => updateSpline(document, splineId, (spline) => {
    const node = spline.nodes.find((current) => current.id === nodeId);
    if (!node) return { success: false, error: "Spline node not found" };
    const offset = { dx: point.x - node.anchor.x, dy: point.y - node.anchor.y };
    const result = moveSplineHandleData(spline, nodeId, handle, offset);
    if (!result.success) return { success: false, error: result.error };
    const updated = result.spline.nodes.map((current) => current.id === nodeId
      ? { ...current, ...(handle === "in" ? { outHandle: { dx: -offset.dx, dy: -offset.dy } } : { inHandle: { dx: -offset.dx, dy: -offset.dy } }) }
      : current);
    return replaceSpline(document, { ...result.spline, nodes: updated });
  }),
});

export const closeSplineElement = (splineId: ElementId): EditorCommand => ({
  name: `spline-close:${splineId}`,
  apply: (document) => updateSpline(document, splineId, (spline) => {
    if (spline.closed) return { success: false, error: "Spline is already closed" };
    if (spline.nodes.length < 3) return { success: false, error: "A spline must have at least three nodes to close" };
    const nodes = spline.nodes.map((node, index) => {
      const previous = spline.nodes[(index - 1 + spline.nodes.length) % spline.nodes.length]!.anchor;
      const next = spline.nodes[(index + 1) % spline.nodes.length]!.anchor;
      const tangent = { dx: (next.x - previous.x) / 6, dy: (next.y - previous.y) / 6 };
      return { ...node, inHandle: { dx: -tangent.dx, dy: -tangent.dy }, outHandle: tangent };
    });
    return replaceSpline(document, { ...spline, nodes, closed: true });
  }),
});
const updatePath = (document: DocumentSnapshot, path: PathElement): CommandResult => replaceElements(document, document.elements.map((element) => element.id === path.id ? path : element));
const remapPathDimensionElements = (elements: readonly Element[], before: PathElement, after: readonly PathElement[], referenceMap: ReadonlyMap<string, ReferenceResolution>): readonly Element[] => elements.flatMap<Element>((element) => {
  if (element.type !== "dimension") return [element];
  const remap = (reference: DimensionElement["references"][number]): DimensionElement["references"][number] | undefined => {
    if (!("nodeIndex" in reference) || reference.elementId !== before.id) return reference;
    const sourceNodes = realGeometryNodes(before);
    const sourceIndex = reference.nodeId !== undefined ? sourceNodes.findIndex((node) => node.kind !== "control" && node.nodeId === reference.nodeId) : reference.nodeIndex;
    const sourceNode = sourceNodes[sourceIndex]; if (!sourceNode) return undefined;
    if (sourceNode.kind !== "control" && sourceNode.nodeId !== undefined) {
      const targetPath = after.find((path) => path.nodes.some((node) => node.id === sourceNode.nodeId));
      if (!targetPath) return undefined;
      const targetIndex = realGeometryNodes(targetPath).findIndex((node) => node.kind !== "control" && node.nodeId === sourceNode.nodeId);
      return targetIndex >= 0 ? { kind: "node", elementId: targetPath.id, nodeIndex: targetIndex, nodeId: sourceNode.nodeId } : undefined;
    }
    const sourceSegment = sourceNode.segmentIndex !== undefined ? before.segments[sourceNode.segmentIndex] : undefined;
    if (!sourceSegment || sourceNode.handle === undefined) return undefined;
    const sourceReference = pathSegmentReference(before.id, sourceSegment.id); const resolution = referenceMap.get(topologyReferenceKey(sourceReference));
    const targets = resolution?.kind === "removed" ? [] : resolution?.kind === "replaced" ? resolution.references : resolution?.kind === "preserved" ? [resolution.reference] : [sourceReference];
    const orderedTargets = sourceNode.handle === "control2" ? [...targets].reverse() : targets;
    for (const target of orderedTargets) {
      if (target.kind !== "path-segment") continue;
      const targetPath = after.find((path) => path.id === target.elementId); const targetSegmentIndex = targetPath?.segments.findIndex((segment) => segment.id === target.segmentId) ?? -1;
      if (!targetPath || targetSegmentIndex < 0) continue;
      const targetSegment = targetPath.segments[targetSegmentIndex];
      const sourceStart = before.nodes.find((node) => node.id === sourceSegment.startNodeId)?.anchor; const sourceEnd = before.nodes.find((node) => node.id === sourceSegment.endNodeId)?.anchor;
      const targetStart = targetSegment ? targetPath.nodes.find((node) => node.id === targetSegment.startNodeId)?.anchor : undefined; const targetEnd = targetSegment ? targetPath.nodes.find((node) => node.id === targetSegment.endNodeId)?.anchor : undefined;
      const samePoint = (first: PointMm | undefined, second: PointMm | undefined) => first !== undefined && second !== undefined && Math.hypot(first.x - second.x, first.y - second.y) <= 1e-8;
      const reversed = samePoint(targetStart, sourceEnd) || !samePoint(targetStart, sourceStart) && samePoint(targetEnd, sourceStart);
      const targetHandle = reversed ? sourceNode.handle === "control1" ? "control2" : "control1" : sourceNode.handle;
      const targetIndex = realGeometryNodes(targetPath).findIndex((node) => node.kind === "control" && node.segmentIndex === targetSegmentIndex && node.handle === targetHandle);
      if (targetIndex >= 0) return { kind: "node", elementId: targetPath.id, nodeIndex: targetIndex };
    }
    return undefined;
  };
  const first = remap(element.references[0]); const second = remap(element.references[1]);
  return first && second ? [{ ...element, references: [first, second] }] : [];
});
const translatePath = (path: PathElement, delta: PointMm): PathElement => ({ ...path, nodes: path.nodes.map((node) => ({ ...node, anchor: { x: node.anchor.x + delta.x, y: node.anchor.y + delta.y } })), segments: path.segments.map((segment) => segment.type === "cubicBezier" ? { ...segment, control1: { x: segment.control1.x + delta.x, y: segment.control1.y + delta.y }, control2: { x: segment.control2.x + delta.x, y: segment.control2.y + delta.y } } : segment) });
const translateGlyph = (glyph: GlyphElement, delta: PointMm): GlyphElement => ({ ...glyph, position: { x: glyph.position.x + delta.x, y: glyph.position.y + delta.y }, contours: glyph.contours.map((contour) => ({ ...contour, nodes: contour.nodes.map((node) => ({ ...node, anchor: { x: node.anchor.x + delta.x, y: node.anchor.y + delta.y } })), segments: contour.segments.map((segment) => segment.type === "cubicBezier" ? { ...segment, control1: { x: segment.control1.x + delta.x, y: segment.control1.y + delta.y }, control2: { x: segment.control2.x + delta.x, y: segment.control2.y + delta.y } } : segment) })) });
const updateGlyphNodeData = (glyph: GlyphElement, nodeIndex: number, point: PointMm): GlyphElement | undefined => {
  const target = glyphGeometryNodes(glyph)[nodeIndex];
  if (!target) return undefined;
  return { ...glyph, contours: glyph.contours.map((contour, ringIndex) => {
    if (ringIndex !== target.ringIndex) return contour;
    const nodes = contour.nodes.map((node) => node.id === target.nodeId && target.kind === "anchor" ? { ...node, anchor: point } : node);
    const segments = contour.segments.map((segment, index) => {
      if (index !== target.segmentIndex || segment.type !== "cubicBezier") return segment;
      return target.handle === "control1" ? { ...segment, control1: point } : { ...segment, control2: point };
    });
    return { ...contour, nodes, segments };
  }) };
};

export const createPathNode = (pathId: ElementId, node: PathElement["nodes"][number], afterNodeId?: string): EditorCommand => ({ name: `path-create-node:${pathId}`, apply: (document) => { const path = pathAt(document, pathId); if (!path || path.closed || path.nodes.some((current) => current.id === node.id)) return { success: false, error: "Invalid path or duplicate node" }; if (afterNodeId !== undefined && afterNodeId !== path.nodes.at(-1)?.id) return { success: false, error: "Only appending path nodes is supported" }; const last = path.nodes.at(-1)!; return updatePath(document, { ...path, nodes: [...path.nodes, node], segments: [...path.segments, { id: pathSegmentId(), type: "line", startNodeId: last.id, endNodeId: node.id }] }); } });
export const createPathCubicNode = (pathId: ElementId, node: PathElement["nodes"][number], control1: PointMm, control2: PointMm, afterNodeId?: string): EditorCommand => ({ name: `path-create-cubic-node:${pathId}`, apply: (document) => { const path = pathAt(document, pathId); if (!path || path.closed || path.nodes.some((current) => current.id === node.id)) return { success: false, error: "Invalid path or duplicate node" }; if (afterNodeId !== undefined && afterNodeId !== path.nodes.at(-1)?.id) return { success: false, error: "Only appending path nodes is supported" }; const last = path.nodes.at(-1)!; return updatePath(document, { ...path, nodes: [...path.nodes, node], segments: [...path.segments, { id: pathSegmentId(), type: "cubicBezier", startNodeId: last.id, endNodeId: node.id, control1, control2 }] }); } });
export const movePathNode = (pathId: ElementId, nodeId: string, anchor: PointMm): EditorCommand => ({ name: `path-move-node:${pathId}:${nodeId}`, apply: (document) => {
  const path = pathAt(document, pathId);
  if (path) { const node = path.nodes.find((current) => current.id === nodeId); if (!node) return { success: false, error: "Path node not found" }; const delta = { x: anchor.x - node.anchor.x, y: anchor.y - node.anchor.y }; return updatePath(document, { ...path, nodes: path.nodes.map((current) => current.id === nodeId ? { ...current, anchor } : current), segments: path.segments.map((segment) => segment.type === "cubicBezier" && (segment.startNodeId === nodeId || segment.endNodeId === nodeId) ? { ...segment, ...(segment.startNodeId === nodeId ? { control1: { x: segment.control1.x + delta.x, y: segment.control1.y + delta.y } } : {}), ...(segment.endNodeId === nodeId ? { control2: { x: segment.control2.x + delta.x, y: segment.control2.y + delta.y } } : {}) } : segment) }); }
  const glyph = glyphAt(document, pathId); if (!glyph) return { success: false, error: "Path or glyph node not found" };
  let delta: PointMm | undefined;
  const contours = glyph.contours.map((contour) => {
    const node = contour.nodes.find((current) => current.id === nodeId); if (!node) return contour;
    delta = { x: anchor.x - node.anchor.x, y: anchor.y - node.anchor.y };
    return { ...contour, nodes: contour.nodes.map((current) => current.id === nodeId ? { ...current, anchor } : current), segments: contour.segments.map((segment) => segment.type === "cubicBezier" && (segment.startNodeId === nodeId || segment.endNodeId === nodeId) ? { ...segment, ...(segment.startNodeId === nodeId ? { control1: { x: segment.control1.x + delta!.x, y: segment.control1.y + delta!.y } } : {}), ...(segment.endNodeId === nodeId ? { control2: { x: segment.control2.x + delta!.x, y: segment.control2.y + delta!.y } } : {}) } : segment) };
  });
  return delta ? replaceElements(document, document.elements.map((element) => element.id === glyph.id ? { ...glyph, contours } : element)) : { success: false, error: "Glyph node not found" };
} });
export const movePathHandle = (pathId: ElementId, segmentIndex: number, handle: "control1" | "control2", point: PointMm, ringIndex?: number): EditorCommand => ({ name: `path-move-handle:${pathId}:${ringIndex ?? ""}:${segmentIndex}:${handle}`, apply: (document) => {
  const path = pathAt(document, pathId);
  if (path) {
    const segment = path.segments[segmentIndex];
    if (!segment || segment.type !== "cubicBezier") return { success: false, error: "Cubic segment not found" };
    const nodeId = handle === "control1" ? segment.startNodeId : segment.endNodeId;
    const node = path.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return { success: false, error: "Cubic segment node not found" };
    const segments = [...path.segments];
    segments[segmentIndex] = handle === "control1" ? { ...segment, control1: point } : { ...segment, control2: point };
    if (node.join === "symmetric") {
      const oppositeIndex = handle === "control1"
        ? path.segments.findIndex((candidate) => candidate.type === "cubicBezier" && candidate.endNodeId === nodeId)
        : path.segments.findIndex((candidate) => candidate.type === "cubicBezier" && candidate.startNodeId === nodeId);
      const opposite = oppositeIndex >= 0 ? segments[oppositeIndex] : undefined;
      if (opposite?.type === "cubicBezier") {
        const mirrored = mirrorHandleOffset({ dx: point.x - node.anchor.x, dy: point.y - node.anchor.y });
        segments[oppositeIndex] = handle === "control1"
          ? { ...opposite, control2: { x: node.anchor.x + mirrored.dx, y: node.anchor.y + mirrored.dy } }
          : { ...opposite, control1: { x: node.anchor.x + mirrored.dx, y: node.anchor.y + mirrored.dy } };
      }
    }
    return updatePath(document, { ...path, segments });
  }
  const glyph = glyphAt(document, pathId); if (!glyph) return { success: false, error: "Path or glyph not found" };
  let found = false; let nodeId: string | undefined;
  const contours = glyph.contours.map((contour, currentRing) => ({ ...contour, segments: contour.segments.map((segment, index) => { if ((ringIndex !== undefined && currentRing !== ringIndex) || index !== segmentIndex || segment.type !== "cubicBezier" || found) return segment; found = true; nodeId = handle === "control1" ? segment.startNodeId : segment.endNodeId; return handle === "control1" ? { ...segment, control1: point } : { ...segment, control2: point }; }) }));
  if (found && nodeId) {
    const contour = glyph.contours[ringIndex ?? glyph.contours.findIndex((candidate) => candidate.segments[segmentIndex]?.type === "cubicBezier")];
    const node = contour?.nodes.find((candidate) => candidate.id === nodeId);
    if (node?.join === "symmetric") {
      const mirrored = mirrorHandleOffset({ dx: point.x - node.anchor.x, dy: point.y - node.anchor.y });
      let mirroredFound = false;
      for (const [currentRing, candidate] of glyph.contours.entries()) {
        if (ringIndex !== undefined && currentRing !== ringIndex) continue;
        const segments = candidate.segments.map((segment) => {
          if (mirroredFound || segment.type !== "cubicBezier") return segment;
          if (handle === "control1" && segment.endNodeId === nodeId) { mirroredFound = true; return { ...segment, control2: { x: node.anchor.x + mirrored.dx, y: node.anchor.y + mirrored.dy } }; }
          if (handle === "control2" && segment.startNodeId === nodeId) { mirroredFound = true; return { ...segment, control1: { x: node.anchor.x + mirrored.dx, y: node.anchor.y + mirrored.dy } }; }
          return segment;
        });
        const target = contours[currentRing];
        if (target) contours[currentRing] = { ...target, segments };
      }
    }
  }
  return found ? replaceElements(document, document.elements.map((element) => element.id === glyph.id ? { ...glyph, contours } : element)) : { success: false, error: "Cubic segment not found" };
} });
export const setPathJoin = (pathId: ElementId, nodeId: string, join: PathJoin): EditorCommand => ({ name: `path-join:${pathId}:${nodeId}:${join}`, apply: (document) => { const path = pathAt(document, pathId); const node = path?.nodes.find((current) => current.id === nodeId); if (!path || !node) return { success: false, error: "Path node not found" }; const incoming = path.segments.find((segment) => segment.endNodeId === nodeId); const outgoing = path.segments.find((segment) => segment.startNodeId === nodeId); if (join !== "corner" && incoming?.type === "cubicBezier" && outgoing?.type === "cubicBezier") { const inLength = Math.hypot(incoming.control2.x - node.anchor.x, incoming.control2.y - node.anchor.y); const outLength = Math.hypot(outgoing.control1.x - node.anchor.x, outgoing.control1.y - node.anchor.y); const direction = { x: outgoing.control1.x - node.anchor.x, y: outgoing.control1.y - node.anchor.y }; const magnitude = Math.hypot(direction.x, direction.y) || 1; const length = join === "symmetric" ? (inLength + outLength) / 2 : outLength; const control1 = { x: node.anchor.x + direction.x / magnitude * length, y: node.anchor.y + direction.y / magnitude * length }; const control2 = { x: node.anchor.x - direction.x / magnitude * (join === "symmetric" ? length : inLength), y: node.anchor.y - direction.y / magnitude * (join === "symmetric" ? length : inLength) }; const segments = path.segments.map((segment) => segment === outgoing ? { ...segment, control1 } : segment === incoming ? { ...segment, control2 } : segment); return updatePath(document, { ...path, nodes: path.nodes.map((current) => current.id === nodeId ? { ...current, join } : current), segments }); } return updatePath(document, { ...path, nodes: path.nodes.map((current) => current.id === nodeId ? { ...current, join } : current) }); } });
export const setPathJoinMode = setPathJoin;
/** Splits a straight path segment at a normalized intersection parameter. */
export const splitPathLineAt = (pathId: ElementId, segmentIndex: number, parameter: number, newNodeId = `path-node-${crypto.randomUUID()}`): EditorCommand => ({ name: `path-split-at:${pathId}:${segmentIndex}`, apply: (document) => {
  const path = pathAt(document, pathId); const segment = path?.segments[segmentIndex];
  if (!path || !segment || segment.type !== "line" || !Number.isFinite(parameter) || parameter <= 0 || parameter >= 1 || path.nodes.some((node) => node.id === newNodeId)) return { success: false, error: "Line segment or split parameter is invalid" };
  const start = path.nodes.find((node) => node.id === segment.startNodeId); const end = path.nodes.find((node) => node.id === segment.endNodeId);
  const endIndex = path.nodes.findIndex((node) => node.id === segment.endNodeId);
  if (!start || !end || endIndex < 0) return { success: false, error: "Path segment nodes are invalid" };
  const node = { id: newNodeId, anchor: { x: start.anchor.x + (end.anchor.x - start.anchor.x) * parameter, y: start.anchor.y + (end.anchor.y - start.anchor.y) * parameter }, join: "corner" as const };
  const nodes = [...path.nodes]; nodes.splice(endIndex, 0, node);
  const replacements: PathElement["segments"] = [{ id: pathSegmentId(), type: "line", startNodeId: segment.startNodeId, endNodeId: node.id }, { id: pathSegmentId(), type: "line", startNodeId: node.id, endNodeId: segment.endNodeId }];
  const segments = [...path.segments]; segments.splice(segmentIndex, 1, ...replacements);
  const nextPath = { ...path, nodes, segments };
  const elements = document.elements.map((element) => element.id === path.id ? nextPath : element);
  const edit = topologyEditForPathSegmentReplacement(elements, path.id, segment.id, replacements);
  return replaceTopology(document, { ...edit, elements: remapPathDimensionElements(elements, path, [nextPath], edit.referenceMap) });
} });

interface CutPieceGraph { readonly piece: ReturnType<typeof splitCuttableSegments>[number]; readonly source: Element }
const cutPointDistance = (piece: CutPieceGraph, point: PointMm | undefined): number => {
  if (!point) return 0;
  const dx = piece.piece.end.x - piece.piece.start.x; const dy = piece.piece.end.y - piece.piece.start.y; const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - piece.piece.start.x) * dx + (point.y - piece.piece.start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (piece.piece.start.x + t * dx), point.y - (piece.piece.start.y + t * dy));
};

/** Rebuilds only the straight planar component containing the selected edge. */
const cutStraightComponent = (document: DocumentSnapshot, elementIdToCut: ElementId, segmentIndex: number, point?: PointMm): CommandResult => {
  const selectedElement = document.elements.find((element) => element.id === elementIdToCut);
  if (!selectedElement || (selectedElement.type !== "line" && selectedElement.type !== "rectangle" && selectedElement.type !== "ellipse" && selectedElement.type !== "path")) return { success: false, error: "Only straight lines, ellipse arcs, rectangle edges, and line paths can be cut" };
  if (selectedElement.type === "path" && selectedElement.segments[segmentIndex]?.type !== "line") return { success: false, error: "Only straight path segments can be cut" };
  const sources = document.elements.flatMap((element): CutPieceGraph[] => cuttableSegments(element).flatMap((piece) => element.type === "path" && element.segments[piece.segmentIndex]?.type === "cubicBezier" ? [] : [{ piece, source: element }]));
  const curveSources = document.elements.flatMap((element): CutPieceGraph[] => {
    if (element.type !== "path") return [];
    const nodes = new Map(element.nodes.map((node) => [node.id, node.anchor]));
    return element.segments.flatMap((segment, segmentIndex) => {
      if (segment.type !== "cubicBezier") return [];
      const start = nodes.get(segment.startNodeId); const end = nodes.get(segment.endNodeId);
      return start && end ? [{ piece: { elementId: element.id, segmentIndex, start, end }, source: element }] : [];
    });
  });
  const split = splitCuttableSegments(sources.map(({ piece }) => piece));
  const graph = [...split.map((piece) => ({ piece, source: document.elements.find((element) => element.id === piece.elementId)! })), ...curveSources];
  const candidates = graph.filter(({ piece }) => piece.elementId === elementIdToCut && piece.segmentIndex === segmentIndex);
  const selected = candidates.reduce<CutPieceGraph | undefined>((best, candidate) => !best || cutPointDistance(candidate, point) < cutPointDistance(best, point) ? candidate : best, undefined);
  if (!selected || !selected.source) return { success: false, error: "The selected segment is not cuttable" };
  const key = (pointValue: PointMm) => `${Math.round(pointValue.x / 1e-8)}:${Math.round(pointValue.y / 1e-8)}`;
  const connected = new Set<CutPieceGraph>([selected]); let changed = true;
  while (changed) { changed = false; for (const candidate of graph) if (!connected.has(candidate) && [...connected].some(({ piece }) => [piece.start, piece.end].some((end) => [candidate.piece.start, candidate.piece.end].some((start) => key(end) === key(start))))) { connected.add(candidate); changed = true; } }
  const edgeKey = (start: PointMm, end: PointMm) => [key(start), key(end)].sort().join("|");
  const component = [...connected];
  const selectedEdge = edgeKey(selected.piece.start, selected.piece.end);
  const remaining = component.filter(({ piece, source }) => {
    if (selected.source.type === "ellipse" && source.type === "ellipse") return !(piece.elementId === selected.piece.elementId && piece.segmentIndex === selected.piece.segmentIndex);
    if (edgeKey(piece.start, piece.end) !== selectedEdge) return true;
    return source.type === "path" && source.segments[piece.segmentIndex]?.type === "cubicBezier";
  });
  const componentElements = new Set(component.map(({ piece }) => piece.elementId));
  const topologySources = document.elements.flatMap((element) => element.type === "path" && componentElements.has(element.id) ? element.segments.map((segment) => pathSegmentReference(element.id, segment.id)) : []);
  const topologyDestinations = new Map<string, readonly TopologyReference[]>();
  const nodeDestinations = new Map<string, readonly { readonly elementId: ElementId; readonly nodeId: string; readonly handle?: "in" | "out" }[]>();
  const sourceNodeKey = (source: Element, nodeIndex: number): string => {
    const node = realGeometryNodes(source)[nodeIndex];
    return `${source.id}:node:${node?.nodeId ?? `index:${nodeIndex}`}${node?.kind === "control" ? `:handle:${node.handle}` : ""}`;
  };
  const result = classifyCutGraph(remaining.map(({ piece }) => piece));
  const cycleEdges = new Set(result.cycles.flatMap((cycle) => cycle.points.map((start, index) => edgeKey(start, cycle.points[(index + 1) % cycle.points.length]!))));
  const open = remaining.filter(({ piece }) => !cycleEdges.has(edgeKey(piece.start, piece.end)));
  const paths: PathElement[] = [];
  const usedOpen = new Set<CutPieceGraph>();
  const usedElementIds = new Set(document.elements.filter((element) => !componentElements.has(element.id)).map((element) => element.id));
  const nextElementId = (base: string): ElementId => { let candidate = base; let suffix = 1; while (usedElementIds.has(elementId(candidate))) candidate = `${base}:${suffix++}`; const id = elementId(candidate); usedElementIds.add(id); return id; };
  const sourceFor = (pieces: readonly CutPieceGraph[]) => pieces[0]?.source ?? selected.source;
  const ellipseCubic = (ellipse: Extract<Element, { type: "ellipse" }>, start: PointMm, end: PointMm): Pick<Extract<PathSegment, { type: "cubicBezier" }>, "control1" | "control2"> => {
    const center = elementCenter(ellipse); const rx = ellipse.size.width / 2; const ry = ellipse.size.height / 2; const cos = Math.cos(-ellipse.rotation); const sin = Math.sin(-ellipse.rotation);
    const localAngle = (pointValue: PointMm) => { const dx = pointValue.x - center.x; const dy = pointValue.y - center.y; return Math.atan2((dx * sin + dy * cos) / ry, (dx * cos - dy * sin) / rx); };
    const tangent = (angle: number): PointMm => transformPoint({ x: -rx * Math.sin(angle), y: ry * Math.cos(angle) }, { x: 0, y: 0 }, ellipse.rotation);
    const a0 = localAngle(start); const a1 = localAngle(end); let delta = a1 - a0; while (delta <= -Math.PI) delta += Math.PI * 2; while (delta > Math.PI) delta -= Math.PI * 2;
    const k = 4 / 3 * Math.tan(delta / 4); const t0 = tangent(a0); const t1 = tangent(a1);
    return { control1: { x: start.x + t0.x * k, y: start.y + t0.y * k }, control2: { x: end.x - t1.x * k, y: end.y - t1.y * k } };
  };
  const makePath = (pieces: readonly CutPieceGraph[], closed: boolean, index: number, styleSource: Element): PathElement => {
    const id = nextElementId(index === 0 ? elementIdToCut : `${elementIdToCut}:cut:${index}`); const nodes: PathNode[] = []; const segments: PathSegment[] = [];
    const appendNode = (anchor: PointMm) => { const existing = nodes.at(-1); if (existing && key(existing.anchor) === key(anchor)) return existing.id; const node = { id: `${id}:node:${nodes.length}`, anchor, join: "corner" as const }; nodes.push(node); return node.id; };
    const recordPathHandle = (source: PathElement, sourceSegmentIndex: number, sourceHandle: "control1" | "control2", outputNodeId: string, outputHandle: "in" | "out") => {
      const sourceIndex = realGeometryNodes(source).findIndex((node) => node.kind === "control" && node.segmentIndex === sourceSegmentIndex && node.handle === sourceHandle);
      if (sourceIndex < 0) return;
      const sourceKey = sourceNodeKey(source, sourceIndex); const output = { elementId: id, nodeId: outputNodeId, handle: outputHandle } as const;
      const current = nodeDestinations.get(sourceKey) ?? [];
      if (!current.some((candidate) => candidate.elementId === output.elementId && candidate.nodeId === output.nodeId && candidate.handle === output.handle)) nodeDestinations.set(sourceKey, [...current, output]);
    };
    const recordEndpoint = (source: Element, sourceSegmentIndex: number, point: PointMm, outputNodeId: string) => {
      const original = cuttableSegments(source).filter((segment) => segment.segmentIndex === sourceSegmentIndex);
      const originalStart = original[0]?.start; const originalEnd = original.at(-1)?.end;
      if (!originalStart || !originalEnd || key(point) !== key(originalStart) && key(point) !== key(originalEnd)) return;
      const geometryNodes = realGeometryNodes(source);
      const endpointNodeIds = source.type === "path"
        ? [source.segments[sourceSegmentIndex]?.startNodeId, source.segments[sourceSegmentIndex]?.endNodeId]
        : source.type === "sketch"
          ? [source.edges[sourceSegmentIndex]?.startNodeId, source.edges[sourceSegmentIndex]?.endNodeId]
          : [];
      const endpointIndexes = endpointNodeIds.length > 0
        ? endpointNodeIds.flatMap((nodeId) => { const index = geometryNodes.findIndex((node) => node.kind !== "control" && node.nodeId === nodeId); return index >= 0 ? [index] : []; })
        : geometryNodes.flatMap((node, nodeIndex) => key(node.point) === key(point) ? [nodeIndex] : []);
      for (const nodeIndex of endpointIndexes) {
        const node = geometryNodes[nodeIndex]; if (!node || key(node.point) !== key(point)) continue;
        const sourceKey = sourceNodeKey(source, nodeIndex); const output = { elementId: id, nodeId: outputNodeId };
        const current = nodeDestinations.get(sourceKey) ?? [];
        if (!current.some((candidate) => candidate.elementId === output.elementId && candidate.nodeId === output.nodeId)) nodeDestinations.set(sourceKey, [...current, output]);
      }
    };
    for (let pieceIndex = 0; pieceIndex < pieces.length;) {
      const first = pieces[pieceIndex]!; let lastIndex = pieceIndex;
      const sourcePathSegment = first.source.type === "path" ? first.source.segments[first.piece.segmentIndex] : undefined;
      while (lastIndex + 1 < pieces.length && (first.source.type === "ellipse" || sourcePathSegment?.type === "cubicBezier") && pieces[lastIndex + 1]!.piece.elementId === first.piece.elementId && pieces[lastIndex + 1]!.piece.segmentIndex === first.piece.segmentIndex) lastIndex += 1;
      const last = pieces[lastIndex]!; const startNodeId = appendNode(first.piece.start); const endNodeId = appendNode(last.piece.end);
      const generated = first.source.type === "ellipse" ? { id: pathSegmentId(), type: "cubicBezier" as const, startNodeId, endNodeId, ...ellipseCubic(first.source, first.piece.start, last.piece.end) } : sourcePathSegment?.type === "cubicBezier" ? (() => {
        const sourceStart = first.source.type === "path" ? first.source.nodes.find((node) => node.id === sourcePathSegment.startNodeId)?.anchor : undefined;
        const forward = sourceStart !== undefined && key(first.piece.start) === key(sourceStart);
        return { id: pathSegmentId(), type: "cubicBezier" as const, startNodeId, endNodeId, control1: forward ? sourcePathSegment.control1 : sourcePathSegment.control2, control2: forward ? sourcePathSegment.control2 : sourcePathSegment.control1 };
      })() : { id: pathSegmentId(), type: "line" as const, startNodeId, endNodeId };
      segments.push(generated);
      recordEndpoint(first.source, first.piece.segmentIndex, first.piece.start, startNodeId);
      recordEndpoint(last.source, last.piece.segmentIndex, last.piece.end, endNodeId);
      if (first.source.type === "path" && sourcePathSegment?.type === "cubicBezier") {
        const sourceNodes = new Map(first.source.nodes.map((node) => [node.id, node.anchor])); const sourceStart = sourceNodes.get(sourcePathSegment.startNodeId); const sourceEnd = sourceNodes.get(sourcePathSegment.endNodeId);
        if (sourceStart && key(first.piece.start) === key(sourceStart)) recordPathHandle(first.source, first.piece.segmentIndex, "control1", startNodeId, "out");
        if (sourceEnd && key(first.piece.start) === key(sourceEnd)) recordPathHandle(first.source, first.piece.segmentIndex, "control2", startNodeId, "out");
        if (sourceEnd && key(last.piece.end) === key(sourceEnd)) recordPathHandle(first.source, first.piece.segmentIndex, "control2", endNodeId, "in");
        if (sourceStart && key(last.piece.end) === key(sourceStart)) recordPathHandle(first.source, first.piece.segmentIndex, "control1", endNodeId, "in");
      }
      if (sourcePathSegment && first.source.type === "path") {
        const source = pathSegmentReference(first.source.id, sourcePathSegment.id); const sourceKey = topologyReferenceKey(source);
        topologyDestinations.set(sourceKey, [...(topologyDestinations.get(sourceKey) ?? []), pathSegmentReference(id, generated.id)]);
      }
      pieceIndex = lastIndex + 1;
    }
    if (closed && segments.length && nodes.length > 1 && key(nodes[0]!.anchor) === key(nodes.at(-1)!.anchor)) {
      const removedNodeId = nodes.pop()!.id; const firstNodeId = nodes[0]!.id; const last = segments.at(-1)!;
      segments[segments.length - 1] = { ...last, endNodeId: firstNodeId } as PathSegment;
      for (const [sourceKey, outputs] of nodeDestinations) nodeDestinations.set(sourceKey, outputs.map((output) => output.elementId === id && output.nodeId === removedNodeId ? { ...output, nodeId: firstNodeId } : output));
    }
    return { type: "path", id, layerId: styleSource.layerId, nodes, segments, closed, style: closed ? styleSource.style : Object.fromEntries(Object.entries(styleSource.style).filter(([name]) => name !== "fill")) as typeof styleSource.style, ...("operation" in styleSource && styleSource.operation ? { operation: styleSource.operation } : {}) };
  };
  const cyclePieces = (points: readonly PointMm[]): CutPieceGraph[] => points.map((start, index) => {
    const end = points[(index + 1) % points.length]!; const match = remaining.find(({ piece }) => edgeKey(piece.start, piece.end) === edgeKey(start, end))!;
    return key(match.piece.start) === key(start) ? match : { ...match, piece: { ...match.piece, start: match.piece.end, end: match.piece.start } };
  });
  const keepPath = (path: PathElement) => path.nodes.length >= 2 && path.segments.length >= 1 && (!path.closed && path.segments.length === path.nodes.length - 1 || path.closed && path.segments.length === path.nodes.length);
  for (const cycle of result.cycles) { const pieces = cyclePieces(cycle.points); const source = pieces.find(({ source }) => source.type === "rectangle")?.source ?? selected.source; const path = makePath(pieces, true, paths.length, source); if (keepPath(path)) paths.push(path); }
  while (usedOpen.size < open.length) { const seed = open.find((candidate) => !usedOpen.has(candidate)); if (!seed) break; const chain: CutPieceGraph[] = [seed]; usedOpen.add(seed); let end = seed.piece.end; for (;;) { const next = open.find((candidate) => !usedOpen.has(candidate) && (key(candidate.piece.start) === key(end) || key(candidate.piece.end) === key(end))); if (!next) break; usedOpen.add(next); if (key(next.piece.end) === key(end)) chain.push({ ...next, piece: { ...next.piece, start: next.piece.end, end: next.piece.start } }); else chain.push(next); end = chain.at(-1)!.piece.end; } const path = makePath(chain, false, paths.length, sourceFor(chain)); if (keepPath(path)) paths.push(path); }
  const firstAffected = document.elements.findIndex((element) => componentElements.has(element.id));
  const elements = document.elements.filter((element) => !componentElements.has(element.id));
  const insertionIndex = firstAffected < 0 ? elements.length : document.elements.slice(0, firstAffected).filter((element) => !componentElements.has(element.id)).length;
  elements.splice(insertionIndex, 0, ...paths);
  const sourceById = new Map(document.elements.filter((element) => componentElements.has(element.id)).map((element) => [element.id, element]));
  const migrated = document.elements.flatMap((element) => {
    if (element.type !== "dimension" || !element.references.every((reference) => componentElements.has(reference.elementId))) return [element];
    const targets = element.references.map((reference) => {
      if (!("nodeIndex" in reference)) return [];
      const source = sourceById.get(reference.elementId); if (!source) return [];
      const sourceNodes = realGeometryNodes(source);
      const sourceIndex = reference.nodeId !== undefined ? sourceNodes.findIndex((node) => node.nodeId === reference.nodeId) : reference.nodeIndex;
      if (sourceIndex < 0 || !sourceNodes[sourceIndex]) return [];
      return (nodeDestinations.get(sourceNodeKey(source, sourceIndex)) ?? []).flatMap((destination) => {
        const candidate = paths.find((path) => path.id === destination.elementId); if (!candidate) return [];
        const nodeIndex = realGeometryNodes(candidate).findIndex((node) => destination.handle === undefined ? node.kind !== "control" && node.nodeId === destination.nodeId : node.kind === "control" && node.nodeId === destination.nodeId && node.handle === (destination.handle === "out" ? "control1" : "control2"));
        return nodeIndex >= 0 ? [{ candidate, nodeId: destination.nodeId, nodeIndex, handle: destination.handle }] : [];
      });
    });
    const pair = targets[0]?.flatMap((firstTarget) => targets[1]?.flatMap((secondTarget) => firstTarget.candidate.id === secondTarget.candidate.id && firstTarget.nodeIndex !== secondTarget.nodeIndex ? [{ firstTarget, secondTarget }] : []) ?? [])[0];
    if (!pair) return [];
    const dimensionReference = (target: typeof pair.firstTarget): DimensionElement["references"][number] => ({ kind: "node", elementId: target.candidate.id, nodeIndex: target.nodeIndex, ...(target.handle === undefined ? { nodeId: target.nodeId } : {}) });
    return [{ ...element, references: [dimensionReference(pair.firstTarget), dimensionReference(pair.secondTarget)] } as DimensionElement];
  });
  const migratedDimensions = new Map(migrated.filter((element): element is DimensionElement => element.type === "dimension").map((element) => [element.id, element]));
  const nextElements = elements.flatMap((element) => {
    if (element.type !== "dimension" || !element.references.some((reference) => componentElements.has(reference.elementId))) return [element];
    const next = migratedDimensions.get(element.id);
    return next ? [next] : [];
  });
  const remapConnectionReference = (reference: ExplicitConnection["first"]): ExplicitConnection["first"] | undefined => {
    if (!componentElements.has(reference.elementId)) return reference;
    const source = sourceById.get(reference.elementId); if (!source) return undefined;
    const sourceIndex = realGeometryNodes(source).findIndex((_, index) => JSON.stringify(connectableNodeAddress(source, index)) === JSON.stringify(reference.node));
    if (sourceIndex < 0) return undefined;
    const outputs = [...new Map((nodeDestinations.get(sourceNodeKey(source, sourceIndex)) ?? []).map((output) => [`${output.elementId}:${output.nodeId}`, output])).values()];
    if (outputs.length !== 1) return undefined;
    const output = outputs[0]!; const outputPath = paths.find((path) => path.id === output.elementId);
    if (!outputPath) return undefined;
    const sourceHandle = "handle" in reference.node ? reference.node.handle : undefined; const handle = output.handle;
    if (sourceHandle !== undefined && handle === undefined) return undefined;
    const hasHandle = handle === undefined || outputPath.segments.some((segment) => segment.type === "cubicBezier" && (handle === "in" ? segment.endNodeId : segment.startNodeId) === output.nodeId);
    return hasHandle ? { elementId: output.elementId, node: { kind: "path", nodeId: output.nodeId, ...(handle ? { handle } : {}) } } : undefined;
  };
  const connections = (document.connections ?? []).flatMap((connection) => {
    const first = remapConnectionReference(connection.first); const second = remapConnectionReference(connection.second);
    if (!first || !second || first.elementId === second.elementId && JSON.stringify(first.node) === JSON.stringify(second.node)) return [];
    return [{ ...connection, first, second }];
  });
  const edit = topologyEditForReferenceDestinations(nextElements, topologySources, topologyDestinations, "Path segment was removed while rebuilding the cut component");
  return replaceTopology({ ...document, connections }, edit);
};

export const cutLineAtPoint = (lineId: ElementId, point: PointMm): EditorCommand => ({ name: `cut-line-at:${lineId}`, apply: (document) => cutStraightComponent(document, lineId, 0, point) });
export const cutPathSegment = (pathId: ElementId, segmentIndex: number, point?: PointMm): EditorCommand => ({ name: `cut-segment:${pathId}:${segmentIndex}`, apply: (document) => {
  const path = pathAt(document, pathId); const segment = path?.segments[segmentIndex];
  const hasCubic = path?.segments.some((candidate) => candidate.type === "cubicBezier") ?? false;
  // Open mixed paths retain untouched Bézier segments and may become pieces.
  // Closed mixed paths use the planar graph, where cubic edges are atomic and
  // connect only through their exact endpoints.
  if (path && hasCubic && !path.closed) {
    if (!segment || segment.type !== "line") return { success: false, error: "Only open straight path segments can be cut beside Bézier geometry" };
    const ranges = [[0, segmentIndex], [segmentIndex + 1, path.segments.length]] as const;
    const usedElementIds = new Set(document.elements.filter((element) => element.id !== path.id).map((element) => element.id));
    const pieceId = (index: number): ElementId => {
      if (index === 0) return path.id;
      const base = `${path.id}:piece:${index}`; let candidate = base; let suffix = 1;
      while (usedElementIds.has(elementId(candidate))) candidate = `${base}:${suffix++}`;
      const id = elementId(candidate); usedElementIds.add(id); return id;
    };
    const pieces = ranges.filter(([start, end]) => end > start).map(([start, end], index): PathElement => {
      const segments = path.segments.slice(start, end); const used = new Set(segments.flatMap((candidate) => [candidate.startNodeId, candidate.endNodeId]));
      return { ...path, id: pieceId(index), nodes: path.nodes.filter((node) => used.has(node.id)), segments, closed: false };
    });
    const sources = path.segments.map((candidate) => pathSegmentReference(path.id, candidate.id));
    const destinations = new Map<string, readonly TopologyReference[]>();
    for (const piece of pieces) for (const candidate of piece.segments) {
      const source = pathSegmentReference(path.id, candidate.id);
      destinations.set(topologyReferenceKey(source), [pathSegmentReference(piece.id, candidate.id)]);
    }
    const elements = document.elements.flatMap<Element>((element) => element.id === path.id ? pieces : [element]);
    const remapConnectionReference = (reference: ExplicitConnection["first"]): ExplicitConnection["first"] | undefined => {
      if (reference.elementId !== path.id || reference.node.kind !== "path") return reference;
      const address = reference.node;
      const piece = pieces.find((candidate) => candidate.nodes.some((node) => node.id === address.nodeId) && (address.handle === undefined || candidate.segments.some((candidateSegment) => candidateSegment.type === "cubicBezier" && (address.handle === "in" ? candidateSegment.endNodeId : candidateSegment.startNodeId) === address.nodeId)));
      return piece ? { ...reference, elementId: piece.id } : undefined;
    };
    const connections = (document.connections ?? []).flatMap((connection) => {
      const first = remapConnectionReference(connection.first); const second = remapConnectionReference(connection.second);
      return first && second ? [{ ...connection, first, second }] : [];
    });
    const edit = topologyEditForReferenceDestinations(elements, sources, destinations, "Path segment was cut");
    const remappedElements = remapPathDimensionElements(elements, path, pieces, edit.referenceMap);
    return replaceTopology({ ...document, connections }, { ...edit, elements: remappedElements });
  }
  return cutStraightComponent(document, pathId, segmentIndex, point);
} });

export const splitPathSegment = (pathId: ElementId, segmentIndex: number, newNodeId = `path-node-${crypto.randomUUID()}`): EditorCommand => ({ name: `path-split:${pathId}:${segmentIndex}`, apply: (document) => {
  const path = pathAt(document, pathId); const segment = path?.segments[segmentIndex];
  if (!path || !segment || path.nodes.some((node) => node.id === newNodeId)) return { success: false, error: "Path segment or node is invalid" };
  const start = path.nodes.find((node) => node.id === segment.startNodeId); const end = path.nodes.find((node) => node.id === segment.endNodeId);
  if (!start || !end) return { success: false, error: "Path segment nodes are invalid" };
  const lerp = (a: PointMm, b: PointMm): PointMm => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const nodes = [...path.nodes];
  const endIndex = path.nodes.findIndex((node) => node.id === segment.endNodeId);
  if (endIndex < 0) return { success: false, error: "Path segment end node is invalid" };
  let inserted: PathElement["segments"];
  if (segment.type === "cubicBezier") {
    const a = lerp(start.anchor, segment.control1); const b = lerp(segment.control1, segment.control2); const c = lerp(segment.control2, end.anchor); const d = lerp(a, b); const e = lerp(b, c); const midpoint = lerp(d, e);
    nodes.splice(endIndex, 0, { id: newNodeId, anchor: midpoint, join: "corner" });
    inserted = [{ id: pathSegmentId(), type: "cubicBezier", startNodeId: segment.startNodeId, endNodeId: newNodeId, control1: a, control2: d }, { id: pathSegmentId(), type: "cubicBezier", startNodeId: newNodeId, endNodeId: segment.endNodeId, control1: e, control2: c }];
  } else {
    nodes.splice(endIndex, 0, { id: newNodeId, anchor: { x: (start.anchor.x + end.anchor.x) / 2, y: (start.anchor.y + end.anchor.y) / 2 }, join: "corner" });
    inserted = [{ id: pathSegmentId(), type: "line", startNodeId: segment.startNodeId, endNodeId: newNodeId }, { id: pathSegmentId(), type: "line", startNodeId: newNodeId, endNodeId: segment.endNodeId }];
  }
  const segments = [...path.segments]; segments.splice(segmentIndex, 1, ...inserted);
  const nextPath = { ...path, nodes, segments };
  const elements = document.elements.map((element) => element.id === path.id ? nextPath : element);
  const edit = topologyEditForPathSegmentReplacement(elements, path.id, segment.id, inserted);
  return replaceTopology(document, { ...edit, elements: remapPathDimensionElements(elements, path, [nextPath], edit.referenceMap) });
} });
const DEFAULT_CLOSED_FILL = "rgba(101,217,255,0.22)";
export const closePath = (pathId: ElementId): EditorCommand => ({ name: `path-close:${pathId}`, apply: (document) => { const path = pathAt(document, pathId); if (!path || path.closed) return { success: false, error: "Path is already closed" }; const first = path.nodes[0]!; const last = path.nodes.at(-1)!; const nextPath = { ...path, style: { ...path.style, fill: path.style.fill ?? DEFAULT_CLOSED_FILL }, closed: true, segments: [...path.segments, { id: pathSegmentId(), type: "line" as const, startNodeId: last.id, endNodeId: first.id }] }; const sources = path.segments.map((segment) => pathSegmentReference(path.id, segment.id)); const destinations = new Map(sources.map((source) => [topologyReferenceKey(source), [source]] as const)); return replaceTopology(document, topologyEditForReferenceDestinations(document.elements.map((element) => element.id === path.id ? nextPath : element), sources, destinations, "Path segment was removed")); } });
export const openPath = (pathId: ElementId): EditorCommand => ({ name: `path-open:${pathId}`, apply: (document) => {
  const path = pathAt(document, pathId); const removedSegment = path?.closed ? path.segments.at(-1) : undefined;
  if (!path || !removedSegment) return { success: false, error: "Path is already open" };
  const nextPath: PathElement = { ...path, closed: false, segments: path.segments.slice(0, -1) };
  const sources = path.segments.map((segment) => pathSegmentReference(path.id, segment.id));
  const destinations = new Map(nextPath.segments.map((segment) => { const reference = pathSegmentReference(path.id, segment.id); return [topologyReferenceKey(reference), [reference]] as const; }));
  const baseElements = document.elements.map((element) => element.id === path.id ? nextPath : element);
  const edit = topologyEditForReferenceDestinations(baseElements, sources, destinations, "Closing path segment was removed");
  const supportsAddress = (address: ConnectableNodeAddress): boolean => "nodeId" in address && nextPath.nodes.some((node) => node.id === address.nodeId) && (address.handle === undefined || nextPath.segments.some((segment) => segment.type === "cubicBezier" && (address.handle === "in" ? segment.endNodeId : segment.startNodeId) === address.nodeId));
  const remapConnectionReference = (reference: ExplicitConnection["first"]): ExplicitConnection["first"] | undefined => reference.elementId === path.id && reference.node.kind === "path" && !supportsAddress(reference.node) ? undefined : reference;
  const connections = (document.connections ?? []).flatMap((connection) => {
    const first = remapConnectionReference(connection.first); const second = remapConnectionReference(connection.second);
    return first && second ? [{ ...connection, first, second }] : [];
  });
  return replaceTopology({ ...document, connections }, { ...edit, elements: remapPathDimensionElements(baseElements, path, [nextPath], edit.referenceMap) });
} });
export const reversePath = (pathId: ElementId): EditorCommand => ({ name: `path-reverse:${pathId}`, apply: (document) => {
  const path = pathAt(document, pathId);
  if (!path) return { success: false, error: "Path not found" };
  const nodes = [...path.nodes].reverse();
  const segments = [...path.segments].reverse().map((segment) => segment.type === "line"
    ? { ...segment, startNodeId: segment.endNodeId, endNodeId: segment.startNodeId }
    : { ...segment, startNodeId: segment.endNodeId, endNodeId: segment.startNodeId, control1: segment.control2, control2: segment.control1 });
  const nextPath = { ...path, nodes, segments };
  const sources = path.segments.map((segment) => pathSegmentReference(path.id, segment.id));
  const elements = document.elements.map((element) => element.id === path.id ? nextPath : element);
  const referenceMap = new Map(sources.map((source) => [topologyReferenceKey(source), { kind: "preserved", reference: source } as ReferenceResolution]));
  const remapConnectionReference = (reference: ExplicitConnection["first"]): ExplicitConnection["first"] => {
    if (reference.elementId !== path.id || reference.node.kind !== "path" || reference.node.handle === undefined) return reference;
    return { ...reference, node: { ...reference.node, handle: reference.node.handle === "in" ? "out" : "in" } };
  };
  const connections = (document.connections ?? []).map((connection) => ({ ...connection, first: remapConnectionReference(connection.first), second: remapConnectionReference(connection.second) }));
  return replaceTopology({ ...document, connections }, { elements: remapPathDimensionElements(elements, path, [nextPath], referenceMap), referenceMap, diagnostics: [] });
} });

const lineControls = (start: PointMm, end: PointMm): { readonly control1: PointMm; readonly control2: PointMm } => ({
  control1: { x: start.x + (end.x - start.x) / 3, y: start.y + (end.y - start.y) / 3 },
  control2: { x: start.x + (end.x - start.x) * 2 / 3, y: start.y + (end.y - start.y) * 2 / 3 },
});

/** Removes path anchors while rebuilding only the segments made adjacent by the removal. */
export const deletePathNodes = (pathId: ElementId, nodeIds: readonly string[]): EditorCommand => ({
  name: `path-node-delete:${pathId}:${[...nodeIds].join(",")}`,
  apply: (document) => {
    const path = pathAt(document, pathId);
    if (!path) return { success: false, error: "Path not found" };
    const requested = [...new Set(nodeIds)];
    if (!requested.length || requested.some((id) => !path.nodes.some((node) => node.id === id))) return { success: false, error: "Path node not found" };
    const minimum = path.closed ? 3 : 2;
    if (path.nodes.length - requested.length < minimum) return { success: false, error: `A ${path.closed ? "closed" : "open"} path must keep at least ${minimum} nodes` };

    const removed = new Set(requested);
    const nodes = path.nodes.filter((node) => !removed.has(node.id));
    const originalSegment = (startIndex: number, endIndex: number) => {
      const indexes: number[] = [];
      let index = startIndex;
      do {
        indexes.push(index);
        index = (index + 1) % path.nodes.length;
      } while (index !== endIndex);
      return indexes.map((segmentIndex) => path.segments[segmentIndex]).filter((segment): segment is NonNullable<typeof segment> => segment !== undefined);
    };
    const rebuilt = nodes.slice(0, -1).map((node, index) => {
      const end = nodes[index + 1]!;
      const startIndex = path.nodes.findIndex((candidate) => candidate.id === node.id);
      const endIndex = path.nodes.findIndex((candidate) => candidate.id === end.id);
      const source = originalSegment(startIndex, endIndex);
      return { segment: rebuildPathSegment(node, end, source), source };
    });
    if (path.closed) {
      const first = nodes[0]!;
      const last = nodes.at(-1)!;
      const startIndex = path.nodes.findIndex((candidate) => candidate.id === last.id);
      const endIndex = path.nodes.findIndex((candidate) => candidate.id === first.id);
      const source = originalSegment(startIndex, endIndex);
      rebuilt.push({ segment: rebuildPathSegment(last, first, source), source });
    }
    const segments = rebuilt.map(({ segment }) => segment); const destinations = new Map<string, readonly TopologyReference[]>();
    for (const { segment, source } of rebuilt) for (const original of source) {
      const reference = pathSegmentReference(path.id, original.id); const key = topologyReferenceKey(reference);
      destinations.set(key, [...(destinations.get(key) ?? []), pathSegmentReference(path.id, segment.id)]);
    }
    const nextPath = { ...path, nodes, segments };
    const elements = document.elements.map((element) => element.id === path.id ? nextPath : element);
    const sources = path.segments.map((segment) => pathSegmentReference(path.id, segment.id));
    const remapConnectionReference = (reference: ExplicitConnection["first"]): ExplicitConnection["first"] | undefined => {
      if (reference.elementId !== path.id || reference.node.kind !== "path") return reference;
      const address = reference.node;
      if (removed.has(address.nodeId)) return undefined;
      if (address.handle) {
        const hasHandle = segments.some((segment) => segment.type === "cubicBezier" && (address.handle === "in" ? segment.endNodeId : segment.startNodeId) === address.nodeId);
        if (!hasHandle) return undefined;
      }
      return reference;
    };
    const connections = (document.connections ?? []).flatMap((connection) => {
      const first = remapConnectionReference(connection.first); const second = remapConnectionReference(connection.second);
      return first && second ? [{ ...connection, first, second }] : [];
    });
    const edit = topologyEditForReferenceDestinations(elements, sources, destinations, "Path segment lost its endpoint");
    const remappedElements = remapPathDimensionElements(elements, path, [nextPath], edit.referenceMap);
    return replaceTopology({ ...document, connections }, { ...edit, elements: remappedElements });
  },
});

function rebuildPathSegment(start: PathElement["nodes"][number], end: PathElement["nodes"][number], source: readonly PathElement["segments"][number][]): PathElement["segments"][number] {
  const firstSegment = source[0];
  const lastSegment = source.at(-1);
  const firstCubic = firstSegment?.type === "cubicBezier" ? firstSegment : undefined;
  const lastCubic = lastSegment?.type === "cubicBezier" ? lastSegment : undefined;
  const preservedId = source.length === 1 && firstSegment?.startNodeId === start.id && firstSegment.endNodeId === end.id ? firstSegment.id : pathSegmentId();
  if (!firstCubic && !lastCubic) return { id: preservedId, type: "line", startNodeId: start.id, endNodeId: end.id };
  const fallback = lineControls(start.anchor, end.anchor);
  return {
    id: preservedId,
    type: "cubicBezier",
    startNodeId: start.id,
    endNodeId: end.id,
    control1: firstCubic?.control1 ?? fallback.control1,
    control2: lastCubic?.control2 ?? fallback.control2,
  };
}

export const updateContourNode = (id: ElementId, address: ContourNodeAddress, point: PointMm): EditorCommand => ({
  name: `contour-node:${id}:${address.ringIndex}:${address.pointIndex}`,
  apply: (document) => {
    if (![point.x, point.y].every(Number.isFinite)) return { success: false, error: "Contour node coordinates must be finite" };
    const current = document.elements.find((element) => element.id === id);
    if (!current) return { success: false, error: `Element not found: ${id}` };
    if (current.type !== "contour") return { success: false, error: "Contour node updates require a contour" };
    const ring = current.contours[address.ringIndex];
    if (!ring || !ring.points[address.pointIndex]) return { success: false, error: "Contour node not found" };
    const points = current.contours.map((candidate, ringIndex) => candidate.points.map((candidatePoint, pointIndex) => {
      const isAddress = ringIndex === address.ringIndex && pointIndex === address.pointIndex;
      const closesRing = ringIndex === address.ringIndex && address.pointIndex === 0 && pointIndex === candidate.points.length - 1 && candidate.points.at(-1)?.x === candidate.points[0]?.x && candidate.points.at(-1)?.y === candidate.points[0]?.y;
      return isAddress || closesRing ? point : candidatePoint;
    }));
    return replaceElements(document, document.elements.map((element) => element.id === id && element.type === "contour" ? contourWithPoints(element, points) : element));
  },
});

export const insertContourNode = (id: ElementId, address: ContourSegmentAddress, point: PointMm): EditorCommand => ({
  name: `contour-node-insert:${id}:${address.ringIndex}:${address.segmentIndex}`,
  apply: (document) => {
    if (![point.x, point.y].every(Number.isFinite)) return { success: false, error: "Contour node coordinates must be finite" };
    const current = document.elements.find((element) => element.id === id);
    if (!current) return { success: false, error: `Element not found: ${id}` };
    if (current.type !== "contour") return { success: false, error: "Contour node insertion requires a contour" };
    const ring = current.contours[address.ringIndex];
    if (!ring) return { success: false, error: "Contour segment ring not found" };
    const closing = ring.points.length > 1 && ring.points.at(-1)?.x === ring.points[0]?.x && ring.points.at(-1)?.y === ring.points[0]?.y;
    const vertexCount = closing ? ring.points.length - 1 : ring.points.length;
    if (!Number.isInteger(address.segmentIndex) || address.segmentIndex < 0 || address.segmentIndex >= vertexCount) return { success: false, error: "Contour segment not found" };
    const insertIndex = address.segmentIndex + 1;
    const points = current.contours.map((candidate, ringIndex) => ringIndex === address.ringIndex ? [...candidate.points.slice(0, insertIndex), point, ...candidate.points.slice(insertIndex)] : candidate.points);
    return replaceElements(document, document.elements.map((element) => element.id === id && element.type === "contour" ? contourWithPoints(element, points) : element));
  },
});

export const insertFormaNode = (id: ElementId, address: ContourSegmentAddress, point: PointMm): EditorCommand => ({
  name: `forma-node-insert:${id}:${address.segmentIndex}`,
  apply: (document) => {
    const current = document.elements.find((element) => element.id === id);
    if (!current) return { success: false, error: `Element not found: ${id}` };
    if (current.type === "contour") return insertContourNode(id, address, point).apply(document);
    const contour = elementToContour(current);
    const inserted = insertContourNode(id, address, point).apply({ ...document, elements: document.elements.map((element) => element.id === id ? contour : element) });
    return inserted.success ? inserted : { success: false, error: inserted.error };
  },
});

const sketchConstraintForDimension = (dimension: DimensionElement, sketch: SketchElement, elements: readonly Element[], value?: number): SketchConstraint | undefined => {
  const measuredValue = value ?? dimensionGeometry(dimension, elements)?.value;
  if (!Number.isFinite(measuredValue) || measuredValue === undefined || measuredValue <= 0) return undefined;
  const constraintId = dimension.constraintId ?? `dimension:${dimension.id}`;
  const first = dimension.references[0]; const second = dimension.references[1];
  if (first.elementId !== sketch.id || second.elementId !== sketch.id) return undefined;
  if (dimension.kind === "aligned" || dimension.kind === "horizontal" || dimension.kind === "vertical") {
    if (!("kind" in first) || !("kind" in second) || first.kind !== "node" || second.kind !== "node" || !first.nodeId || !second.nodeId) return undefined;
    const kind = dimension.kind === "aligned" ? "distance" : dimension.kind === "horizontal" ? "distance-horizontal" : "distance-vertical";
    return { id: constraintId, kind, references: [{ elementId: sketch.id, nodeId: first.nodeId }, { elementId: sketch.id, nodeId: second.nodeId }], value: measuredValue };
  }
  if (dimension.kind === "angular") {
    if (!("kind" in first) || !("kind" in second) || first.kind !== "line" || second.kind !== "line") return undefined;
    const firstEdgeIndex = sketchEdgeIndexAtAddress(sketch, first); const secondEdgeIndex = sketchEdgeIndexAtAddress(sketch, second);
    if (firstEdgeIndex === undefined || firstEdgeIndex !== secondEdgeIndex) return undefined;
    const edge = sketch.edges[firstEdgeIndex];
    if (!edge) return undefined;
    return { id: constraintId, kind: "angle", references: [{ elementId: sketch.id, nodeId: edge.startNodeId }, { elementId: sketch.id, nodeId: edge.endNodeId }], value: measuredValue };
  }
  return undefined;
};

export const updateDimensionValue = (dimensionId: ElementId, value: number): EditorCommand => ({
  name: `dimension-value:${dimensionId}`,
  apply: (document) => {
    if (!Number.isFinite(value) || value <= 0) return { success: false, error: "Dimension value must be positive" };
    const dimension = document.elements.find((element): element is DimensionElement => element.id === dimensionId && element.type === "dimension");
    if (!dimension) return { success: false, error: "Dimension not found" };
    const targetId = dimension.references[0].elementId;
    const target = document.elements.find((element) => element.id === targetId);
    // A cross-object dimension drives the second referenced node while the
    // first reference remains the datum. This makes the relation useful and
    // deterministic without guessing which object the user intended to fix.
    if (dimension.references[1].elementId !== targetId && dimension.kind !== "angular") {
      if (dimension.driving === true) return { success: false, error: "Driving dimensions require one referenced element" };
      const first = dimension.references[0]; const second = dimension.references[1];
      if (!("kind" in first) || !("kind" in second) || first.kind !== "node" || second.kind !== "node") return { success: true, document };
      if (!target) return { success: false, error: "First dimension reference element not found" };
      const firstNodes = realGeometryNodes(target);
      const secondElement = document.elements.find((element) => element.id === second.elementId);
      if (!secondElement) return { success: false, error: "Second dimension reference element not found" };
      const secondNodes = realGeometryNodes(secondElement);
      const firstNode = first.nodeId ? firstNodes.find((node) => node.nodeId === first.nodeId) : firstNodes[first.nodeIndex];
      const secondNode = second.nodeId ? secondNodes.find((node) => node.nodeId === second.nodeId) : secondNodes[second.nodeIndex];
      if (!firstNode || !secondNode) return { success: false, error: "Cross-object dimension references are invalid" };
      const dx = secondNode.point.x - firstNode.point.x; const dy = secondNode.point.y - firstNode.point.y; const length = Math.hypot(dx, dy);
      if (length <= 1e-9) return { success: false, error: "Cannot dimension coincident cross-object nodes" };
      const point = dimension.kind === "aligned" ? { x: firstNode.point.x + dx * value / length, y: firstNode.point.y + dy * value / length } : dimension.kind === "horizontal" ? { x: firstNode.point.x + Math.sign(dx || 1) * value, y: secondNode.point.y } : dimension.kind === "vertical" ? { x: secondNode.point.x, y: firstNode.point.y + Math.sign(dy || 1) * value } : undefined;
      return point ? updateElementNode(second.elementId, second.nodeIndex, point).apply(document) : { success: true, document }; 
    }
    if ((dimension.kind === "radius" || dimension.kind === "diameter") && dimension.driving !== true) return { success: false, error: "Only driving circular dimensions can change a circle" };
        if (dimension.kind === "radius" || dimension.kind === "diameter") {
      if (target?.type !== "ellipse" || target.size.width !== target.size.height) return { success: false, error: "Circular driving dimensions require a circle" };
      const first = dimension.references[0]; const second = dimension.references[1];
      if (!("kind" in first) || !("kind" in second) || first.kind !== "node" || second.kind !== "node" || !first.nodeId || !second.nodeId || ![first.nodeId, second.nodeId].includes("center") || first.nodeId === second.nodeId) return { success: false, error: "Radius driving references require center and rim nodes" };
      const circleConstraint = dimension.driving && dimension.constraintId ? target.circleConstraints?.find((candidate) => candidate.id === dimension.constraintId) : undefined;
      if (dimension.driving && (!circleConstraint || (dimension.kind === "radius" ? circleConstraint.kind !== "radius" : circleConstraint.kind !== "diameter"))) return { success: false, error: "Driving radius dimension does not match a circle size constraint" };
      const rimId = first.nodeId === "center" ? second.nodeId : first.nodeId;
      const center = elementCenter(target); const rim = realGeometryNodes(target).find((node) => node.nodeId === rimId)?.point;
      if (!rim) return { success: false, error: "Radius driving rim reference is invalid" };
      const currentRadius = Math.hypot(rim.x - center.x, rim.y - center.y);
      if (!Number.isFinite(currentRadius) || currentRadius <= 0) return { success: false, error: "Radius driving circle is degenerate" };
      const radius = dimension.kind === "diameter" ? value / 2 : value;
          const position = { x: center.x - radius, y: center.y - radius };
      const updatedConstraints = circleConstraint ? target.circleConstraints?.map((candidate) => candidate.id === circleConstraint.id ? { ...candidate, value } : candidate) : target.circleConstraints;
      const updated = { ...target, position, size: { width: radius * 2, height: radius * 2 }, ...(updatedConstraints ? { circleConstraints: updatedConstraints } : {}) };
      return replaceElements(document, document.elements.map((element) => element.id === target.id ? updated : element));
    }
    if (target?.type === "line") {
      const first = dimension.references[0]; const second = dimension.references[1];
      if (dimension.kind === "angular") {
        if (!("kind" in first) || !("kind" in second) || first.kind !== "line" || second.kind !== "line") return { success: false, error: "Line angle dimensions require line references" };
        const firstLine = document.elements.find((element): element is LineElement => element.id === first.elementId && element.type === "line");
        const secondLine = document.elements.find((element): element is LineElement => element.id === second.elementId && element.type === "line");
        if (!firstLine || !secondLine) return { success: false, error: "Driving angular dimensions currently require native lines" };
        if (firstLine.id === secondLine.id) {
          if (first.elementId !== target.id || second.elementId !== target.id) return { success: false, error: "Line angle dimension references are invalid" };
          const dx = target.end.x - target.start.x; const dy = target.end.y - target.start.y; const length = Math.hypot(dx, dy);
          if (length <= 1e-9) return { success: false, error: "Cannot dimension a zero-length line" };
          const currentAngle = Math.atan2(dy, dx); const sign = currentAngle < 0 ? -1 : 1; const angle = sign * value * Math.PI / 180;
          const end = { x: target.start.x + length * Math.cos(angle), y: target.start.y + length * Math.sin(angle) };
          return replaceElements(document, document.elements.map((element) => element.id === target.id && element.type === "line" ? { ...element, end } : element));
        }
        const firstEndpoints = [firstLine.start, firstLine.end] as const; const secondEndpoints = [secondLine.start, secondLine.end] as const;
        let vertex: PointMm | undefined; let firstOther: PointMm | undefined; let secondOther: PointMm | undefined;
        for (const candidate of firstEndpoints) for (const other of secondEndpoints) if (Math.hypot(candidate.x - other.x, candidate.y - other.y) <= 1e-6) {
          vertex = candidate;
          firstOther = candidate === firstLine.start ? firstLine.end : firstLine.start;
          secondOther = other === secondLine.start ? secondLine.end : secondLine.start;
        }
        if (!vertex || !firstOther || !secondOther) return { success: false, error: "Angular dimension lines must share an endpoint" };
        const firstVector = { x: firstOther.x - vertex.x, y: firstOther.y - vertex.y }; const secondVector = { x: secondOther.x - vertex.x, y: secondOther.y - vertex.y };
        const firstLength = Math.hypot(firstVector.x, firstVector.y); const secondLength = Math.hypot(secondVector.x, secondVector.y);
        if (firstLength <= 1e-9 || secondLength <= 1e-9) return { success: false, error: "Cannot dimension a zero-length line" };
        const cross = firstVector.x * secondVector.y - firstVector.y * secondVector.x; const sign = cross < 0 ? -1 : 1;
        const baseAngle = Math.atan2(firstVector.y, firstVector.x); const angle = baseAngle + sign * value * Math.PI / 180;
        const updatedOther = { x: vertex.x + secondLength * Math.cos(angle), y: vertex.y + secondLength * Math.sin(angle) };
        const updatedSecond = secondLine.start.x === vertex.x && secondLine.start.y === vertex.y ? { ...secondLine, end: updatedOther } : { ...secondLine, start: updatedOther };
        return replaceElements(document, document.elements.map((element) => element.id === secondLine.id ? updatedSecond : element));
      }
      if (!("kind" in first) || !("kind" in second) || first.kind !== "node" || second.kind !== "node") return { success: false, error: "Line driving dimensions require node references" };
      const nodes = realGeometryNodes(target);
      const firstNode = first.nodeId ? nodes.find((node) => node.nodeId === first.nodeId) : nodes[first.nodeIndex];
      const secondNode = second.nodeId ? nodes.find((node) => node.nodeId === second.nodeId) : nodes[second.nodeIndex];
      if (!firstNode || !secondNode || firstNode.nodeId === secondNode.nodeId || firstNode.kind !== "endpoint" || secondNode.kind !== "endpoint") return { success: false, error: "Line driving dimension references are invalid" };
      const dx = secondNode.point.x - firstNode.point.x; const dy = secondNode.point.y - firstNode.point.y;
      const currentLength = Math.hypot(dx, dy);
      if (!Number.isFinite(currentLength) || currentLength <= 1e-9) return { success: false, error: "Cannot dimension a zero-length line" };
      let end: PointMm;
      if (dimension.kind === "aligned") {
        end = { x: firstNode.point.x + dx * value / currentLength, y: firstNode.point.y + dy * value / currentLength };
      } else if (dimension.kind === "horizontal") {
        end = { x: firstNode.point.x + Math.sign(dx || 1) * value, y: secondNode.point.y };
      } else if (dimension.kind === "vertical") {
        end = { x: secondNode.point.x, y: firstNode.point.y + Math.sign(dy || 1) * value };
      } else return { success: false, error: "Unsupported line dimension kind" };
      const updated = secondNode.nodeId === "start" ? { ...target, start: end } : { ...target, end };
      return replaceElements(document, document.elements.map((element) => element.id === target.id ? updated : element));
    }
    if (dimension.kind !== "aligned" && dimension.kind !== "horizontal" && dimension.kind !== "vertical" && target?.type !== "sketch") return { success: false, error: "This dimension kind cannot drive the referenced geometry" };
    if (target?.type === "path") {
      const first = dimension.references[0]; const second = dimension.references[1];
      if (!("kind" in first) || !("kind" in second) || first.kind !== "node" || second.kind !== "node") return { success: false, error: "Path driving dimensions require node references" };
      const firstNode = target.nodes.find((node, index) => node.id === first.nodeId || (!first.nodeId && first.nodeIndex === index));
      const secondNode = target.nodes.find((node, index) => node.id === second.nodeId || (!second.nodeId && second.nodeIndex === index));
      if (!firstNode || !secondNode || firstNode.id === secondNode.id) return { success: false, error: "Path driving dimension references are invalid" };
      const dx = secondNode.anchor.x - firstNode.anchor.x; const dy = secondNode.anchor.y - firstNode.anchor.y;
      const currentLength = Math.hypot(dx, dy);
      if (currentLength <= 1e-9) return { success: false, error: "Cannot dimension a zero-length path segment" };
      const horizontal = dimension.kind === "horizontal";
      const vertical = dimension.kind === "vertical";
      const direction = (horizontal ? dx : vertical ? dy : currentLength) < 0 ? -1 : 1;
      const anchor = dimension.kind === "aligned"
        ? { x: firstNode.anchor.x + dx * value / currentLength, y: firstNode.anchor.y + dy * value / currentLength }
        : horizontal ? { x: firstNode.anchor.x + direction * value, y: secondNode.anchor.y }
          : { x: secondNode.anchor.x, y: firstNode.anchor.y + direction * value };
      const next = { ...target, nodes: target.nodes.map((node) => node.id === secondNode.id ? { ...node, anchor } : node) };
      return replaceElements(document, document.elements.map((element) => element.id === target.id ? next : element));
    }
    if (target?.type === "sketch") {
      if (dimension.kind === "angular" && dimension.driving !== true && ("kind" in dimension.references[0]) && ("kind" in dimension.references[1]) && dimension.references[0].kind === "line" && dimension.references[1].kind === "line") {
        const lineData = (reference: Extract<DimensionElement["references"][number], { kind: "line" }>) => {
          const element = document.elements.find((candidate) => candidate.id === reference.elementId);
          if (element?.type === "line") return { element, referenceKey: element.id, start: element.start, end: element.end, startNodeId: "start", endNodeId: "end" };
          if (element?.type !== "sketch") return undefined;
          const edge = sketchEdgeAtAddress(element, reference); const nodes = new Map(element.nodes.map((node) => [node.id, node.point]));
          const start = edge ? nodes.get(edge.startNodeId) : undefined; const end = edge ? nodes.get(edge.endNodeId) : undefined;
          return edge && start && end ? { element, referenceKey: `${element.id}:${edge.id}`, start, end, startNodeId: edge.startNodeId, endNodeId: edge.endNodeId } : undefined;
        };
        const firstLine = lineData(dimension.references[0]); const secondLine = lineData(dimension.references[1]);
        if (!firstLine || !secondLine) return { success: false, error: "Angular dimension lines are invalid" };
        const sameReference = firstLine.referenceKey === secondLine.referenceKey;
        const vertex = sameReference ? firstLine.start : [firstLine.start, firstLine.end].find((candidate) => [secondLine.start, secondLine.end].some((other) => Math.hypot(candidate.x - other.x, candidate.y - other.y) <= 1e-6));
        if (!vertex) return { success: false, error: "Angular dimension lines must share an endpoint" };
        const firstOther = sameReference ? firstLine.end : Math.hypot(vertex.x - firstLine.start.x, vertex.y - firstLine.start.y) <= 1e-6 ? firstLine.end : firstLine.start;
        const secondOther = sameReference ? secondLine.end : Math.hypot(vertex.x - secondLine.start.x, vertex.y - secondLine.start.y) <= 1e-6 ? secondLine.end : secondLine.start;
        const secondLength = Math.hypot(secondOther.x - vertex.x, secondOther.y - vertex.y);
        if (secondLength <= 1e-9) return { success: false, error: "Cannot dimension a zero-length sketch edge" };
        const baseAngle = sameReference ? 0 : Math.atan2(firstOther.y - vertex.y, firstOther.x - vertex.x);
        const currentCross = (firstOther.x - vertex.x) * (secondOther.y - vertex.y) - (firstOther.y - vertex.y) * (secondOther.x - vertex.x);
        const angle = baseAngle + (sameReference ? value * Math.PI / 180 : (currentCross < 0 ? -1 : 1) * value * Math.PI / 180);
        const updatedPoint = { x: vertex.x + secondLength * Math.cos(angle), y: vertex.y + secondLength * Math.sin(angle) };
        const secondIsStart = Math.hypot(secondLine.start.x - vertex.x, secondLine.start.y - vertex.y) <= 1e-6;
        const elements = document.elements.map((element) => {
          if (element.id !== secondLine.element.id) return element;
          if (element.type === "line") return { ...element, ...(secondIsStart ? { end: updatedPoint } : { start: updatedPoint }) };
          if (element.type !== "sketch") return element;
          const nodeId = secondIsStart ? secondLine.endNodeId : secondLine.startNodeId;
          const relationNodeIds = new Set([firstLine.startNodeId, firstLine.endNodeId, secondLine.startNodeId, secondLine.endNodeId]);
          const secondNodeIds = new Set([secondLine.startNodeId, secondLine.endNodeId]);
          const constraints = element.constraints?.filter((constraint) => {
            if (!constraint.id.startsWith("auto:") || !["horizontal", "vertical", "perpendicular"].includes(constraint.kind)) return true;
            const references = constraint.references.map((reference) => reference.nodeId);
            const constrainsSecond = references.length === 2 && references.every((nodeId) => secondNodeIds.has(nodeId));
            const constrainsPair = references.length === 4 && references.every((nodeId) => relationNodeIds.has(nodeId));
            return !constrainsSecond && !constrainsPair;
          });
          return { ...element, nodes: element.nodes.map((node) => node.id === nodeId ? { ...node, point: updatedPoint } : node), ...(constraints ? { constraints } : {}) };
        });
        const solvedElements = elements.map((element) => {
          if (element.type !== "sketch" || (element.id !== firstLine.element.id && element.id !== secondLine.element.id)) return element;
          const solved = solveSketchConstraints(element);
          return solved.status === "conflict" || solved.status === "overdefined" ? undefined : solved.sketch;
        });
        if (solvedElements.some((element) => element === undefined)) return { success: false, error: "Sketch constraints are in conflict" };
        return replaceElements(document, solvedElements as Element[]);
      }
      if (dimension.driving && dimension.constraintId) {
        const nextConstraint = sketchConstraintForDimension(dimension, target, document.elements, value);
        const constraint = target.constraints?.find((candidate) => candidate.id === dimension.constraintId);
        if (!constraint || !nextConstraint || constraint.kind !== nextConstraint.kind) return { success: false, error: "Driving dimension constraint does not match its references" };
        const constraintReferenceIds = constraint.references.map((reference) => `${reference.elementId}:${reference.nodeId}`).sort();
        const dimensionReferenceIds = nextConstraint.references.map((reference) => `${reference.elementId}:${reference.nodeId}`).sort();
        const matches = constraintReferenceIds.length === dimensionReferenceIds.length && constraintReferenceIds.every((reference, index) => reference === dimensionReferenceIds[index]);
        if (!matches) return { success: false, error: "Driving dimension constraint does not match its references" };
        const solved = solveSketchConstraints({ ...target, constraints: target.constraints!.map((candidate) => candidate.id === constraint.id ? nextConstraint : candidate) });
        if (solved.status === "conflict" || solved.status === "overdefined") return { success: false, error: `Sketch constraints are ${solved.status}` };
        return replaceElements(document, document.elements.map((element) => element.id === target.id ? solved.sketch : element));
      }
      const first = dimension.references[0]; const second = dimension.references[1];
      if (!("kind" in first) || !("kind" in second) || first.kind !== "node" || second.kind !== "node" || !first.nodeId || !second.nodeId) return { success: false, error: "Sketch driving dimensions require node references" };
      const firstNode = target.nodes.find((node) => node.id === first.nodeId);
      const secondNode = target.nodes.find((node) => node.id === second.nodeId);
      if (!firstNode || !secondNode || firstNode.id === secondNode.id) return { success: false, error: "Sketch driving dimension references are invalid" };
      const dx = secondNode.point.x - firstNode.point.x; const dy = secondNode.point.y - firstNode.point.y; const currentLength = Math.hypot(dx, dy);
      if (currentLength <= 1e-9) return { success: false, error: "Cannot dimension a zero-length sketch segment" };
      const direction = dimension.kind === "horizontal" ? Math.sign(dx || 1) : dimension.kind === "vertical" ? Math.sign(dy || 1) : 1;
      const point = dimension.kind === "aligned" ? { x: firstNode.point.x + dx * value / currentLength, y: firstNode.point.y + dy * value / currentLength } : dimension.kind === "horizontal" ? { x: firstNode.point.x + direction * value, y: secondNode.point.y } : { x: secondNode.point.x, y: firstNode.point.y + direction * value };
      const secondNodeIndex = target.nodes.findIndex((node) => node.id === secondNode.id);
      return updateElementNode(target.id, secondNodeIndex, point).apply(document);
    }
    if (!target || target.type !== "rectangle" || target.rotation !== 0) return { success: false, error: "Driving dimensions currently require an unrotated rectangle" };
    const center = { x: target.position.x + target.size.width / 2, y: target.position.y + target.size.height / 2 };
    const size = dimension.kind === "horizontal" ? { width: value, height: target.size.height } : { width: target.size.width, height: value };
    const position = { x: center.x - size.width / 2, y: center.y - size.height / 2 };
    return replaceElements(document, document.elements.map((element) => element.id === target.id && element.type === "rectangle" ? { ...element, position, size } : element));
  },
});

const validateSketchConstraint = (sketch: SketchElement, constraint: SketchConstraint): string | undefined => {
  if (!constraint.references.every((reference) => reference.elementId === sketch.id && sketch.nodes.some((node) => node.id === reference.nodeId))) return "Sketch constraint references are invalid";
  if ((constraint.kind === "parallel" || constraint.kind === "perpendicular" || constraint.kind === "equal") && constraint.references.length !== 4) return "This sketch relation requires two line references";
  if ((constraint.kind === "horizontal" || constraint.kind === "vertical" || constraint.kind === "coincident" || constraint.kind === "distance-horizontal" || constraint.kind === "distance-vertical" || constraint.kind === "distance" || constraint.kind === "angle") && constraint.references.length !== 2) return "This sketch constraint requires two references";
  if (constraint.kind === "fixed" && constraint.references.length !== 1) return "A fixed constraint requires one reference";
  if ((constraint.kind === "distance-horizontal" || constraint.kind === "distance-vertical" || constraint.kind === "distance" || constraint.kind === "angle") && (!Number.isFinite(constraint.value) || constraint.value === undefined || constraint.value <= 0)) return "Distance constraints require a positive value";
  return undefined;
};

const solveSketchCandidate = (document: DocumentSnapshot, sketch: SketchElement, constraints: readonly SketchConstraint[]): CommandResult => {
  const validationError = constraints.map((constraint) => validateSketchConstraint(sketch, constraint)).find((error): error is string => error !== undefined);
  if (validationError) return { success: false, error: validationError };
  const solved = solveSketchConstraints({ ...sketch, constraints });
  if (solved.status === "conflict" || solved.status === "overdefined") return { success: false, error: `Sketch constraints are ${solved.status}` };
  return replaceElements(document, document.elements.map((element) => element.id === sketch.id ? solved.sketch : element));
};

export const addSketchSegmentRelation = (constraint: SketchConstraint): EditorCommand => ({
  name: `sketch-segment-relation:${constraint.id}`,
  apply: (document) => {
    if (!(constraint.kind === "parallel" || constraint.kind === "perpendicular" || constraint.kind === "equal" || constraint.kind === "coincident") || constraint.references.length !== (constraint.kind === "coincident" ? 2 : 4)) return { success: false, error: "Relation requires valid sketch references" };
    const sourceIds = [...new Set(constraint.references.map((reference) => reference.elementId))];
    const sketches = sourceIds.map((sourceId) => document.elements.find((element): element is SketchElement => element.id === sourceId && element.type === "sketch"));
    if (sketches.some((sketch) => sketch === undefined)) return { success: false, error: "Segment relation sketches were not found" };
    const target = sketches[0]!;
    if (sourceIds.length === 1) return addSketchConstraint(target.id, { ...constraint, references: constraint.references.map((reference) => ({ elementId: target.id, nodeId: reference.nodeId })) as unknown as SketchConstraint["references"] }).apply(document);
    const remapNode = new Map<string, string>();
    const nodes = sketches.flatMap((sketch, sketchIndex) => sketch!.nodes.map((node) => {
      const nodeId = sketchIndex === 0 ? node.id : `${sketch!.id}:${node.id}`;
      remapNode.set(`${sketch!.id}:${node.id}`, nodeId);
      return { ...node, id: nodeId };
    }));
    const edges = sketches.flatMap((sketch, sketchIndex) => sketch!.edges.map((edge) => ({ id: sketchIndex === 0 ? edge.id : `${sketch!.id}:${edge.id}`, startNodeId: remapNode.get(`${sketch!.id}:${edge.startNodeId}`) ?? edge.startNodeId, endNodeId: remapNode.get(`${sketch!.id}:${edge.endNodeId}`) ?? edge.endNodeId })));
    const existingConstraints = sketches.flatMap((sketch, sketchIndex) => (sketch!.constraints ?? []).map((current) => ({ ...current, id: sketchIndex === 0 ? current.id : `${sketch!.id}:${current.id}`, references: current.references.map((reference) => ({ elementId: target.id, nodeId: remapNode.get(`${sketch!.id}:${reference.nodeId}`) ?? reference.nodeId })) as unknown as SketchConstraint["references"] })));
    const relation = { ...constraint, references: constraint.references.map((reference) => ({ elementId: target.id, nodeId: remapNode.get(`${reference.elementId}:${reference.nodeId}`) ?? reference.nodeId })) as unknown as SketchConstraint["references"] };
    const merged: SketchElement = { ...target, nodes, edges, constraints: [...existingConstraints, relation] };
    const solved = solveSketchConstraints(merged);
    if (solved.status === "conflict" || solved.status === "overdefined") return { success: false, error: `Sketch constraints are ${solved.status}` };
    const removed = new Set(sourceIds.slice(1));
    const remapElement = (element: Element): Element | undefined => {
      if (removed.has(element.id)) return undefined;
      if (element.type !== "dimension") return element;
      if (!element.references.some((reference) => removed.has(reference.elementId))) return element;
      return undefined;
    };
    const elements = document.elements.flatMap((element) => {
      if (element.id === target.id) return [solved.sketch];
      const mapped = remapElement(element);
      return mapped ? [mapped] : [];
    });
    return replaceElements(removeConnectionsFor(document, removed), elements);
  },
});

export const addSketchConstraint = (sketchId: ElementId, constraint: SketchConstraint): EditorCommand => ({
  name: `sketch-constraint-add:${sketchId}:${constraint.id}`,
  apply: (document) => {
    const sketch = document.elements.find((element): element is SketchElement => element.id === sketchId && element.type === "sketch");
    if (!sketch || sketch.constraints?.some((current) => current.id === constraint.id)) return { success: false, error: "Sketch constraint cannot be added" };
    const sameReferences = (first: SketchConstraint, second: SketchConstraint) => first.kind === second.kind && first.references.length === second.references.length && first.references.every((reference, index) => reference.elementId === second.references[index]?.elementId && reference.nodeId === second.references[index]?.nodeId);
    const constraints = (sketch.constraints ?? []).filter((current) => !(current.id.startsWith("auto:") && (sameReferences(current, constraint) || constraint.references.every((reference) => current.references.some((candidate) => `${candidate.elementId}:${candidate.nodeId}` === `${reference.elementId}:${reference.nodeId}`)))));
    return solveSketchCandidate(document, sketch, [...constraints, constraint]);
  },
});

export const updateSketchConstraint = (sketchId: ElementId, constraintId: string, constraint: SketchConstraint): EditorCommand => ({
  name: `sketch-constraint-update:${sketchId}:${constraintId}`,
  apply: (document) => {
    const sketch = document.elements.find((element): element is SketchElement => element.id === sketchId && element.type === "sketch");
    const current = sketch?.constraints?.find((candidate) => candidate.id === constraintId);
    if (!sketch || !current) return { success: false, error: "Sketch constraint not found" };
    if (constraint.id !== constraintId) return { success: false, error: "Sketch constraint id cannot change" };
    const constraints = sketch.constraints!.map((candidate) => candidate.id === constraintId ? constraint : candidate);
    return solveSketchCandidate(document, sketch, constraints);
  },
});

export const deleteSketchConstraint = (sketchId: ElementId, constraintId: string): EditorCommand => ({
  name: `sketch-constraint-delete:${sketchId}:${constraintId}`,
  apply: (document) => {
    const sketch = document.elements.find((element): element is SketchElement => element.id === sketchId && element.type === "sketch");
    if (!sketch || !sketch.constraints?.some((constraint) => constraint.id === constraintId)) return { success: false, error: "Sketch constraint not found" };
    return solveSketchCandidate(document, sketch, sketch.constraints.filter((constraint) => constraint.id !== constraintId));
  },
});

export const solveSketch = (sketchId: ElementId): EditorCommand => ({
  name: `sketch-solve:${sketchId}`,
  apply: (document) => {
    const sketch = document.elements.find((element): element is SketchElement => element.id === sketchId && element.type === "sketch");
    if (!sketch) return { success: false, error: "Sketch not found" };
    const result = solveSketchConstraints(sketch);
    if (result.status === "conflict" || result.status === "overdefined") return { success: false, error: `Sketch constraints are ${result.status}` };
    return replaceElements(document, document.elements.map((element) => element.id === sketchId ? result.sketch : element));
  },
});

export const addCircleConstraint = (circleId: ElementId, constraint: CircleConstraint): EditorCommand => ({
  name: `circle-constraint-add:${circleId}:${constraint.id}`,
  apply: (document) => {
    const circle = document.elements.find((element): element is Extract<Element, { type: "ellipse" }> => element.id === circleId && element.type === "ellipse");
    if (!circle || circle.size.width !== circle.size.height) return { success: false, error: "Circle not found or is not circular" };
    if (!constraint.id || circle.circleConstraints?.some((candidate) => candidate.id === constraint.id) || constraint.kind.endsWith("horizontal") && constraint.value === undefined || constraint.kind.endsWith("vertical") && constraint.value === undefined || (constraint.kind === "radius" || constraint.kind === "diameter") && (!Number.isFinite(constraint.value) || constraint.value === undefined || constraint.value <= 0)) return { success: false, error: "Invalid circle constraint" };
    const result = solveCircleConstraints({ ...circle, circleConstraints: [...(circle.circleConstraints ?? []), constraint] });
    if (result.status === "conflict") return { success: false, error: "Circle constraints are in conflict" };
    return replaceElements(document, document.elements.map((element) => element.id === circleId ? result.circle : element));
  },
});

export const updateCircleConstraint = (circleId: ElementId, constraintId: string, constraint: CircleConstraint): EditorCommand => ({
  name: `circle-constraint-update:${circleId}:${constraintId}`,
  apply: (document) => {
    const circle = document.elements.find((element): element is Extract<Element, { type: "ellipse" }> => element.id === circleId && element.type === "ellipse");
    if (!circle || circle.size.width !== circle.size.height) return { success: false, error: "Circle not found or is not circular" };
    if (constraint.id !== constraintId || constraint.value === undefined || !Number.isFinite(constraint.value) || (constraint.kind === "radius" || constraint.kind === "diameter") && constraint.value <= 0) return { success: false, error: "Invalid circle constraint" };
    if (!circle.circleConstraints?.some((candidate) => candidate.id === constraintId)) return { success: false, error: "Circle constraint not found" };
    const constraints = circle.circleConstraints.map((candidate) => candidate.id === constraintId ? constraint : candidate);
    const result = solveCircleConstraints({ ...circle, circleConstraints: constraints });
    if (result.status === "conflict") return { success: false, error: "Circle constraints are in conflict" };
    return replaceElements(document, document.elements.map((element) => element.id === circleId ? result.circle : element));
  },
});

export const deleteCircleConstraint = (circleId: ElementId, constraintId: string): EditorCommand => ({
  name: `circle-constraint-delete:${circleId}:${constraintId}`,
  apply: (document) => {
    const circle = document.elements.find((element): element is Extract<Element, { type: "ellipse" }> => element.id === circleId && element.type === "ellipse");
    if (!circle || !circle.circleConstraints?.some((candidate) => candidate.id === constraintId)) return { success: false, error: "Circle constraint not found" };
    const result = solveCircleConstraints({ ...circle, circleConstraints: circle.circleConstraints.filter((candidate) => candidate.id !== constraintId) });
    return replaceElements(document, document.elements.map((element) => element.id === circleId ? result.circle : element));
  },
});

export const setDimensionDriving = (dimensionId: ElementId, driving: boolean): EditorCommand => ({
  name: `dimension-driving:${dimensionId}:${driving}`,
  apply: (document) => {
    const dimension = document.elements.find((element): element is DimensionElement => element.id === dimensionId && element.type === "dimension");
    if (!dimension) return { success: false, error: "Dimension not found" };
    const targetId = dimension.references[0].elementId;
    const constraintId = dimension.constraintId ?? `dimension:${dimension.id}`;
    const updatedDimension = driving ? { ...dimension, driving: true, constraintId } : Object.fromEntries(Object.entries({ ...dimension, driving: false }).filter(([key]) => key !== "constraintId")) as unknown as DimensionElement;
    if (dimension.kind === "radius" || dimension.kind === "diameter") {
      const target = document.elements.find((element): element is Extract<Element, { type: "ellipse" }> => element.id === targetId && element.type === "ellipse");
      if (!target || target.size.width !== target.size.height) return { success: false, error: "Driving dimension target is not a circle" };
      const existing = target.circleConstraints ?? [];
      const value = dimensionGeometry(dimension, document.elements)?.value;
      if (driving && (!value || !Number.isFinite(value) || value <= 0)) return { success: false, error: "Circular dimension has no valid value" };
      const constraints = driving ? [...existing.filter((candidate) => candidate.id !== constraintId), { id: constraintId, kind: dimension.kind, value: value as number, driving: true }] : existing.filter((candidate) => candidate.id !== constraintId);
      const solved = solveCircleConstraints({ ...target, circleConstraints: constraints });
      if (solved.status === "conflict") return { success: false, error: "Circle constraints are in conflict" };
      return replaceElements(document, document.elements.map((element) => element.id === dimension.id ? updatedDimension : element.id === target.id ? solved.circle : element));
    }
    const target = document.elements.find((element): element is SketchElement => element.id === targetId && element.type === "sketch");
    if (!target) return { success: false, error: "Only sketch or circular dimensions can be driving" };
    const existing = target.constraints ?? [];
    const constraint = sketchConstraintForDimension({ ...dimension, constraintId }, target, document.elements);
    if (driving && !constraint) return { success: false, error: "Sketch dimension cannot create a driving constraint" };
    const constraints = driving ? [...existing.filter((candidate) => candidate.id !== constraintId), constraint!] : existing.filter((candidate) => candidate.id !== constraintId);
    const solved = solveSketchConstraints({ ...target, constraints });
    if (solved.status === "conflict" || solved.status === "overdefined") return { success: false, error: `Sketch constraints are ${solved.status}` };
    return replaceElements(document, document.elements.map((element) => element.id === dimension.id ? updatedDimension : element.id === target.id ? solved.sketch : element));
  },
});

export const solveCircle = (circleId: ElementId): EditorCommand => ({
  name: `circle-solve:${circleId}`,
  apply: (document) => {
    const circle = document.elements.find((element): element is Extract<Element, { type: "ellipse" }> => element.id === circleId && element.type === "ellipse");
    if (!circle || circle.size.width !== circle.size.height) return { success: false, error: "Circle not found or is not circular" };
    const result = solveCircleConstraints(circle);
    if (result.status === "conflict") return { success: false, error: "Circle constraints are in conflict" };
    return replaceElements(document, document.elements.map((element) => element.id === circleId ? result.circle : element));
  },
});

export const updateElementNode = (id: ElementId, nodeIndex: number, point: PointMm): EditorCommand => ({
  name: `forma-node:${id}:${nodeIndex}`,
  apply: (document) => {
    if (![point.x, point.y].every(Number.isFinite) || !Number.isInteger(nodeIndex) || nodeIndex < 0) return { success: false, error: "Forma node coordinates must be finite" };
    const current = document.elements.find((element) => element.id === id);
    if (!current) return { success: false, error: `Element not found: ${id}` };
    if (current.type === "contour") return { success: false, error: "Contour nodes require a contour address" };
    const nodes = realGeometryNodes(current);
    const node = nodes[nodeIndex];
    if (!node) return { success: false, error: "Forma node not found" };
    if (current.type === "line") {
      const delta = { x: point.x - node.point.x, y: point.y - node.point.y };
      const next = nodeIndex === 0 ? { ...current, start: point } : nodeIndex === 2 ? { ...current, end: point } : { ...current, start: { x: current.start.x + delta.x, y: current.start.y + delta.y }, end: { x: current.end.x + delta.x, y: current.end.y + delta.y } };
      return replaceElements(document, document.elements.map((element) => element.id === id ? next : element));
    }
    if (current.type === "glyph") {
      const next = updateGlyphNodeData(current, nodeIndex, point);
      return next ? replaceElements(document, document.elements.map((element) => element.id === id ? next : element)) : { success: false, error: "Glyph node not found" };
    }
    if (current.type === "sketch") {
      if (!node.nodeId) return { success: false, error: "Sketch node not found" };
      const candidate = { ...current, nodes: current.nodes.map((sketchNode) => sketchNode.id === node.nodeId ? { ...sketchNode, point } : sketchNode) };
          const solved = solveSketchConstraints(candidate);
          if (solved.status === "conflict" || solved.status === "overdefined") return { success: false, error: `Sketch constraints are ${solved.status}` };
          return replaceElements(document, document.elements.map((element) => element.id === id ? solved.sketch : element));
    }
    if (current.type === "path") {
      if (!node.nodeId) return { success: false, error: "Path node not found" };
      return node.kind === "control" ? movePathHandle(id, node.segmentIndex ?? -1, node.handle ?? "control1", point).apply(document) : movePathNode(id, node.nodeId, point).apply(document);
    }
    if (current.type === "spline") {
      if (!node.nodeId) return { success: false, error: "Spline node not found" };
      return updateSplineNode(id, node.nodeId, point).apply(document);
    }
    if (node.kind === "center" || ((current.type === "rectangle" || current.type === "ellipse") && node.kind === "corner")) {
      return moveElement(id, { x: point.x - node.point.x, y: point.y - node.point.y }).apply(document);
    }
    const handle = current.type === "rectangle" || current.type === "ellipse"
      ? node.kind === "corner" ? (["nw", "ne", "se", "sw"] as const)[nodes.filter((candidate) => candidate.kind === "corner").findIndex((candidate) => candidate === node)]
        : node.kind === "cardinal" ? (["n", "e", "s", "w"] as const)[nodes.filter((candidate) => candidate.kind === "cardinal").findIndex((candidate) => candidate === node)]
        : undefined
      : undefined;
    const handleIndex = nodes.indexOf(node);
    const mappedHandle = handle ?? (["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const)[handleIndex];
    if (!mappedHandle) return { success: false, error: "Forma node cannot resize this object" };
    const geometry = resizeGroup([current], mappedHandle, point, 1)[0];
    return geometry ? replaceElements(document, document.elements.map((element) => element.id === id ? geometry : element)) : { success: false, error: "Forma node resize failed" };
  },
});

const deleteGlyphAnchorNodes = (glyph: GlyphElement, nodeIndexes: readonly number[]): GlyphElement | undefined => {
  const geometryNodes = glyphGeometryNodes(glyph);
  const nodeIds = new Set(nodeIndexes.flatMap((index) => geometryNodes[index]?.kind === "anchor" ? [geometryNodes[index]!.nodeId] : []));
  if (!nodeIds.size) return undefined;
  const contours = glyph.contours.map((contour) => {
    const kept = contour.nodes.filter((node) => !nodeIds.has(node.id));
    if (kept.length < 3) return undefined;
    const originalSegment = (startIndex: number, endIndex: number): PathSegment[] => {
      const segments: PathSegment[] = [];
      let index = startIndex;
      do {
        const segment = contour.segments[index];
        if (segment) segments.push(segment);
        index = (index + 1) % contour.nodes.length;
      } while (index !== endIndex);
      return segments;
    };
    const segments = kept.map((node, index) => {
      const end = kept[(index + 1) % kept.length]!;
      const startIndex = contour.nodes.findIndex((candidate) => candidate.id === node.id);
      const endIndex = contour.nodes.findIndex((candidate) => candidate.id === end.id);
      return rebuildPathSegment(node, end, originalSegment(startIndex, endIndex));
    });
    return { ...contour, nodes: kept, segments };
  });
  return contours.every((contour): contour is NonNullable<typeof contour> => contour !== undefined) ? { ...glyph, contours } : undefined;
};

export const deleteElementNodes = (id: ElementId, nodeIndexes: readonly number[]): EditorCommand => ({
  name: `forma-node-delete:${id}:${[...nodeIndexes].join(",")}`,
  apply: (document) => {
    const current = document.elements.find((element) => element.id === id);
    if (!current) return { success: false, error: `Element not found: ${id}` };
    const indexes = [...new Set(nodeIndexes)].sort((a, b) => b - a);
    if (!indexes.length) return { success: false, error: "No Forma nodes selected" };
    if (current.type === "sketch") {
      const nodes = realGeometryNodes(current);
      const nodeIds = new Set(indexes.flatMap((index) => nodes[index]?.nodeId ? [nodes[index]!.nodeId] : []));
      if (nodeIds.size !== indexes.length) return { success: false, error: "Sketch node not found" };
      const keptNodes = current.nodes.filter((node) => !nodeIds.has(node.id));
      const keptEdges = current.edges.filter((edge) => !nodeIds.has(edge.startNodeId) && !nodeIds.has(edge.endNodeId));
      if (keptNodes.length < 2 || keptEdges.length < 1) return { success: false, error: "A sketch must retain at least two nodes and one edge" };
      const constraints = current.constraints?.filter((constraint) => !constraint.references.some((reference) => nodeIds.has(reference.nodeId)));
      const next = { ...current, nodes: keptNodes, edges: keptEdges, ...(constraints ? { constraints } : {}) };
      return replaceElements(document, document.elements.map((element) => element.id === id ? next : element));
    }
    if (current.type === "glyph") {
      const glyph = deleteGlyphAnchorNodes(current, indexes);
      return glyph ? replaceElements(document, document.elements.map((element) => element.id === id ? glyph : element)) : { success: false, error: "No se puede eliminar: el glifo debe conservar al menos tres anclas por contorno" };
    }
    if (current.type !== "contour" && indexes.some((index) => realGeometryNodes(current)[index]?.kind === "center")) return { success: false, error: "El centro no es un nodo de contorno eliminable" };
    const contour = current.type === "contour" ? current : elementToContour(current);
    const remove = new Set(indexes);
    const points = contour.contours.map((ring) => {
      const vertices = ring.points.slice(0, -1);
      const kept = vertices.filter((_, index) => !remove.has(index));
      return [...kept, kept[0]!];
    });
    if (points.some((ring) => ring.length < 4)) return { success: false, error: "No se puede eliminar: el anillo debe conservar al menos tres vértices" };
    return replaceElements(document, document.elements.map((element) => element.id === id ? contourWithPoints({ ...contour, id } as typeof contour, points) : element));
  },
});

export const deleteContourNodes = (id: ElementId, addresses: readonly ContourNodeAddress[]): EditorCommand => ({
  name: `contour-node-delete:${id}`,
  apply: (document) => {
    const current = document.elements.find((element) => element.id === id);
    if (!current || current.type !== "contour") return { success: false, error: "Contour nodes require a contour" };
    const removals = new Map<number, Set<number>>();
    for (const address of addresses) {
      if (!Number.isInteger(address.ringIndex) || !Number.isInteger(address.pointIndex)) return { success: false, error: "Invalid contour node address" };
      const ring = current.contours[address.ringIndex];
      if (!ring) return { success: false, error: "Contour node ring not found" };
      const vertices = ring.points.slice(0, -1);
      if (address.pointIndex < 0 || address.pointIndex >= vertices.length) return { success: false, error: "Contour node not found" };
      const set = removals.get(address.ringIndex) ?? new Set<number>(); set.add(address.pointIndex); removals.set(address.ringIndex, set);
    }
    const points = current.contours.map((ring, ringIndex) => { const vertices = ring.points.slice(0, -1); const kept = vertices.filter((_, index) => !removals.get(ringIndex)?.has(index)); return [...kept, kept[0]!]; });
    if (points.some((ring) => ring.length < 4)) return { success: false, error: "No se puede eliminar: el anillo debe conservar al menos tres vértices" };
    return replaceElements(document, document.elements.map((element) => element.id === id && element.type === "contour" ? contourWithPoints(element, points) : element));
  },
});

const translateElement = (element: Element, delta: PointMm, id: ElementId): Element => {
  if (element.type === "dimension") return { ...element, id, offset: { x: element.offset.x + delta.x, y: element.offset.y + delta.y } };
  if (element.type === "line") return { ...element, id, start: { x: element.start.x + delta.x, y: element.start.y + delta.y }, end: { x: element.end.x + delta.x, y: element.end.y + delta.y } };
  if (element.type === "contour") return { ...contourWithPoints(element, element.contours.map((contour) => contour.points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y })))), id, rotation: element.rotation };
  if (element.type === "path") return { ...translatePath(element, delta), id };
  if (element.type === "glyph") return { ...translateGlyph(element, delta), id };
  if (element.type === "spline") return { ...element, id, nodes: element.nodes.map((node) => ({ ...node, anchor: { x: node.anchor.x + delta.x, y: node.anchor.y + delta.y } })) };
  if (element.type === "sketch") return { ...element, id, nodes: element.nodes.map((node) => ({ ...node, point: { x: node.point.x + delta.x, y: node.point.y + delta.y } })) };
  return { ...element, id, position: { x: element.position.x + delta.x, y: element.position.y + delta.y } };
};

export const duplicateElements = (ids: readonly ElementId[], direction: Direction, distance: number, count: number): EditorCommand => ({
  name: `duplicate:${direction}:${count}`,
  apply: (document) => {
    if (!Number.isFinite(distance) || distance < 0) return { success: false, error: "Distance must be a finite non-negative number" };
    if (!Number.isInteger(count) || count < 1) return { success: false, error: "Copy count must be a positive integer" };
    const uniqueIds = [...new Set(ids)];
    const selected = document.elements.filter((element) => uniqueIds.includes(element.id));
    if (!selected.length || selected.length !== uniqueIds.length) return { success: false, error: "One or more elements were not found" };
    const vector = directionVector(direction);
    const bounds = boundsOfElements(selected);
    const step = { x: vector.x * (vector.x === 0 ? 0 : bounds.width + distance), y: vector.y * (vector.y === 0 ? 0 : bounds.height + distance) };
    const copies = Array.from({ length: count }, (_, copyIndex) => selected.map((element) => translateElement(element, { x: step.x * (copyIndex + 1), y: step.y * (copyIndex + 1) }, elementId(`element-${crypto.randomUUID()}`)))).flat();
    return replaceElements(document, [...document.elements, ...copies]);
  },
});

export type FlipAxis = "horizontal" | "vertical";
export const flipElements = (ids: readonly ElementId[], axis: FlipAxis): EditorCommand => ({
  name: `flip-${axis}:${[...new Set(ids)].join(",")}`,
  apply: (document) => {
    const selected = new Set(ids);
    const known = document.elements.filter((element) => selected.has(element.id));
    if (known.length !== selected.size) return { success: false, error: "One or more elements were not found" };
    if (known.length === 0) return { success: false, error: "No elements selected" };
    const center = groupCenter(boundsOfElements(known));
    const horizontal = axis === "horizontal";
    return replaceElements(document, document.elements.map((element) => {
       if (!selected.has(element.id)) return element;
       if (element.type === "dimension") return element;
      const currentCenter = elementCenter(element);
      const reflectedCenter = horizontal
        ? { x: center.x * 2 - currentCenter.x, y: currentCenter.y }
        : { x: currentCenter.x, y: center.y * 2 - currentCenter.y };
      const delta = { x: reflectedCenter.x - currentCenter.x, y: reflectedCenter.y - currentCenter.y };
      if (element.type === "path") {
        const reflect = (point: PointMm): PointMm => horizontal ? { x: center.x * 2 - point.x, y: point.y } : { x: point.x, y: center.y * 2 - point.y };
        return { ...element, nodes: element.nodes.map((node) => ({ ...node, anchor: reflect(node.anchor) })), segments: element.segments.map((segment) => segment.type === "cubicBezier" ? { ...segment, control1: reflect(segment.control1), control2: reflect(segment.control2) } : segment) };
      }
      if (element.type === "glyph") {
        const reflect = (point: PointMm): PointMm => horizontal ? { x: center.x * 2 - point.x, y: point.y } : { x: point.x, y: center.y * 2 - point.y };
        return { ...element, position: { x: reflectedCenter.x - element.size.width / 2, y: reflectedCenter.y - element.size.height / 2 }, contours: element.contours.map((contour) => ({ ...contour, nodes: contour.nodes.map((node) => ({ ...node, anchor: reflect(node.anchor) })), segments: contour.segments.map((segment) => segment.type === "cubicBezier" ? { ...segment, control1: reflect(segment.control1), control2: reflect(segment.control2) } : segment) })) };
      }
      if (element.type === "spline") return { ...element, nodes: element.nodes.map((node) => ({ ...node, anchor: horizontal ? { x: center.x * 2 - node.anchor.x, y: node.anchor.y } : { x: node.anchor.x, y: center.y * 2 - node.anchor.y }, ...(node.inHandle ? { inHandle: horizontal ? { dx: -node.inHandle.dx, dy: node.inHandle.dy } : { dx: node.inHandle.dx, dy: -node.inHandle.dy } } : {}), ...(node.outHandle ? { outHandle: horizontal ? { dx: -node.outHandle.dx, dy: node.outHandle.dy } : { dx: node.outHandle.dx, dy: -node.outHandle.dy } } : {}) })) };
      if (element.type === "sketch") return { ...element, nodes: element.nodes.map((node) => ({ ...node, point: horizontal ? { x: center.x * 2 - node.point.x, y: node.point.y } : { x: node.point.x, y: center.y * 2 - node.point.y } })) };
      if (element.type === "text") return { ...element, position: horizontal ? { x: center.x * 2 - element.position.x - element.size.width, y: element.position.y } : { x: element.position.x, y: center.y * 2 - element.position.y - element.size.height }, rotation: -element.rotation };
      const moved = element.type === "line"
        ? { ...element, start: { x: element.start.x + delta.x, y: element.start.y + delta.y }, end: { x: element.end.x + delta.x, y: element.end.y + delta.y } }
        : { ...element, position: { x: element.position.x + delta.x, y: element.position.y + delta.y } };
      if (element.type === "contour") return contourWithPoints(element, element.contours.map((contour) => contour.points.map((point) => horizontal ? { x: center.x * 2 - point.x, y: point.y } : { x: point.x, y: center.y * 2 - point.y })));
      return { ...moved, rotation: -element.rotation, [horizontal ? "flipX" : "flipY"]: !(horizontal ? element.flipX : element.flipY) };
    }));
  },
});

export const updateElementStyles = (ids: readonly ElementId[], patch: StylePatch): EditorCommand => ({
  name: `style:${[...new Set(ids)].join(",")}`,
  apply: (document) => {
    const selected = new Set(ids);
    const known = document.elements.filter((element) => selected.has(element.id));
    if (known.length !== selected.size) return { success: false, error: "One or more elements were not found" };
    if (known.length === 0) return { success: false, error: "No elements selected" };
    return replaceElements(document, document.elements.map((element) => {
      if (!selected.has(element.id)) return element;
      const style = { ...element.style, ...patch } as VisualStyle & { fill?: string | null };
      if (patch.fill === null) delete style.fill;
      return { ...element, style } as Element;
    }));
  },
});

export const updatePage = (width: number, height: number): EditorCommand => ({
  name: "page-size",
  apply: (document) => result({ ...document, page: { width, height }, revision: nextRevision(document.revision) }),
});

export const setLayerVisibility = (id: LayerId, visible: boolean): EditorCommand => ({
  name: `layer-visibility:${id}`,
  apply: (document) => {
    const layer = document.layers.find((current) => current.id === id);
    if (!layer) return { success: false, error: `Layer not found: ${id}` };
    if (layer.visible === visible) return { success: true, document };
    return result({ ...document, revision: nextRevision(document.revision), layers: document.layers.map((current) => current.id === id ? { ...current, visible } : current) });
  },
});

export const reorderLayer = (id: LayerId, order: number): EditorCommand => ({
  name: `layer-order:${id}`,
  apply: (document) => {
    if (!document.layers.some((layer) => layer.id === id) || !Number.isInteger(order) || order < 0 || order >= document.layers.length) return { success: false, error: `Invalid layer or order: ${id}` };
    const ordered = [...document.layers].sort((a, b) => a.order - b.order);
    const currentIndex = ordered.findIndex((layer) => layer.id === id);
    const [moved] = ordered.splice(currentIndex, 1);
    ordered.splice(order, 0, moved!);
    return result({ ...document, revision: nextRevision(document.revision), layers: ordered.map((layer, index) => ({ ...layer, order: index })) });
  },
});

export const addLayer = (layer: Layer): EditorCommand => ({
  name: `layer-add:${layer.id}`,
  apply: (document) => document.layers.some((current) => current.id === layer.id)
    ? { success: false, error: `Layer already exists: ${layer.id}` }
    : result({ ...document, revision: nextRevision(document.revision), layers: [...document.layers, { ...layer }] }),
});

export function createEditor(document: DocumentSnapshot): EditorState { return { document, selection: [], undo: [], redo: [], gesture: undefined }; }
const knownSelection = (state: EditorState, ids: readonly ElementId[]): ElementId[] => {
  const known = new Set(state.document.elements.map((element) => element.id));
  return [...new Set(ids)].filter((id) => known.has(id));
};
export function select(state: EditorState, ids: readonly ElementId[]): EditorState {
  return { ...state, selection: knownSelection(state, ids) };
}
export const replaceSelection = select;
export function addToSelection(state: EditorState, ids: readonly ElementId[]): EditorState { return select(state, [...state.selection, ...ids]); }
export function removeFromSelection(state: EditorState, ids: readonly ElementId[]): EditorState { const removed = new Set(ids); return select(state, state.selection.filter((id) => !removed.has(id))); }
export function toggleSelection(state: EditorState, id: ElementId): EditorState { return state.selection.includes(id) ? removeFromSelection(state, [id]) : addToSelection(state, [id]); }
export function selectForPointerDown(state: EditorState, id: ElementId, shiftKey: boolean): EditorState {
  if (shiftKey) return toggleSelection(state, id);
  return state.selection.includes(id) ? state : select(state, [id]);
}
export function clearSelection(state: EditorState): EditorState { return { ...state, selection: [] }; }

export function dispatch(state: EditorState, command: EditorCommand): EditorState {
  const applied = command.apply(state.document);
  if (!applied.success || applied.document === state.document) return state;
  const nextSelection = command.name.startsWith("text-to-glyphs:") || command.name.startsWith("shape-")
    ? applied.document.elements.filter((element) => !state.document.elements.some((previous) => previous.id === element.id)).map((element) => element.id)
    : command.name.startsWith("duplicate:")
      ? applied.document.elements.filter((element) => !state.document.elements.some((previous) => previous.id === element.id)).map((element) => element.id)
    : knownSelection({ ...state, document: applied.document }, state.selection);
  return { ...state, document: applied.document, selection: nextSelection, undo: [...state.undo, { command: command.name, before: state.document, after: applied.document, selectionBefore: state.selection, selectionAfter: nextSelection }], redo: [], gesture: undefined };
}

export function undo(state: EditorState): EditorState {
  const transaction = state.undo.at(-1);
  if (!transaction) return state;
   const selection = transaction.command.startsWith("text-to-glyphs:") || transaction.command.startsWith("shape-") || transaction.command.startsWith("duplicate:") ? transaction.selectionBefore : knownSelection({ ...state, document: transaction.before }, state.selection);
  return { ...state, document: transaction.before, selection, undo: state.undo.slice(0, -1), redo: [...state.redo, transaction], gesture: undefined };
}
export function redo(state: EditorState): EditorState {
  const transaction = state.redo.at(-1);
  if (!transaction) return state;
   const selection = transaction.command.startsWith("text-to-glyphs:") || transaction.command.startsWith("shape-") || transaction.command.startsWith("duplicate:") ? transaction.selectionAfter : knownSelection({ ...state, document: transaction.after }, state.selection);
  return { ...state, document: transaction.after, selection, undo: [...state.undo, transaction], redo: state.redo.slice(0, -1), gesture: undefined };
}

export function beginGesture(state: EditorState): EditorState {
  return { ...state, gesture: { base: state.document, preview: state.document } };
}
export function previewGesture(state: EditorState, command: EditorCommand): EditorState {
  if (!state.gesture) return state;
  const applied = command.apply(state.gesture.preview);
  return applied.success ? { ...state, document: applied.document, gesture: { ...state.gesture, preview: applied.document } } : state;
}
/** Recomputes a preview from the gesture base, so pointer-derived corrections never accumulate. */
export function previewGestureFromBase(state: EditorState, command: EditorCommand): EditorState {
  if (!state.gesture) return state;
  const applied = command.apply(state.gesture.base);
  return applied.success ? { ...state, document: applied.document, gesture: { ...state.gesture, preview: applied.document } } : state;
}
export function commitGesture(state: EditorState): EditorState {
  if (!state.gesture) return state;
  const { base, preview } = state.gesture;
  if (preview === base) return { ...state, gesture: undefined };
  return { ...state, document: preview, undo: [...state.undo, { command: "gesture", before: base, after: preview, selectionBefore: state.selection, selectionAfter: state.selection }], redo: [], gesture: undefined };
}
export function cancelGesture(state: EditorState): EditorState {
  return state.gesture ? { ...state, document: state.gesture.base, gesture: undefined } : state;
}

export { revision };
