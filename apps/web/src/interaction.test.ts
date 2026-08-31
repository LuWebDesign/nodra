import { describe, expect, it } from "vitest";
import { createDocument, elementId, layerId, type DocumentSnapshot } from "@nodra/domain";
import { validateDocument } from "@nodra/validation";
import { canActivateRotation, circleGeometry, centerPageInCanvas, clientPointToCanvas, clientPointToPage, creationGuides, directionalGuide, hasNonCollinearPoints, hoveredSelectionCenter, INITIAL_ZOOM, isDrawingTool, marqueeSelection, MAX_ZOOM, MIN_ZOOM, movementExceedsThreshold, normalizeBounds, normalizeDrag, pagePointToScreen, screenDeltaToMm, screenPointToMm, viewportPointToCanvas, containsBounds, elementsContainedBy, pickDimensionTarget, pickElement, pickFormaElement, pickFormaNode, pickFormaSegment, pickHoverNode, pickCuttableSegment, pickNode, pointerDownIntent, selectedNodeAnchor, selectionCenter, selectionFrame, snapCreationPoint, snapMoveDelta, visibleEditablePathNodeIndexes, zoomAtPoint } from "./interaction.js";
import { geometryPatch, geometryValue } from "./propertyBar.js";
import { dimensionKindForNodes, dimensionOffsetForPlacement, pointMidpoint } from "@nodra/geometry";

describe("editable path handles", () => {
  const nodes = [
    { kind: "anchor" as const, nodeId: "a", point: { x: 0, y: 0 } },
    { kind: "anchor" as const, nodeId: "b", point: { x: 10, y: 0 } },
    { kind: "anchor" as const, nodeId: "c", point: { x: 20, y: 0 } },
    { kind: "control" as const, nodeId: "a", segmentIndex: 0, handle: "control1" as const, point: { x: 3, y: -3 } },
    { kind: "control" as const, nodeId: "b", segmentIndex: 0, handle: "control2" as const, point: { x: 7, y: -3 } },
    { kind: "control" as const, nodeId: "b", segmentIndex: 1, handle: "control1" as const, point: { x: 13, y: 3 } },
    { kind: "control" as const, nodeId: "c", segmentIndex: 1, handle: "control2" as const, point: { x: 17, y: 3 } },
  ];
  const segments = [
    { type: "cubicBezier" as const, startNodeId: "a", endNodeId: "b", control1: nodes[3]!.point, control2: nodes[4]!.point },
    { type: "cubicBezier" as const, startNodeId: "b", endNodeId: "c", control1: nodes[5]!.point, control2: nodes[6]!.point },
  ];
  it("shows anchors before selection and neighbouring handles after selecting an anchor", () => {
    expect(visibleEditablePathNodeIndexes(nodes, segments, [])).toEqual([0, 1, 2]);
    expect(visibleEditablePathNodeIndexes(nodes, segments, [1])).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe("canvas coordinates", () => {
  it("keeps node picking separate from element picking for dimension placement", () => {
    const first = { x: 10, y: 10 }; const second = { x: 50, y: 12 }; const midpoint = pointMidpoint(first, second);
    expect(dimensionKindForNodes(first, second)).toBe("horizontal");
    expect(dimensionOffsetForPlacement("horizontal", midpoint, { x: midpoint.x, y: 0 })).toEqual({ x: 0, y: -11 });
  });
  it("picks line bodies for angular dimensions while endpoints remain node hits", () => {
    const layer = { id: layerId("dimension-pick"), name: "Dimensions", visible: true, order: 0 };
    const line = { type: "line" as const, id: elementId("dimension-pick-line"), layerId: layer.id, start: { x: 10, y: 10 }, end: { x: 50, y: 10 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const checked = { ...createDocument("dimension-pick-doc", [layer]), elements: [line] };
    expect(pickDimensionTarget(checked, { x: 30, y: 10 }, 1)?.kind).toBe("line");
    expect(pickDimensionTarget(checked, { x: 10, y: 10 }, 1)?.kind).toBe("node");
    expect(pickNode(checked, { x: 30, y: 10 }, 1)).toMatchObject({ node: { kind: "center" } });
  });
  it("picks a sketch edge body while preserving sketch node precedence", () => {
    const layer = { id: layerId("sketch-dimension-pick"), name: "Sketches", visible: true, order: 0 };
    const sketch = { type: "sketch" as const, id: elementId("sketch-dimension-pick"), layerId: layer.id, nodes: [{ id: "a", point: { x: 10, y: 10 } }, { id: "b", point: { x: 50, y: 10 } }], edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }], style: { stroke: "#000", strokeWidth: 1 } };
    const checked = { ...createDocument("sketch-dimension-pick-doc", [layer]), elements: [sketch] };
    expect(pickDimensionTarget(checked, { x: 30, y: 10 }, 1)).toMatchObject({ kind: "line", hit: { elementId: sketch.id, edgeIndex: 0, line: { start: { x: 10, y: 10 }, end: { x: 50, y: 10 } } } });
    expect(pickDimensionTarget(checked, { x: 10, y: 10 }, 1)).toMatchObject({ kind: "node", hit: { elementId: sketch.id } });
  });
  it("centers the default 1200x900 page in a measured canvas", () => {
    expect(centerPageInCanvas({ width: 360, height: 270 }, { width: 1200, height: 900 }, INITIAL_ZOOM)).toEqual({ x: expect.closeTo(360), y: expect.closeTo(270) });
  });

  it("centers a recovered custom page without assuming default dimensions", () => {
    expect(centerPageInCanvas({ width: 1000, height: 700 }, { width: 800, height: 500 }, 1)).toEqual({ x: -100, y: -100 });
  });

  it("keeps the raw pointer position in canvas-local pixels", () => {
    expect(clientPointToCanvas({ x: 130, y: 80 }, { left: 10, top: 20 })).toEqual({ x: 120, y: 60 });
  });

  it("round-trips client points through the offset, scaled page boundary", () => {
    const page = { width: 1200, height: 900 };
    const zoom = 2.5;
    const panMm = { x: 120, y: 80 };
    const canvasRect = { left: 40, top: 60 };
    const pageRect = { left: canvasRect.left - panMm.x * zoom + 1, top: canvasRect.top - panMm.y * zoom + 1 };
    const metrics = { rect: pageRect, renderedWidth: page.width * zoom, renderedHeight: page.height * zoom, borderLeft: 1, borderTop: 1 };
    for (const point of [{ x: 260, y: 190 }, { x: 415, y: 330 }, { x: 700, y: 510 }]) {
      const client = { x: pageRect.left + 1 + point.x * zoom, y: pageRect.top + 1 + point.y * zoom };
      expect(clientPointToPage(client, page, metrics)).toEqual(point);
      expect({ x: client.x - canvasRect.left - 1, y: client.y - canvasRect.top - 1 }).toEqual({ ...viewportPointToCanvas(point, zoom, panMm), x: viewportPointToCanvas(point, zoom, panMm).x + 1, y: viewportPointToCanvas(point, zoom, panMm).y + 1 });
    }
  });

  it("projects page points into canvas pixels after pan and zoom", () => {
    expect(viewportPointToCanvas({ x: 32, y: 26 }, 3, { x: 20, y: 10 })).toEqual({ x: 36, y: 48 });
  });

  it("calculates geometric centers without being affected by rotation", () => {
    const rectangle = { type: "rectangle" as const, id: elementId("center-rectangle"), layerId: layerId("center"), position: { x: 10, y: 20 }, size: { width: 30, height: 40 }, cornerRadius: 0, rotation: Math.PI / 3, style: { stroke: "#000", strokeWidth: 1 } };
    const line = { type: "line" as const, id: elementId("center-line"), layerId: layerId("center"), start: { x: 4, y: 8 }, end: { x: 20, y: 18 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    expect(selectionCenter(rectangle)).toEqual({ x: 25, y: 40 });
    expect(selectionCenter(line)).toEqual({ x: 12, y: 13 });
  });

  it("picks rendered annotation dimensions from resolved references", () => {
    const layer = { id: layerId("dimension-layer"), name: "Dimension layer", visible: true, order: 0 };
    const line = { type: "line" as const, id: elementId("dimension-line"), layerId: layer.id, start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const dimension = { type: "dimension" as const, id: elementId("dimension-hit"), layerId: layer.id, kind: "aligned" as const, references: [{ elementId: line.id, nodeIndex: 0 }, { elementId: line.id, nodeIndex: 2 }] as const, offset: { x: 0, y: -8 }, precision: 2, units: "mm" as const, rotation: 0 as const, style: { stroke: "#2563eb", strokeWidth: 0.45 } };
    const checked = { ...createDocument("dimension-doc", [layer]), elements: [line, dimension] };
     expect(pickElement(checked, { x: 5, y: -8 }, 3)).toBe(dimension.id);
     expect(pickElement(checked, { x: 5, y: -19 }, 3)).toBe(dimension.id);
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

describe("Forma hit testing", () => {
  it("ignores text without breaking editable closed geometry", () => {
    const layer = { id: layerId("forma-text"), name: "Forma", visible: true, order: 0 };
    const text = { type: "text" as const, id: elementId("forma-text"), layerId: layer.id, position: { x: 10, y: 10 }, size: { width: 30, height: 10 }, text: "A", fontFamily: "Arial", fontSize: 24, fontWeight: "normal" as const, fontStyle: "normal" as const, textAlign: "left" as const, lineHeight: 1.2, rotation: 0, style: { stroke: "#000", fill: "#000", strokeWidth: 1 } };
    const rectangle = { type: "rectangle" as const, id: elementId("forma-rectangle"), layerId: layer.id, position: { x: 50, y: 10 }, size: { width: 20, height: 10 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const checked = { ...createDocument("forma-text-document", [layer]), elements: [text, rectangle] };
    expect(() => pickFormaSegment(checked, { x: 60, y: 10 }, 1)).not.toThrow();
    expect(pickFormaSegment(checked, { x: 60, y: 10 }, 1)).toMatchObject({ elementId: rectangle.id });
    expect(pickFormaNode(checked, { x: 20, y: 10 }, 1)).toBeUndefined();
  });

  it("does not route open paths or splines through closed-shape Forma insertion", () => {
    const layer = { id: layerId("forma-open"), name: "Forma", visible: true, order: 0 };
    const openPath = {
      type: "path" as const,
      id: elementId("forma-open-path"),
      layerId: layer.id,
      nodes: [{ id: "a", anchor: { x: 10, y: 30 }, join: "corner" as const }, { id: "b", anchor: { x: 30, y: 30 }, join: "corner" as const }],
      segments: [{ type: "line" as const, startNodeId: "a", endNodeId: "b" }],
      closed: false,
      style: { stroke: "#000", strokeWidth: 1 },
    };
    const openSpline = {
      type: "spline" as const,
      id: elementId("forma-open-spline"),
      layerId: layer.id,
      nodes: [{ id: "a", anchor: { x: 10, y: 50 }, continuity: "smooth" as const }, { id: "b", anchor: { x: 30, y: 50 }, continuity: "smooth" as const }],
      closed: false,
      style: { stroke: "#000", strokeWidth: 1 },
    };
    const checked = { ...createDocument("forma-open-document", [layer]), elements: [openPath, openSpline] };

    expect(() => pickFormaSegment(checked, { x: 20, y: 30 }, 1)).not.toThrow();
    expect(() => pickFormaSegment(checked, { x: 20, y: 50 }, 1)).not.toThrow();
    expect(pickFormaSegment(checked, { x: 20, y: 30 }, 1)).toBeUndefined();
    expect(pickFormaSegment(checked, { x: 20, y: 50 }, 1)).toBeUndefined();
    expect(pickFormaNode(checked, { x: 10, y: 30 }, 1)).toMatchObject({ elementId: openPath.id });
    expect(pickFormaNode(checked, { x: 10, y: 50 }, 1)).toMatchObject({ elementId: openSpline.id });
  });

  it("fails closed per malformed element while preserving valid Forma hits", () => {
    const layer = { id: layerId("forma-malformed"), name: "Forma", visible: true, order: 0 };
    const valid = { type: "rectangle" as const, id: elementId("forma-valid"), layerId: layer.id, position: { x: 50, y: 10 }, size: { width: 20, height: 10 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const degenerate = { type: "contour" as const, id: elementId("forma-degenerate"), layerId: layer.id, position: { x: 0, y: 0 }, size: { width: 0, height: 0 }, rotation: 0, contours: [{ points: [] }], fillRule: "evenodd" as const, style: { stroke: "#000", strokeWidth: 1 } };
    const malformedGlyph = {
      type: "glyph" as const,
      id: elementId("forma-malformed-glyph"),
      layerId: layer.id,
      position: { x: 0, y: 0 }, size: { width: 1, height: 1 }, rotation: 0,
      contours: [{ nodes: [{ id: "known", anchor: { x: 0, y: 0 }, join: "corner" as const }], segments: [{ type: "line" as const, startNodeId: "known", endNodeId: "missing" }] }],
      style: { stroke: "#000", strokeWidth: 1 },
    };
    const checked = { ...createDocument("forma-malformed-document", [layer]), elements: [malformedGlyph, degenerate, valid] } as unknown as DocumentSnapshot;

    expect(() => pickFormaNode(checked, { x: 60, y: 15 }, 1)).not.toThrow();
    expect(() => pickFormaSegment(checked, { x: 60, y: 15 }, 1)).not.toThrow();
    expect(() => pickFormaElement(checked, { x: 60, y: 15 }, 1)).not.toThrow();
    expect(pickFormaNode(checked, { x: 60, y: 15 }, 1)).toMatchObject({ elementId: valid.id });
    expect(pickFormaSegment(checked, { x: 60, y: 15 }, 1)).toMatchObject({ elementId: valid.id });
    expect(pickFormaElement(checked, { x: 60, y: 15 }, 1)).toBe(valid.id);
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
  it("activates rotation only for an already-selected single hit in the select tool", () => {
    const selected = elementId("selected");
    expect(canActivateRotation("select", [selected], selected)).toBe(true);
    expect(canActivateRotation("select", [selected, elementId("other")], selected)).toBe(true);
    expect(canActivateRotation("select", [selected], undefined)).toBe(false);
    expect(canActivateRotation("rectangle", [selected], selected)).toBe(false);
  });
  it("recognizes drawing tools without consulting object hit testing", () => {
    expect(["rectangle", "ellipse", "line"].every(isDrawingTool)).toBe(true);
    expect(isDrawingTool("select")).toBe(false);
    expect(isDrawingTool("dimension")).toBe(false);
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

describe("click creation geometry", () => {
  it("keeps creation previews aligned with the document point under the cursor after pan and zoom", () => {
    const zoom = 2.5;
    const panMm = { x: 120, y: 80 };
    const documentPoint = { x: 260, y: 190 };
    const canvasPoint = viewportPointToCanvas(documentPoint, zoom, panMm);
    const pointer = screenPointToMm(canvasPoint, { x: 0, y: 0 }, zoom, panMm);
    const start = { x: 220, y: 150 };
    const lineDocument = { ...createDocument("creation-preview-space", [{ id: layerId("creation-preview"), name: "Preview", visible: true, order: 0 }]), elements: [{ type: "line" as const, id: elementId("creation-preview-line"), layerId: layerId("creation-preview"), start: documentPoint, end: { x: 300, y: 190 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } }] };

    expect(pointer).toEqual(documentPoint);
    expect(normalizeDrag(start, pointer)).toEqual({ position: { x: 220, y: 150 }, size: { width: 40, height: 40 } });
    expect(circleGeometry(start, pointer)).toMatchObject({ radius: 56.568542494923804 });
    expect(creationGuides(lineDocument, pointer, zoom, 4)).toEqual([{ source: documentPoint, target: documentPoint, kind: "node" }]);
    expect(viewportPointToCanvas(pointer, zoom, panMm)).toEqual(canvasPoint);
  });

  it("creates equal circle dimensions and rejects a zero radius", () => {
    expect(circleGeometry({ x: 10, y: 20 }, { x: 13, y: 24 })).toMatchObject({ position: { x: 5, y: 15 }, size: { width: 10, height: 10 }, radius: 5 });
    expect(circleGeometry({ x: 10, y: 20 }, { x: 10, y: 20 })).toBeUndefined();
  });
  it("closes only a non-collinear line draft with at least three points", () => {
    expect(hasNonCollinearPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe(false);
    expect(hasNonCollinearPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }])).toBe(false);
    expect(hasNonCollinearPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toBe(true);
  });
  it("shows one visual guide inside tolerance and none outside it", () => {
    const layer = { id: layerId("creation-guides"), name: "Guides", visible: true, order: 0 };
    const line = { type: "line" as const, id: elementId("guide-line"), layerId: layer.id, start: { x: 20, y: 20 }, end: { x: 40, y: 20 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const document = { ...createDocument("creation-guides-doc", [layer]), elements: [line] };
    expect(creationGuides(document, { x: 20.5, y: 20 }, 4, 4)).toMatchObject([{ target: line.start, kind: "node" }]);
    expect(creationGuides(document, { x: 20.5, y: 20 }, 1, 0.25)).toEqual([]);
  });

  it("prioritizes a node over a nearer center and returns the exact node point", () => {
    const layer = { id: layerId("creation-snap-priority"), name: "Snap priority", visible: true, order: 0 };
    const rectangle = { type: "rectangle" as const, id: elementId("creation-snap-rectangle"), layerId: layer.id, position: { x: 10, y: 10 }, size: { width: 20, height: 20 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const document = { ...createDocument("creation-snap-priority", [layer]), elements: [rectangle] };
    expect(snapCreationPoint(document, { x: 11, y: 11 }, 1, 8)).toMatchObject({ point: { x: 10, y: 10 }, kind: "node", address: { kind: "named", name: "nw" } });
    expect(snapCreationPoint(document, { x: 20.5, y: 20 }, 1, 8)).toEqual({ point: { x: 20, y: 20 }, kind: "center" });
  });

  it("uses one screen tolerance and excludes hidden geometry from creation snapping", () => {
    const visible = { id: layerId("creation-snap-visible"), name: "Visible", visible: true, order: 0 };
    const hidden = { id: layerId("creation-snap-hidden"), name: "Hidden", visible: false, order: 1 };
    const rectangle = { type: "rectangle" as const, id: elementId("creation-snap-visible-rectangle"), layerId: visible.id, position: { x: 10, y: 10 }, size: { width: 20, height: 20 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const hiddenRectangle = { ...rectangle, id: elementId("creation-snap-hidden-rectangle"), layerId: hidden.id, position: { x: 100, y: 100 } };
    const document = { ...createDocument("creation-snap-tolerance", [visible, hidden]), elements: [rectangle, hiddenRectangle] };
    expect(snapCreationPoint(document, { x: 10.5, y: 10 }, 4, 2)?.point).toEqual(rectangle.position);
    expect(snapCreationPoint(document, { x: 100, y: 100 }, 4, 2)).toBeUndefined();
    expect(snapCreationPoint(document, { x: 10.5, y: 10 }, 1, 0.25)).toBeUndefined();
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
    expect(INITIAL_ZOOM).toBe(0.75);
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
    expect(anchor).toMatchObject({ elementId: source.id, nodeIndex: 6, node: { kind: "edge-midpoint", point: { x: 20, y: 15 } } });
    expect(snapMoveDelta(document, [source.id], { x: 19, y: 0 }, 1, 3, anchor).delta).toEqual({ x: 20, y: 0 });
  });
  it("snaps the grabbed rectangle midpoint to another real node", () => {
    const endpointTarget = { type: "line" as const, id: elementId("midpoint-target"), layerId: visible.id, start: { x: 45, y: 15 }, end: { x: 55, y: 25 }, rotation: 0, style: source.style };
    const document = { ...createDocument("midpoint-snap", [visible]), elements: [source, endpointTarget] };
    const anchor = pickNode(document, { x: 20, y: 15 }, 4, 2);
    expect(anchor).toMatchObject({ elementId: source.id, nodeIndex: 6, node: { kind: "edge-midpoint" } });
    expect(snapMoveDelta(document, [source.id], { x: 24.5, y: 0 }, 4, 3, anchor)).toEqual({
      delta: { x: 25, y: 0 },
      guide: { source: { x: 45, y: 15 }, target: endpointTarget.start },
    });
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

  it("hit-tests a rotated rectangle edge midpoint with stable identity", () => {
    const layer = { id: layerId("midpoint-hit"), name: "Midpoint hit", visible: true, order: 0 };
    const document = createDocument("midpoint-hit", [layer]);
    const rectangle = { type: "rectangle" as const, id: elementId("rotated-midpoint"), layerId: layer.id, position: { x: 10, y: 20 }, size: { width: 20, height: 10 }, cornerRadius: 0, rotation: Math.PI / 2, style: { stroke: "#000", strokeWidth: 1 } };
    const checked = { ...document, elements: [rectangle] };
    expect(pickNode(checked, { x: 25, y: 25 }, 3, 2)).toMatchObject({ elementId: rectangle.id, nodeIndex: 5, node: { kind: "edge-midpoint" } });
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

  it("uses visible layer and document order to break coincident node ties", () => {
    const lower = { id: layerId("coincident-lower"), name: "Lower", visible: true, order: 0 };
    const higher = { id: layerId("coincident-higher"), name: "Higher", visible: true, order: 1 };
    const first = { type: "ellipse" as const, id: elementId("coincident-first"), layerId: lower.id, position: { x: 0, y: 0 }, size: { width: 20, height: 20 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const second = { ...first, id: elementId("coincident-second"), layerId: higher.id };
    expect(pickNode({ ...createDocument("coincident-nodes", [lower, higher]), elements: [first, second] }, { x: 10, y: 0 }, 1)?.elementId).toBe(second.id);
  });

  it("starts a circular dimension from an arbitrary visible circle contour", () => {
    const layer = { id: layerId("circle-contour-dimension"), name: "Circles", visible: true, order: 0 };
    const circle = { type: "ellipse" as const, id: elementId("circle-contour-target"), layerId: layer.id, position: { x: 10, y: 10 }, size: { width: 20, height: 20 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const center = { x: 20, y: 20 };
    const point = { x: center.x + Math.SQRT1_2 * 10, y: center.y + Math.SQRT1_2 * 10 };
    const target = pickDimensionTarget({ ...createDocument("circle-contour-dimension", [layer]), elements: [circle] }, point, 1, 0.01);
    expect(target?.kind).toBe("circle");
    expect(target).toMatchObject({ kind: "circle", hit: { elementId: circle.id, center: { node: { nodeId: "center" } } } });
  });

  it("returns the exact cuttable segment endpoints for hover feedback", () => {
    const layer = { id: layerId("cut-hover"), name: "Cut hover", visible: true, order: 0 };
    const document = createDocument("cut-hover", [layer]);
    const line = { type: "line" as const, id: elementId("cut-hover-line"), layerId: layer.id, start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const hit = pickCuttableSegment({ ...document, elements: [line] }, { x: 5, y: 0.5 }, 1);
    expect(hit).toMatchObject({ elementId: line.id, segmentIndex: 0, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
  });

  it("returns full ellipse quadrant points for cut hover feedback", () => {
    const layer = { id: layerId("cut-ellipse-hover"), name: "Cut ellipse hover", visible: true, order: 0 };
    const document = createDocument("cut-ellipse-hover", [layer]);
    const circle = { type: "ellipse" as const, id: elementId("cut-hover-circle"), layerId: layer.id, position: { x: -5, y: -5 }, size: { width: 10, height: 10 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const hit = pickCuttableSegment({ ...document, elements: [circle] }, { x: 3.5, y: 3.5 }, 1);
    expect(hit).toMatchObject({ elementId: circle.id, segmentIndex: 0 });
    expect(hit?.points?.length).toBeGreaterThan(2);
    expect(hit?.start).toEqual({ x: 5, y: 0 });
    expect(hit?.end.x).toBeCloseTo(0);
    expect(hit?.end.y).toBeCloseTo(5);
  });

  it("uses the minimal tool-specific node feedback targets", () => {
    const layer = { id: layerId("hover-feedback"), name: "Hover feedback", visible: true, order: 0 };
    const document = createDocument("hover-feedback", [layer]);
    const rectangle = { type: "rectangle" as const, id: elementId("hover-rectangle"), layerId: layer.id, position: { x: 10, y: 10 }, size: { width: 20, height: 10 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const checked = validateDocument({ ...document, elements: [rectangle] });
    expect(checked.success).toBe(true);
    if (!checked.success) return;
    expect(pickHoverNode(checked.data, { x: 10, y: 10 }, 1, "select")).toMatchObject({ elementId: rectangle.id, nodeIndex: 0 });
    expect(pickHoverNode(checked.data, { x: 10, y: 10 }, 1, "forma")).toMatchObject({ elementId: rectangle.id, nodeIndex: 0 });
    expect(pickHoverNode(checked.data, { x: 10, y: 10 }, 1, "pen")).toMatchObject({ elementId: rectangle.id, nodeIndex: 0 });
    expect(pickHoverNode(checked.data, { x: 10, y: 10 }, 1, "spline")).toMatchObject({ elementId: rectangle.id, nodeIndex: 0 });
    expect(pickHoverNode(checked.data, { x: 10, y: 10 }, 1, "dimension")).toMatchObject({ elementId: rectangle.id, nodeIndex: 0 });
    expect(pickHoverNode(checked.data, { x: 100, y: 100 }, 1, "select")).toBeUndefined();
  });
  it("snaps line endpoints to fifteen-degree directions", () => {
    const guide = directionalGuide({ x: 10, y: 10 }, { x: 25, y: 20 }, 15);
    expect(guide?.angle).toBe(30);
    expect(guide?.snappedPoint.x).toBeCloseTo(25.6125);
    expect(guide?.snappedPoint.y).toBeCloseTo(19.0139);
  });
});
