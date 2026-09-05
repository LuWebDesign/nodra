import type { PointMm } from "@nodra/domain";
import { GEOMETRY_EPSILON, PARAMETER_EPSILON } from "./tolerances.js";

/** Curves use mm coordinates, a top-left frame (positive y is down), and t∈[0,1].
 * Angles are measured from +X; positive angles are visually clockwise. */
export interface LineCurve2D { readonly type: "line"; readonly start: PointMm; readonly end: PointMm }
export interface CubicBezierCurve2D { readonly type: "cubicBezier"; readonly p0: PointMm; readonly p1: PointMm; readonly p2: PointMm; readonly p3: PointMm }
/** A full clockwise turn; t=1 is the same seam point as t=0. */
export interface CircleCurve2D { readonly type: "circle"; readonly center: PointMm; readonly radius: number }
export type ArcDirection = "clockwise" | "counterclockwise";
/** `fullTurn` distinguishes a complete revolution from a zero-sweep arc. */
export interface ArcCurve2D { readonly type: "arc"; readonly center: PointMm; readonly radius: number; readonly startAngle: number; readonly endAngle: number; readonly direction: ArcDirection; readonly fullTurn?: boolean }
export type Curve2D = LineCurve2D | CubicBezierCurve2D | CircleCurve2D | ArcCurve2D;
export interface CurveFragment { readonly curve: Curve2D; readonly sourceInterval: { readonly t0: number; readonly t1: number } }
export interface CurveBounds { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

const TAU = Math.PI * 2;
const POLYNOMIAL_SCALE_EPSILON = Number.EPSILON * 64;
const POLYNOMIAL_VALUE_EPSILON = Number.EPSILON * 1024;
const finite = (values: readonly number[], message: string): void => { if (!values.every(Number.isFinite)) throw new Error(message); };
const clamp = (t: number): number => Math.max(0, Math.min(1, t));
const parameter = (t: number): number => { finite([t], "parameter must be finite"); if (t < 0 || t > 1) throw new Error("parameter must be within [0, 1]"); return t; };
const sign = (direction: ArcDirection): 1 | -1 => direction === "clockwise" ? 1 : -1;
const normalizeAngle = (a: number): number => ((a % TAU) + TAU) % TAU;
function validate(c: Curve2D): void {
  if (c.type === "line") finite([c.start.x, c.start.y, c.end.x, c.end.y], "line coordinates must be finite");
  else if (c.type === "cubicBezier") finite([c.p0.x, c.p0.y, c.p1.x, c.p1.y, c.p2.x, c.p2.y, c.p3.x, c.p3.y], "cubic coordinates must be finite");
  else { finite([c.center.x, c.center.y, c.radius], "circle coordinates must be finite"); if (!(c.radius > 0)) throw new Error("curve radius must be positive"); if (c.type === "arc") finite([c.startAngle, c.endAngle], "arc angles must be finite"); }
}
function cubicPoint(c: CubicBezierCurve2D, t: number): PointMm { const u = 1 - t; return { x: u ** 3 * c.p0.x + 3 * u ** 2 * t * c.p1.x + 3 * u * t ** 2 * c.p2.x + t ** 3 * c.p3.x, y: u ** 3 * c.p0.y + 3 * u ** 2 * t * c.p1.y + 3 * u * t ** 2 * c.p2.y + t ** 3 * c.p3.y }; }
function cubicDerivative(c: CubicBezierCurve2D, t: number): PointMm { const u = 1 - t; return { x: 3 * (u ** 2 * (c.p1.x - c.p0.x) + 2 * u * t * (c.p2.x - c.p1.x) + t ** 2 * (c.p3.x - c.p2.x)), y: 3 * (u ** 2 * (c.p1.y - c.p0.y) + 2 * u * t * (c.p2.y - c.p1.y) + t ** 2 * (c.p3.y - c.p2.y)) }; }
function sweep(c: ArcCurve2D): number { return c.fullTurn ? TAU : normalizeAngle((c.endAngle - c.startAngle) * sign(c.direction)); }
function arcAngle(c: ArcCurve2D, t: number): number { const full = sweep(c); return t === 1 && c.fullTurn ? c.startAngle : c.startAngle + sign(c.direction) * full * t; }
function arcPoint(c: ArcCurve2D, t: number): PointMm { const a = arcAngle(c, t); return { x: c.center.x + c.radius * Math.cos(a), y: c.center.y + c.radius * Math.sin(a) }; }

const checkedPoint = (value: PointMm): PointMm => { if (![value.x, value.y].every(Number.isFinite)) throw new Error("curve calculation exceeds the numeric range"); return { x: value.x === 0 ? 0 : value.x, y: value.y === 0 ? 0 : value.y }; };
export function pointAt(c: Curve2D, t0: number): PointMm {
  validate(c); const t = parameter(t0); let value: PointMm;
  if (c.type === "line") value = { x: (1 - t) * c.start.x + t * c.end.x, y: (1 - t) * c.start.y + t * c.end.y };
  else if (c.type === "cubicBezier") value = cubicPoint(c, t);
  else if (c.type === "circle") { const a = t === 1 ? 0 : TAU * t; value = { x: c.center.x + c.radius * Math.cos(a), y: c.center.y + c.radius * Math.sin(a) }; }
  else value = arcPoint(c, t);
  return checkedPoint(value);
}
/** Raw derivative with respect to t (not a unit tangent), in mm per normalized parameter. */
export function tangentAt(c: Curve2D, t0: number): PointMm {
  validate(c); const t = parameter(t0); let value: PointMm;
  if (c.type === "line") value = { x: c.end.x - c.start.x, y: c.end.y - c.start.y };
  else if (c.type === "cubicBezier") value = cubicDerivative(c, t);
  else { const a = c.type === "circle" ? TAU * t : arcAngle(c, t); const angularSweep = c.type === "circle" ? TAU : sign(c.direction) * sweep(c); value = { x: -c.radius * angularSweep * Math.sin(a), y: c.radius * angularSweep * Math.cos(a) }; }
  return checkedPoint(value);
}
const distanceSquared = (a: PointMm, b: PointMm): number => { const value = (a.x - b.x) ** 2 + (a.y - b.y) ** 2; if (!Number.isFinite(value)) throw new Error("curve calculation exceeds the numeric range"); return value; };

// Polynomial coefficients are constant-first. Root isolation recursively uses all
// critical points, so tangent (even-multiplicity) roots are not lost.
function polynomialDerivative(p: readonly number[]): number[] { return p.slice(1).map((v, i) => v * (i + 1)); }
function polynomialAt(p: readonly number[], x: number): number { let result = 0; for (let i = p.length - 1; i >= 0; i--) result = result * x + p[i]!; return result; }
function rootsInUnit(p: readonly number[]): number[] {
  if (!p.every(Number.isFinite)) throw new Error("curve calculation exceeds the numeric range");
  const coefficients = [...p];
  const scale = Math.max(...coefficients.map(Math.abs));
  if (scale === 0) return [];
  while (coefficients.length > 1 && Math.abs(coefficients.at(-1)!) <= POLYNOMIAL_SCALE_EPSILON * scale) coefficients.pop();
  if (coefficients.length <= 1) return [];
  const derivative = rootsInUnit(polynomialDerivative(coefficients));
  const bounds = [0, ...derivative, 1].sort((a, b) => a - b);
  const valueTolerance = POLYNOMIAL_VALUE_EPSILON * scale;
  const roots: number[] = [];
  for (const x of bounds) if (Math.abs(polynomialAt(coefficients, x)) <= valueTolerance) roots.push(x);
  for (let i = 0; i + 1 < bounds.length; i++) {
    let lo = bounds[i]!, hi = bounds[i + 1]!; let flo = polynomialAt(coefficients, lo), fhi = polynomialAt(coefficients, hi);
    if (Math.abs(flo) <= valueTolerance || Math.abs(fhi) <= valueTolerance || (flo < 0) === (fhi < 0)) continue;
    while (hi - lo > PARAMETER_EPSILON) { const mid = (lo + hi) / 2; const fm = polynomialAt(coefficients, mid); if (Math.abs(fm) <= valueTolerance) { lo = mid; hi = mid; break; } if ((flo < 0) === (fm < 0)) { lo = mid; flo = fm; } else { hi = mid; fhi = fm; } }
    roots.push((lo + hi) / 2);
  }
  return roots.sort((a, b) => a - b).filter((x, i, all) => i === 0 || x - all[i - 1]! > PARAMETER_EPSILON);
}
function cubicDistancePolynomial(c: CubicBezierCurve2D, p: PointMm): number[] {
  const x = [c.p0.x - p.x, 3 * (c.p1.x - c.p0.x), 3 * (c.p0.x - 2 * c.p1.x + c.p2.x), -c.p0.x + 3 * c.p1.x - 3 * c.p2.x + c.p3.x];
  const y = [c.p0.y - p.y, 3 * (c.p1.y - c.p0.y), 3 * (c.p0.y - 2 * c.p1.y + c.p2.y), -c.p0.y + 3 * c.p1.y - 3 * c.p2.y + c.p3.y];
  const dx = [x[1]!, 2 * x[2]!, 3 * x[3]!], dy = [y[1]!, 2 * y[2]!, 3 * y[3]!];
  const result = Array.from({ length: 6 }, () => 0); for (let i = 0; i < x.length; i++) for (let j = 0; j < dx.length; j++) result[i + j] = (result[i + j] ?? 0) + x[i]! * dx[j]! + y[i]! * dy[j]!; if (!result.every(Number.isFinite)) throw new Error("curve calculation exceeds the numeric range"); return result;
}
export function closestParameter(c: Curve2D, p: PointMm): number {
  validate(c); finite([p.x, p.y], "point must be finite");
  if (c.type === "line") { const dx = c.end.x - c.start.x, dy = c.end.y - c.start.y, d = dx * dx + dy * dy; if (!Number.isFinite(d)) throw new Error("curve calculation exceeds the numeric range"); return d <= GEOMETRY_EPSILON ** 2 ? 0 : clamp(((p.x - c.start.x) * dx + (p.y - c.start.y) * dy) / d); }
  if (c.type === "circle") return normalizeAngle(Math.atan2(p.y - c.center.y, p.x - c.center.x)) / TAU;
  if (c.type === "arc") { const s = sweep(c); const d = normalizeAngle((Math.atan2(p.y - c.center.y, p.x - c.center.x) - c.startAngle) * sign(c.direction)); if (c.fullTurn) return d / TAU; if (s === 0) return 0; if (d <= s) return clamp(d / s); const da = distanceSquared(p, arcPoint(c, 0)), db = distanceSquared(p, arcPoint(c, 1)); return db < da ? 1 : 0; }
  const candidates = [0, 1, ...rootsInUnit(cubicDistancePolynomial(c, p))]; let best = 0, bestDistance = distanceSquared(pointAt(c, 0), p); for (const t of candidates) { const d = distanceSquared(pointAt(c, t), p); if (d < bestDistance) { best = t; bestDistance = d; } } return best;
}
function extremaForCubic(a: number, b: number, c: number): number[] { const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c)); if (scale === 0) return []; const normalizedA = a / scale, normalizedB = b / scale, normalizedC = c / scale; if (Math.abs(normalizedA) <= POLYNOMIAL_SCALE_EPSILON) return Math.abs(normalizedB) <= POLYNOMIAL_SCALE_EPSILON ? [] : [-normalizedC / normalizedB].filter((t) => t > 0 && t < 1); const disc = normalizedB * normalizedB - 4 * normalizedA * normalizedC; if (disc < -POLYNOMIAL_SCALE_EPSILON) return []; if (Math.abs(disc) <= POLYNOMIAL_SCALE_EPSILON) { const t = -normalizedB / (2 * normalizedA); return t > 0 && t < 1 ? [t] : []; } const root = Math.sqrt(disc); return [-normalizedB - root, -normalizedB + root].map((v) => v / (2 * normalizedA)).filter((t) => t > 0 && t < 1); }
export function curveBounds(c: Curve2D): CurveBounds { validate(c); const points: PointMm[] = [pointAt(c, 0), pointAt(c, 1)]; if (c.type === "cubicBezier") for (const axis of ["x", "y"] as const) { const a = -c[`p0`][axis] + 3 * c.p1[axis] - 3 * c.p2[axis] + c.p3[axis], b = 2 * (c.p0[axis] - 2 * c.p1[axis] + c.p2[axis]), d = c.p1[axis] - c.p0[axis]; for (const t of extremaForCubic(a, b, d)) points.push(pointAt(c, t)); } else if (c.type === "circle" || c.type === "arc") { const angles = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]; for (const a of angles) { const t = c.type === "circle" ? normalizeAngle(a) / TAU : normalizeAngle((a - c.startAngle) * sign(c.direction)) / sweep(c); if (c.type === "circle" || t >= -PARAMETER_EPSILON && t <= 1 + PARAMETER_EPSILON) { const cardinal = a === 0 ? { x: c.center.x + c.radius, y: c.center.y } : a === Math.PI / 2 ? { x: c.center.x, y: c.center.y + c.radius } : a === Math.PI ? { x: c.center.x - c.radius, y: c.center.y } : { x: c.center.x, y: c.center.y - c.radius }; points.push(cardinal); } } } const xs = points.map((p) => p.x), ys = points.map((p) => p.y), x = Math.min(...xs), y = Math.min(...ys); const bounds = { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }; if (!Object.values(bounds).every(Number.isFinite)) throw new Error("curve calculation exceeds the numeric range"); return bounds; }
function splitCubic(c: CubicBezierCurve2D, t: number): [CubicBezierCurve2D, CubicBezierCurve2D] { const l = (a: PointMm, b: PointMm): PointMm => checkedPoint({ x: (1 - t) * a.x + t * b.x, y: (1 - t) * a.y + t * b.y }); const a = l(c.p0, c.p1), b = l(c.p1, c.p2), d = l(c.p2, c.p3), e = l(a, b), f = l(b, d), m = l(e, f); return [{ type: "cubicBezier", p0: c.p0, p1: a, p2: e, p3: m }, { type: "cubicBezier", p0: m, p1: f, p2: d, p3: c.p3 }]; }
export function splitCurveAtParameters(c: Curve2D, parameters: readonly number[]): readonly CurveFragment[] { validate(c); if (!parameters.every(Number.isFinite) || parameters.some((t) => t < 0 || t > 1)) throw new Error("parameters must be finite and within [0, 1]"); const cuts = parameters.slice().filter((t) => t > PARAMETER_EPSILON && t < 1 - PARAMETER_EPSILON).sort((a, b) => a - b).filter((t, i, all) => i === 0 || t - all[i - 1]! > PARAMETER_EPSILON); const bounds = [0, ...cuts, 1]; const out: CurveFragment[] = []; for (let i = 0; i + 1 < bounds.length; i++) { const t0 = bounds[i]!, t1 = bounds[i + 1]!; let piece: Curve2D; if (c.type === "line") piece = { type: "line", start: pointAt(c, t0), end: pointAt(c, t1) }; else if (c.type === "cubicBezier") { const right = splitCubic(c, t0)[1]; piece = t0 === 0 && t1 === 1 ? c : splitCubic(right, (t1 - t0) / (1 - t0))[0]; } else if (c.type === "circle") piece = { type: "arc", center: c.center, radius: c.radius, startAngle: TAU * t0, endAngle: TAU * t1, direction: "clockwise", ...(t0 === 0 && t1 === 1 ? { fullTurn: true } : {}) }; else piece = { type: "arc", center: c.center, radius: c.radius, startAngle: arcAngle(c, t0), endAngle: arcAngle(c, t1), direction: c.direction, ...(t0 === 0 && t1 === 1 && c.fullTurn ? { fullTurn: true } : {}) }; out.push({ curve: piece, sourceInterval: { t0, t1 } }); } return out; }
