import {
  constraintComponentStatesForDocument,
  constraintComponentsForDocument,
  constraintResidualsForDocument,
  supportsDocumentConstraintKind,
} from "@nodra/constraints";
import { nextRevision, type DocumentConstraint, type DocumentSnapshot, type SketchConstraintKind } from "@nodra/domain";
import {
  addDocumentConstraint,
  recomputeSketchKernel,
  updateDocumentConstraint,
  type EditorCommand,
} from "@nodra/editor-core";

export const supportsGlobalConstraintKind = (kind: SketchConstraintKind): boolean => supportsDocumentConstraintKind(kind);

export const documentConstraintDiagnosticId = (constraintId: string): string => JSON.stringify(["document", null, constraintId]);

const constraintNodeKey = (elementId: string, nodeId: string): string => JSON.stringify([elementId, nodeId]);

const solveConstraintComponent = (document: DocumentSnapshot, constraint: DocumentConstraint): DocumentSnapshot | undefined => {
  const diagnosticId = documentConstraintDiagnosticId(constraint.id);
  const component = constraintComponentsForDocument(document).find((candidate) => candidate.constraintIds.includes(diagnosticId));
  if (!component) return undefined;

  const affectedNodeKeys = new Set(component.nodeKeys);
  const componentConstraintIds = new Set(component.constraintIds);
  const componentElements = document.elements
    .filter((element) => element.type !== "sketch" || element.nodes.some((node) => affectedNodeKeys.has(constraintNodeKey(element.id, node.id))))
    .map((element) => element.type !== "sketch" ? element : {
      ...element,
      constraints: (element.constraints ?? []).filter((candidate) => componentConstraintIds.has(JSON.stringify(["local", element.id, candidate.id]))),
    });
  const componentDocument: DocumentSnapshot = {
    ...document,
    elements: componentElements,
    ...(document.constraints ? { constraints: document.constraints.filter((candidate) => componentConstraintIds.has(documentConstraintDiagnosticId(candidate.id))) } : {}),
  };
  const recomputed = recomputeSketchKernel(componentDocument);
  if (!recomputed.committed) return undefined;

  const solvedById = new Map(recomputed.document.elements.map((element) => [element.id, element]));
  const elements = document.elements.map((element) => {
    if (element.type !== "sketch") return element;
    const solved = solvedById.get(element.id);
    if (solved?.type !== "sketch") return element;
    const nodes = element.nodes.map((node, index) => affectedNodeKeys.has(constraintNodeKey(element.id, node.id)) ? solved.nodes[index] ?? node : node);
    return nodes.some((node, index) => node !== element.nodes[index]) ? { ...element, nodes } : element;
  });
  const scoped = elements.some((element, index) => element !== document.elements[index]) ? { ...document, elements } : document;
  const residuals = constraintResidualsForDocument(scoped).filter((residual) => component.constraintIds.includes(residual.constraintId));
  const componentState = constraintComponentStatesForDocument(scoped).find((state) => state.nodeKeys.some((key) => affectedNodeKeys.has(key)));
  if (!residuals.some((residual) => residual.constraintId === diagnosticId) || residuals.some((residual) => !residual.supported || !residual.satisfied) || componentState?.state === "conflict") return undefined;
  return scoped;
};

const solvedDocumentConstraintCommand = (
  constraint: DocumentConstraint,
  mutation: EditorCommand,
  operation: "add" | "update",
): EditorCommand => ({
  name: `document-constraint-${operation}-solved:${constraint.id}`,
  apply: (current: DocumentSnapshot) => {
    const mutated = mutation.apply(current);
    if (!mutated.success || mutated.document === current) return mutated;
    const solved = solveConstraintComponent(mutated.document, constraint);
    return solved ? { ...mutated, document: solved } : { success: false, error: "La relación global entra en conflicto" };
  },
});

export const addSolvedDocumentConstraint = (constraint: DocumentConstraint): EditorCommand =>
  solvedDocumentConstraintCommand(constraint, addDocumentConstraint(constraint), "add");

export const updateSolvedDocumentConstraint = (constraint: DocumentConstraint): EditorCommand =>
  solvedDocumentConstraintCommand(constraint, updateDocumentConstraint(constraint), "update");

const sourceIsVisible = (before: DocumentSnapshot, after: DocumentSnapshot, constraint: DocumentConstraint): boolean => {
  if (!("source" in constraint)) {
    if (constraint.kind !== "midpoint" || constraint.references.length !== 2) return true;
    const [dependent, reference] = constraint.references;
    if (!dependent || !("nodeId" in dependent) || !reference || !("edgeId" in reference)) return false;
    const dependentSketch = after.elements.find((element) => element.type === "sketch" && element.id === dependent.elementId);
    if (dependentSketch?.type !== "sketch" || !dependentSketch.nodes.some((node) => node.id === dependent.nodeId)) return false;
    const source = before.elements.find((element) => element.type === "sketch" && element.id === reference.elementId);
    const layer = source && before.layers.find((candidate) => candidate.id === source.layerId);
    return source?.type === "sketch" && layer?.visible === true && source.edges.some((edge) => edge.id === reference.edgeId);
  }
  const reference = constraint.source;
  const source = before.elements.find((element) => element.id === reference.elementId);
  const layer = source && before.layers.find((candidate) => candidate.id === source.layerId);
  if (!source || !layer?.visible) return false;
  if (constraint.kind === "line-endpoint-midpoint") {
    const dependent = after.elements.find((element) => element.id === constraint.references[0]!.elementId);
    if (dependent?.type !== "line") return false;
    if (reference.kind === "line") return source.type === "line";
    return reference.kind === "path-segment" && source.type === "path" && !source.closed && source.segments.some((segment) => segment.id === reference.segmentId);
  }
  if (reference.kind === "line") return source.type === "line";
  if (reference.kind === "arc") return source.type === "arc";
  if (reference.kind === "path-segment") return source.type === "path" && source.segments.some((segment) => segment.id === reference.segmentId);
  return source.type === "spline" && source.nodes.some((node, index) => node.id === reference.startNodeId && source.nodes[index + 1]?.id === reference.endNodeId);
};

/** Applies geometry and its dependent midpoint relations as one atomic editor command. */
export const createGeometryWithDocumentConstraints = (
  geometryCommand: EditorCommand,
  deriveConstraints: (before: DocumentSnapshot, after: DocumentSnapshot) => readonly DocumentConstraint[],
): EditorCommand => ({
  name: geometryCommand.name,
  apply: (before) => {
    const geometry = geometryCommand.apply(before);
    if (!geometry.success) return geometry;
    let constraints: readonly DocumentConstraint[];
    try {
      constraints = deriveConstraints(before, geometry.document);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unable to derive document constraints" };
    }
    if (constraints.length > 2) return { success: false, error: "At most two document constraints may be added atomically" };
    if (geometry.document === before) return constraints.length === 0 ? geometry : { success: false, error: "Cannot add document constraints without a geometry change" };
    let current = geometry.document;
    for (const constraint of constraints) {
      if (!sourceIsVisible(before, geometry.document, constraint)) return { success: false, error: "Document constraint source is missing or hidden" };
      const applied = constraint.kind === "line-endpoint-midpoint"
        ? addDocumentConstraint(constraint).apply(current)
        : addSolvedDocumentConstraint(constraint).apply(current);
      if (!applied.success) return applied;
      current = applied.document;
    }
    return { ...geometry, document: { ...current, revision: nextRevision(before.revision) } };
  },
});
