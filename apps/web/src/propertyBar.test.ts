import { describe, expect, it } from "vitest";
import { elementId, layerId, type RectangleElement } from "@nodra/domain";
import { cornerRadiusPatch, cornerRadiusValue, geometryPatch, geometryValue, rotationDegreesValue, rotationPatch } from "./propertyBar.js";

const rectangle: RectangleElement = { type: "rectangle", id: elementId("r"), layerId: layerId("l"), position: { x: 2, y: 3 }, size: { width: 20, height: 10 }, cornerRadius: 1.5, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };

describe("property bar helpers", () => {
  it("reads and patches geometry without losing sibling values", () => {
    expect(geometryValue(rectangle, "width")).toBe(20);
    expect(geometryPatch(rectangle, "height", 12)).toEqual({ position: rectangle.position, size: { width: 20, height: 12 } });
  });

  it("accepts non-negative millimetre corner radii and rejects invalid values", () => {
    expect(cornerRadiusValue(rectangle)).toBe(1.5);
    expect(cornerRadiusPatch(0)).toEqual({ cornerRadius: 0 });
    expect(cornerRadiusPatch(-1)).toBeUndefined();
    expect(cornerRadiusPatch(Number.NaN)).toBeUndefined();
  });
  it("normalizes degree input, rejects invalid drafts, and avoids effective no-ops", () => {
    expect(rotationPatch("-90", 0)?.rotation).toBeCloseTo(Math.PI * 1.5);
    expect(rotationPatch("450", 0)?.rotation).toBeCloseTo(Math.PI / 2);
    expect(rotationPatch("", Math.PI / 2)).toBeUndefined();
    expect(rotationPatch("invalid", Math.PI / 2)).toBeUndefined();
    expect(rotationPatch("360", 0)).toBeUndefined();
    expect(rotationDegreesValue({ ...rectangle, rotation: -Math.PI / 2 })).toBeCloseTo(270);
  });
});
