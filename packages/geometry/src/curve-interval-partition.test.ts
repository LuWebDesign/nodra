import { describe, expect, it } from "vitest";
import { partitionCurveByInterval, pointAt, type ArcCurve2D, type CircleCurve2D, type CubicBezierCurve2D, type LineCurve2D } from "./index.js";

const line: LineCurve2D = { type: "line", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
const circle: CircleCurve2D = { type: "circle", center: { x: 0, y: 0 }, radius: 5 };

const intervals = (fragments: ReturnType<typeof partitionCurveByInterval>["selected"]) => fragments.map(({ sourceInterval }) => sourceInterval);

describe("partitionCurveByInterval", () => {
  it("partitions an open line into selected and remaining exact intervals", () => {
    const partition = partitionCurveByInterval(line, { start: 0.2, end: 0.7, wrapsSeam: false });
    expect(intervals(partition.selected)).toEqual([{ t0: 0.2, t1: 0.7 }]);
    expect(intervals(partition.remainder)).toEqual([{ t0: 0, t1: 0.2 }, { t0: 0.7, t1: 1 }]);
    expect(partition.selected[0]!.curve).toEqual({ type: "line", start: { x: 2, y: 0 }, end: { x: 7, y: 0 } });
  });

  it("uses exact De Casteljau fragments for cubic previews", () => {
    const cubic: CubicBezierCurve2D = { type: "cubicBezier", p0: { x: 0, y: 0 }, p1: { x: 0, y: 12 }, p2: { x: 12, y: 12 }, p3: { x: 12, y: 0 } };
    const partition = partitionCurveByInterval(cubic, { start: 0.25, end: 0.75, wrapsSeam: false });
    expect(intervals(partition.selected)).toEqual([{ t0: 0.25, t1: 0.75 }]);
    expect(intervals(partition.remainder)).toEqual([{ t0: 0, t1: 0.25 }, { t0: 0.75, t1: 1 }]);
    expect(pointAt(partition.selected[0]!.curve, 0)).toEqual(pointAt(cubic, 0.25));
    expect(pointAt(partition.selected[0]!.curve, 1)).toEqual(pointAt(cubic, 0.75));
    expect(partition.selected[0]!.curve.type).toBe("cubicBezier");
  });

  it("partitions a non-wrapping circle interval into one selected arc", () => {
    const partition = partitionCurveByInterval(circle, { start: 0.25, end: 0.75, wrapsSeam: false });
    expect(intervals(partition.selected)).toEqual([{ t0: 0.25, t1: 0.75 }]);
    expect(intervals(partition.remainder)).toEqual([{ t0: 0, t1: 0.25 }, { t0: 0.75, t1: 1 }]);
    expect(partition.selected[0]!.curve).toMatchObject({ type: "arc", startAngle: Math.PI / 2, endAngle: 3 * Math.PI / 2, direction: "clockwise" });
  });

  it("returns wrapping circle preview fragments in traversal order", () => {
    const partition = partitionCurveByInterval(circle, { start: 0.75, end: 0.25, wrapsSeam: true });
    expect(intervals(partition.selected)).toEqual([{ t0: 0.75, t1: 1 }, { t0: 0, t1: 0.25 }]);
    expect(intervals(partition.remainder)).toEqual([{ t0: 0.25, t1: 0.75 }]);
    const seamEnd = pointAt(partition.selected[0]!.curve, 1); const seamStart = pointAt(partition.selected[1]!.curve, 0);
    expect(seamEnd.x).toBeCloseTo(seamStart.x, 12); expect(seamEnd.y).toBeCloseTo(seamStart.y, 12);
  });

  it("supports full-turn arcs while keeping partial arcs open", () => {
    const full: ArcCurve2D = { type: "arc", center: { x: 1, y: 2 }, radius: 4, startAngle: Math.PI / 3, endAngle: Math.PI / 3, direction: "counterclockwise", fullTurn: true };
    expect(intervals(partitionCurveByInterval(full, { start: 0.8, end: 0.2, wrapsSeam: true }).selected)).toEqual([{ t0: 0.8, t1: 1 }, { t0: 0, t1: 0.2 }]);
    const partial: ArcCurve2D = { type: "arc", center: full.center, radius: full.radius, startAngle: full.startAngle, endAngle: -Math.PI / 3, direction: full.direction };
    expect(() => partitionCurveByInterval(partial, { start: 0.8, end: 0.2, wrapsSeam: true })).toThrow("only closed curves");
  });

  it("can select an entire curve without mutating the input", () => {
    const snapshot = structuredClone(line);
    const partition = partitionCurveByInterval(line, { start: 0, end: 1, wrapsSeam: false });
    expect(intervals(partition.selected)).toEqual([{ t0: 0, t1: 1 }]);
    expect(partition.remainder).toEqual([]);
    expect(line).toEqual(snapshot);
  });

  it("normalizes near-endpoint values using only parameter tolerance", () => {
    const partition = partitionCurveByInterval(line, { start: 5e-10, end: 0.5, wrapsSeam: false });
    expect(intervals(partition.selected)).toEqual([{ t0: 0, t1: 0.5 }]);
    expect(intervals(partition.remainder)).toEqual([{ t0: 0.5, t1: 1 }]);
  });

  it("passes a custom parameter tolerance through to exact splitting", () => {
    const partition = partitionCurveByInterval(line, { start: 0.5, end: 0.5000000005, wrapsSeam: false }, { parameterEpsilon: 1e-12 });
    expect(intervals(partition.selected)).toEqual([{ t0: 0.5, t1: 0.5000000005 }]);
    expect(partition.remainder).toHaveLength(2);
  });

  it("rejects invalid orientation, degeneracy, ranges, and curves", () => {
    expect(() => partitionCurveByInterval(line, { start: 0.8, end: 0.2, wrapsSeam: false })).toThrow("orientation");
    expect(() => partitionCurveByInterval(circle, { start: 0.2, end: 0.8, wrapsSeam: true })).toThrow("orientation");
    expect(() => partitionCurveByInterval(line, { start: 0.5, end: 0.5 + 5e-10, wrapsSeam: false })).toThrow("non-degenerate");
    expect(() => partitionCurveByInterval(line, { start: -0.1, end: 0.5, wrapsSeam: false })).toThrow("interval parameters");
    expect(() => partitionCurveByInterval({ ...circle, radius: 0 }, { start: 0.2, end: 0.8, wrapsSeam: false })).toThrow("curve radius");
    expect(() => partitionCurveByInterval(line, { start: 0.2, end: 0.8, wrapsSeam: false }, { parameterEpsilon: -1 })).toThrow("parameterEpsilon");
  });
});
