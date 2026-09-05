import type { PointMm } from "@nodra/domain";
import type { CircleCurve2D, CubicBezierCurve2D, Curve2D, LineCurve2D } from "./curve2d.js";
import { GEOMETRY_EPSILON, PARAMETER_EPSILON } from "./tolerances.js";

export interface IntersectionOptions {
  readonly geometryEpsilon?: number;
  readonly parameterEpsilon?: number;
}

export type IntersectionContact = "crossing" | "tangent" | "endpoint";
export interface IntersectionPoint {
  readonly point: PointMm;
  readonly firstParameter: number;
  readonly secondParameter: number;
  readonly contact: IntersectionContact;
}
export interface ParameterInterval { readonly t0: number; readonly t1: number }
export interface IntersectionSpan {
  readonly firstInterval: ParameterInterval;
  readonly secondInterval: ParameterInterval;
}
export type IntersectionResult =
  | { readonly kind: "none" }
  | { readonly kind: "points"; readonly points: readonly IntersectionPoint[] }
  | { readonly kind: "overlap"; readonly spans: readonly IntersectionSpan[]; readonly points: readonly IntersectionPoint[] }
  | { readonly kind: "unsupported"; readonly reason: "curve-pair" | "degenerate-line" };

const ROOT_COEFFICIENT_EPSILON = Number.EPSILON * 128;
const ROOT_VALUE_EPSILON = Number.EPSILON * 2048;
const ANGULAR_EPSILON = Number.EPSILON * 128;
const COORDINATE_ULP_FACTOR = 4;
const ROOT_MAX_ITERATIONS = 128;
const TAU = Math.PI * 2;
const none = (): IntersectionResult => ({ kind: "none" });
const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const cross = (first: PointMm, second: PointMm): number => first.x * second.y - first.y * second.x;
const dot = (first: PointMm, second: PointMm): number => first.x * second.x + first.y * second.y;

function checkedNumber(value: number): number {
  if (!Number.isFinite(value)) throw new Error("intersection calculation exceeds the numeric range");
  return value;
}
function checkedPoint(point: PointMm): PointMm {
  checkedNumber(point.x); checkedNumber(point.y);
  return { x: point.x === 0 ? 0 : point.x, y: point.y === 0 ? 0 : point.y };
}
function subtract(first: PointMm, second: PointMm): PointMm {
  return checkedPoint({ x: first.x - second.x, y: first.y - second.y });
}
function linePoint(line: LineCurve2D, parameter: number): PointMm {
  return checkedPoint({ x: (1 - parameter) * line.start.x + parameter * line.end.x, y: (1 - parameter) * line.start.y + parameter * line.end.y });
}
function cubicPoint(curve: CubicBezierCurve2D, parameter: number): PointMm {
  const inverse = 1 - parameter;
  return checkedPoint({
    x: inverse ** 3 * curve.p0.x + 3 * inverse ** 2 * parameter * curve.p1.x + 3 * inverse * parameter ** 2 * curve.p2.x + parameter ** 3 * curve.p3.x,
    y: inverse ** 3 * curve.p0.y + 3 * inverse ** 2 * parameter * curve.p1.y + 3 * inverse * parameter ** 2 * curve.p2.y + parameter ** 3 * curve.p3.y,
  });
}
function validateCurve(curve: Curve2D): void {
  const values = curve.type === "line"
    ? [curve.start.x, curve.start.y, curve.end.x, curve.end.y]
    : curve.type === "cubicBezier"
      ? [curve.p0.x, curve.p0.y, curve.p1.x, curve.p1.y, curve.p2.x, curve.p2.y, curve.p3.x, curve.p3.y]
      : curve.type === "circle"
        ? [curve.center.x, curve.center.y, curve.radius]
        : [curve.center.x, curve.center.y, curve.radius, curve.startAngle, curve.endAngle];
  if (!values.every(Number.isFinite)) throw new Error("curve coordinates must be finite");
  if ((curve.type === "circle" || curve.type === "arc") && curve.radius <= 0) throw new Error("curve radius must be positive");
}
function optionsOrDefaults(options?: IntersectionOptions): { geometryEpsilon: number; parameterEpsilon: number } {
  const geometryEpsilon = options?.geometryEpsilon ?? GEOMETRY_EPSILON;
  const parameterEpsilon = options?.parameterEpsilon ?? PARAMETER_EPSILON;
  if (![geometryEpsilon, parameterEpsilon].every(Number.isFinite) || geometryEpsilon < 0 || parameterEpsilon < 0 || parameterEpsilon >= 0.5) throw new Error("intersection tolerances must be finite, geometryEpsilon >= 0, and parameterEpsilon in [0, 0.5)");
  return { geometryEpsilon, parameterEpsilon };
}
function coordinateTolerance(curves: readonly Curve2D[]): number {
  const coordinates = curves.flatMap((curve) => curve.type === "line"
    ? [curve.start.x, curve.start.y, curve.end.x, curve.end.y]
    : curve.type === "cubicBezier"
      ? [curve.p0.x, curve.p0.y, curve.p1.x, curve.p1.y, curve.p2.x, curve.p2.y, curve.p3.x, curve.p3.y]
      : [curve.center.x, curve.center.y, curve.radius]);
  return checkedNumber(Number.EPSILON * Math.max(1, ...coordinates.map(Math.abs)) * COORDINATE_ULP_FACTOR);
}

interface LineFrame {
  readonly direction: PointMm;
  readonly length: number;
}
function lineFrame(line: LineCurve2D): LineFrame | undefined {
  const vector = subtract(line.end, line.start); const length = checkedNumber(Math.hypot(vector.x, vector.y));
  if (length === 0) return undefined;
  return { direction: checkedPoint({ x: vector.x / length, y: vector.y / length }), length };
}
function endpointContact(firstParameter: number, secondParameter: number, parameterEpsilon: number): boolean {
  return firstParameter <= parameterEpsilon || firstParameter >= 1 - parameterEpsilon || secondParameter <= parameterEpsilon || secondParameter >= 1 - parameterEpsilon;
}

function intersectLines(first: LineCurve2D, second: LineCurve2D, geometryEpsilon: number, parameterEpsilon: number): IntersectionResult {
  const firstFrame = lineFrame(first); const secondFrame = lineFrame(second);
  if (!firstFrame || !secondFrame) return { kind: "unsupported", reason: "degenerate-line" };
  const between = subtract(second.start, first.start);
  const denominator = checkedNumber(cross(firstFrame.direction, secondFrame.direction));
  const numericDistance = coordinateTolerance([first, second]);
  const spatialTolerance = geometryEpsilon + numericDistance;
  if (Math.abs(denominator) <= ANGULAR_EPSILON) {
    if (Math.abs(checkedNumber(cross(firstFrame.direction, between))) > spatialTolerance) return none();
    const secondStartOnFirst = checkedNumber(dot(between, firstFrame.direction) / firstFrame.length);
    const orientation = checkedNumber(dot(secondFrame.direction, firstFrame.direction));
    const secondEndOnFirst = checkedNumber(secondStartOnFirst + orientation * secondFrame.length / firstFrame.length);
    const overlapStart = Math.max(0, Math.min(secondStartOnFirst, secondEndOnFirst));
    const overlapEnd = Math.min(1, Math.max(secondStartOnFirst, secondEndOnFirst));
    if (overlapEnd < overlapStart) {
      const gap = (overlapStart - overlapEnd) * firstFrame.length;
      if (gap > spatialTolerance) return none();
      const firstParameter = clamp((overlapStart + overlapEnd) / 2);
      const point = linePoint(first, firstParameter);
      const secondParameter = clamp(dot(subtract(point, second.start), secondFrame.direction) / secondFrame.length);
      return { kind: "points", points: [{ point, firstParameter, secondParameter, contact: "endpoint" }] };
    }
    const firstT0 = clamp(overlapStart); const firstT1 = clamp(overlapEnd);
    const firstPoint = linePoint(first, firstT0); const lastPoint = linePoint(first, firstT1);
    const secondAtFirst = clamp(dot(subtract(firstPoint, second.start), secondFrame.direction) / secondFrame.length);
    const secondAtLast = clamp(dot(subtract(lastPoint, second.start), secondFrame.direction) / secondFrame.length);
    if ((firstT1 - firstT0) * firstFrame.length <= spatialTolerance) {
      return { kind: "points", points: [{ point: firstPoint, firstParameter: firstT0, secondParameter: secondAtFirst, contact: "endpoint" }] };
    }
    return { kind: "overlap", spans: [{ firstInterval: { t0: firstT0, t1: firstT1 }, secondInterval: { t0: Math.min(secondAtFirst, secondAtLast), t1: Math.max(secondAtFirst, secondAtLast) } }], points: [] };
  }
  const firstParameter = checkedNumber(cross(between, secondFrame.direction) / (firstFrame.length * denominator));
  const secondParameter = checkedNumber(cross(between, firstFrame.direction) / (secondFrame.length * denominator));
  if (firstParameter < -parameterEpsilon || firstParameter > 1 + parameterEpsilon || secondParameter < -parameterEpsilon || secondParameter > 1 + parameterEpsilon) return none();
  const firstT = clamp(firstParameter); const secondT = clamp(secondParameter);
  return { kind: "points", points: [{ point: linePoint(first, firstT), firstParameter: firstT, secondParameter: secondT, contact: endpointContact(firstT, secondT, parameterEpsilon) ? "endpoint" : "crossing" }] };
}

function polynomialDerivative(polynomial: readonly number[]): number[] {
  return polynomial.slice(1).map((value, index) => checkedNumber(value * (index + 1)));
}
function polynomialAt(polynomial: readonly number[], parameter: number): number {
  let value = 0;
  for (let index = polynomial.length - 1; index >= 0; index -= 1) value = checkedNumber(value * parameter + polynomial[index]!);
  return value;
}
function rootsInUnit(polynomial: readonly number[], parameterEpsilon: number, valueEpsilon = ROOT_VALUE_EPSILON): number[] {
  if (!polynomial.every(Number.isFinite)) throw new Error("intersection polynomial must be finite");
  const scale = Math.max(...polynomial.map(Math.abs));
  if (scale === 0) return [];
  const coefficients = polynomial.map((value) => value / scale);
  while (coefficients.length > 1 && Math.abs(coefficients.at(-1)!) <= ROOT_COEFFICIENT_EPSILON) coefficients.pop();
  if (coefficients.length <= 1) return [];
  const critical = rootsInUnit(polynomialDerivative(coefficients), parameterEpsilon);
  const boundaries = deduplicatedParameters([0, ...critical, 1], parameterEpsilon);
  const roots: number[] = [];
  for (const boundary of boundaries) if (Math.abs(polynomialAt(coefficients, boundary)) <= valueEpsilon) roots.push(boundary);
  for (let index = 0; index + 1 < boundaries.length; index += 1) {
    let low = boundaries[index]!; let high = boundaries[index + 1]!; let lowValue = polynomialAt(coefficients, low); const highValue = polynomialAt(coefficients, high);
    if (Math.abs(lowValue) <= valueEpsilon || Math.abs(highValue) <= valueEpsilon || (lowValue < 0) === (highValue < 0)) continue;
    for (let iteration = 0; iteration < ROOT_MAX_ITERATIONS && high - low > Math.max(parameterEpsilon, Number.EPSILON); iteration += 1) {
      const middle = (low + high) / 2; const middleValue = polynomialAt(coefficients, middle);
      if (Math.abs(middleValue) <= ROOT_VALUE_EPSILON) { low = middle; high = middle; break; }
      if ((lowValue < 0) === (middleValue < 0)) { low = middle; lowValue = middleValue; } else high = middle;
    }
    roots.push((low + high) / 2);
  }
  return roots.map(clamp).sort((first, second) => first - second).filter((parameter, index, all) => index === 0 || parameter - all[index - 1]! > parameterEpsilon);
}
function bezierPower(values: readonly [number, number, number, number]): readonly [number, number, number, number] {
  const [p0, p1, p2, p3] = values;
  return [p0, checkedNumber(3 * (p1 - p0)), checkedNumber(3 * (p0 - 2 * p1 + p2)), checkedNumber(-p0 + 3 * p1 - 3 * p2 + p3)];
}
function deduplicatedParameters(parameters: readonly number[], parameterEpsilon: number): number[] {
  return [...parameters].map(clamp).sort((first, second) => first - second).filter((parameter, index, all) => index === 0 || parameter - all[index - 1]! > parameterEpsilon);
}
function tangentContact(polynomial: readonly number[], parameter: number, parameterEpsilon: number, valueEpsilon: number): boolean {
  const sampleOffset = Math.max(Math.cbrt(ROOT_VALUE_EPSILON), parameterEpsilon * 4);
  const before = Math.max(0, parameter - sampleOffset); const after = Math.min(1, parameter + sampleOffset);
  if (before === parameter || after === parameter) return false;
  const beforeValue = polynomialAt(polynomial, before); const afterValue = polynomialAt(polynomial, after);
  if (beforeValue === 0 || afterValue === 0) return Math.abs(polynomialAt(polynomialDerivative(polynomial), parameter)) <= valueEpsilon;
  return (beforeValue < 0) === (afterValue < 0);
}

function collinearCubic(
  cubic: CubicBezierCurve2D,
  line: LineCurve2D,
  frame: LineFrame,
  geometryEpsilon: number,
  parameterEpsilon: number,
): IntersectionResult {
  const projected = [cubic.p0, cubic.p1, cubic.p2, cubic.p3].map((point) => checkedNumber(dot(subtract(point, line.start), frame.direction) / frame.length)) as [number, number, number, number];
  const polynomial = bezierPower(projected);
  const lineParameterTolerance = Math.max(parameterEpsilon, geometryEpsilon / frame.length);
  const zeroPolynomial = [...polynomial];
  const onePolynomial = [...polynomial]; onePolynomial[0] = checkedNumber(onePolynomial[0]! - 1);
  const cuts = deduplicatedParameters([0, 1, ...rootsInUnit(zeroPolynomial, parameterEpsilon, lineParameterTolerance), ...rootsInUnit(onePolynomial, parameterEpsilon, lineParameterTolerance), ...rootsInUnit(polynomialDerivative(polynomial), parameterEpsilon)], parameterEpsilon);
  const spans: IntersectionSpan[] = [];
  for (let index = 0; index + 1 < cuts.length; index += 1) {
    const t0 = cuts[index]!; const t1 = cuts[index + 1]!; const middleValue = polynomialAt(polynomial, (t0 + t1) / 2);
    if (middleValue < -lineParameterTolerance || middleValue > 1 + lineParameterTolerance) continue;
    const lineT0 = clamp(polynomialAt(polynomial, t0)); const lineT1 = clamp(polynomialAt(polynomial, t1));
    if (Math.abs(lineT1 - lineT0) * frame.length > geometryEpsilon) spans.push({ firstInterval: { t0, t1 }, secondInterval: { t0: Math.min(lineT0, lineT1), t1: Math.max(lineT0, lineT1) } });
  }
  const candidates = deduplicatedParameters([...rootsInUnit(zeroPolynomial, parameterEpsilon, lineParameterTolerance), ...rootsInUnit(onePolynomial, parameterEpsilon, lineParameterTolerance), 0, 1], parameterEpsilon);
  const points = candidates.flatMap((firstParameter): IntersectionPoint[] => {
    if (spans.some(({ firstInterval }) => firstParameter >= firstInterval.t0 - parameterEpsilon && firstParameter <= firstInterval.t1 + parameterEpsilon)) return [];
    const secondParameter = polynomialAt(polynomial, firstParameter);
    if (secondParameter < -lineParameterTolerance || secondParameter > 1 + lineParameterTolerance) return [];
    return [{ point: cubicPoint(cubic, firstParameter), firstParameter, secondParameter: clamp(secondParameter), contact: "endpoint" }];
  });
  if (spans.length) return { kind: "overlap", spans, points };
  return points.length ? { kind: "points", points } : none();
}

function intersectCubicLine(cubic: CubicBezierCurve2D, line: LineCurve2D, geometryEpsilon: number, parameterEpsilon: number): IntersectionResult {
  const frame = lineFrame(line);
  if (!frame) return { kind: "unsupported", reason: "degenerate-line" };
  const controls = [cubic.p0, cubic.p1, cubic.p2, cubic.p3] as const;
  const distances = controls.map((point) => checkedNumber(cross(frame.direction, subtract(point, line.start)))) as [number, number, number, number];
  const numericDistance = coordinateTolerance([cubic, line]); const spatialTolerance = geometryEpsilon + numericDistance;
  const constantPoint = controls.every((point) => Math.hypot(point.x - cubic.p0.x, point.y - cubic.p0.y) <= numericDistance);
  if (constantPoint) {
    const secondParameter = checkedNumber(dot(subtract(cubic.p0, line.start), frame.direction) / frame.length);
    const lineParameterTolerance = Math.max(parameterEpsilon, spatialTolerance / frame.length);
    if (Math.abs(distances[0]!) > spatialTolerance || secondParameter < -lineParameterTolerance || secondParameter > 1 + lineParameterTolerance) return none();
    return { kind: "points", points: [{ point: checkedPoint(cubic.p0), firstParameter: 0, secondParameter: clamp(secondParameter), contact: "endpoint" }] };
  }
  if (distances.every((distance) => Math.abs(distance) <= numericDistance)) return collinearCubic(cubic, line, frame, geometryEpsilon, parameterEpsilon);
  const distanceScale = Math.max(...distances.map(Math.abs));
  const polynomial = bezierPower(distances.map((distance) => distance / distanceScale) as [number, number, number, number]);
  const valueEpsilon = ROOT_VALUE_EPSILON;
  const roots = rootsInUnit(polynomial, parameterEpsilon, valueEpsilon);
  const lineParameterTolerance = Math.max(parameterEpsilon, spatialTolerance / frame.length);
  const points = roots.flatMap((firstParameter): IntersectionPoint[] => {
    const point = cubicPoint(cubic, firstParameter);
    const secondParameter = checkedNumber(dot(subtract(point, line.start), frame.direction) / frame.length);
    if (secondParameter < -lineParameterTolerance || secondParameter > 1 + lineParameterTolerance) return [];
    const lineT = clamp(secondParameter); const closest = linePoint(line, lineT);
    if (Math.hypot(point.x - closest.x, point.y - closest.y) > spatialTolerance) return [];
    const contact = endpointContact(firstParameter, lineT, parameterEpsilon)
      ? "endpoint"
      : tangentContact(polynomial, firstParameter, parameterEpsilon, valueEpsilon) ? "tangent" : "crossing";
    return [{ point, firstParameter, secondParameter: lineT, contact }];
  });
  const deduplicated = points.sort((first, second) => first.firstParameter - second.firstParameter).filter((point, index, all) => index === 0 || point.firstParameter - all[index - 1]!.firstParameter > parameterEpsilon);
  return deduplicated.length ? { kind: "points", points: deduplicated } : none();
}

function circleParameter(circle: CircleCurve2D, point: PointMm): number {
  const angle = Math.atan2(point.y - circle.center.y, point.x - circle.center.x);
  return ((angle % TAU) + TAU) % TAU / TAU;
}

function intersectLineCircle(line: LineCurve2D, circle: CircleCurve2D, geometryEpsilon: number, parameterEpsilon: number): IntersectionResult {
  const frame = lineFrame(line);
  if (!frame) return { kind: "unsupported", reason: "degenerate-line" };
  const centerOffset = subtract(circle.center, line.start);
  const along = checkedNumber(dot(centerOffset, frame.direction));
  const perpendicular = checkedNumber(cross(frame.direction, centerOffset));
  const numericTolerance = checkedNumber(Number.EPSILON * Math.max(1, frame.length, circle.radius, Math.abs(centerOffset.x), Math.abs(centerOffset.y)) * COORDINATE_ULP_FACTOR);
  const classificationTolerance = geometryEpsilon + numericTolerance;
  const outputTolerance = geometryEpsilon + coordinateTolerance([line, circle]);
  const radialGap = Math.abs(perpendicular) - circle.radius;
  if (radialGap > classificationTolerance) return none();
  const tangent = radialGap >= -numericTolerance;
  const normalizedDistance = perpendicular / circle.radius;
  const offset = tangent ? 0 : checkedNumber(circle.radius * Math.sqrt(Math.max(0, 1 - normalizedDistance * normalizedDistance)));
  const lineParameterTolerance = Math.max(parameterEpsilon, classificationTolerance / frame.length);
  const parameters = (offset === 0 ? [along / frame.length] : [(along - offset) / frame.length, (along + offset) / frame.length]).map(checkedNumber).sort((first, second) => first - second).filter((parameter, index, all) => index === 0 || parameter - all[index - 1]! > parameterEpsilon);
  const points = parameters.flatMap((firstParameter): IntersectionPoint[] => {
    if (firstParameter < -lineParameterTolerance || firstParameter > 1 + lineParameterTolerance) return [];
    const lineT = clamp(firstParameter); const point = linePoint(line, lineT);
    const radiusAtPoint = checkedNumber(Math.hypot(point.x - circle.center.x, point.y - circle.center.y));
    if (Math.abs(radiusAtPoint - circle.radius) > outputTolerance) return [];
    return [{ point, firstParameter: lineT, secondParameter: circleParameter(circle, point), contact: lineT <= parameterEpsilon || lineT >= 1 - parameterEpsilon ? "endpoint" : tangent ? "tangent" : "crossing" }];
  });
  return points.length ? { kind: "points", points } : none();
}

function intersectCircles(first: CircleCurve2D, second: CircleCurve2D, geometryEpsilon: number): IntersectionResult {
  const centerOffset = subtract(second.center, first.center);
  const centerDistance = checkedNumber(Math.hypot(centerOffset.x, centerOffset.y));
  const numericTolerance = checkedNumber(Number.EPSILON * Math.max(1, centerDistance, first.radius, second.radius) * COORDINATE_ULP_FACTOR);
  const classificationTolerance = geometryEpsilon + numericTolerance;
  const radiusDifference = Math.abs(first.radius - second.radius);
  if (centerDistance <= numericTolerance) {
    return radiusDifference <= numericTolerance
      ? { kind: "overlap", spans: [{ firstInterval: { t0: 0, t1: 1 }, secondInterval: { t0: 0, t1: 1 } }], points: [] }
      : none();
  }
  const externalGap = centerDistance - first.radius - second.radius;
  const internalGap = radiusDifference - centerDistance;
  if (externalGap > classificationTolerance || internalGap > classificationTolerance) return none();
  const tangent = externalGap >= -numericTolerance || internalGap >= -numericTolerance;
  const scale = Math.max(centerDistance, first.radius, second.radius);
  const normalizedDistance = centerDistance / scale; const normalizedFirstRadius = first.radius / scale; const normalizedSecondRadius = second.radius / scale;
  const normalizedAlong = checkedNumber((normalizedDistance ** 2 + normalizedFirstRadius ** 2 - normalizedSecondRadius ** 2) / (2 * normalizedDistance));
  const normalizedHeight = tangent ? 0 : Math.sqrt(Math.max(0, normalizedFirstRadius ** 2 - normalizedAlong ** 2));
  const along = checkedNumber(normalizedAlong * scale); const height = checkedNumber(normalizedHeight * scale);
  const direction = checkedPoint({ x: centerOffset.x / centerDistance, y: centerOffset.y / centerDistance });
  const base = checkedPoint({ x: first.center.x + direction.x * along, y: first.center.y + direction.y * along });
  const candidates = height === 0 ? [base] : [checkedPoint({ x: base.x - direction.y * height, y: base.y + direction.x * height }), checkedPoint({ x: base.x + direction.y * height, y: base.y - direction.x * height })];
  const outputTolerance = geometryEpsilon + coordinateTolerance([first, second]);
  const points = candidates.flatMap((point): IntersectionPoint[] => {
    const firstResidual = Math.abs(Math.hypot(point.x - first.center.x, point.y - first.center.y) - first.radius);
    const secondResidual = Math.abs(Math.hypot(point.x - second.center.x, point.y - second.center.y) - second.radius);
    if (firstResidual > outputTolerance || secondResidual > outputTolerance) return [];
    return [{ point, firstParameter: circleParameter(first, point), secondParameter: circleParameter(second, point), contact: tangent ? "tangent" : "crossing" }];
  }).sort((left, right) => left.firstParameter - right.firstParameter);
  return points.length ? { kind: "points", points } : none();
}

function swapResult(result: IntersectionResult): IntersectionResult {
  if (result.kind === "points") return { kind: "points", points: result.points.map((point) => ({ ...point, firstParameter: point.secondParameter, secondParameter: point.firstParameter })).sort((first, second) => first.firstParameter - second.firstParameter) };
  if (result.kind === "overlap") return { kind: "overlap", spans: result.spans.map((span) => ({ firstInterval: span.secondInterval, secondInterval: span.firstInterval })).sort((first, second) => first.firstInterval.t0 - second.firstInterval.t0), points: result.points.map((point) => ({ ...point, firstParameter: point.secondParameter, secondParameter: point.firstParameter })).sort((first, second) => first.firstParameter - second.firstParameter) };
  return result;
}

/** Exact narrow-phase intersections for the curve pairs supported by this stage. */
export function intersectCurves(first: Curve2D, second: Curve2D, options?: IntersectionOptions): IntersectionResult {
  validateCurve(first); validateCurve(second);
  const { geometryEpsilon, parameterEpsilon } = optionsOrDefaults(options);
  if (first.type === "line" && second.type === "line") return intersectLines(first, second, geometryEpsilon, parameterEpsilon);
  if (first.type === "cubicBezier" && second.type === "line") return intersectCubicLine(first, second, geometryEpsilon, parameterEpsilon);
  if (first.type === "line" && second.type === "cubicBezier") return swapResult(intersectCubicLine(second, first, geometryEpsilon, parameterEpsilon));
  if (first.type === "line" && second.type === "circle") return intersectLineCircle(first, second, geometryEpsilon, parameterEpsilon);
  if (first.type === "circle" && second.type === "line") return swapResult(intersectLineCircle(second, first, geometryEpsilon, parameterEpsilon));
  if (first.type === "circle" && second.type === "circle") return intersectCircles(first, second, geometryEpsilon);
  return { kind: "unsupported", reason: "curve-pair" };
}
