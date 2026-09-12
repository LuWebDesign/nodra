import type { CircleElement, DocumentSnapshot, ElementId, PointMm, SketchElement } from "@nodra/domain";
import { solveConstraintComponents, type ConstraintDiagnostic } from "@nodra/constraints";
import { collectMixedIntersections, deriveCurvePieces, elementToCurves, sketchProfileResult, solveCircleConstraints, type CurvePiece2D, type MixedIntersectionPair } from "@nodra/geometry";
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

export type SketchMixedTopologyDiagnosticCode = "unsupported" | "overlap" | "malformed" | "ambiguous";
    export interface SketchMixedTopologyDiagnostic {
      readonly code: SketchMixedTopologyDiagnosticCode;
      readonly message: string;
      readonly severity: "info" | "warning";
      readonly firstElementId?: ElementId;
      readonly secondElementId?: ElementId;
    }

    /** Derived-only native curve pieces and pair interactions; never persisted. */
    export interface SketchMixedTopologyResult {
      readonly pieces: readonly CurvePiece2D[];
      readonly intersections: readonly MixedIntersectionPair[];
      readonly diagnostics: readonly SketchMixedTopologyDiagnostic[];
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
      readonly derivedMixedTopology: SketchMixedTopologyResult;
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
  const profile = sketchProfileResult(sketch);
  const contours = [...profile.outerRegions, ...profile.holes];
  const invalid = profile.status === "invalid" || profile.status === "degenerate" || profile.status === "ambiguous";
  const diagnostics: SketchTopologyDiagnostic[] = invalid
    ? [{ code: "invalid-topology", sketchId: sketch.id, message: profile.diagnostics.map((diagnostic) => diagnostic.message).join("; ") }]
    : profile.status === "valid-closed"
      ? [{ code: "closed-profile", sketchId: sketch.id, message: `${contours.length} closed profile${contours.length === 1 ? "" : "s"} detected` }]
      : [{ code: "open-profile", sketchId: sketch.id, message: "Sketch contains an open or incomplete profile" }];
  return { diagnostics, contours, valid: !invalid, profileReady: profile.status === "valid-closed" };
};

const sourceElementId = (piece: CurvePiece2D): ElementId => piece.source.elementId;
    const mixedDiagnostic = (pair: MixedIntersectionPair, code: SketchMixedTopologyDiagnosticCode, message: string, severity: "info" | "warning"): SketchMixedTopologyDiagnostic => ({ code, message, severity, firstElementId: sourceElementId(pair.firstPiece), secondElementId: sourceElementId(pair.secondPiece) });

    /** Derives native mixed interactions after validation, without changing document state. */
    const deriveMixedTopology = (document: DocumentSnapshot): SketchMixedTopologyResult => {
      const malformed: SketchMixedTopologyDiagnostic[] = [];
      const sourced = document.elements.slice().sort((first, second) => byStableText(first.id, second.id)).flatMap((element) => {
        try { return elementToCurves(element); }
        catch (error) { malformed.push({ code: "malformed", message: error instanceof Error ? error.message : "Malformed element geometry", severity: "warning", firstElementId: element.id }); return []; }
      });
      const pieces: CurvePiece2D[] = [];
      sourced.forEach((curve) => {
        try { pieces.push(...deriveCurvePieces([curve])); }
        catch (error) { malformed.push({ code: "malformed", message: error instanceof Error ? error.message : "Malformed native curve metadata", severity: "warning", firstElementId: curve.source.elementId }); }
      });
      const intersections = collectMixedIntersections(pieces).pairs;
      const diagnostics = [...malformed, ...intersections.flatMap((pair) => {
        const pairDiagnostics = pair.diagnostics.flatMap((diagnostic) => {
          const code = diagnostic.code === "unsupported-pair" ? "unsupported" : diagnostic.code === "malformed-piece" ? "malformed" : "overlap";
          return [mixedDiagnostic(pair, code, diagnostic.message, diagnostic.severity)];
        });
        const ambiguous = pair.points.some((point, index) => pair.points.slice(index + 1).some((other) => Math.hypot(point.point.x - other.point.x, point.point.y - other.point.y) <= 1e-9));
        return ambiguous ? [...pairDiagnostics, mixedDiagnostic(pair, "ambiguous", "Multiple intersection results resolve to the same geometric point; topology is ambiguous.", "warning")] : pairDiagnostics;
      })].sort((first, second) => byStableText(`${first.code}:${first.firstElementId ?? ""}:${first.secondElementId ?? ""}:${first.message}`, `${second.code}:${second.firstElementId ?? ""}:${second.secondElementId ?? ""}:${second.message}`));
      return { pieces, intersections, diagnostics };
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
          derivedMixedTopology: { pieces: [], intersections: [], diagnostics: [] },
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
  const derivedMixedTopology = deriveMixedTopology(circlesDocument);
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
        derivedMixedTopology,
    profileReady: !failed && topology.length > 0 && topology.every((value) => value.valid && value.profileReady),
    contours,
  };
}

/** Short alias for callers that already operate on document recomputes. */
export const recomputeSketch = recomputeSketchKernel;
