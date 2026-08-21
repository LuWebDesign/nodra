import { describe, expect, it } from "vitest";
import { createDocument, elementId, layerId } from "@nodra/domain";
import { centerPageInCanvas, clientPointToCanvas, hoveredSelectionCenter, INITIAL_ZOOM, isDrawingTool, marqueeSelection, MAX_ZOOM, MIN_ZOOM, movementExceedsThreshold, normalizeBounds, normalizeDrag, pagePointToCanvas, pagePointToScreen, screenDeltaToMm, screenPointToMm, containsBounds, elementsContainedBy, pickElement, pickNode, pointerDownIntent, selectedNodeAnchor, selectionCenter, selectionFrame, snapMoveDelta, zoomAtPoint } from "./interaction.js";
import { geometryPatch, geometryValue } from "./propertyBar.js";

describe("canvas coordinates", () => {
  it("centers the default 1200x900 page in a measured canvas", () => {
    expect(centerPageInCanvas({ width: 360, height: 270 }, { width: 1200, height: 900 }, INITIAL_ZOOM)).toEqual({ x: expect.closeTo(0), y: expect.closeTo(0) });
  });

  it("centers a recovered custom page without assuming default dimensions", () => {
    expect(centerPageInCanvas({ width: 1000, height: 700 }, { width: 800, height: 500 }, 1)).toEqual({ x: -100, y: -100 });
  });

  it("keeps the raw pointer position in canvas-local pixels", () => {
    expect(clientPointToCanvas({ x: 130, y: 80 }, { left: 10, top: 20 })).toEqual({ x: 120, y: 60 });
  });

  it("projects page points into canvas pixels after pan and zoom", () => {
    expect(pagePointToCanvas({ x: 32, y: 26 }, 3, { x: 20, y: 10 })).toEqual({ x: 36, y: 48 });
  });

  it("calculates geometric centers without being affected by rotation", () => {
    const rectangle = { type: "rectangle" as const, id: elementId("center-rectangle"), layerId: layerId("center"), position: { x: 10, y: 20 }, size: { width: 30, height: 40 }, cornerRadius: 0, rotation: Math.PI / 3, style: { stroke: "#000", strokeWidth: 1 } };
    const line = { type: "line" as const, id: elementId("center-line"), layerId: layerId("center"), start: { x: 4, y: 8 }, end: { x: 20, y: 18 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    expect(selectionCenter(rectangle)).toEqual({ x: 25, y: 40 });
    expect(selectionCenter(line)).toEqual({ x: 12, y: 13 });
  });

  it("shows center feedback only when the selected object is the picked object", () => {
    const layer = { id: layerId("center-hover"), name: "Center hover", visible: true, order: 0 };
    const document = createDocument("center-hover-doc", [layer]);
    const rectangle = { type: "rectangle" as const, id: elementId("center-hover-rectangle"), layerId: layer.id, position: { x: 10, y: 10 }, size: { width: 20, height: 10 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const checked = { ...document, elements: [rectangle] };
    expect(hoveredSelectionCenter(checked, rectangle, { x: 15, y: 15 }, 3)).toEqual({ x: 20, y: 15 });
    expect(hoveredSelectionCenter(checked, rectangle, { x: 100, y: 100 }, 3)).toBeUndefined();
  });
});

describe("screenDeltaToMm", () => {
  it("converts screen movement using the current zoom", () => {
    expect(screenDeltaToMm({ x: 12, y: -6 }, 3)).toEqual({ x: 4, y: -2 });
  });

  it("rejects an invalid zoom", () => {
    expect(() => screenDeltaToMm({ x: 1, y: 1 }, 0)).toThrow("zoom must be positive");
  });
});

describe("pointer movement threshold", () => {
  it("does not treat a click or sub-threshold jitter as a drag", () => {
    expect(movementExceedsThreshold({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(false);
    expect(movementExceedsThreshold({ x: 10, y: 10 }, { x: 12, y: 11 })).toBe(false);
    expect(movementExceedsThreshold({ x: 10, y: 10 }, { x: 13, y: 10 })).toBe(true);
  });
});

describe("drawing tool routing", () => {
  it("recognizes drawing tools without consulting object hit testing", () => {
    expect(["rectangle", "ellipse", "line"].every(isDrawingTool)).toBe(true);
    expect(isDrawingTool("select")).toBe(false);
    expect(isDrawingTool("pan")).toBe(false);
  });

  it("selects an existing object on click but keeps drawing available for a drag", () => {
    expect(pointerDownIntent("rectangle", elementId("existing"))).toBe("select");
    expect(pointerDownIntent("ellipse", elementId("existing"))).toBe("select");
    expect(pointerDownIntent("line", elementId("existing"))).toBe("select");
    expect(pointerDownIntent("rectangle", undefined)).toBe("draw");
  });

  it("projects every selected object frame into canvas space and keeps line frames visible", () => {
    const line = { type: "line" as const, id: elementId("frame-line"), layerId: layerId("frame"), start: { x: 12, y: 20 }, end: { x: 12, y: 40 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    expect(selectionFrame(line, 3, { x: 10, y: 10 })).toEqual({ left: 5, top: 30, width: 2, height: 60 });
  });
});

describe("property bar geometry", () => {
  const rectangle = { type: "rectangle" as const, id: elementId("property"), layerId: layerId("property"), position: { x: 10, y: 20 }, size: { width: 30, height: 40 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };

  it("reads and patches one rectangle dimension without changing the others", () => {
    expect(geometryValue(rectangle, "width")).toBe(30);
    expect(geometryPatch(rectangle, "x", 25)).toEqual({ position: { x: 25, y: 20 }, size: { width: 30, height: 40 } });
    expect(geometryPatch(rectangle, "height", 55)).toEqual({ position: { x: 10, y: 20 }, size: { width: 30, height: 55 } });
  });

  it("selects fully enclosed objects for reverse marquee drags from the pointer-up snapshot", () => {
    const layer = { id: layerId("marquee"), name: "Marquee", visible: true, order: 0 };
  const snapshot = { ...createDocument("marquee-doc", [layer]), elements: [{ type: "rectangle" as const, id: elementId("enclosed"), layerId: layer.id, position: { x: 10, y: 10 }, size: { width: 20, height: 10 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } }] };
    expect(marqueeSelection(snapshot, { x: 40, y: 30 }, { x: 0, y: 0 })).toEqual([elementId("enclosed")]);
    expect(marqueeSelection(snapshot, { x: 15, y: 15 }, { x: 0, y: 0 })).toEqual([]);
  });
});

describe("zoomAtPoint", () => {
  it("keeps the document point beneath the cursor fixed", () => {
    const result = zoomAtPoint(2, { x: 10, y: 20 }, { x: 100, y: 60 }, 4);
    expect(result.zoom).toBe(4);
    expect(screenPointToMm({ x: 100, y: 60 }, { x: 0, y: 0 }, result.zoom, result.panMm)).toEqual({ x: 60, y: 50 });
  });
  it("clamps to the documented zoom range", () => {
    expect(INITIAL_ZOOM).toBe(0.3);
    expect(zoomAtPoint(2, { x: 0, y: 0 }, { x: 0, y: 0 }, 0).zoom).toBe(MIN_ZOOM);
    expect(zoomAtPoint(2, { x: 0, y: 0 }, { x: 0, y: 0 }, 99).zoom).toBe(MAX_ZOOM);
  });

  it("keeps an anchored point stable while zooming out from negative pan", () => {
    const before = { x: 420, y: 280 };
    const result = zoomAtPoint(1, { x: -300, y: -200 }, before, 0.3);
    expect(screenPointToMm(before, { x: 0, y: 0 }, result.zoom, result.panMm)).toEqual({ x: 120, y: 80 });
    expect(result.panMm.x).toBeCloseTo(-1280);
    expect(result.panMm.y).toBeCloseTo(-853.3333333333334);
  });
});

describe("move snapping", () => {
  const visible = { id: layerId("snap-visible"), name: "Visible", visible: true, order: 0 };
  const hidden = { id: layerId("snap-hidden"), name: "Hidden", visible: false, order: 1 };
  const source = { type: "rectangle" as const, id: elementId("snap-source"), layerId: visible.id, position: { x: 10, y: 10 }, size: { width: 10, height: 10 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
  const target = { ...source, id: elementId("snap-target"), position: { x: 40, y: 10 } };
  it("snaps a moving real node within screen tolerance and reports a guide", () => {
    const result = snapMoveDelta({ ...createDocument("snap", [visible]), elements: [source, target] }, [source.id], { x: 19, y: 0 }, 2, 4);
    expect(result.delta).toEqual({ x: 20, y: 0 });
    expect(result.guide).toEqual({ source: { x: 40, y: 10 }, target: { x: 40, y: 10 } });
  });
  it("uses the grabbed node as the only moving snap source", () => {
    const document = { ...createDocument("anchored-snap", [visible]), elements: [source, target] };
    const anchor = pickNode(document, { x: 20, y: 15 }, 1);
    expect(anchor?.nodeIndex).toBe(1);
    expect(snapMoveDelta(document, [source.id], { x: 19, y: 0 }, 1, 3, anchor).delta).toEqual({ x: 20, y: 0 });
  });
  it("keeps free movement outside tolerance and excludes selected or hidden targets", () => {
    const hiddenTarget = { ...target, id: elementId("snap-hidden-target"), layerId: hidden.id };
    const document = { ...createDocument("snap-exclusions", [visible, hidden]), elements: [source, target, hiddenTarget] };
    expect(snapMoveDelta(document, [source.id, target.id], { x: 1, y: 1 }, 1, 8)).toEqual({ delta: { x: 1, y: 1 }, guide: undefined });
    expect(snapMoveDelta({ ...document, elements: [source, hiddenTarget] }, [source.id], { x: 29, y: 0 }, 1, 8)).toEqual({ delta: { x: 29, y: 0 }, guide: undefined });
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

  it("converts page coordinates once for overlays inside the scaled page", () => {
    expect(pagePointToScreen({ x: 12, y: 18 }, 3)).toEqual({ x: 36, y: 54 });
    expect(() => pagePointToScreen({ x: 1, y: 1 }, 0)).toThrow("zoom must be positive");
  });

  it("normalizes and contains marquee bounds", () => {
    const marquee = normalizeBounds({ x: 20, y: 15 }, { x: 5, y: 2 });
    expect(marquee).toEqual({ x: 5, y: 2, width: 15, height: 13 });
    expect(containsBounds(marquee, { x: 6, y: 3, width: 2, height: 2 })).toBe(true);
    expect(containsBounds(marquee, { x: 4, y: 3, width: 2, height: 2 })).toBe(false);
    expect(containsBounds(normalizeBounds({ x: 5, y: 2 }, { x: 20, y: 15 }), { x: 6, y: 3, width: 2, height: 2 })).toBe(true);
  });

  it("picks the topmost visible element and ignores hidden layers", () => {
    const hidden = { id: layerId("hidden"), name: "Hidden", visible: false, order: 1 };
    const visible = { id: layerId("visible"), name: "Visible", visible: true, order: 0 };
    const document = createDocument("doc", [visible, hidden]);
    const rectangle = { type: "rectangle" as const, id: elementId("r"), layerId: visible.id, position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const hiddenRectangle = { ...rectangle, id: elementId("hidden-r"), layerId: hidden.id };
    const checked = { ...document, elements: [rectangle, hiddenRectangle] };
    expect(pickElement(checked, { x: 5, y: 5 }, 3)).toBe(rectangle.id);
    expect(elementsContainedBy(checked, { x: -1, y: -1, width: 20, height: 20 })).toEqual([rectangle.id]);
  });

  it("hit-tests an existing shape independently of the active drawing tool", () => {
    const layer = { id: layerId("active-tool"), name: "Active tool", visible: true, order: 0 };
    const document = createDocument("doc-active-tool", [layer]);
    const rectangle = { type: "rectangle" as const, id: elementId("active-rectangle"), layerId: layer.id, position: { x: 10, y: 10 }, size: { width: 20, height: 10 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const checked = { ...document, elements: [rectangle] };

    for (const activeTool of ["rectangle", "ellipse", "line"] as const) {
      expect(pickElement(checked, { x: 15, y: 15 }, 3), activeTool).toBe(rectangle.id);
    }
  });

  it("prioritizes real nodes and applies a zoom-aware tolerance", () => {
    const layer = { id: layerId("node-hit"), name: "Node hit", visible: true, order: 0 };
    const document = createDocument("node-hit", [layer]);
    const rectangle = { type: "rectangle" as const, id: elementId("node-rectangle"), layerId: layer.id, position: { x: 10, y: 10 }, size: { width: 20, height: 10 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const checked = { ...document, elements: [rectangle] };
    expect(pickNode(checked, { x: 10.9, y: 10.9 }, 1)).toMatchObject({ elementId: rectangle.id, nodeIndex: 0 });
    expect(pickNode(checked, { x: 10.9, y: 10.9 }, 10, 8)).toBeUndefined();
    expect(pickElement(checked, { x: 10.9, y: 10.9 }, 1)).toBe(rectangle.id);
  });

  it("retains the exact node only when its element is in the move selection", () => {
    const layer = { id: layerId("anchor-selection"), name: "Anchor selection", visible: true, order: 0 };
    const document = createDocument("anchor-selection", [layer]);
    const rectangle = { type: "rectangle" as const, id: elementId("anchor-rectangle"), layerId: layer.id, position: { x: 10, y: 10 }, size: { width: 20, height: 10 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const checked = { ...document, elements: [rectangle] };
    const node = pickNode(checked, { x: 10, y: 10 }, 1);
    expect(selectedNodeAnchor(node, [rectangle.id])).toBe(node);
    expect(selectedNodeAnchor(node, [])).toBeUndefined();
  });
});
