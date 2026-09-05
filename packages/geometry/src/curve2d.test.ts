import { describe, expect, it } from "vitest";
import { closestParameter, curveBounds, GEOMETRY_EPSILON, PARAMETER_EPSILON, pointAt, splitCurveAtParameters, tangentAt, type ArcCurve2D, type CircleCurve2D, type CubicBezierCurve2D, type Curve2D, type LineCurve2D } from "./index.js";

const expectPointClose = (actual: { readonly x: number; readonly y: number }, expected: { readonly x: number; readonly y: number }, digits = 8) => {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
};
const radians = (degrees: number) => degrees * Math.PI / 180;

const line: LineCurve2D = { type: "line", start: { x: 0, y: 0 }, end: { x: 10, y: 4 } };
const cubic: CubicBezierCurve2D = { type: "cubicBezier", p0: { x: 0, y: 0 }, p1: { x: 2, y: 8 }, p2: { x: 8, y: -4 }, p3: { x: 10, y: 4 } };
const wrappedArc: ArcCurve2D = { type: "arc", center: { x: 0, y: 0 }, radius: 5, startAngle: radians(320), endAngle: radians(30), direction: "clockwise" };
const circle: CircleCurve2D = { type: "circle", center: { x: 3, y: -2 }, radius: 5 };

function expectSplitMatchesOriginal(curve: Curve2D, parameters: readonly number[]) {
  const fragments = splitCurveAtParameters(curve, parameters);
  for (const fragment of fragments) for (const localT of [0, 0.2, 0.5, 0.8, 1]) {
    const { t0, t1 } = fragment.sourceInterval;
    const span = t1 - t0;
    const globalT = t0 + localT * span;
    expectPointClose(pointAt(fragment.curve, localT), pointAt(curve, globalT), 7);
    const globalTangent = tangentAt(curve, globalT);
    expectPointClose(tangentAt(fragment.curve, localT), { x: globalTangent.x * span, y: globalTangent.y * span }, 6);
  }
  for (let index = 1; index < fragments.length; index += 1) expectPointClose(pointAt(fragments[index - 1]!.curve, 1), pointAt(fragments[index]!.curve, 0), 10);
  return fragments;
}

describe("Curve2D line operations", () => {
  it("evaluates horizontal, vertical, and diagonal lines with raw tangents and exact bounds", () => {
    const horizontal: LineCurve2D = { type: "line", start: { x: -2, y: 3 }, end: { x: 8, y: 3 } };
    const vertical: LineCurve2D = { type: "line", start: { x: 4, y: -5 }, end: { x: 4, y: 7 } };
    expect(pointAt(horizontal, 0.25)).toEqual({ x: 0.5, y: 3 });
    expect(tangentAt(horizontal, 0.8)).toEqual({ x: 10, y: 0 });
    expect(curveBounds(horizontal)).toEqual({ x: -2, y: 3, width: 10, height: 0 });
    expect(pointAt(vertical, 0.5)).toEqual({ x: 4, y: 1 });
    expect(tangentAt(vertical, 0.2)).toEqual({ x: 0, y: 12 });
    expect(curveBounds(vertical)).toEqual({ x: 4, y: -5, width: 0, height: 12 });
    expectPointClose(pointAt(line, 0.5), { x: 5, y: 2 });
  });

  it("clamps closest parameters before and after endpoints and handles short or degenerate lines deterministically", () => {
    expect(closestParameter(line, { x: -10, y: -4 })).toBe(0);
    expect(closestParameter(line, { x: 20, y: 8 })).toBe(1);
    expect(closestParameter(line, { x: 5, y: 2 })).toBeCloseTo(0.5);
    const short: LineCurve2D = { type: "line", start: { x: 2, y: 3 }, end: { x: 2 + GEOMETRY_EPSILON / 100, y: 3 } };
    expectPointClose(tangentAt(short, 0), { x: GEOMETRY_EPSILON / 100, y: 0 }, 16);
    expect(closestParameter(short, { x: 20, y: 20 })).toBe(0);
    const degenerate: LineCurve2D = { type: "line", start: { x: 2, y: 3 }, end: { x: 2, y: 3 } };
    expect(pointAt(degenerate, 0.7)).toEqual({ x: 2, y: 3 });
    expect(tangentAt(degenerate, 0)).toEqual({ x: 0, y: 0 });
    expect(closestParameter(degenerate, { x: 20, y: 20 })).toBe(0);
  });
});

describe("Curve2D circular operations", () => {
  it("uses clockwise angles in the top-left coordinate frame and a closed circle seam", () => {
    expect(pointAt(circle, 1)).toEqual(pointAt(circle, 0));
    expectPointClose(pointAt({ ...circle, center: { x: 0, y: 0 }, radius: 2 }, 0.25), { x: 0, y: 2 });
    expectPointClose(tangentAt({ ...circle, center: { x: 0, y: 0 }, radius: 2 }, 0), { x: 0, y: 4 * Math.PI });
    expect(closestParameter(circle, { x: 8, y: -2 })).toBe(0);
    expect(curveBounds(circle)).toEqual({ x: -2, y: -7, width: 10, height: 10 });
  });

  it("supports clockwise and counterclockwise arcs, wrap-around, full turns, and endpoint projection", () => {
    expectPointClose(pointAt(wrappedArc, 0), { x: 5 * Math.cos(radians(320)), y: 5 * Math.sin(radians(320)) });
    expectPointClose(pointAt(wrappedArc, 0.5), { x: 5 * Math.cos(radians(355)), y: 5 * Math.sin(radians(355)) });
    const reverse: ArcCurve2D = { ...wrappedArc, direction: "counterclockwise" };
    expectPointClose(pointAt(reverse, 0.5), { x: 5 * Math.cos(radians(175)), y: 5 * Math.sin(radians(175)) });
    const full: ArcCurve2D = { type: "arc", center: { x: 0, y: 0 }, radius: 5, startAngle: 0, endAngle: 2 * Math.PI, direction: "clockwise", fullTurn: true };
    expect(pointAt(full, 1)).toEqual(pointAt(full, 0));
    expectSplitMatchesOriginal(full, [0.2, 0.7]);
    const tiny: ArcCurve2D = { type: "arc", center: full.center, radius: full.radius, startAngle: 0, endAngle: 1e-15, direction: "clockwise" };
    expectPointClose(pointAt(tiny, 1), { x: 5 * Math.cos(1e-15), y: 5 * Math.sin(1e-15) }, 12);
    expect(curveBounds(tiny).height).toBeLessThan(1e-8);
    expect(closestParameter(tiny, pointAt(tiny, 1))).toBeCloseTo(1);
    const zero: ArcCurve2D = { ...tiny, endAngle: 0 };
    expect(pointAt(zero, 0.8)).toEqual(pointAt(zero, 0));
    expect(tangentAt(zero, 0.8)).toEqual({ x: 0, y: 0 });
    const quarter: ArcCurve2D = { type: "arc", center: { x: 0, y: 0 }, radius: 5, startAngle: 0, endAngle: Math.PI / 2, direction: "clockwise" };
    expect(closestParameter(quarter, { x: 5, y: -1 })).toBe(0);
    expect(closestParameter(quarter, { x: -5, y: 0 })).toBe(1);
    expect(closestParameter(quarter, pointAt(quarter, 0.4))).toBeCloseTo(0.4);
    expectPointClose(tangentAt({ ...quarter, radius: 2 }, 0), { x: 0, y: Math.PI });
    expect(curveBounds(quarter)).toMatchObject({ x: expect.closeTo(0), y: 0, width: expect.closeTo(5), height: 5 });
  });
});

describe("Curve2D cubic operations", () => {
  it("evaluates raw derivatives, global closest candidates, and analytic bounds", () => {
    const arch: CubicBezierCurve2D = { type: "cubicBezier", p0: { x: 0, y: 0 }, p1: { x: 0, y: 3 }, p2: { x: 3, y: 3 }, p3: { x: 3, y: 0 } };
    expect(tangentAt(arch, 0)).toEqual({ x: 0, y: 9 });
    expect(curveBounds(arch)).toEqual({ x: 0, y: 0, width: 3, height: 2.25 });
    const largeScale = 1e154;
    const largeArch: CubicBezierCurve2D = { type: "cubicBezier", p0: { x: 0, y: 0 }, p1: { x: 0, y: 3 * largeScale }, p2: { x: 3 * largeScale, y: 3 * largeScale }, p3: { x: 3 * largeScale, y: 0 } };
    const largeBounds = curveBounds(largeArch);
    expect(largeBounds.width / largeScale).toBeCloseTo(3);
    expect(largeBounds.height / largeScale).toBeCloseTo(2.25);
    expect(closestParameter(cubic, pointAt(cubic, 0.37))).toBeCloseTo(0.37, 7);
    const query = { x: 4.2, y: 1.7 };
    const closest = closestParameter(cubic, query);
    const closestDistance = Math.hypot(pointAt(cubic, closest).x - query.x, pointAt(cubic, closest).y - query.y);
    const denseMinimum = Math.min(...Array.from({ length: 10_001 }, (_, index) => {
      const candidate = pointAt(cubic, index / 10_000);
      return Math.hypot(candidate.x - query.x, candidate.y - query.y);
    }));
    expect(closestDistance).toBeLessThanOrEqual(denseMinimum + GEOMETRY_EPSILON);
    const loop: CubicBezierCurve2D = { type: "cubicBezier", p0: { x: -2, y: 0 }, p1: { x: 4, y: 5 }, p2: { x: -4, y: 5 }, p3: { x: 2, y: 0 } };
    const loopQuery = { x: 0.3, y: 2.1 };
    const loopClosest = closestParameter(loop, loopQuery);
    const loopDistance = Math.hypot(pointAt(loop, loopClosest).x - loopQuery.x, pointAt(loop, loopClosest).y - loopQuery.y);
    const loopDenseMinimum = Math.min(...Array.from({ length: 20_001 }, (_, index) => { const candidate = pointAt(loop, index / 20_000); return Math.hypot(candidate.x - loopQuery.x, candidate.y - loopQuery.y); }));
    expect(loopDistance).toBeLessThanOrEqual(loopDenseMinimum + GEOMETRY_EPSILON);
    const degenerate: CubicBezierCurve2D = { type: "cubicBezier", p0: { x: 2, y: 3 }, p1: { x: 2, y: 3 }, p2: { x: 2, y: 3 }, p3: { x: 2, y: 3 } };
    expect(closestParameter(degenerate, { x: 8, y: 9 })).toBe(0);
    expect(tangentAt(degenerate, 0.5)).toEqual({ x: 0, y: 0 });
    expect(curveBounds(degenerate)).toEqual({ x: 2, y: 3, width: 0, height: 0 });
  });
});

describe("splitCurveAtParameters", () => {
  it("sorts and deduplicates parameters and ignores values near either endpoint", () => {
    const fragments = splitCurveAtParameters(line, [0.7, 0.20000000001, 0.2, 1, 0, 0.70000000002]);
    expect(fragments.map((fragment) => fragment.sourceInterval)).toEqual([{ t0: 0, t1: 0.2 }, { t0: 0.2, t1: 0.7 }, { t0: 0.7, t1: 1 }]);
    expect(splitCurveAtParameters(line, [PARAMETER_EPSILON / 2, 1 - PARAMETER_EPSILON / 2])).toHaveLength(1);
    const wholeCircle = splitCurveAtParameters(circle, []);
    expect(wholeCircle).toHaveLength(1);
    expect(wholeCircle[0]!.curve).toMatchObject({ type: "arc", fullTurn: true });
    expectPointClose(pointAt(wholeCircle[0]!.curve, 0.5), pointAt(circle, 0.5));
  });

  it("preserves local-to-global evaluation for lines, cubics, arcs, and circle-to-arc fragments", () => {
    for (const curve of [line, cubic, wrappedArc, circle] satisfies readonly Curve2D[]) {
      const fragments = expectSplitMatchesOriginal(curve, [0.2, 0.7]);
      expect(fragments).toHaveLength(3);
      if (curve.type === "circle") expect(fragments.every((fragment) => fragment.curve.type === "arc")).toBe(true);
    }
  });

  it("rejects invalid curves, parameters, and domains", () => {
    expect(() => pointAt(line, -0.1)).toThrow("parameter must be within [0, 1]");
    expect(() => pointAt(line, Number.NaN)).toThrow("parameter must be finite");
    expect(() => splitCurveAtParameters(line, [-0.01])).toThrow("parameters must be finite and within [0, 1]");
    expect(() => splitCurveAtParameters(line, [1.01])).toThrow("parameters must be finite and within [0, 1]");
    expect(() => splitCurveAtParameters(line, [Number.NaN])).toThrow("parameters must be finite and within [0, 1]");
    expect(() => pointAt({ type: "circle", center: { x: 0, y: 0 }, radius: 0 }, 0)).toThrow("curve radius must be positive");
    expect(() => closestParameter(cubic, { x: Number.POSITIVE_INFINITY, y: 0 })).toThrow("point must be finite");
    const extreme: LineCurve2D = { type: "line", start: { x: -Number.MAX_VALUE, y: 0 }, end: { x: Number.MAX_VALUE, y: 0 } };
    expect(pointAt(extreme, 0.5)).toEqual({ x: 0, y: 0 });
    expect(splitCurveAtParameters(extreme, [0.5])).toHaveLength(2);
    expect(() => tangentAt(extreme, 0.5)).toThrow("curve calculation exceeds the numeric range");
    expect(() => closestParameter(extreme, { x: 0, y: 0 })).toThrow("curve calculation exceeds the numeric range");
  });
});
