import { describe, expect, it } from "vitest";
import { cubicBezierLineIntersections, intersectCurves, lineSegmentIntersection, pointAt, type CubicBezierCurve2D, type Curve2D, type IntersectionPoint, type IntersectionResult, type LineCurve2D } from "./index.js";

const line = (start: { x: number; y: number }, end: { x: number; y: number }): LineCurve2D => ({ type: "line", start, end });
const horizontal = line({ x: 0, y: 0 }, { x: 10, y: 0 });
const cubic = (ys: readonly [number, number, number, number]): CubicBezierCurve2D => ({ type: "cubicBezier", p0: { x: 0, y: ys[0] }, p1: { x: 10 / 3, y: ys[1] }, p2: { x: 20 / 3, y: ys[2] }, p3: { x: 10, y: ys[3] } });

function points(result: IntersectionResult): readonly IntersectionPoint[] {
  expect(result.kind).toBe("points");
  return result.kind === "points" ? result.points : [];
}
function expectPointParameters(result: IntersectionResult, expected: readonly [number, number][]) {
  const actual = points(result);
  expect(actual).toHaveLength(expected.length);
  expected.forEach(([first, second], index) => {
    expect(actual[index]!.firstParameter).toBeCloseTo(first, 8);
    expect(actual[index]!.secondParameter).toBeCloseTo(second, 8);
    expectPointOnSources(actual[index]!, first, second);
  });
}
function expectPointOnSources(intersection: IntersectionPoint, firstParameter: number, secondParameter: number) {
  expect(intersection.firstParameter).toBeCloseTo(firstParameter, 8);
  expect(intersection.secondParameter).toBeCloseTo(secondParameter, 8);
  expect(Number.isFinite(intersection.point.x) && Number.isFinite(intersection.point.y)).toBe(true);
}
function expectSymmetric(first: Curve2D, second: Curve2D) {
  const direct = intersectCurves(first, second); const reversed = intersectCurves(second, first);
  expect(reversed.kind).toBe(direct.kind);
  if (direct.kind === "points" && reversed.kind === "points") {
    expect(reversed.points).toHaveLength(direct.points.length);
    for (const intersection of direct.points) {
      const match = reversed.points.find((candidate) => Math.abs(candidate.firstParameter - intersection.secondParameter) < 1e-7 && Math.abs(candidate.secondParameter - intersection.firstParameter) < 1e-7);
      expect(match?.contact).toBe(intersection.contact);
      expect(match?.point.x).toBeCloseTo(intersection.point.x, 8); expect(match?.point.y).toBeCloseTo(intersection.point.y, 8);
    }
  }
  if (direct.kind === "overlap" && reversed.kind === "overlap") {
    expect(reversed.spans).toHaveLength(direct.spans.length);
    for (const span of direct.spans) expect(reversed.spans.some((candidate) => Math.abs(candidate.firstInterval.t0 - span.secondInterval.t0) < 1e-7 && Math.abs(candidate.firstInterval.t1 - span.secondInterval.t1) < 1e-7 && Math.abs(candidate.secondInterval.t0 - span.firstInterval.t0) < 1e-7 && Math.abs(candidate.secondInterval.t1 - span.firstInterval.t1) < 1e-7)).toBe(true);
  }
}

describe("IntersectionEngine Line × Line", () => {
  it("returns a parameterized interior crossing symmetrically", () => {
    const first = line({ x: 0, y: 0 }, { x: 10, y: 10 }); const second = line({ x: 0, y: 10 }, { x: 10, y: 0 });
    const result = intersectCurves(first, second);
    expectPointParameters(result, [[0.5, 0.5]]);
    expect(points(result)[0]).toMatchObject({ point: { x: expect.closeTo(5, 10), y: expect.closeTo(5, 10) }, contact: "crossing" });
    expectSymmetric(first, second);
  });

  it("classifies endpoint contact and rejects finite disjoint or parallel lines", () => {
    const endpoint = intersectCurves(horizontal, line({ x: 10, y: 0 }, { x: 10, y: 5 }));
    expect(points(endpoint)[0]).toEqual({ point: { x: 10, y: 0 }, firstParameter: 1, secondParameter: 0, contact: "endpoint" });
    expect(intersectCurves(horizontal, line({ x: 11, y: -1 }, { x: 11, y: 1 }))).toEqual({ kind: "none" });
    expect(intersectCurves(horizontal, line({ x: 0, y: 2 }, { x: 10, y: 2 }))).toEqual({ kind: "none" });
  });

  it("returns partial and complete collinear overlap intervals for either orientation", () => {
    const partial = intersectCurves(horizontal, line({ x: 3, y: 0 }, { x: 8, y: 0 }));
    expect(partial).toEqual({ kind: "overlap", spans: [{ firstInterval: { t0: 0.3, t1: 0.8 }, secondInterval: { t0: 0, t1: 1 } }], points: [] });
    const reversedDirection = intersectCurves(horizontal, line({ x: 8, y: 0 }, { x: 3, y: 0 }));
    expect(reversedDirection).toMatchObject({ kind: "overlap", spans: [{ firstInterval: { t0: expect.closeTo(0.3, 10), t1: expect.closeTo(0.8, 10) }, secondInterval: { t0: 0, t1: 1 } }] });
    const complete = intersectCurves(horizontal, line({ x: 0, y: 0 }, { x: 10, y: 0 }));
    expect(complete).toEqual({ kind: "overlap", spans: [{ firstInterval: { t0: 0, t1: 1 }, secondInterval: { t0: 0, t1: 1 } }], points: [] });
    expectSymmetric(horizontal, line({ x: 3, y: 0 }, { x: 8, y: 0 }));
  });

  it("distinguishes point contact, tolerated spatial gap, and a real gap", () => {
    expect(points(intersectCurves(horizontal, line({ x: 10, y: 0 }, { x: 20, y: 0 })))[0]).toMatchObject({ firstParameter: 1, secondParameter: 0, contact: "endpoint" });
    expect(intersectCurves(horizontal, line({ x: 10 + 5e-9, y: 0 }, { x: 20, y: 0 }), { geometryEpsilon: 1e-8 })).toMatchObject({ kind: "points" });
    expect(intersectCurves(horizontal, line({ x: 10 + 2e-8, y: 0 }, { x: 20, y: 0 }), { geometryEpsilon: 1e-8 })).toEqual({ kind: "none" });
  });

  it("does not confuse a shallow finite crossing with parallel lines", () => {
    const long = line({ x: 0, y: 0 }, { x: 1e6, y: 0 });
    const shallow = line({ x: 0, y: -5e-7 }, { x: 1e6, y: 5e-7 });
    expectPointParameters(intersectCurves(long, shallow), [[0.5, 0.5]]);
  });

  it("reports exactly degenerate lines as unsupported and rejects overflow", () => {
    expect(intersectCurves(line({ x: 1, y: 1 }, { x: 1, y: 1 }), horizontal)).toEqual({ kind: "unsupported", reason: "degenerate-line" });
    expect(() => intersectCurves(line({ x: -Number.MAX_VALUE, y: 0 }, { x: Number.MAX_VALUE, y: 0 }), horizontal)).toThrow("numeric range");
  });
});

describe("IntersectionEngine Line × Cubic", () => {
  it("returns all ordered crossing roots and exact source parameters", () => {
    const sCurve = cubic([-0.08, 0.14, -0.14, 0.08]);
    const result = intersectCurves(sCurve, horizontal);
    expectPointParameters(result, [[0.2, 0.2], [0.5, 0.5], [0.8, 0.8]]);
    expect(points(result).every(({ contact }) => contact === "crossing")).toBe(true);
    for (const intersection of points(result)) {
      const onCubic = pointAt(sCurve, intersection.firstParameter); const onLine = pointAt(horizontal, intersection.secondParameter);
      expect(intersection.point.x).toBeCloseTo(onCubic.x, 8); expect(intersection.point.y).toBeCloseTo(onCubic.y, 8);
      expect(onCubic.x).toBeCloseTo(onLine.x, 8); expect(onCubic.y).toBeCloseTo(onLine.y, 8);
    }
    expectSymmetric(sCurve, horizontal);
  });

  it("classifies a double root as tangent and deduplicates a triple crossing", () => {
    const tangent = intersectCurves(cubic([0.25, -1 / 12, -1 / 12, 0.25]), horizontal);
    expectPointParameters(tangent, [[0.5, 0.5]]);
    expect(points(tangent)[0]!.contact).toBe("tangent");
    const triple = intersectCurves(cubic([-5e-10, 5e-10, -5e-10, 5e-10]), horizontal, { geometryEpsilon: 1e-9 });
    expectPointParameters(triple, [[0.5, 0.5]]);
    expect(points(triple)[0]!.contact).toBe("crossing");
  });

  it("classifies curve or finite-line endpoints before tangent/crossing", () => {
    const curveEndpoint = intersectCurves(cubic([0, 1, 1, 1]), horizontal);
    expect(points(curveEndpoint)[0]).toMatchObject({ firstParameter: 0, secondParameter: 0, contact: "endpoint" });
    const lineEndpoint = intersectCurves(cubic([-1, -1, 1, 1]), line({ x: 5, y: 0 }, { x: 10, y: 0 }));
    expect(points(lineEndpoint)[0]).toMatchObject({ firstParameter: expect.closeTo(0.5, 8), secondParameter: expect.closeTo(0, 8), contact: "endpoint" });
  });

  it("filters supporting-line roots outside the finite segment and rejects near misses", () => {
    expect(intersectCurves(cubic([-1, -1, 1, 1]), line({ x: 0, y: 0 }, { x: 4.9, y: 0 }))).toEqual({ kind: "none" });
    expect(intersectCurves(cubic([0.250001, -1 / 12 + 0.000001, -1 / 12 + 0.000001, 0.250001]), horizontal)).toEqual({ kind: "none" });
  });

  it("returns monotonic overlap spans for a collinear cubic", () => {
    const collinear = cubic([0, 0, 0, 0]);
    const overlap = intersectCurves(collinear, line({ x: 3, y: 0 }, { x: 7, y: 0 }));
    expect(overlap.kind).toBe("overlap");
    if (overlap.kind !== "overlap") return;
    expect(overlap.spans).toHaveLength(1);
    expect(overlap.spans[0]!.firstInterval.t0).toBeCloseTo(0.3, 8); expect(overlap.spans[0]!.firstInterval.t1).toBeCloseTo(0.7, 8);
    expect(overlap.spans[0]!.secondInterval.t0).toBeCloseTo(0, 8); expect(overlap.spans[0]!.secondInterval.t1).toBeCloseTo(1, 8);
    expectSymmetric(collinear, line({ x: 3, y: 0 }, { x: 7, y: 0 }));
  });

  it("reports an isolated collinear touch as one endpoint point", () => {
    const touching: CubicBezierCurve2D = { type: "cubicBezier", p0: { x: 0, y: 0 }, p1: { x: 2 / 3, y: 0 }, p2: { x: 2 / 3, y: 0 }, p3: { x: 0, y: 0 } };
    const result = intersectCurves(touching, line({ x: 0.5, y: 0 }, { x: 1, y: 0 }));
    expectPointParameters(result, [[0.5, 0]]);
    expect(points(result)[0]!.contact).toBe("endpoint");
  });

  it("keeps isolated collinear contacts alongside overlap spans", () => {
    const mixed: CubicBezierCurve2D = { type: "cubicBezier", p0: { x: -0.032, y: 0 }, p1: { x: 0.088, y: 0 }, p2: { x: -0.192, y: 0 }, p3: { x: 0.128, y: 0 } };
    const result = intersectCurves(mixed, line({ x: 0, y: 0 }, { x: 1, y: 0 }));
    expect(result.kind).toBe("overlap");
    if (result.kind !== "overlap") return;
    expect(result.spans.some(({ firstInterval }) => Math.abs(firstInterval.t0 - 0.8) < 1e-7 && firstInterval.t1 === 1)).toBe(true);
    expect(result.points).toHaveLength(1);
    expect(result.points[0]).toMatchObject({ firstParameter: expect.closeTo(0.2, 7), secondParameter: expect.closeTo(0, 7), contact: "endpoint" });
  });

  it("canonicalizes a constant cubic to one point and returns none outside the finite line", () => {
    const constant: CubicBezierCurve2D = { type: "cubicBezier", p0: { x: 5, y: 0 }, p1: { x: 5, y: 0 }, p2: { x: 5, y: 0 }, p3: { x: 5, y: 0 } };
    expect(intersectCurves(constant, horizontal)).toEqual({ kind: "points", points: [{ point: { x: 5, y: 0 }, firstParameter: 0, secondParameter: 0.5, contact: "endpoint" }] });
    expect(intersectCurves(cubic([0, 0, 0, 0]), line({ x: 20, y: 0 }, { x: 30, y: 0 }))).toEqual({ kind: "none" });
  });
});

describe("IntersectionEngine contract and legacy compatibility", () => {
  it("reports unsupported pairs explicitly and validates every Curve2D kind", () => {
    const bezier = cubic([-1, -1, 1, 1]);
    expect(intersectCurves(bezier, bezier)).toEqual({ kind: "unsupported", reason: "curve-pair" });
    expect(intersectCurves(horizontal, { type: "circle", center: { x: 0, y: 0 }, radius: 1 })).toEqual({ kind: "unsupported", reason: "curve-pair" });
    expect(() => intersectCurves(horizontal, { type: "circle", center: { x: Number.NaN, y: 0 }, radius: 1 })).toThrow("curve coordinates must be finite");
    expect(() => intersectCurves(horizontal, { type: "arc", center: { x: 0, y: 0 }, radius: 0, startAngle: 0, endAngle: 1, direction: "clockwise" })).toThrow("curve radius must be positive");
  });

  it("validates geometry and parameter tolerances independently", () => {
    expect(() => intersectCurves(horizontal, horizontal, { geometryEpsilon: -1 })).toThrow("intersection tolerances");
    expect(() => intersectCurves(horizontal, horizontal, { geometryEpsilon: Number.NaN })).toThrow("intersection tolerances");
    expect(() => intersectCurves(horizontal, horizontal, { parameterEpsilon: -1 })).toThrow("intersection tolerances");
    expect(() => intersectCurves(horizontal, horizontal, { parameterEpsilon: 0.5 })).toThrow("intersection tolerances");
  });

  it("keeps legacy helpers delegated with their existing result shapes", () => {
    expect(lineSegmentIntersection({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toMatchObject({ point: { x: expect.closeTo(5, 10), y: expect.closeTo(5, 10) }, firstT: expect.closeTo(0.5, 10), secondT: expect.closeTo(0.5, 10) });
    expect(lineSegmentIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 3, y: 0 }, { x: 8, y: 0 })).toBeUndefined();
    const legacy = cubicBezierLineIntersections(cubic([-1, -1, 1, 1]), horizontal.start, horizontal.end);
    expect(legacy).toHaveLength(1);
    expect(legacy[0]).toMatchObject({ curveT: expect.closeTo(0.5, 8), lineT: expect.closeTo(0.5, 8), point: { x: expect.closeTo(5, 8), y: expect.closeTo(0, 8) } });
    expect(cubicBezierLineIntersections(cubic([0, 0, 0, 0]), horizontal.start, horizontal.end)).toEqual([]);
    const constant = { p0: { x: 5, y: 0 }, p1: { x: 5, y: 0 }, p2: { x: 5, y: 0 }, p3: { x: 5, y: 0 } };
    expect(cubicBezierLineIntersections(constant, horizontal.start, horizontal.end)).toEqual([]);
  });
});
