import { describe, expect, it } from "vitest";
import { cubicBezierLineIntersections, intersectCurves, lineSegmentIntersection, pointAt, type ArcCurve2D, type CircleCurve2D, type CubicBezierCurve2D, type Curve2D, type IntersectionPoint, type IntersectionResult, type LineCurve2D } from "./index.js";

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

describe("IntersectionEngine Line × Circle", () => {
  const circle: CircleCurve2D = { type: "circle", center: { x: 0, y: 0 }, radius: 5 };

  it("returns two secant points with clockwise circle parameters", () => {
    const secant = line({ x: -10, y: 0 }, { x: 10, y: 0 });
    const result = intersectCurves(secant, circle);
    expectPointParameters(result, [[0.25, 0.5], [0.75, 0]]);
    expect(points(result).map(({ contact }) => contact)).toEqual(["crossing", "crossing"]);
    expect(points(result).map(({ point }) => point)).toEqual([{ x: -5, y: 0 }, { x: 5, y: 0 }]);
    expectSymmetric(secant, circle);
    const circleFirst = points(intersectCurves(circle, secant));
    expect(circleFirst.map(({ firstParameter, secondParameter }) => [firstParameter, secondParameter])).toEqual([[0, 0.75], [0.5, 0.25]]);
  });

  it("deduplicates a tangent and preserves the top-left clockwise quarter parameter", () => {
    const result = intersectCurves(line({ x: -10, y: 5 }, { x: 10, y: 5 }), circle);
    expectPointParameters(result, [[0.5, 0.25]]);
    expect(points(result)[0]).toMatchObject({ point: { x: 0, y: 5 }, contact: "tangent" });
    expect(points(intersectCurves(circle, line({ x: -10, y: 5 }, { x: 10, y: 5 })))[0]).toMatchObject({ firstParameter: 0.25, secondParameter: 0.5, contact: "tangent" });
  });

  it("classifies only finite-line endpoints, never the circular seam", () => {
    const seamCrossing = intersectCurves(line({ x: 0, y: 0 }, { x: 10, y: 0 }), circle);
    expect(points(seamCrossing)[0]).toMatchObject({ firstParameter: 0.5, secondParameter: 0, contact: "crossing" });
    const endpointLine = line({ x: 5, y: 0 }, { x: 10, y: 0 });
    const endpoint = intersectCurves(endpointLine, circle);
    expect(points(endpoint)[0]).toMatchObject({ firstParameter: 0, secondParameter: 0, contact: "endpoint" });
    expect(points(intersectCurves(circle, endpointLine))[0]).toMatchObject({ firstParameter: 0, secondParameter: 0, contact: "endpoint" });
  });

  it("returns one point when the finite segment clips a secant and none for misses", () => {
    const clipped = intersectCurves(line({ x: -10, y: 0 }, { x: 0, y: 0 }), circle);
    expect(points(clipped)).toHaveLength(1);
    expect(points(clipped)[0]).toMatchObject({ point: { x: -5, y: 0 }, firstParameter: 0.5, secondParameter: 0.5, contact: "crossing" });
    expect(intersectCurves(line({ x: -10, y: 6 }, { x: 10, y: 6 }), circle)).toEqual({ kind: "none" });
    expect(intersectCurves(line({ x: 6, y: 0 }, { x: 10, y: 0 }), circle)).toEqual({ kind: "none" });
  });

  it("uses model-space tolerance around tangency without collapsing an interior secant", () => {
    expect(intersectCurves(line({ x: -10, y: 5 + 5e-9 }, { x: 10, y: 5 + 5e-9 }), circle, { geometryEpsilon: 1e-8 })).toMatchObject({ kind: "points", points: [{ contact: "tangent" }] });
    const nearSecant = intersectCurves(line({ x: -10, y: 5 - 5e-9 }, { x: 10, y: 5 - 5e-9 }), circle, { geometryEpsilon: 1e-8 });
    expect(points(nearSecant)).toHaveLength(2);
    expect(points(nearSecant).every(({ contact }) => contact === "crossing")).toBe(true);
    expect(intersectCurves(line({ x: -10, y: 5 + 2e-8 }, { x: 10, y: 5 + 2e-8 }), circle, { geometryEpsilon: 1e-8 })).toEqual({ kind: "none" });
    const translated: CircleCurve2D = { type: "circle", center: { x: 1e9, y: -1e9 }, radius: 5 };
    const translatedResult = intersectCurves(line({ x: 1e9 - 10, y: -1e9 }, { x: 1e9 + 10, y: -1e9 }), translated, { geometryEpsilon: 1e-6 });
    expect(points(translatedResult)).toHaveLength(2);
    const veryTranslated: CircleCurve2D = { type: "circle", center: { x: 1e15, y: 1e15 }, radius: 5 };
    expect(intersectCurves(line({ x: 1e15 - 10, y: 1e15 + 20 }, { x: 1e15 + 10, y: 1e15 + 20 }), veryTranslated, { geometryEpsilon: 1e-8 })).toEqual({ kind: "none" });
    const translatedSecant = intersectCurves(line({ x: 1e15 - 10, y: 1e15 + 4.5 }, { x: 1e15 + 10, y: 1e15 + 4.5 }), veryTranslated, { geometryEpsilon: 1e-8 });
    expect(points(translatedSecant)).toHaveLength(2);
    expect(points(translatedSecant).every(({ contact }) => contact === "crossing")).toBe(true);
  });

  it("reports degenerate lines", () => {
    expect(intersectCurves(line({ x: 0, y: 0 }, { x: 0, y: 0 }), circle)).toEqual({ kind: "unsupported", reason: "degenerate-line" });
  });
});

describe("IntersectionEngine Line/Circle × Arc", () => {
  const circle: CircleCurve2D = { type: "circle", center: { x: 0, y: 0 }, radius: 5 };
  const quarter: ArcCurve2D = { type: "arc", center: circle.center, radius: circle.radius, startAngle: 0, endAngle: Math.PI / 2, direction: "clockwise" };

  it("filters line intersections to the finite angular sweep", () => {
    const throughCenter = line({ x: -10, y: 0 }, { x: 10, y: 0 });
    expect(points(intersectCurves(throughCenter, quarter))).toEqual([{ point: { x: 5, y: 0 }, firstParameter: 0.75, secondParameter: 0, contact: "endpoint" }]);
    const crossing = points(intersectCurves(line({ x: -10, y: 3 }, { x: 10, y: 3 }), quarter));
    expect(crossing).toHaveLength(1);
    expect(crossing[0]).toMatchObject({ point: { x: expect.closeTo(4, 12), y: 3 }, firstParameter: 0.7, secondParameter: expect.closeTo(Math.atan2(3, 4) / (Math.PI / 2), 8), contact: "crossing" });
    expectSymmetric(throughCenter, quarter);
  });

  it("supports counterclockwise and seam-wrapping arcs", () => {
    const upper: ArcCurve2D = { ...quarter, endAngle: -Math.PI / 2, direction: "counterclockwise" };
    expect(points(intersectCurves(line({ x: -10, y: -3 }, { x: 10, y: -3 }), upper))[0]).toMatchObject({ point: { x: expect.closeTo(4, 12), y: -3 }, contact: "crossing" });
    const wrapping: ArcCurve2D = { ...quarter, startAngle: 3 * Math.PI / 2, endAngle: Math.PI / 2 };
    expect(points(intersectCurves(line({ x: -10, y: 0 }, { x: 10, y: 0 }), wrapping))).toEqual([{ point: { x: 5, y: 0 }, firstParameter: 0.75, secondParameter: 0.5, contact: "crossing" }]);
  });

  it("distinguishes zero sweeps from full turns and classifies only real arc endpoints", () => {
    const zero: ArcCurve2D = { ...quarter, endAngle: 0 };
    expect(points(intersectCurves(line({ x: 0, y: 0 }, { x: 10, y: 0 }), zero))[0]).toMatchObject({ secondParameter: 0, contact: "endpoint" });
    const full: ArcCurve2D = { ...zero, fullTurn: true };
    const fullPoints = points(intersectCurves(line({ x: -10, y: 0 }, { x: 10, y: 0 }), full));
    expect(fullPoints).toHaveLength(2);
    expect(fullPoints.map(({ contact }) => contact)).toEqual(["crossing", "crossing"]);
  });

  it("filters circle intersections and preserves tangency", () => {
    const other: CircleCurve2D = { type: "circle", center: { x: 6, y: 0 }, radius: 5 };
    const lowerHalf: ArcCurve2D = { ...quarter, endAngle: Math.PI };
    const result = points(intersectCurves(other, lowerHalf));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ point: { x: 3, y: 4 }, contact: "crossing" });
    expectSymmetric(other, lowerHalf);
    const tangentCircle: CircleCurve2D = { type: "circle", center: { x: 7, y: 0 }, radius: 2 };
    expect(points(intersectCurves(tangentCircle, quarter))[0]).toMatchObject({ point: { x: expect.closeTo(5, 10), y: 0 }, secondParameter: 0, contact: "endpoint" });
  });

  it("returns parameterized overlaps for coincident partial, wrapping, and full arcs", () => {
    expect(intersectCurves(circle, quarter)).toEqual({ kind: "overlap", spans: [{ firstInterval: { t0: 0, t1: 0.25 }, secondInterval: { t0: 0, t1: 1 } }], points: [] });
    const wrapping: ArcCurve2D = { ...quarter, startAngle: 3 * Math.PI / 2, endAngle: Math.PI / 2 };
    expect(intersectCurves(circle, wrapping)).toEqual({ kind: "overlap", spans: [
      { firstInterval: { t0: 0, t1: 0.25 }, secondInterval: { t0: 0.5, t1: 1 } },
      { firstInterval: { t0: 0.75, t1: 1 }, secondInterval: { t0: 0, t1: 0.5 } },
    ], points: [] });
    const full: ArcCurve2D = { ...quarter, endAngle: 0, fullTurn: true };
    expect(intersectCurves(circle, full)).toEqual({ kind: "overlap", spans: [{ firstInterval: { t0: 0, t1: 1 }, secondInterval: { t0: 0, t1: 1 } }], points: [] });
    expectSymmetric(circle, wrapping);
    const counterclockwiseFromSeam: ArcCurve2D = { ...quarter, startAngle: 0, endAngle: -Math.PI / 2, direction: "counterclockwise" };
    expect(intersectCurves(circle, counterclockwiseFromSeam)).toEqual({ kind: "overlap", spans: [{ firstInterval: { t0: 0.75, t1: 1 }, secondInterval: { t0: 0, t1: 1 } }], points: [] });
    const counterclockwiseToSeam: ArcCurve2D = { ...quarter, startAngle: Math.PI / 2, endAngle: 0, direction: "counterclockwise" };
    expect(intersectCurves(circle, counterclockwiseToSeam)).toEqual({ kind: "overlap", spans: [{ firstInterval: { t0: 0, t1: 0.25 }, secondInterval: { t0: 0, t1: 1 } }], points: [] });
  });

  it("chooses the nearest endpoint around an almost-full excluded seam", () => {
    const almostFull: ArcCurve2D = { ...quarter, endAngle: -1e-9 };
    const nearEndAngle = -8e-10;
    const radial = line({ x: 0, y: 0 }, { x: 10 * Math.cos(nearEndAngle), y: 10 * Math.sin(nearEndAngle) });
    expect(points(intersectCurves(radial, almostFull, { geometryEpsilon: 1e-8 }))[0]).toMatchObject({ secondParameter: 1, contact: "endpoint" });
  });

  it("uses model-space endpoint tolerance at large translated coordinates", () => {
    const center = { x: 1e15, y: 1e15 };
    const translated: ArcCurve2D = { ...quarter, center };
    const radial = line(center, { x: center.x, y: center.y + 10 });
    expect(points(intersectCurves(radial, translated))).toHaveLength(1);
    expect(points(intersectCurves(radial, translated))[0]).toMatchObject({ secondParameter: 1, contact: "endpoint" });
    const slightlyBeyond = Math.PI / 2 + 1e-9;
    const localArc: ArcCurve2D = { ...quarter };
    const tolerated = line({ x: 0, y: 0 }, { x: 10 * Math.cos(slightlyBeyond), y: 10 * Math.sin(slightlyBeyond) });
    expect(points(intersectCurves(tolerated, localArc, { geometryEpsilon: 1e-8 }))[0]).toMatchObject({ secondParameter: 1, contact: "endpoint" });
    const outside = Math.PI / 2 + 1e-7;
    expect(intersectCurves(line({ x: 0, y: 0 }, { x: 10 * Math.cos(outside), y: 10 * Math.sin(outside) }), localArc, { geometryEpsilon: 1e-8 })).toEqual({ kind: "none" });
  });

  it("represents coincident zero and sub-tolerance sweeps as one endpoint", () => {
    const zero: ArcCurve2D = { ...quarter, endAngle: 0 };
    expect(intersectCurves(circle, zero)).toEqual({ kind: "points", points: [{ point: { x: 5, y: 0 }, firstParameter: 0, secondParameter: 0, contact: "endpoint" }] });
    const microscopic: ArcCurve2D = { ...quarter, endAngle: 1e-12 };
    expect(intersectCurves(circle, microscopic)).toEqual({ kind: "points", points: [{ point: { x: 5, y: 0 }, firstParameter: 0, secondParameter: 0, contact: "endpoint" }] });
    const radial = line({ x: 0, y: 0 }, { x: 10 * Math.cos(5e-13), y: 10 * Math.sin(5e-13) });
    expect(points(intersectCurves(radial, microscopic))[0]).toMatchObject({ secondParameter: 0, contact: "endpoint" });
  });
});

describe("IntersectionEngine Circle × Cubic", () => {
  const circle: CircleCurve2D = { type: "circle", center: { x: 0, y: 0 }, radius: 5 };
  const straightCubic: CubicBezierCurve2D = { type: "cubicBezier", p0: { x: -10, y: 0 }, p1: { x: -10 / 3, y: 0 }, p2: { x: 10 / 3, y: 0 }, p3: { x: 10, y: 0 } };

  it("returns ordered crossings with cubic and clockwise circle parameters", () => {
    const result = intersectCurves(straightCubic, circle);
    expectPointParameters(result, [[0.25, 0.5], [0.75, 0]]);
    expect(points(result).map(({ contact }) => contact)).toEqual(["crossing", "crossing"]);
    expectSymmetric(straightCubic, circle);
    expect(points(intersectCurves(circle, straightCubic)).map(({ firstParameter }) => ({ parameter: firstParameter }))).toEqual([{ parameter: 0 }, { parameter: 0.5 }]);
  });

  it("finds all six intersections of a looping cubic", () => {
    const looping: CubicBezierCurve2D = {
      type: "cubicBezier",
      p0: { x: -6.292612313373148, y: 0.9902684468016094 },
      p1: { x: 14.980806977144098, y: -13.351108519598013 },
      p2: { x: -13.620872581330813, y: 1.1680503393885182 },
      p3: { x: -0.024218587625133736, y: -5.455267476317969 },
    };
    const intersections = points(intersectCurves(looping, circle));
    expect(intersections).toHaveLength(6);
    expect(intersections.map(({ firstParameter }) => firstParameter)).toEqual([
      expect.closeTo(0.0213257268, 8), expect.closeTo(0.2172982386, 8), expect.closeTo(0.5297032142, 8),
      expect.closeTo(0.6662982259, 8), expect.closeTo(0.9001134508, 8), expect.closeTo(0.9638866954, 8),
    ]);
    expect(intersections.every(({ contact }) => contact === "crossing")).toBe(true);
    expect(intersections.every((intersection, index) => index === 0 || intersection.firstParameter > intersections[index - 1]!.firstParameter)).toBe(true);
    expectSymmetric(looping, circle);
  });

  it("classifies tangency and preserves an interior near-tangent pair", () => {
    const horizontalAt = (y: number): CubicBezierCurve2D => ({ type: "cubicBezier", p0: { x: -2, y }, p1: { x: -2 / 3, y }, p2: { x: 2 / 3, y }, p3: { x: 2, y } });
    expect(points(intersectCurves(horizontalAt(5), circle))).toMatchObject([{ firstParameter: expect.closeTo(0.5, 12), secondParameter: 0.25, contact: "tangent" }]);
    const interior = points(intersectCurves(horizontalAt(5 - 5e-9), circle, { geometryEpsilon: 1e-8 }));
    expect(interior).toHaveLength(2);
    expect(interior.every(({ contact }) => contact === "crossing")).toBe(true);
    expect(intersectCurves(horizontalAt(5 + 5e-9), circle, { geometryEpsilon: 1e-8 })).toMatchObject({ kind: "points", points: [{ contact: "tangent" }] });
    expect(intersectCurves(horizontalAt(5 + 2e-8), circle, { geometryEpsilon: 1e-8 })).toEqual({ kind: "none" });
    const nearExteriorMaximum: CubicBezierCurve2D = { type: "cubicBezier", p0: { x: 0, y: 4.75 + 5e-9 }, p1: { x: 0, y: 5 + 1 / 12 + 5e-9 }, p2: { x: 0, y: 5 + 1 / 12 + 5e-9 }, p3: { x: 0, y: 4.75 + 5e-9 } };
    const maximumCrossings = points(intersectCurves(nearExteriorMaximum, circle, { geometryEpsilon: 1e-8 }));
    expect(maximumCrossings).toHaveLength(2);
    expect(maximumCrossings.every(({ contact }) => contact === "crossing")).toBe(true);
  });

  it("distinguishes a fourth-order tangency, a triple crossing, and tightly clustered roots", () => {
    const fourthOrder: CubicBezierCurve2D = { type: "cubicBezier", p0: { x: 0.25, y: 5 }, p1: { x: -1 / 12, y: 5 }, p2: { x: -1 / 12, y: 5 }, p3: { x: 0.25, y: 5 } };
    expect(points(intersectCurves(fourthOrder, circle))).toMatchObject([{ firstParameter: expect.closeTo(0.5, 8), contact: "tangent" }]);
    const tripleCrossing: CubicBezierCurve2D = { type: "cubicBezier", p0: { x: 0, y: 4.875 }, p1: { x: 0, y: 5.125 }, p2: { x: 0, y: 4.875 }, p3: { x: 0, y: 5.125 } };
    expect(points(intersectCurves(tripleCrossing, circle))).toMatchObject([{ firstParameter: expect.closeTo(0.5, 8), contact: "crossing" }]);
    const clustered: CubicBezierCurve2D = { type: "cubicBezier", p0: { x: -2, y: 5 - 1e-10 }, p1: { x: -2 / 3, y: 5 - 1e-10 }, p2: { x: 2 / 3, y: 5 - 1e-10 }, p3: { x: 2, y: 5 - 1e-10 } };
    const clusteredPoints = points(intersectCurves(clustered, circle, { geometryEpsilon: 1e-8 }));
    expect(clusteredPoints).toHaveLength(2);
    expect(clusteredPoints[1]!.firstParameter - clusteredPoints[0]!.firstParameter).toBeLessThan(1e-4);
    expect(clusteredPoints.every(({ contact }) => contact === "crossing")).toBe(true);
    const merged = points(intersectCurves(clustered, circle, { geometryEpsilon: 1e-8, parameterEpsilon: 1e-3 }));
    expect(merged).toHaveLength(1);
    expect(merged[0]!.contact).toBe("tangent");
  });

  it("gives cubic endpoints precedence and never treats the circle seam as an endpoint", () => {
    const endpoint: CubicBezierCurve2D = { type: "cubicBezier", p0: { x: 5, y: 0 }, p1: { x: 6, y: 0 }, p2: { x: 7, y: 0 }, p3: { x: 8, y: 0 } };
    expect(points(intersectCurves(endpoint, circle))[0]).toEqual({ point: { x: 5, y: 0 }, firstParameter: 0, secondParameter: 0, contact: "endpoint" });
    expect(points(intersectCurves(circle, endpoint))[0]).toMatchObject({ firstParameter: 0, secondParameter: 0, contact: "endpoint" });
    expect(points(intersectCurves(straightCubic, circle))[1]).toMatchObject({ firstParameter: expect.closeTo(0.75, 12), secondParameter: 0, contact: "crossing" });
  });

  it("canonicalizes a constant cubic on the circle and rejects one away from it", () => {
    const constant = (point: { x: number; y: number }): CubicBezierCurve2D => ({ type: "cubicBezier", p0: point, p1: point, p2: point, p3: point });
    expect(intersectCurves(constant({ x: 0, y: 5 }), circle)).toEqual({ kind: "points", points: [{ point: { x: 0, y: 5 }, firstParameter: 0, secondParameter: 0.25, contact: "endpoint" }] });
    expect(intersectCurves(constant({ x: 0, y: 6 }), circle)).toEqual({ kind: "none" });
  });

  it("preserves local geometry after a large translation", () => {
    const center = { x: 1e15, y: 1e15 };
    const translatedCircle: CircleCurve2D = { type: "circle", center, radius: 5 };
    const translatedCubic: CubicBezierCurve2D = { type: "cubicBezier", p0: { x: center.x - 10, y: center.y }, p1: { x: center.x - 10 / 3, y: center.y }, p2: { x: center.x + 10 / 3, y: center.y }, p3: { x: center.x + 10, y: center.y } };
    const result = intersectCurves(translatedCubic, translatedCircle);
    expect(points(result)).toHaveLength(2);
    expect(points(result).every(({ contact }) => contact === "crossing")).toBe(true);
  });
});

describe("IntersectionEngine Circle × Circle", () => {
  const first: CircleCurve2D = { type: "circle", center: { x: 0, y: 0 }, radius: 5 };

  it("returns two crossing points ordered by the first clockwise parameter", () => {
    const second: CircleCurve2D = { type: "circle", center: { x: 6, y: 0 }, radius: 5 };
    const result = intersectCurves(first, second);
    const intersections = points(result);
    expect(intersections).toHaveLength(2);
    expect(intersections[0]).toMatchObject({ point: { x: 3, y: 4 }, firstParameter: expect.closeTo(Math.atan2(4, 3) / (2 * Math.PI), 8), secondParameter: expect.closeTo(Math.atan2(4, -3) / (2 * Math.PI), 8), contact: "crossing" });
    expect(intersections[1]).toMatchObject({ point: { x: 3, y: -4 }, contact: "crossing" });
    expectSymmetric(first, second);
  });

  it("classifies external and internal tangencies without treating seams as endpoints", () => {
    const external: CircleCurve2D = { type: "circle", center: { x: 7, y: 0 }, radius: 2 };
    expect(points(intersectCurves(first, external))[0]).toMatchObject({ point: { x: expect.closeTo(5, 10), y: 0 }, firstParameter: 0, secondParameter: 0.5, contact: "tangent" });
    const internal: CircleCurve2D = { type: "circle", center: { x: 3, y: 0 }, radius: 2 };
    expect(points(intersectCurves(first, internal))[0]).toMatchObject({ point: { x: expect.closeTo(5, 10), y: 0 }, firstParameter: 0, secondParameter: 0, contact: "tangent" });
    expectSymmetric(first, external);
  });

  it("returns none for separated, contained, and unequal concentric circles", () => {
    expect(intersectCurves(first, { type: "circle", center: { x: 20, y: 0 }, radius: 2 })).toEqual({ kind: "none" });
    expect(intersectCurves(first, { type: "circle", center: { x: 1, y: 0 }, radius: 1 })).toEqual({ kind: "none" });
    expect(intersectCurves(first, { type: "circle", center: { x: 0, y: 0 }, radius: 4 })).toEqual({ kind: "none" });
  });

  it("represents coincident circles as one complete overlap", () => {
    const coincident: CircleCurve2D = { ...first };
    expect(intersectCurves(first, coincident)).toEqual({ kind: "overlap", spans: [{ firstInterval: { t0: 0, t1: 1 }, secondInterval: { t0: 0, t1: 1 } }], points: [] });
    expectSymmetric(first, coincident);
  });

  it("does not collapse distinct nearly concentric circles into overlap", () => {
    const shifted: CircleCurve2D = { type: "circle", center: { x: 5e-9, y: 0 }, radius: 5 };
    const result = intersectCurves(first, shifted, { geometryEpsilon: 1e-8 });
    expect(result.kind).toBe("points");
    expect(points(result)).toHaveLength(2);
  });

  it("keeps an interior near-tangent pair as two crossings and tolerates an exterior tangent", () => {
    const interior: CircleCurve2D = { type: "circle", center: { x: 10 - 5e-9, y: 0 }, radius: 5 };
    const interiorResult = intersectCurves(first, interior, { geometryEpsilon: 1e-8 });
    expect(points(interiorResult)).toHaveLength(2);
    expect(points(interiorResult).every(({ contact }) => contact === "crossing")).toBe(true);
    const exterior: CircleCurve2D = { type: "circle", center: { x: 10 + 5e-9, y: 0 }, radius: 5 };
    expect(intersectCurves(first, exterior, { geometryEpsilon: 1e-8 })).toMatchObject({ kind: "points", points: [{ contact: "tangent" }] });
    expect(intersectCurves(first, { ...exterior, center: { x: 10 + 2e-8, y: 0 } }, { geometryEpsilon: 1e-8 })).toEqual({ kind: "none" });
  });

  it("preserves classification at large translated coordinates", () => {
    const translatedFirst: CircleCurve2D = { type: "circle", center: { x: 1e15, y: 1e15 }, radius: 5 };
    const translatedSecond: CircleCurve2D = { type: "circle", center: { x: 1e15 + 6, y: 1e15 }, radius: 5 };
    const result = intersectCurves(translatedFirst, translatedSecond, { geometryEpsilon: 1e-8 });
    expect(points(result)).toHaveLength(2);
    expect(points(result).every(({ contact }) => contact === "crossing")).toBe(true);
    expect(intersectCurves(translatedFirst, { ...translatedSecond, center: { x: 1e15 + 20, y: 1e15 } }, { geometryEpsilon: 1e-8 })).toEqual({ kind: "none" });
  });
});

describe("IntersectionEngine Cubic × Cubic", () => {
  it("finds transverse, tangent, and triple crossings without flattening", () => {
    expectPointParameters(intersectCurves(cubic([-1, 0, 1, 0]), cubic([0, -1, 0, 1])), [[0.2113248654, 0.2113248654], [0.7886751346, 0.7886751346]]);
    const horizontal = cubic([0, 0, 0, 0]);
    const tangent = intersectCurves(cubic([0.25, -1 / 12, -1 / 12, 0.25]), horizontal);
    expectPointParameters(tangent, [[0.5, 0.5]]);
    expect(points(tangent)[0]?.contact).toBe("tangent");
    const triple = intersectCurves(cubic([-1, 1, -1, 1]), horizontal);
    expectPointParameters(triple, [[0.5, 0.5]]);
    expect(points(triple)[0]?.contact).toBe("crossing");
  });

  it("refines a non-rational even-multiplicity contact in both parameters", () => {
    const parameter = Math.SQRT1_2; const squared = parameter ** 2;
    const tangent: CubicBezierCurve2D = {
      type: "cubicBezier",
      p0: { x: 0, y: squared }, p1: { x: 10 / 3, y: squared - 2 * parameter / 3 },
      p2: { x: 20 / 3, y: squared - 4 * parameter / 3 + 1 / 3 }, p3: { x: 10, y: (1 - parameter) ** 2 },
    };
    const horizontal = cubic([0, 0, 0, 0]);
    const result = intersectCurves(tangent, horizontal);
    expectPointParameters(result, [[parameter, parameter]]);
    expect(points(result)[0]!.contact).toBe("tangent");
    expectSymmetric(tangent, horizontal);
  });

  it("supports effective polynomial degrees below three and a genuinely cubic coordinate", () => {
    const first: CubicBezierCurve2D = { type: "cubicBezier", p0: { x: 0, y: 0 }, p1: { x: 0, y: 1 / 3 }, p2: { x: 0, y: 2 / 3 }, p3: { x: 1, y: 1 } };
    const second: CubicBezierCurve2D = { type: "cubicBezier", p0: { x: 1, y: 0 }, p1: { x: 1, y: 1 / 3 }, p2: { x: 1, y: 2 / 3 }, p3: { x: 0, y: 1 } };
    const parameter = 2 ** (-1 / 3);
    expectPointParameters(intersectCurves(first, second), [[parameter, parameter]]);
  });

  it("handles endpoints, misses, translation, and symmetry", () => {
    const first = cubic([0, 1, 1, 1]);
    const second: CubicBezierCurve2D = { ...first, p0: { x: 0, y: 0 }, p1: { x: 4, y: 1 }, p2: { x: 7, y: 1 }, p3: { x: 10, y: 2 } };
    expect(points(intersectCurves(first, second))[0]?.contact).toBe("endpoint");
    expect(intersectCurves(cubic([-1, 0, 1, 0]), cubic([10, 10, 10, 10]))).toEqual({ kind: "none" });
    const translated = (curve: CubicBezierCurve2D): CubicBezierCurve2D => ({ ...curve, p0: { x: curve.p0.x + 1e15, y: curve.p0.y + 1e15 }, p1: { x: curve.p1.x + 1e15, y: curve.p1.y + 1e15 }, p2: { x: curve.p2.x + 1e15, y: curve.p2.y + 1e15 }, p3: { x: curve.p3.x + 1e15, y: curve.p3.y + 1e15 } });
    const direct = intersectCurves(cubic([-1, 0, 1, 0]), cubic([0, -1, 0, 1]));
    const reverse = intersectCurves(cubic([0, -1, 0, 1]), cubic([-1, 0, 1, 0]));
    expectPointParameters(reverse, points(direct).map(({ firstParameter, secondParameter }) => [secondParameter, firstParameter]));
    expect(points(intersectCurves(translated(cubic([-1, 0, 1, 0])), translated(cubic([0, -1, 0, 1]))))).toHaveLength(2);
    const translatedFirst = translated(cubic([0, 0, 0, 0])); const translatedSeparated = translated(cubic([0.5, 0.5, 0.5, 0.5]));
    expect(intersectCurves(translatedFirst, translatedSeparated)).toEqual({ kind: "none" });
  });

  it("distinguishes collinear point contact, disjoint ranges, and shared portions", () => {
    const vertical = (start: number, end: number): CubicBezierCurve2D => ({ type: "cubicBezier", p0: { x: 0, y: start }, p1: { x: 0, y: start + (end - start) / 3 }, p2: { x: 0, y: start + 2 * (end - start) / 3 }, p3: { x: 0, y: end } });
    expect(intersectCurves(vertical(0, 5), vertical(5, 10))).toEqual({ kind: "points", points: [{ point: { x: 0, y: 5 }, firstParameter: 1, secondParameter: 0, contact: "endpoint" }] });
    expect(intersectCurves(vertical(0, 4), vertical(5, 10))).toEqual({ kind: "none" });
    expect(intersectCurves(vertical(0, 6), vertical(5, 10))).toEqual({ kind: "unsupported", reason: "coincident-curve-portions" });
    expectSymmetric(vertical(0, 5), vertical(5, 10));
  });

  it("canonicalizes a constant cubic as one endpoint parameter", () => {
    const point = { x: 5, y: 0 };
    const constant: CubicBezierCurve2D = { type: "cubicBezier", p0: point, p1: point, p2: point, p3: point };
    const horizontal = cubic([0, 0, 0, 0]);
    expect(intersectCurves(constant, horizontal)).toEqual({ kind: "points", points: [{ point, firstParameter: 0, secondParameter: 0.5, contact: "endpoint" }] });
    expectSymmetric(constant, horizontal);
  });

  it("reports exact full overlap and uncertified coincident portions distinctly", () => {
    const base = cubic([-1, 0, 1, 0]);
    expect(intersectCurves(base, base)).toMatchObject({ kind: "overlap", spans: [{ firstInterval: { t0: 0, t1: 1 }, secondInterval: { t0: 0, t1: 1 } }] });
    expect(intersectCurves(base, { ...base, p0: base.p3, p1: base.p2, p2: base.p1, p3: base.p0 })).toMatchObject({ kind: "overlap" });
    const collinear = cubic([0, 0, 0, 0]);
    expect(intersectCurves(collinear, { ...collinear, p0: { x: 5, y: 0 }, p1: { x: 20 / 3, y: 0 }, p2: { x: 25 / 3, y: 0 }, p3: { x: 10, y: 0 } })).toEqual({ kind: "unsupported", reason: "coincident-curve-portions" });
    const disjoint: CubicBezierCurve2D = { ...collinear, p0: { x: 20, y: 0 }, p1: { x: 70 / 3, y: 0 }, p2: { x: 80 / 3, y: 0 }, p3: { x: 30, y: 0 } };
    expect(intersectCurves(collinear, disjoint)).toEqual({ kind: "none" });
    const nearlyEqual: CubicBezierCurve2D = { ...base, p0: { ...base.p0, y: base.p0.y + 5e-9 }, p1: { ...base.p1, y: base.p1.y + 5e-9 }, p2: { ...base.p2, y: base.p2.y + 5e-9 }, p3: { ...base.p3, y: base.p3.y + 5e-9 } };
    expect(intersectCurves(base, nearlyEqual, { geometryEpsilon: 1e-8 }).kind).not.toBe("overlap");
  });
});

describe("IntersectionEngine contract and legacy compatibility", () => {
  it("reports unsupported pairs explicitly and validates every Curve2D kind", () => {
    const bezier = cubic([-1, -1, 1, 1]);
    expect(intersectCurves(bezier, bezier)).toMatchObject({ kind: "overlap" });
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
