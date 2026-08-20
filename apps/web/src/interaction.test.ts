import { describe, expect, it } from "vitest";
import { createDocument, elementId, layerId } from "@nodra/domain";
import { normalizeBounds, normalizeDrag, screenDeltaToMm, screenPointToMm, containsBounds, elementsContainedBy, pickElement } from "./interaction.js";

describe("screenDeltaToMm", () => {
  it("converts screen movement using the current zoom", () => {
    expect(screenDeltaToMm({ x: 12, y: -6 }, 3)).toEqual({ x: 4, y: -2 });
  });

  it("rejects an invalid zoom", () => {
    expect(() => screenDeltaToMm({ x: 1, y: 1 }, 0)).toThrow("zoom must be positive");
  });
});

describe("drag geometry", () => {
  it("normalizes reverse drags and enforces a minimum size", () => {
    expect(normalizeDrag({ x: 20, y: 15 }, { x: 10, y: 12 })).toEqual({ position: { x: 10, y: 12 }, size: { width: 10, height: 3 } });
    expect(normalizeDrag({ x: 4, y: 5 }, { x: 4, y: 5 })).toEqual({ position: { x: 4, y: 5 }, size: { width: 1, height: 1 } });
  });

  it("converts a canvas client point into document millimetres", () => {
    expect(screenPointToMm({ x: 130, y: 80 }, { x: 10, y: 20 }, 2, { x: 5, y: 7 })).toEqual({ x: 65, y: 37 });
  });

  it("normalizes and contains marquee bounds", () => {
    const marquee = normalizeBounds({ x: 20, y: 15 }, { x: 5, y: 2 });
    expect(marquee).toEqual({ x: 5, y: 2, width: 15, height: 13 });
    expect(containsBounds(marquee, { x: 6, y: 3, width: 2, height: 2 })).toBe(true);
  });

  it("picks the topmost visible element and ignores hidden layers", () => {
    const hidden = { id: layerId("hidden"), name: "Hidden", visible: false, order: 1 };
    const visible = { id: layerId("visible"), name: "Visible", visible: true, order: 0 };
    const document = createDocument("doc", [visible, hidden]);
    const rectangle = { type: "rectangle" as const, id: elementId("r"), layerId: visible.id, position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const hiddenRectangle = { ...rectangle, id: elementId("hidden-r"), layerId: hidden.id };
    const checked = { ...document, elements: [rectangle, hiddenRectangle] };
    expect(pickElement(checked, { x: 5, y: 5 }, 3)).toBe(rectangle.id);
    expect(elementsContainedBy(checked, { x: -1, y: -1, width: 20, height: 20 })).toEqual([rectangle.id]);
  });
});
