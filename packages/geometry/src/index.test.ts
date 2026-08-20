import { describe, expect, it } from "vitest";
import { boundsOf, hitTest, mmToScreen, resizeCorner, screenToMm, validateSize } from "./index.js";
import { elementId, layerId } from "@nodra/domain";

const style = { stroke: "#000", strokeWidth: 0.2 };
const rectangle = { type: "rectangle" as const, id: elementId("r"), layerId: layerId("l"), position: { x: 10, y: 20 }, size: { width: 20, height: 10 }, rotation: 0, style };

describe("canonical millimetre geometry", () => {
  it("round-trips viewport conversion", () => {
    const viewport = { zoom: 2, panMm: { x: 5, y: 7 } };
    const point = { x: 12, y: 18 };
    expect(screenToMm(mmToScreen(point, viewport), viewport)).toEqual(point);
  });
  it("computes bounds and hits top-left rectangle coordinates", () => {
    expect(boundsOf(rectangle)).toEqual({ x: 10, y: 20, width: 20, height: 10 });
    expect(hitTest(rectangle, { x: 10, y: 20 })).toBe(true);
    expect(hitTest(rectangle, { x: 31, y: 20 })).toBe(false);
  });
  it("rejects degenerate geometry and viewports", () => {
    expect(() => validateSize({ width: 0, height: 2 })).toThrow();
    expect(() => mmToScreen({ x: 1, y: 1 }, { zoom: 0, panMm: { x: 0, y: 0 } })).toThrow();
    expect(() => hitTest({ type: "line", id: elementId("line"), layerId: layerId("l"), start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, rotation: 0, style }, { x: 0, y: 0 })).toThrow();
  });
  it("preserves the opposite corner while normalizing reverse drags", () => {
    expect(resizeCorner(rectangle, "se", { x: 0, y: 10 }, 2)).toEqual({ position: { x: 0, y: 10 }, size: { width: 10, height: 10 } });
    expect(resizeCorner(rectangle, "se", { x: 10, y: 20 }, 2)).toEqual({ position: { x: 10, y: 20 }, size: { width: 2, height: 2 } });
  });
  it("inverse-rotates a pointer for rotated rectangles", () => {
    const rotated = { ...rectangle, position: { x: 0, y: 0 }, size: { width: 10, height: 4 }, rotation: Math.PI / 2 };
    const result = resizeCorner(rotated, "se", { x: 5, y: 2 }, 1);
    expect(result.size).toEqual({ width: 5, height: 2 });
    expect(result.position.x).toBeCloseTo(3.5);
    expect(result.position.y).toBeCloseTo(-1.5);
  });
});
