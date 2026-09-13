import { describe, expect, it } from "vitest";
import { arcElementToCurve, circleElementToCurve, deriveCurvePieces, lineElementToCurve } from "./curve2d-adapters.js";
import { sketchProfileResult, validateSketchProfileResult } from "./profile.js";

const piece = (curve: Parameters<typeof deriveCurvePieces>[0][number]["curve"], id: string) => deriveCurvePieces([{ curve, source: { kind: "line-element", elementId: id as never }, sourceIndex: 0 }])[0]!;

const rectangle = (id = "rect") => ({ type: "rectangle" as const, id: id as never, layerId: "layer" as never, position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } });

describe("canonical parametric sketch profiles", () => {
  it("derives only explicitly scoped native elements and owns circular holes", () => {
    const rectangleElement = { ...rectangle("outer"), position: { x: -10, y: -10 }, size: { width: 20, height: 20 } };
    const hole = { type: "circle" as const, id: "hole" as never, layerId: "layer" as never, center: { x: 0, y: 0 }, radius: 3, style: { stroke: "#000", strokeWidth: 1 } };
    const unrelated = { ...hole, id: "unrelated" as never, center: { x: 100, y: 100 }, radius: 2 };
    const result = sketchProfileResult({ elements: [rectangleElement, hole] });
    expect(result.status).toBe("valid-closed"); expect(result.regions).toHaveLength(1); expect(result.regions[0]?.holes).toHaveLength(1);
    expect(result.parametricFragments.every((fragment) => fragment.source.elementId !== unrelated.id)).toBe(true);
    expect(validateSketchProfileResult(result)).toEqual([]);
  });
  it("rejects tampered fragment IDs and stale intervals", () => {
    const result = sketchProfileResult({ elements: [rectangle()] });
    const tampered = structuredClone(result) as unknown as { parametricFragments: Array<typeof result.parametricFragments[number]>; loops: Array<typeof result.loops[number]> };
    tampered.parametricFragments[0] = { ...tampered.parametricFragments[0]!, id: "missing", sourceInterval: { t0: 3, t1: 4 } };
    tampered.loops[0] = { ...tampered.loops[0]!, fragmentIds: ["missing"] };
    const codes = validateSketchProfileResult(tampered as unknown as typeof result).map(({ code }) => code);
    expect(codes).toContain("invalid-fragment-reference"); expect(codes).toContain("stale-source-interval");
  });
  it("rejects inconsistent loops and bad region hole ownership", () => {
    const hole = { type: "circle" as const, id: "hole" as never, layerId: "layer" as never, center: { x: 5, y: 5 }, radius: 2, style: { stroke: "#000", strokeWidth: 1 } };
    const result = sketchProfileResult({ elements: [rectangle(), hole] });
    const tampered = structuredClone(result) as unknown as { loops: Array<typeof result.loops[number]>; regions: Array<typeof result.regions[number]> };
    tampered.loops[0] = { ...tampered.loops[0]!, endpoints: ["bad", "bad"] };
    tampered.regions[0] = { ...tampered.regions[0]!, holeLoopIds: ["not-a-loop"], holes: [] };
    const codes = validateSketchProfileResult(tampered as unknown as typeof result).map(({ code }) => code);
    expect(codes).toContain("inconsistent-loop"); expect(codes).toContain("inconsistent-region");
  });
  it("preserves native mixed line and arc fragments", () => {
    const result = sketchProfileResult([piece({ type: "line", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }, "line"), piece({ type: "arc", center: { x: 5, y: 0 }, radius: 5, startAngle: 0, endAngle: Math.PI, direction: "counterclockwise" }, "arc")]);
    expect(result.parametricFragments.every(({ curve }) => curve.type === "line" || curve.type === "arc")).toBe(true);
  });
  it("materializes circles and accepts canonical arcs without flattening", () => {
    const circle = circleElementToCurve({ type: "circle", id: "circle" as never, layerId: "layer" as never, center: { x: 0, y: 0 }, radius: 5, style: { stroke: "#000", strokeWidth: 1 } });
    const fullCircle = sketchProfileResult([deriveCurvePieces([circle])[0]!]);
    expect(fullCircle.status).toBe("valid-closed");
    expect(fullCircle.loops).toHaveLength(1);
    expect(fullCircle.regions).toHaveLength(1);
    const arc = arcElementToCurve({ type: "arc", id: "arc" as never, layerId: "layer" as never, center: { x: 0, y: 0 }, radius: 4, startAngle: 0, endAngle: Math.PI / 2, direction: "clockwise", style: { stroke: "#000", strokeWidth: 1 } });
    expect(sketchProfileResult(deriveCurvePieces([arc])).parametricFragments[0]?.curve.type).toBe("arc");
  });
  it("keeps stable output across repeated derivation", () => {
    const line = lineElementToCurve({ type: "line", id: "line" as never, layerId: "layer" as never, start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } });
    const pieces = deriveCurvePieces([line]); expect(sketchProfileResult(pieces)).toEqual(sketchProfileResult(pieces));
  });
  it("derives canonical crossing-circle topology with two fragments per source and one region", () => {
    const first = { type: "circle" as const, id: "first-circle" as never, layerId: "layer" as never, center: { x: 0, y: 0 }, radius: 5, style: { stroke: "#000", strokeWidth: 1 } };
    const second = { ...first, id: "second-circle" as never, center: { x: 6, y: 0 } };
    const result = sketchProfileResult({ elements: [first, second] });
    const fragments = result.parametricFragments.filter((fragment) => fragment.curve.type === "arc");
    expect(fragments).toHaveLength(4);
    expect(fragments.filter((fragment) => fragment.source.elementId === first.id)).toHaveLength(2);
    expect(fragments.filter((fragment) => fragment.source.elementId === second.id)).toHaveLength(2);
    expect(result.status).toBe("valid-closed");
    expect(result.loops).toHaveLength(1);
    expect(result.regions).toHaveLength(1);
    expect(validateSketchProfileResult(result)).toEqual([]);
  });
  it.each([
    ["tangent", { x: 10, y: 0 }], ["concentric", { x: 0, y: 0 }],
    ["coincident", { x: 0, y: 0 }], ["disjoint", { x: 20, y: 0 }],
  ])("keeps %s circle scopes conservative", (_case, center) => {
    const first = { type: "circle" as const, id: "conservative-first" as never, layerId: "layer" as never, center: { x: 0, y: 0 }, radius: 5, style: { stroke: "#000", strokeWidth: 1 } };
    const second = { ...first, id: "conservative-second" as never, center };
    const result = sketchProfileResult({ elements: [first, second] });
    if (_case === "disjoint") expect(result.regions).toHaveLength(2);
    else expect(result.status).not.toBe("valid-closed");
  });
  it("keeps circle plus native line and partial arc provenance explicit", () => {
    const circle = { type: "circle" as const, id: "mixed-circle" as never, layerId: "layer" as never, center: { x: 0, y: 0 }, radius: 5, style: { stroke: "#000", strokeWidth: 1 } };
    const line = { type: "line" as const, id: "mixed-line" as never, layerId: "layer" as never, start: { x: -8, y: 0 }, end: { x: 8, y: 0 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const arc = { type: "arc" as const, id: "mixed-arc" as never, layerId: "layer" as never, center: { x: 6, y: 0 }, radius: 5, startAngle: 0, endAngle: Math.PI, direction: "counterclockwise" as const, style: { stroke: "#000", strokeWidth: 1 } };
    const result = sketchProfileResult({ elements: [circle, line, arc] });
    expect(result.parametricFragments.some((fragment) => fragment.source.elementId === line.id && fragment.curve.type === "line")).toBe(true);
    expect(result.parametricFragments.filter((fragment) => fragment.source.elementId === circle.id && fragment.curve.type === "arc").length).toBeGreaterThan(1);
    expect(result.parametricFragments.some((fragment) => fragment.source.elementId === arc.id && fragment.curve.type === "arc")).toBe(true);
    expect(validateSketchProfileResult(result)).toEqual([]);
  });
});
