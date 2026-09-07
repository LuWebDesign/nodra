import type { PointMm } from "@nodra/domain";
import { GEOMETRY_EPSILON } from "./tolerances.js";
import type { ArcCurve2D } from "./curve2d.js";

const TAU = Math.PI * 2;

/**
 * Builds the unique circular arc from `start` to `end` which passes through
 * `through`. Coordinates are model millimetres in the top-left frame (so a
 * positive angle/direction clockwise on screen).
 */
export function arcThroughThreePoints(
  start: PointMm,
  end: PointMm,
  through: PointMm,
  geometryEpsilon = GEOMETRY_EPSILON,
): ArcCurve2D | undefined {
  const values = [start.x, start.y, end.x, end.y, through.x, through.y, geometryEpsilon];
  if (!values.every(Number.isFinite)) throw new Error("points and geometryEpsilon must be finite");
  if (geometryEpsilon < 0) throw new Error("geometryEpsilon must not be negative");

  // Work in coordinates translated by start, and normalize before products.
  // This avoids both loss of precision for translated documents and overflow
  // in the circumcenter determinant.
  const ux = end.x - start.x;
  const uy = end.y - start.y;
  const vx = through.x - start.x;
  const vy = through.y - start.y;
  if (![ux, uy, vx, vy].every(Number.isFinite)) return undefined;
  const wx = through.x - end.x;
  const wy = through.y - end.y;
  if (![wx, wy].every(Number.isFinite)) return undefined;
  if (Math.hypot(ux, uy) <= geometryEpsilon || Math.hypot(vx, vy) <= geometryEpsilon || Math.hypot(wx, wy) <= geometryEpsilon) return undefined;
  const scale = Math.max(Math.abs(ux), Math.abs(uy), Math.abs(vx), Math.abs(vy));
  if (!(scale > 0) || !Number.isFinite(scale)) return undefined;
  const unx = ux / scale; const uny = uy / scale;
  const vnx = vx / scale; const vny = vy / scale;
  const uLength = Math.hypot(unx, uny);
  const vLength = Math.hypot(vnx, vny);
  if (!(uLength > 0) || !(vLength > 0)) return undefined;

  // A distance epsilon is converted to a dimensionless, scale-aware area
  // threshold. The machine-epsilon floor rejects configurations whose center
  // cannot be computed reliably even when the requested tolerance is zero.
  const cross = unx * vny - uny * vnx;
  if (!Number.isFinite(cross)) return undefined;
  const collinearThreshold = Math.max(geometryEpsilon / scale, Number.EPSILON * 32);
  if (Math.abs(cross) <= collinearThreshold * uLength) return undefined;

  const uSquared = unx * unx + uny * uny;
  const vSquared = vnx * vnx + vny * vny;
  const centerNormalizedX = (vny * uSquared - uny * vSquared) / (2 * cross);
  const centerNormalizedY = (unx * vSquared - vnx * uSquared) / (2 * cross);
  const offsetX = centerNormalizedX * scale;
  const offsetY = centerNormalizedY * scale;
  const center = { x: start.x + offsetX, y: start.y + offsetY };
  const radius = Math.hypot(offsetX, offsetY);
  if (![center.x, center.y, radius].every(Number.isFinite) || !(radius > geometryEpsilon)) return undefined;

  const angle = (x: number, y: number): number => {
    const result = Math.atan2(y, x);
    return result < 0 ? result + TAU : result;
  };
  // Keep these vectors relative to the translated origin; subtracting two
  // large absolute coordinates here would discard significant digits.
  const startAngle = angle(-offsetX, -offsetY);
  const endAngle = angle(ux - offsetX, uy - offsetY);
  const throughAngle = angle(vx - offsetX, vy - offsetY);
  const clockwiseSweep = (endAngle - startAngle + TAU) % TAU;
  const counterclockwiseSweep = (startAngle - endAngle + TAU) % TAU;
  const clockwiseThrough = (throughAngle - startAngle + TAU) % TAU;
  const counterclockwiseThrough = (startAngle - throughAngle + TAU) % TAU;
  const angleTolerance = Math.min(Math.PI, geometryEpsilon / radius);
  const contains = (position: number, sweep: number): boolean => position <= sweep + angleTolerance;

  // For three distinct, non-collinear points exactly one direction contains
  // the third point (except endpoint-level numerical ties, where clockwise is
  // deterministic). Never emit fullTurn: start and end are distinct here.
  const direction = contains(clockwiseThrough, clockwiseSweep) ? "clockwise"
    : contains(counterclockwiseThrough, counterclockwiseSweep) ? "counterclockwise" : undefined;
  if (!direction) return undefined;
  return { type: "arc", center, radius, startAngle, endAngle, direction };
}
