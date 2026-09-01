import type { Element, ElementId } from "@nodra/domain";

export type TopologyReference =
  | { readonly kind: "sketch-edge"; readonly elementId: ElementId; readonly edgeId: string }
  | { readonly kind: "path-segment"; readonly elementId: ElementId; readonly segmentId: string };

export type ReferenceResolution =
  | { readonly kind: "preserved"; readonly reference: TopologyReference }
  | { readonly kind: "replaced"; readonly references: readonly TopologyReference[] }
  | { readonly kind: "removed"; readonly reason: string };

export interface TopologyDiagnostic {
  readonly code: "reference-removed";
  readonly referenceKey: string;
  readonly message: string;
}

export interface TopologyEditResult {
  readonly elements: readonly Element[];
  readonly referenceMap: ReadonlyMap<string, ReferenceResolution>;
  readonly diagnostics: readonly TopologyDiagnostic[];
}

export const topologyReferenceKey = (reference: TopologyReference): string => reference.kind === "sketch-edge"
  ? `${reference.elementId}:edge:${reference.edgeId}`
  : `${reference.elementId}:segment:${reference.segmentId}`;
