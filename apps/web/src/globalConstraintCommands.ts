import {
  constraintComponentStatesForDocument,
  constraintComponentsForDocument,
  constraintResidualsForDocument,
  solveConstraintComponents,
  supportsDocumentConstraintKind,
} from "@nodra/constraints";
import type { DocumentConstraint, DocumentSnapshot, SketchConstraintKind } from "@nodra/domain";
import {
  addDocumentConstraint,
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
  const solveResult = solveConstraintComponents(document);
  if (solveResult.nonConvergedComponents.some((nodeKeys) => nodeKeys.some((key) => affectedNodeKeys.has(key)))) return undefined;
  const globallySolved = solveResult.document;
  const solvedById = new Map(globallySolved.elements.map((element) => [element.id, element]));
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
