import type { PointMm } from "@nodra/domain";
import { closestParameter, type Curve2D } from "./curve2d.js";
import { PARAMETER_EPSILON } from "./tolerances.js";

export interface CurveParameterInterval {
  readonly start: number;
  readonly end: number;
  readonly wrapsSeam: boolean;
}

export interface CurveIntervalSelectionOptions {
  readonly parameterEpsilon?: number;
}

export type CurveIntervalSelectionResult =
  | {
      readonly kind: "selected";
      readonly interval: CurveParameterInterval;
      readonly cursorParameter: number;
      readonly cuts: readonly number[];
    }
  | {
      readonly kind: "rejected";
      readonly reason: "insufficient-cuts" | "cursor-on-cut";
    };

const clamp = (parameter: number): number => Math.max(0, Math.min(1, parameter));
const isClosed = (curve: Curve2D): boolean => curve.type === "circle" || (curve.type === "arc" && curve.fullTurn === true);

function toleranceOrDefault(options?: CurveIntervalSelectionOptions): number {
  const tolerance = options?.parameterEpsilon ?? PARAMETER_EPSILON;
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance >= 0.5) throw new Error("parameterEpsilon must be finite and within [0, 0.5)");
  return tolerance;
}

function validateCuts(parameters: readonly number[]): void {
  if (!parameters.every((parameter) => Number.isFinite(parameter) && parameter >= 0 && parameter <= 1)) throw new Error("cut parameters must be finite and within [0, 1]");
}

function normalizedCuts(parameters: readonly number[], closed: boolean, tolerance: number): number[] {
  const normalized = parameters.map((parameter) => {
    if (parameter <= tolerance) return 0;
    if (parameter >= 1 - tolerance) return closed ? 0 : 1;
    return clamp(parameter);
  }).sort((first, second) => first - second).filter((parameter, index, all) => index === 0 || parameter - all[index - 1]! > tolerance);
  return closed ? normalized : normalized.filter((parameter) => parameter > tolerance && parameter < 1 - tolerance);
}

function cyclicDistance(first: number, second: number): number {
  const distance = Math.abs(first - second);
  return Math.min(distance, 1 - distance);
}

/** Selects the parameter interval containing the closest point to `cursor`.
 * Picking tolerance remains a caller concern; this function only uses parameter tolerance. */
export function selectRemovableCurveInterval(
  curve: Curve2D,
  cutParameters: readonly number[],
  cursor: PointMm,
  options?: CurveIntervalSelectionOptions,
): CurveIntervalSelectionResult {
  if (![cursor.x, cursor.y].every(Number.isFinite)) throw new Error("cursor coordinates must be finite");
  validateCuts(cutParameters);
  const parameterEpsilon = toleranceOrDefault(options); const closed = isClosed(curve);
  const rawCursorParameter = closestParameter(curve, cursor);
  const cuts = normalizedCuts(cutParameters, closed, parameterEpsilon);
  if ((!closed && cuts.length === 0) || (closed && cuts.length < 2)) return { kind: "rejected", reason: "insufficient-cuts" };
  const cursorParameter = closed && rawCursorParameter >= 1 - parameterEpsilon ? 0 : rawCursorParameter;
  const onCut = cuts.some((cut) => closed ? cyclicDistance(cursorParameter, cut) <= parameterEpsilon : Math.abs(cursorParameter - cut) <= parameterEpsilon);
  if (onCut) return { kind: "rejected", reason: "cursor-on-cut" };
  if (!closed) {
    const boundaries = [0, ...cuts, 1];
    for (let index = 0; index + 1 < boundaries.length; index += 1) {
      const start = boundaries[index]!; const end = boundaries[index + 1]!;
      if (cursorParameter > start && cursorParameter < end || cursorParameter === start && start === 0 || cursorParameter === end && end === 1) {
        return { kind: "selected", interval: { start, end, wrapsSeam: false }, cursorParameter, cuts };
      }
    }
  } else {
    for (let index = 0; index + 1 < cuts.length; index += 1) {
      const start = cuts[index]!; const end = cuts[index + 1]!;
      if (cursorParameter > start && cursorParameter < end) return { kind: "selected", interval: { start, end, wrapsSeam: false }, cursorParameter, cuts };
    }
    return { kind: "selected", interval: { start: cuts.at(-1)!, end: cuts[0]!, wrapsSeam: true }, cursorParameter, cuts };
  }
  return { kind: "rejected", reason: "cursor-on-cut" };
}
