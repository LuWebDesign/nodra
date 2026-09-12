import type { Curve2DSource } from "./curve2d-adapters.js";
import type { CurvePiece2D, Curve2D } from "./curve2d.js";
import { intersectCurves, type IntersectionOptions, type IntersectionPoint, type IntersectionResult, type IntersectionSpan } from "./intersection-engine.js";

export interface MixedIntersectionDiagnostic {
  readonly code: "malformed-piece" | "unsupported-pair" | "overlap";
  readonly message: string;
  readonly severity: "info" | "warning";
}

export interface CurvePieceProvenance {
  readonly source: Curve2DSource;
  readonly sourceInterval: CurvePiece2D["sourceInterval"];
  readonly orientation: CurvePiece2D["orientation"];
  readonly endpointIdentity?: CurvePiece2D["endpointIdentity"];
}

export interface MixedIntersectionPoint extends IntersectionPoint {
  readonly firstSourceParameter: number;
  readonly secondSourceParameter: number;
}

export interface MixedIntersectionSpan {
  readonly firstInterval: IntersectionSpan["firstInterval"];
  readonly secondInterval: IntersectionSpan["secondInterval"];
  readonly firstSourceInterval: IntersectionSpan["firstInterval"];
  readonly secondSourceInterval: IntersectionSpan["secondInterval"];
}

export interface MixedIntersectionPair {
  /** The actual piece objects are retained so callers never need array position as identity. */
  readonly firstPiece: CurvePiece2D;
  readonly secondPiece: CurvePiece2D;
  readonly first: CurvePieceProvenance;
  readonly second: CurvePieceProvenance;
  readonly kind: IntersectionResult["kind"];
  readonly points: readonly MixedIntersectionPoint[];
  readonly spans: readonly MixedIntersectionSpan[];
  readonly reason?: "curve-pair" | "degenerate-line" | "coincident-curve-portions";
  readonly diagnostics: readonly MixedIntersectionDiagnostic[];
}

export interface MixedIntersectionCollection {
  readonly pairs: readonly MixedIntersectionPair[];
}

function provenance(piece: CurvePiece2D): CurvePieceProvenance {
  return {
    source: piece.source,
    sourceInterval: piece.sourceInterval,
    orientation: piece.orientation,
    ...(piece.endpointIdentity ? { endpointIdentity: piece.endpointIdentity } : {}),
  };
}

function validPiece(piece: CurvePiece2D): boolean {
  if (!piece || typeof piece !== "object" || !piece.curve || typeof piece.curve !== "object") return false;
  const interval = piece.sourceInterval;
  return !!interval && Number.isFinite(interval.t0) && Number.isFinite(interval.t1) && interval.t0 <= interval.t1
    && (piece.orientation === "forward" || piece.orientation === "reverse") && !!piece.source;
}

function sourceParameter(parameter: number, piece: CurvePiece2D): number {
  const { t0, t1 } = piece.sourceInterval;
  const value = piece.orientation === "forward" ? t0 + (t1 - t0) * parameter : t1 - (t1 - t0) * parameter;
  if (!Number.isFinite(value)) throw new Error("source parameter calculation exceeds the numeric range");
  return value;
}

function mapPoint(point: IntersectionPoint, first: CurvePiece2D, second: CurvePiece2D): MixedIntersectionPoint {
  return {
    ...point,
    firstSourceParameter: sourceParameter(point.firstParameter, first),
    secondSourceParameter: sourceParameter(point.secondParameter, second),
  };
}

function mapInterval(interval: IntersectionSpan["firstInterval"], piece: CurvePiece2D): IntersectionSpan["firstInterval"] {
  const start = sourceParameter(interval.t0, piece);
  const end = sourceParameter(interval.t1, piece);
  return { t0: Math.min(start, end), t1: Math.max(start, end) };
}

function pairResult(firstPiece: CurvePiece2D, secondPiece: CurvePiece2D, result: IntersectionResult): MixedIntersectionPair {
  const diagnostics: MixedIntersectionDiagnostic[] = [];
  if (result.kind === "unsupported") diagnostics.push({ code: "unsupported-pair", message: `Unsupported curve pair: ${result.reason}`, severity: "warning" });
  if (result.kind === "overlap") diagnostics.push({ code: "overlap", message: "Curves contain coincident or overlapping portions; no crossing topology was inferred.", severity: "info" });
  const spans = result.kind === "overlap"
    ? result.spans.map((span) => ({ ...span, firstSourceInterval: mapInterval(span.firstInterval, firstPiece), secondSourceInterval: mapInterval(span.secondInterval, secondPiece) }))
    : [];
  return {
    firstPiece,
    secondPiece,
    first: provenance(firstPiece),
    second: provenance(secondPiece),
    kind: result.kind,
    points: result.kind === "points" || result.kind === "overlap" ? result.points.map((point) => mapPoint(point, firstPiece, secondPiece)) : [],
    spans,
    ...(result.kind === "unsupported" ? { reason: result.reason } : {}),
    diagnostics,
  };
}

function malformedPair(firstPiece: CurvePiece2D, secondPiece: CurvePiece2D): MixedIntersectionPair {
  const diagnostic: MixedIntersectionDiagnostic = { code: "malformed-piece", message: "A curve piece has invalid native geometry or source metadata; intersection was not attempted.", severity: "warning" };
  return { firstPiece, secondPiece, first: provenance(firstPiece), second: provenance(secondPiece), kind: "unsupported", points: [], spans: [], reason: "curve-pair", diagnostics: [diagnostic] };
}

/** Collects deterministic pairwise intersections without flattening or mutating native curve pieces. */
export function collectMixedIntersections(pieces: readonly CurvePiece2D[], options?: IntersectionOptions): MixedIntersectionCollection {
  const pairs: MixedIntersectionPair[] = [];
  for (let firstIndex = 0; firstIndex < pieces.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < pieces.length; secondIndex += 1) {
      const first = pieces[firstIndex]!;
      const second = pieces[secondIndex]!;
      if (!validPiece(first) || !validPiece(second)) {
        pairs.push(malformedPair(first, second));
        continue;
      }
      try {
        pairs.push(pairResult(first, second, intersectCurves(first.curve, second.curve, options)));
      } catch (error) {
        const malformed = malformedPair(first, second);
        pairs.push({ ...malformed, diagnostics: [{ ...malformed.diagnostics[0]!, message: error instanceof Error ? error.message : malformed.diagnostics[0]!.message }] });
      }
    }
  }
  return { pairs };
}

export type { Curve2D };
