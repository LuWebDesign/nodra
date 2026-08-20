import { describe, expect, it } from "vitest";
import { boundsOf, hitTest, mmToScreen, screenToMm, validateSize } from "./index.js";
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
});
