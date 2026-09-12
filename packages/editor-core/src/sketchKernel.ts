import type { CircleElement, DocumentSnapshot, ElementId, PointMm, SketchElement } from "@nodra/domain";
import { solveConstraintComponents, type ConstraintDiagnostic } from "@nodra/constraints";
import { classifyCutGraph, cuttableSegments, solveCircleConstraints, splitCuttableSegments } from "@nodra/geometry";
import { validateDocument } from "@nodra/validation";

/**
 * First bounded Sketch Kernel slice.
 *
 * This facade intentionally supports the existing 2D line-segment sketch graph,
 * local sketch constraints, and existing document-level constraints only. It
 * does not implement Offset, Mirror, Fillet, Projection/Use, Patterns, or 3D.
 * Derived state is returned, never persisted, and this function never advances
 * the document revision.
 */
/**
 * Kernel command contract: callers provide a snapshot and explicitly identify
 * whether it is provisional preview or the candidate for commit. The kernel
 * owns solve/validation and topology metadata; editor-core owns revision,
 * history, and the final commit/undo/redo transaction.
 */
export type SketchKernelOperationPhase = "preview" | "commit";
export interface SketchKernelOperationInput {
  readonly document: DocumentSnapshot;
  readonly phase: SketchKernelOperationPhase;
}
export type SketchKernelState = "committed" | "rollback";
export type SketchTopologyDiagnosticCode = "invalid-input" | "invalid-topology" | "open-profile" | "closed-profile";

export interface SketchTopologyDiagnostic {
  readonly code: SketchTopologyDiagnosticCode;
  readonly sketchId?: ElementId;
  readonly message: string;
}

export interface CircleConstraintDiagnostic {
  readonly code: "circle-constraint-conflict";
  readonly circleId: ElementId;
  readonly constraintIds: readonly string[];
  readonly message: string;
}

export interface SketchKernelRecomputeResult {
  readonly document: DocumentSnapshot;
  readonly changed: boolean;
  readonly committed: boolean;
  readonly rollback: boolean;
  readonly converged: boolean;
  readonly state: SketchKernelState;
  readonly constraintDiagnostics: readonly ConstraintDiagnostic[];
  readonly circleConstraintDiagnostics: readonly CircleConstraintDiagnostic[];
  readonly topologyDiagnostics: readonly SketchTopologyDiagnostic[];
  readonly profileReady: boolean;
  readonly contours: readonly (readonly PointMm[])[];
}

/**
 * Result semantics: failed validation or topology/constraint solving rolls
 * back atomically to the input snapshot. Stable node/edge IDs and the
 * reference map describe topology changes; constraints are solved after
 * topology edits. Closed profiles are reported as future extrusion-ready
 * metadata only. No revision or history is changed here.
 */
export type SketchKernelOperationResult = SketchKernelRecomputeResult;

const byStableText = (first: string, second: string): number => first < second ? -1 : first > second ? 1 : 0;
const cloneDocument = (document: DocumentSnapshot): DocumentSnapshot => ({
  ...document,
  layers: document.layers.map((layer) => ({ ...layer })),
  elements: document.elements.map((element) => element.type === "sketch"
    ? { ...element, nodes: element.nodes.map((node) => ({ ...node, point: { ...node.point } })), edges: element.edges.map((edge) => ({ ...edge })), ...(element.constraints ? { constraints: [...element.constraints] } : {}) }
    : element),
});

const topologyForSketch = (sketch: SketchElement): {
  readonly diagnostics: readonly SketchTopologyDiagnostic[];
  readonly contours: readonly (readonly PointMm[])[];
  readonly valid: boolean;
  readonly profileReady: boolean;
} => {
  const segments = cuttableSegments(sketch);
  const invalidGeometry = segments.length !== sketch.edges.length || segments.some((segment) => segment.start.x === segment.end.x && segment.start.y === segment.end.y);
  if (invalidGeometry) return { diagnostics: [{ code: "invalid-topology", sketchId: sketch.id, message: "Sketch topology contains a missing or degenerate line segment" }], contours: [], valid: false, profileReady: false };

  const graph = classifyCutGraph(splitCuttableSegments(segments));
  const contours = graph.cycles.map((cycle) => [...cycle.points, cycle.points[0]!]);
  const hasOpenPieces = graph.openPieces.length > 0;
  const diagnostics: SketchTopologyDiagnostic[] = contours.length && !hasOpenPieces
    ? [{ code: "closed-profile", sketchId: sketch.id, message: `${contours.length} closed profile${contours.length === 1 ? "" : "s"} detected` }]
    : [{ code: "open-profile", sketchId: sketch.id, message: "Sketch contains an open or incomplete profile" }];
  // Open pieces are valid editable topology, but a profile is ready only when every piece belongs to a face.
  return { diagnostics, contours, valid: true, profileReady: contours.length > 0 && !hasOpenPieces };
};

/** Recomputes a validated immutable sketch document without changing its revision. */
export function recomputeSketchKernel(input: unknown): SketchKernelRecomputeResult {
  const original = input as DocumentSnapshot;
  const checked = validateDocument(input);
  if (!checked.success) {
    return {
      document: original,
      changed: false,
      committed: false,
      rollback: true,
      converged: false,
      state: "rollback",
      constraintDiagnostics: [],
          circleConstraintDiagnostics: [],
      topologyDiagnostics: [{ code: "invalid-input", message: checked.error }],
      profileReady: false,
      contours: [],
    };
  }

  const document = checked.data;
  const solved = solveConstraintComponents(document);
      const circles = solved.document.elements.filter((element): element is CircleElement => element.type === "circle" && element.circleConstraints !== undefined).sort((first, second) => byStableText(first.id, second.id));
      const circleResults = circles.map((circle) => ({ circle, result: solveCircleConstraints(circle) }));
      const circleConstraintDiagnostics = circleResults.flatMap(({ circle, result }) => result.status === "conflict"
        ? [{ code: "circle-constraint-conflict" as const, circleId: circle.id, constraintIds: [...result.conflicts].sort(byStableText), message: `Circle constraints are in conflict: ${[...result.conflicts].sort(byStableText).join(", ")}` }]
        : []).sort((first, second) => byStableText(`${first.circleId}:${first.constraintIds.join(",")}`, `${second.circleId}:${second.constraintIds.join(",")}`));
      const circlesDocument = circleConstraintDiagnostics.length
        ? solved.document
        : { ...solved.document, elements: solved.document.elements.map((element) => {
          const circle = circleResults.find((candidate) => candidate.circle.id === element.id)?.result.circle;
          return circle ?? element;
        }) };
  const sketches = circlesDocument.elements.filter((element): element is SketchElement => element.type === "sketch").sort((first, second) => byStableText(first.id, second.id));
  const topology = sketches.map(topologyForSketch);
  const topologyDiagnostics = topology.flatMap((value) => value.diagnostics).sort((first, second) => byStableText(`${first.code}:${first.sketchId ?? ""}`, `${second.code}:${second.sketchId ?? ""}`));
  const invalidTopology = topology.some((value) => !value.valid);
  const failed = !solved.converged || solved.diagnostics.some((diagnostic) => diagnostic.code === "constraint-conflict" || diagnostic.code === "unsupported-constraint" || diagnostic.code === "non-converged-component") || circleConstraintDiagnostics.length > 0 || invalidTopology;
  const committedDocument = failed ? cloneDocument(document) : cloneDocument(circlesDocument);
  const contours = topology.flatMap((value) => value.contours);
  return {
    document: committedDocument,
    changed: !failed && solved.changed,
    committed: !failed,
    rollback: failed,
    converged: solved.converged,
    state: failed ? "rollback" : "committed",
    constraintDiagnostics: [...solved.diagnostics].sort((first, second) => byStableText(`${first.code}:${first.constraintIds.join(",")}`, `${second.code}:${second.constraintIds.join(",")}`)),
        circleConstraintDiagnostics,
    topologyDiagnostics,
    profileReady: !failed && topology.length > 0 && topology.every((value) => value.valid && value.profileReady),
    contours,
  };
}

/** Short alias for callers that already operate on document recomputes. */
export const recomputeSketch = recomputeSketchKernel;
