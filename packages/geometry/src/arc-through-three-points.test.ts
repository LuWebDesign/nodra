import { describe, expect, it } from "vitest";
import { arcThroughThreePoints, closestParameter, GEOMETRY_EPSILON, pointAt } from "./index.js";

const close = (a: { x: number; y: number }, b: { x: number; y: number }, digits = 7) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};
const onArc = (arc: ReturnType<typeof arcThroughThreePoints>, point: { x: number; y: number }) => {
  expect(arc).toBeDefined();
  const curve = arc!;
  close(pointAt(curve, closestParameter(curve, point)), point, 5);
};

describe("arcThroughThreePoints", () => {
  it("selects clockwise and counterclockwise arcs", () => {
    const clockwise = arcThroughThreePoints({ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 });
    expect(clockwise?.direction).toBe("clockwise");
    close(pointAt(clockwise!, 0), { x: 1, y: 0 }); close(pointAt(clockwise!, 1), { x: 0, y: 1 }); onArc(clockwise, { x: 1, y: 1 });
    const counterclockwise = arcThroughThreePoints({ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 });
    expect(counterclockwise?.direction).toBe("counterclockwise");
    onArc(counterclockwise, { x: -1, y: 0 });
  });

  it("selects a major arc and handles the canonical-angle seam", () => {
    const major = arcThroughThreePoints({ x: 5, y: 0 }, { x: 0, y: 5 }, { x: -5, y: 0 });
    expect(major?.direction).toBe("counterclockwise");
    expect(major?.fullTurn).toBeUndefined();
    onArc(major, { x: -5, y: 0 });
    const clockwiseMajor = arcThroughThreePoints({ x: 0, y: 5 }, { x: 5, y: 0 }, { x: -5, y: 0 });
    expect(clockwiseMajor?.direction).toBe("clockwise");
    onArc(clockwiseMajor, { x: -5, y: 0 });
    const seam = arcThroughThreePoints({ x: 0, y: -5 }, { x: 0, y: 5 }, { x: 5, y: 0 });
    expect(seam?.startAngle).toBeGreaterThanOrEqual(0); expect(seam?.startAngle).toBeLessThan(2 * Math.PI);
    expect(seam?.endAngle).toBeGreaterThanOrEqual(0); expect(seam?.endAngle).toBeLessThan(2 * Math.PI);
    onArc(seam, { x: 5, y: 0 });
  });

  it("uses translated coordinates without mutating inputs", () => {
    const start = { x: 1e12 + 5, y: -1e12 }; const end = { x: 1e12, y: -1e12 + 5 }; const through = { x: 1e12 - 5, y: -1e12 };
    const before = JSON.stringify([start, end, through]);
    const arc = arcThroughThreePoints(start, end, through);
    expect(JSON.stringify([start, end, through])).toBe(before);
    expect(arc?.center.x).toBeCloseTo(1e12, 3); expect(arc?.center.y).toBeCloseTo(-1e12, 3); onArc(arc, through);
  });

  it("rejects invalid, duplicate, near-duplicate, and (near-)collinear input", () => {
    expect(() => arcThroughThreePoints({ x: NaN, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 })).toThrow();
    expect(() => arcThroughThreePoints({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, -1)).toThrow();
    expect(() => arcThroughThreePoints({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, Infinity)).toThrow();
    expect(arcThroughThreePoints({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeUndefined();
    expect(arcThroughThreePoints({ x: 0, y: 0 }, { x: GEOMETRY_EPSILON / 2, y: 0 }, { x: 0, y: 1 })).toBeUndefined();
    expect(arcThroughThreePoints({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 })).toBeUndefined();
    expect(arcThroughThreePoints({ x: Number.MAX_VALUE, y: 0 }, { x: -Number.MAX_VALUE, y: 0 }, { x: 0, y: 1 })).toBeUndefined();
    expect(arcThroughThreePoints({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: GEOMETRY_EPSILON / 2 })).toBeUndefined();
  });
});
