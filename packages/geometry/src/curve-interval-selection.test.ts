import { describe, expect, it } from "vitest";
import { elementId } from "@nodra/domain";
import { pointAt, selectRemovableCurveInterval, selectSourcedCurveInterval, type ArcCurve2D, type CircleCurve2D, type CubicBezierCurve2D, type LineCurve2D, type SourcedCurve2D } from "./index.js";

const line: LineCurve2D = { type: "line", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
const circle: CircleCurve2D = { type: "circle", center: { x: 0, y: 0 }, radius: 5 };

function selected(result: ReturnType<typeof selectRemovableCurveInterval>) {
  expect(result.kind).toBe("selected");
  if (result.kind !== "selected") throw new Error("expected selected interval");
  return result;
}

describe("selectRemovableCurveInterval", () => {
  it("selects either side of one cut on an open line", () => {
    expect(selected(selectRemovableCurveInterval(line, [0.4], { x: 2, y: 3 })).interval).toEqual({ start: 0, end: 0.4, wrapsSeam: false });
    expect(selected(selectRemovableCurveInterval(line, [0.4], { x: 8, y: -2 })).interval).toEqual({ start: 0.4, end: 1, wrapsSeam: false });
  });

  it("selects an interior interval among multiple ordered cuts", () => {
    const result = selected(selectRemovableCurveInterval(line, [0.8, 0.2, 0.5, 0.5 + 1e-10], { x: 6, y: 4 }));
    expect(result.interval).toEqual({ start: 0.5, end: 0.8, wrapsSeam: false });
    expect(result.cuts).toEqual([0.2, 0.5, 0.8]);
    expect(result.cursorParameter).toBeCloseTo(0.6, 12);
  });

  it("uses exact cubic closest-point parameter without flattening", () => {
    const cubic: CubicBezierCurve2D = { type: "cubicBezier", p0: { x: 0, y: 0 }, p1: { x: 0, y: 10 }, p2: { x: 10, y: 10 }, p3: { x: 10, y: 0 } };
    const cursor = pointAt(cubic, 0.7);
    const result = selected(selectRemovableCurveInterval(cubic, [0.25, 0.75], cursor));
    expect(result.interval).toEqual({ start: 0.25, end: 0.75, wrapsSeam: false });
    expect(result.cursorParameter).toBeCloseTo(0.7, 8);
  });

  it("treats partial arcs as open even when their angles wrap", () => {
    const arc: ArcCurve2D = { type: "arc", center: { x: 0, y: 0 }, radius: 5, startAngle: 3 * Math.PI / 2, endAngle: Math.PI / 2, direction: "clockwise" };
    expect(selected(selectRemovableCurveInterval(arc, [0.5], pointAt(arc, 0.8))).interval).toEqual({ start: 0.5, end: 1, wrapsSeam: false });
  });

  it("selects ordinary and seam-wrapping intervals on a circle", () => {
    expect(selected(selectRemovableCurveInterval(circle, [0.25, 0.75], pointAt(circle, 0.5))).interval).toEqual({ start: 0.25, end: 0.75, wrapsSeam: false });
    expect(selected(selectRemovableCurveInterval(circle, [0.25, 0.75], pointAt(circle, 0))).interval).toEqual({ start: 0.75, end: 0.25, wrapsSeam: true });
  });

  it("uses the same cyclic policy for full-turn arcs", () => {
    const full: ArcCurve2D = { type: "arc", center: { x: 0, y: 0 }, radius: 5, startAngle: Math.PI / 2, endAngle: Math.PI / 2, direction: "counterclockwise", fullTurn: true };
    const result = selected(selectRemovableCurveInterval(full, [0.2, 0.6, 0.9], pointAt(full, 0.95)));
    expect(result.interval).toEqual({ start: 0.9, end: 0.2, wrapsSeam: true });
  });

  it("canonicalizes the closed seam and rejects insufficient distinct cuts", () => {
    expect(selectRemovableCurveInterval(circle, [0, 1, 1 - 5e-10], pointAt(circle, 0.5))).toEqual({ kind: "rejected", reason: "insufficient-cuts" });
    expect(selectRemovableCurveInterval(circle, [0.25], pointAt(circle, 0.5))).toEqual({ kind: "rejected", reason: "insufficient-cuts" });
    expect(selectRemovableCurveInterval(line, [0, 1], { x: 5, y: 0 })).toEqual({ kind: "rejected", reason: "insufficient-cuts" });
  });

  it("rejects a cursor on either linear or cyclic cut boundary", () => {
    expect(selectRemovableCurveInterval(line, [0.4], { x: 4, y: 0 })).toEqual({ kind: "rejected", reason: "cursor-on-cut" });
    expect(selectRemovableCurveInterval(circle, [0, 0.5], pointAt(circle, 1))).toEqual({ kind: "rejected", reason: "cursor-on-cut" });
  });

  it("keeps parameter tolerance independent from cursor picking distance", () => {
    const farCursor = { x: 5, y: 1e6 };
    expect(selected(selectRemovableCurveInterval(line, [0.4], farCursor)).interval).toEqual({ start: 0.4, end: 1, wrapsSeam: false });
    expect(selectRemovableCurveInterval(line, [0.4], { x: 4 + 5e-3, y: 0 }, { parameterEpsilon: 1e-3 })).toEqual({ kind: "rejected", reason: "cursor-on-cut" });
  });

  it("validates cuts, cursor coordinates, and parameter tolerance", () => {
    expect(() => selectRemovableCurveInterval(line, [Number.NaN], { x: 0, y: 0 })).toThrow("cut parameters");
    expect(() => selectRemovableCurveInterval(line, [-1e-12], { x: 0, y: 0 })).toThrow("cut parameters");
    expect(() => selectRemovableCurveInterval(line, [0.5], { x: Number.POSITIVE_INFINITY, y: 0 })).toThrow("cursor coordinates");
    expect(() => selectRemovableCurveInterval(line, [0.5], { x: 0, y: 0 }, { parameterEpsilon: 0.5 })).toThrow("parameterEpsilon");
    expect(() => selectRemovableCurveInterval({ ...circle, radius: 0 }, [0.25], { x: 0, y: 0 })).toThrow("curve radius");
  });
});


describe("selectSourcedCurveInterval", () => {
  const sourced = (curve: SourcedCurve2D["curve"], id: string, sourceIndex = 0): SourcedCurve2D => ({ curve, source: { kind: "line-element", elementId: elementId(id) }, sourceIndex });
  const target = sourced({ type: "line", start: { x: 0, y: 5 }, end: { x: 10, y: 5 } }, "target");

  it("uses only transversal intersections and excludes the target source", () => {
    const sameSource = sourced(target.curve, "target");
    const tangent = sourced({ type: "circle", center: { x: 5, y: 0 }, radius: 5 }, "tangent");
    const left = sourced({ type: "line", start: { x: 3, y: 0 }, end: { x: 3, y: 10 } }, "left");
    const right = sourced({ type: "line", start: { x: 7, y: 0 }, end: { x: 7, y: 10 } }, "right");
    expect(selectSourcedCurveInterval(target, [sameSource, tangent, left, right], { x: 5, y: 5 })).toMatchObject({ kind: "selected", interval: { start: 0.3, end: 0.7, wrapsSeam: false } });
  });

  it("vetoes overlapping intersections with a tagged unsupported result", () => {
    const overlap = sourced({ type: "line", start: { x: 2, y: 5 }, end: { x: 8, y: 5 } }, "overlap");
    expect(selectSourcedCurveInterval(target, [overlap], { x: 5, y: 5 })).toEqual({ kind: "unsupported" });
  });
});
