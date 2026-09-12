import { describe, expect, it } from "vitest";
import type { ElementId } from "@nodra/domain";
import { collectMixedIntersections } from "./mixed-intersections.js";
import type { CurvePiece2D } from "./curve2d.js";

const piece = (curve: CurvePiece2D["curve"], id: string, interval = { t0: 0, t1: 1 }, orientation: CurvePiece2D["orientation"] = "forward"): CurvePiece2D => ({
  curve, sourceInterval: interval, orientation, source: { kind: "line-element", elementId: id as unknown as ElementId },
});
const line = (start: { x: number; y: number }, end: { x: number; y: number }) => ({ type: "line" as const, start, end });

describe("collectMixedIntersections", () => {
  it("collects line-circle and preserves source parameters", () => {
    const result = collectMixedIntersections([
      piece(line({ x: -2, y: 0 }, { x: 2, y: 0 }), "line", { t0: 10, t1: 20 }),
      piece({ type: "circle", center: { x: 0, y: 0 }, radius: 1 }, "circle"),
    ]);
    expect(result.pairs[0]?.kind).toBe("points");
    expect(result.pairs[0]?.points.map((point) => point.firstSourceParameter)).toEqual([12.5, 17.5]);
    expect(result.pairs[0]?.points.every((point) => point.secondSourceParameter >= 0 && point.secondSourceParameter <= 1)).toBe(true);
  });

  it("supports circle-circle and line-line regression", () => {
    const result = collectMixedIntersections([
      piece(line({ x: 0, y: -1 }, { x: 0, y: 1 }), "vertical"),
      piece(line({ x: -1, y: 0 }, { x: 1, y: 0 }), "horizontal"),
      piece({ type: "circle", center: { x: 1, y: 0 }, radius: 1 }, "first-circle"),
      piece({ type: "circle", center: { x: 3, y: 0 }, radius: 1 }, "second-circle"),
    ]);
    expect(result.pairs[0]?.points[0]?.contact).toBe("crossing");
    expect(result.pairs.find((pair) => pair.first.source.elementId === "first-circle" && pair.second.source.elementId === "second-circle")?.points[0]?.contact).toBe("tangent");
  });

  it("supports arcs and cubic-supported pairs through the engine", () => {
    const arc = piece({ type: "arc", center: { x: 0, y: 0 }, radius: 1, startAngle: 0, endAngle: Math.PI, direction: "counterclockwise" }, "arc");
    const linePiece = piece(line({ x: -2, y: 0 }, { x: 2, y: 0 }), "line");
    const circle = piece({ type: "circle", center: { x: 1, y: 0 }, radius: 1 }, "circle");
    const cubic = piece({ type: "cubicBezier", p0: { x: -2, y: -1 }, p1: { x: -1, y: 1 }, p2: { x: 1, y: 1 }, p3: { x: 2, y: -1 } }, "cubic");
    const result = collectMixedIntersections([linePiece, arc, circle, cubic]);
    expect(result.pairs.find((pair) => pair.firstPiece === linePiece && pair.secondPiece === arc)?.kind).toBe("points");
    expect(result.pairs.find((pair) => pair.firstPiece === arc && pair.secondPiece === circle)?.kind).toBe("points");
    expect(result.pairs.find((pair) => pair.firstPiece === linePiece && pair.secondPiece === cubic)?.kind).toBe("points");
  });

  it("reports tangent and coincident overlap explicitly", () => {
    const result = collectMixedIntersections([
      piece(line({ x: -2, y: 1 }, { x: 2, y: 1 }), "tangent-line"),
      piece({ type: "circle", center: { x: 0, y: 0 }, radius: 1 }, "circle"),
      piece(line({ x: 0, y: 0 }, { x: 2, y: 0 }), "overlap-a"),
      piece(line({ x: 1, y: 0 }, { x: 3, y: 0 }), "overlap-b"),
    ]);
    expect(result.pairs[0]?.points[0]?.contact).toBe("tangent");
    const overlap = result.pairs.find((pair) => pair.first.source.elementId === "overlap-a");
    expect(overlap?.kind).toBe("overlap");
    expect(overlap?.diagnostics[0]?.code).toBe("overlap");
  });

  it("is deterministic and preserves identity under symmetry", () => {
    const first = piece(line({ x: -1, y: 0 }, { x: 1, y: 0 }), "a");
    const second = piece(line({ x: 0, y: -1 }, { x: 0, y: 1 }), "b");
    const forward = collectMixedIntersections([first, second]).pairs[0]!;
    const reverse = collectMixedIntersections([second, first]).pairs[0]!;
    expect(forward.points[0]?.point).toEqual(reverse.points[0]?.point);
    expect(forward.firstPiece).toBe(first);
    expect(reverse.firstPiece).toBe(second);
  });

  it("returns explicit unsupported and malformed outcomes", () => {
    const unsupported = collectMixedIntersections([
      piece({ type: "arc", center: { x: 0, y: 0 }, radius: 1, startAngle: 0, endAngle: Math.PI, direction: "clockwise" }, "arc"),
      piece({ type: "cubicBezier", p0: { x: 0, y: 0 }, p1: { x: 1, y: 0 }, p2: { x: 1, y: 1 }, p3: { x: 0, y: 1 } }, "cubic"),
    ]).pairs[0]!;
    expect(unsupported.kind).toBe("unsupported");
    expect(unsupported.diagnostics[0]?.code).toBe("unsupported-pair");
    const malformed = collectMixedIntersections([piece({ type: "line", start: { x: Number.NaN, y: 0 }, end: { x: 1, y: 0 } }, "bad"), piece(line({ x: 0, y: -1 }, { x: 0, y: 1 }), "good")]).pairs[0]!;
    expect(malformed.diagnostics[0]?.code).toBe("malformed-piece");
  });
});
