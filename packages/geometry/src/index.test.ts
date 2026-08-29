import { describe, expect, it } from "vitest";
import { angularDimensionGeometry, bezierHandlePoint, boundsOf, boundsOfElements, boundsOutsidePage, connectableNode, connectableNodeAddress, closedElementToPolygon, cubicBezierBounds, cuttableSegments, cubicBezierDerivative, degreesToRadians, dimensionGeometry, dimensionKindForNodes, dimensionKindForPlacement, dimensionOffsetForAlignedPlacement, dimensionOffsetForPlacement, editableGeometryNodes, elementCenter, elementSegmentAt, elementToContour, evaluateCubicBezier, ELLIPSE_APPROXIMATION_SEGMENTS, groupCenter, groupHandlePoints, hitTest, mirrorHandleOffset, mmToScreen, pointMidpoint, radiansToDegrees, realGeometryNodes, resizeGroup, resizeHandle, rotatedLineEndpoints, rotateElements, rotationFromDrag, rotationHandlePoints, screenToMm, shapeResultContours, sketchClosedContours, splitCubicBezier, splitCuttableSegments, validateSize, visibleBezierHandleGuides } from "./index.js";
import { elementId, layerId } from "@nodra/domain";

const style = { stroke: "#000", strokeWidth: 0.2 };
const rectangle = { type: "rectangle" as const, id: elementId("r"), layerId: layerId("l"), position: { x: 10, y: 20 }, size: { width: 20, height: 10 }, cornerRadius: 0, rotation: 0, style };

describe("canonical millimetre geometry", () => {
  it("exposes sketch nodes, edge hit testing, and bounds", () => {
    const sketch = { type: "sketch" as const, id: elementId("sketch"), layerId: layerId("l"), nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 10, y: 0 } }, { id: "c", point: { x: 10, y: 10 } }], edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }, { id: "bc", startNodeId: "b", endNodeId: "c" }], style };
    expect(realGeometryNodes(sketch).map((node) => node.nodeId)).toEqual(["a", "b", "c"]);
    expect(connectableNodeAddress(sketch, 1)).toEqual({ kind: "sketch", nodeId: "b" });
    expect(boundsOf(sketch)).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    expect(hitTest(sketch, { x: 5, y: 0.1 }, 0.2)).toBe(true);
    expect(elementSegmentAt(sketch, { x: 10, y: 5 }, 0.2)).toMatchObject({ segmentIndex: 1 });
    expect(sketchClosedContours({ ...sketch, edges: [...sketch.edges, { id: "ca", startNodeId: "c", endNodeId: "a" }] })).toHaveLength(1);
    expect(hitTest({ ...sketch, edges: [...sketch.edges, { id: "ca", startNodeId: "c", endNodeId: "a" }] }, { x: 8, y: 2 }, 0.1)).toBe(true);
  });
  it("provides shared directional Bézier handle primitives", () => {
    const anchor = { x: 10, y: 20 };
    expect(bezierHandlePoint(anchor, "out", { dx: 3, dy: -4 })).toEqual({ direction: "out", point: { x: 13, y: 16 } });
    expect(mirrorHandleOffset({ dx: 3, dy: -4 })).toEqual({ dx: -3, dy: 4 });
  });
  it("calculates dimension midpoint, axis, and natural placement offset", () => {
    const first = { x: 10, y: 20 }; const second = { x: 50, y: 24 };
    expect(pointMidpoint(first, second)).toEqual({ x: 30, y: 22 });
    expect(dimensionKindForNodes(first, second)).toBe("horizontal");
    expect(dimensionOffsetForPlacement("horizontal", pointMidpoint(first, second), { x: 999, y: 5 })).toEqual({ x: 0, y: -17 });
    expect(dimensionOffsetForPlacement("vertical", { x: 4, y: 8 }, { x: 20, y: 999 })).toEqual({ x: 16, y: 0 });
  });
  it("uses placement intent for non-axis dimension nodes", () => {
    const first = { x: 10, y: 20 }; const second = { x: 50, y: 24 };
    const midpoint = pointMidpoint(first, second);
    expect(dimensionKindForNodes(first, second)).toBe("horizontal");
    expect(dimensionKindForPlacement(first, second, { x: midpoint.x + 8, y: midpoint.y + 8 })).toBe("aligned");
    expect(dimensionKindForPlacement(first, second, { x: midpoint.x + 40, y: midpoint.y + 4 })).toBe("horizontal");
    expect(dimensionKindForPlacement(first, second, { x: midpoint.x + 4, y: midpoint.y + 40 })).toBe("vertical");
    expect(dimensionKindForPlacement({ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 50 })).toBe("horizontal");
  });
  it("uses aligned Euclidean geometry and only the perpendicular placement offset for diagonals", () => {
    const start = { x: 10, y: 10 }; const end = { x: 40, y: 40 };
    expect(dimensionKindForNodes(start, end)).toBe("aligned");
    const offset = dimensionOffsetForAlignedPlacement(start, end, { x: 20, y: 35 });
    const dimension = { type: "dimension" as const, id: elementId("aligned"), layerId: layerId("l"), kind: "aligned" as const, references: [{ kind: "node" as const, elementId: elementId("line"), nodeIndex: 0 }, { kind: "node" as const, elementId: elementId("line"), nodeIndex: 2 }] as const, offset, precision: 2, units: "mm" as const, rotation: 0 as const, style };
    const line = { type: "line" as const, id: elementId("line"), layerId: layerId("l"), start, end, rotation: 0, style };
    const geometry = dimensionGeometry(dimension, [line]);
    expect(geometry?.value).toBeCloseTo(Math.hypot(30, 30));
    expect(geometry && geometry.lineEnd.x - geometry.lineStart.x).toBeCloseTo(geometry ? geometry.lineEnd.y - geometry.lineStart.y : 0);
  });
  it("resizes a group around its existing bounds center when requested", () => {
    const second = { ...rectangle, id: elementId("r2"), position: { x: 40, y: 25 }, size: { width: 10, height: 15 } };
    const before = boundsOfElements([rectangle, second]);
    const resized = resizeGroup([rectangle, second], "se", { x: before.x + 80, y: before.y + 40 }, 1, false, true);
    const after = boundsOfElements(resized);
    expect(after).toEqual({ x: -10, y: 10, width: 80, height: 40 });
    expect(groupCenter(after)).toEqual(groupCenter(before));
  });
  it("calculates a stable 90 degree angle from connected lines", () => {
    const first = { type: "line" as const, id: elementId("first"), layerId: layerId("l"), start: { x: 20, y: 20 }, end: { x: 60, y: 20 }, rotation: 0, style };
    const second = { type: "line" as const, id: elementId("second"), layerId: layerId("l"), start: { x: 20, y: 20 }, end: { x: 20, y: 60 }, rotation: 0, style };
    const dimension = { type: "dimension" as const, id: elementId("angular"), layerId: layerId("l"), kind: "angular" as const, references: [{ kind: "line" as const, elementId: first.id }, { kind: "line" as const, elementId: second.id }] as const, offset: { x: 10, y: 10 }, precision: 2, units: "mm" as const, rotation: 0 as const, style };
    expect(angularDimensionGeometry(dimension, [first, second])?.value).toBeCloseTo(90);
  });
  it("projects primitives to editable nodes and segments without changing the primitive", () => {
    expect(realGeometryNodes(rectangle)).toHaveLength(9);
    expect(elementToContour(rectangle).contours[0]?.points).toHaveLength(5);
    expect(elementSegmentAt(rectangle, { x: 20, y: 20 }, 0.1)).toMatchObject({ elementId: rectangle.id, segmentIndex: 0 });
    expect(rectangle.type).toBe("rectangle");
  });
  it("projects ellipse quadrants as cuttable segments that split at line intersections", () => {
    const circle = { type: "ellipse" as const, id: elementId("cut-circle"), layerId: layerId("l"), position: { x: -5, y: -5 }, size: { width: 10, height: 10 }, rotation: 0, style };
    const top = { elementId: elementId("top"), segmentIndex: 0, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    const left = { elementId: elementId("left"), segmentIndex: 0, start: { x: 0, y: 0 }, end: { x: 0, y: 10 } };
    const segments = cuttableSegments(circle);
    const split = splitCuttableSegments([...segments, top, left]);
    expect(segments).toHaveLength(ELLIPSE_APPROXIMATION_SEGMENTS);
    expect(new Set(segments.map((segment) => segment.segmentIndex))).toEqual(new Set([0, 1, 2, 3]));
    expect(split.some((segment) => segment.start.x === 5 && segment.start.y === 0 || segment.end.x === 5 && segment.end.y === 0)).toBe(true);
    expect(split.some((segment) => segment.start.x === 0 && segment.start.y === 5 || segment.end.x === 0 && segment.end.y === 5)).toBe(true);
  });
  it("does not pick a contour segment at a vertex within the segment tolerance", () => {
    const contour = { type: "contour" as const, id: elementId("segment-vertex"), layerId: layerId("l"), position: { x: 10, y: 20 }, size: { width: 20, height: 10 }, contours: [{ points: [{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }, { x: 10, y: 20 }] }], fillRule: "evenodd" as const, rotation: 0, style };
    expect(elementSegmentAt(contour, { x: 10, y: 20 }, 0.1)).toBeUndefined();
    expect(elementSegmentAt(contour, { x: 20, y: 20 }, 0.1)).toMatchObject({ segmentIndex: 0 });
  });
  it("evaluates cubic curves and includes exact derivative extrema", () => {
    const curve = { p0: { x: 0, y: 0 }, p1: { x: 0, y: 10 }, p2: { x: 10, y: 10 }, p3: { x: 10, y: 0 } };
    expect(evaluateCubicBezier(curve, 0)).toEqual(curve.p0);
    expect(cubicBezierDerivative(curve, 0.5).y).toBe(0);
    expect(cubicBezierBounds(curve).height).toBeCloseTo(7.5);
    const [left, right] = splitCubicBezier(curve);
    expect(left.p3).toEqual(right.p0);
  });
  it("handles linear and constant derivative polynomials", () => {
    const curve = { p0: { x: 2, y: 4 }, p1: { x: 5, y: 4 }, p2: { x: 5, y: 10 }, p3: { x: 2, y: 10 } };
    expect(cubicBezierBounds(curve)).toEqual({ x: 2, y: 4, width: 2.25, height: 6 });
  });
  it("hit-tests open spline strokes and closed spline fills in document millimetres", () => {
    const openSpline = {
      type: "spline" as const,
      id: elementId("spline-open-hit"),
      layerId: layerId("l"),
      nodes: [
        { id: "a", anchor: { x: 0, y: 0 }, continuity: "smooth" as const, outHandle: { dx: 5, dy: 8 } },
        { id: "b", anchor: { x: 10, y: 0 }, continuity: "smooth" as const, inHandle: { dx: -5, dy: 8 } },
      ],
      closed: false,
      style,
    };
    expect(hitTest(openSpline, { x: 5, y: 6 }, 0.5)).toBe(true);
    expect(hitTest(openSpline, { x: 5, y: 8 }, 0.5)).toBe(false);

    const closedSpline = {
      type: "spline" as const,
      id: elementId("spline-closed-hit"),
      layerId: layerId("l"),
      nodes: [
        { id: "a", anchor: { x: 0, y: 0 }, continuity: "smooth" as const },
        { id: "b", anchor: { x: 20, y: 0 }, continuity: "smooth" as const },
        { id: "c", anchor: { x: 10, y: 20 }, continuity: "smooth" as const },
      ],
      closed: true,
      style,
    };
    expect(hitTest(closedSpline, { x: 10, y: 6 })).toBe(true);
    expect(hitTest(closedSpline, { x: 10, y: 25 })).toBe(false);
  });
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
  it("hit-tests text as a scaled, rotated rectangle rather than an ellipse", () => {
    const text = { type: "text" as const, id: elementId("text-hit"), layerId: layerId("l"), position: { x: 10, y: 20 }, size: { width: 20, height: 10 }, scaleX: 2, scaleY: 0.5, text: "Text", fontFamily: "Arial", fontSize: 24, fontWeight: "normal" as const, fontStyle: "normal" as const, textAlign: "left" as const, lineHeight: 1.2, rotation: Math.PI / 4, style };
    const center = { x: 30, y: 22.5 };
    expect(hitTest(text, center)).toBe(true);
    const outsideOnLongEdge = { x: center.x + 20.5 * Math.cos(Math.PI / 4), y: center.y + 20.5 * Math.sin(Math.PI / 4) };
    expect(hitTest(text, outsideOnLongEdge, 0)).toBe(false);
    expect(hitTest(text, outsideOnLongEdge, 1)).toBe(true);
    const rectangleCorner = { x: center.x + (10 * Math.cos(Math.PI / 4) - 2.4 * Math.sin(Math.PI / 4)), y: center.y + (10 * Math.sin(Math.PI / 4) + 2.4 * Math.cos(Math.PI / 4)) };
    expect(hitTest(text, rectangleCorner)).toBe(true);
  });
  it("detects objects that cross the page export boundary, including negative coordinates", () => {
    expect(boundsOutsidePage({ ...rectangle, position: { x: -1, y: 20 } }, { width: 1200, height: 900 })).toBe(true);
    expect(boundsOutsidePage(rectangle, { width: 1200, height: 900 })).toBe(false);
    expect(boundsOutsidePage({ ...rectangle, position: { x: 1190, y: 20 } }, { width: 1200, height: 900 })).toBe(true);
  });
  it("rejects degenerate geometry and viewports", () => {
    expect(() => validateSize({ width: 0, height: 2 })).toThrow();
    expect(() => mmToScreen({ x: 1, y: 1 }, { zoom: 0, panMm: { x: 0, y: 0 } })).toThrow();
    expect(() => hitTest({ type: "line", id: elementId("line"), layerId: layerId("l"), start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, rotation: 0, style }, { x: 0, y: 0 })).toThrow();
  });
  it("projects paths into shared anchors and directional handles", () => {
    const path = { type: "path" as const, id: elementId("projection-path"), layerId: layerId("l"), nodes: [{ id: "a", anchor: { x: 0, y: 0 }, join: "symmetric" as const }, { id: "b", anchor: { x: 10, y: 0 }, join: "corner" as const }], segments: [{ type: "cubicBezier" as const, startNodeId: "a", endNodeId: "b", control1: { x: 3, y: 2 }, control2: { x: 7, y: 2 } }], closed: false, rotation: 0, style };
    expect(editableGeometryNodes(path).map((node) => node.kind)).toEqual(["anchor", "anchor", "handle", "handle"]);
    const active = visibleBezierHandleGuides(path, [0]);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ anchorNodeIndex: 0, direction: "out" });
  });
  it("keeps dimensions out of boolean polygon conversion", () => {
    const dimension = { type: "dimension" as const, id: elementId("boolean-dimension"), layerId: rectangle.layerId, kind: "horizontal" as const, references: [{ elementId: rectangle.id, nodeIndex: 0 }, { elementId: rectangle.id, nodeIndex: 1 }] as const, offset: { x: 0, y: -8 }, precision: 2, units: "mm" as const, rotation: 0 as const, style };
    expect(() => closedElementToPolygon(dimension)).toThrow("Shape operations require closed objects");
    expect(() => shapeResultContours("union", [rectangle, dimension])).toThrow("Shape operations require closed objects");
  });
  it("resizes proportional corners, including reverse drags", () => {
    expect(resizeHandle(rectangle, "se", { x: 30, y: 30 })).toEqual({ position: { x: 10, y: 20 }, size: { width: 20, height: 10 } });
    expect(resizeHandle(rectangle, "se", { x: 0, y: 10 }, 2)).toEqual({ position: { x: -10, y: 10 }, size: { width: 20, height: 10 } });
    expect(resizeHandle(rectangle, "nw", { x: 25, y: 27.5 })).toEqual({ position: { x: 25, y: 27.5 }, size: { width: 5, height: 2.5 } });
    expect(resizeHandle(rectangle, "ne", { x: 30, y: 20 })).toEqual({ position: { x: 10, y: 20 }, size: { width: 20, height: 10 } });
    expect(resizeHandle(rectangle, "sw", { x: 10, y: 30 })).toEqual({ position: { x: 10, y: 20 }, size: { width: 20, height: 10 } });
  });
  it("resizes side handles on one axis and enforces minimum dimensions", () => {
    expect(resizeHandle(rectangle, "e", { x: 35, y: 999 })).toEqual({ position: { x: 10, y: 20 }, size: { width: 25, height: 10 } });
    expect(resizeHandle(rectangle, "w", { x: 25, y: -999 })).toEqual({ position: { x: 25, y: 20 }, size: { width: 5, height: 10 } });
    expect(resizeHandle(rectangle, "n", { x: -999, y: 24 })).toEqual({ position: { x: 10, y: 24 }, size: { width: 20, height: 6 } });
    expect(resizeHandle(rectangle, "s", { x: 999, y: 19 }, 2)).toEqual({ position: { x: 10, y: 18 }, size: { width: 20, height: 2 } });
  });
  it("inverse-rotates proportional corners for rotated rectangles", () => {
    const rotated = { ...rectangle, position: { x: 0, y: 0 }, size: { width: 10, height: 4 }, rotation: Math.PI / 2 };
    const result = resizeHandle(rotated, "se", { x: 1, y: 12 });
    expect(result.size.width / result.size.height).toBeCloseTo(2.5);
    expect(result.position.x).toBeCloseTo(-3.5);
    expect(result.position.y).toBeCloseTo(1.5);
  });
  it("extracts rectangle corners, center, and edge midpoints in stable order", () => {
    const nodes = realGeometryNodes(rectangle);
    expect(nodes.map(({ kind }) => kind)).toEqual(["corner", "corner", "corner", "corner", "center", "edge-midpoint", "edge-midpoint", "edge-midpoint", "edge-midpoint"]);
    expect(nodes.map(({ point }) => point)).toEqual([
      { x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }, { x: 10, y: 30 }, { x: 20, y: 25 },
      { x: 20, y: 20 }, { x: 30, y: 25 }, { x: 20, y: 30 }, { x: 10, y: 25 },
    ]);
  });
  it("rotates rectangle edge midpoints with the rectangle", () => {
    const nodes = realGeometryNodes({ ...rectangle, rotation: Math.PI / 2 });
    expect(nodes.map(({ point }) => point)).toEqual([
      { x: 25, y: 15 }, { x: 25, y: 35 }, { x: 15, y: 35 }, { x: 15, y: 15 }, { x: 20, y: 25 },
      { x: 25, y: 25 }, { x: 20, y: 35 }, { x: 15, y: 25 }, { x: 20, y: 15 },
    ]);
  });
  it("extracts line endpoints and ellipse center/cardinal nodes", () => {
    const line = { type: "line" as const, id: elementId("line-nodes"), layerId: layerId("l"), start: { x: 1, y: 2 }, end: { x: 7, y: 8 }, rotation: 0, style };
    expect(realGeometryNodes(line).map(({ point }) => point)).toEqual([line.start, { x: 4, y: 5 }, line.end]);
    const ellipse = { type: "ellipse" as const, id: elementId("ellipse-nodes"), layerId: layerId("l"), position: { x: 10, y: 20 }, size: { width: 20, height: 10 }, rotation: Math.PI / 2, style };
    expect(realGeometryNodes(ellipse).map(({ point }) => point)).toEqual([{ x: 20, y: 25 }, { x: 25, y: 25 }, { x: 20, y: 35 }, { x: 15, y: 25 }, { x: 20, y: 15 }]);
  });
  it("resolves stable addresses without using screen coordinates", () => {
    expect(connectableNodeAddress(rectangle, 0)).toEqual({ kind: "named", name: "nw" });
    expect(connectableNode(rectangle, { kind: "named", name: "e" })?.point).toEqual({ x: 30, y: 25 });
  });
  it("normalizes angle conversion and crosses the angle branch without jumping", () => {
    expect(radiansToDegrees(degreesToRadians(-90))).toBeCloseTo(270);
    expect(radiansToDegrees(degreesToRadians(450))).toBeCloseTo(90);
    expect(rotationFromDrag(0, { x: 0, y: 0 }, { x: -1, y: 0.01 }, { x: -1, y: -0.01 })).toBeCloseTo(0.02, 3);
    expect(radiansToDegrees(rotationFromDrag(degreesToRadians(8), { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }, Math.PI / 12))).toBeCloseTo(15);
  });
  it("places shape handles outside corners and line handles beyond visual endpoints", () => {
    const shapeHandles = rotationHandlePoints(rectangle, 5);
    expect(shapeHandles).toHaveLength(4);
    expect(Math.hypot(shapeHandles[0]!.x - 20, shapeHandles[0]!.y - 25)).toBeGreaterThan(Math.hypot(10, 5));
    const line = { type: "line" as const, id: elementId("rotation-handles"), layerId: layerId("l"), start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: Math.PI / 2, style };
    expect(elementCenter(line)).toEqual({ x: 5, y: 0 });
    expect(rotationHandlePoints(line, 2)).toEqual([{ x: 5, y: -7 }, { x: 5, y: 7 }]);
  });
  it("extracts contour center, vertices, and edge midpoints for every ring", () => {
    const contour = { type: "contour" as const, id: elementId("contour-nodes"), layerId: layerId("l"), position: { x: 10, y: 20 }, size: { width: 20, height: 20 }, contours: [
      { points: [{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 40 }, { x: 10, y: 40 }, { x: 10, y: 20 }] },
      { points: [{ x: 15, y: 25 }, { x: 25, y: 25 }, { x: 25, y: 35 }, { x: 15, y: 35 }, { x: 15, y: 25 }] },
    ], fillRule: "evenodd" as const, rotation: 0, style };
    const nodes = realGeometryNodes(contour);
    expect(nodes.filter(({ kind }) => kind === "center")).toEqual([{ kind: "center", point: { x: 20, y: 30 } }]);
    expect(nodes.filter(({ kind }) => kind === "corner")).toHaveLength(8);
    expect(nodes.filter(({ kind }) => kind === "edge-midpoint")).toHaveLength(8);
    expect(nodes).toContainEqual({ kind: "edge-midpoint", point: { x: 20, y: 20 } });
    expect(nodes).toContainEqual({ kind: "edge-midpoint", point: { x: 20, y: 25 } });
  });
  it("converts rotated and flipped ellipses to deterministic closed document-space polygons", () => {
    const ellipse = { type: "ellipse" as const, id: elementId("operation-ellipse"), layerId: layerId("l"), position: { x: 0, y: 0 }, size: { width: 20, height: 10 }, rotation: Math.PI / 4, flipX: true, style };
    const polygon = closedElementToPolygon(ellipse)[0]![0]!;
    expect(polygon).toHaveLength(ELLIPSE_APPROXIMATION_SEGMENTS + 1);
    expect(polygon[0]![0]).toBeCloseTo(polygon.at(-1)![0]);
    expect(polygon[0]![1]).toBeCloseTo(polygon.at(-1)![1]);
    expect(polygon[0]![0]).toBeCloseTo(-10 * Math.cos(Math.PI / 4) + 10);
  });
  it("returns real union contours rather than an axis-aligned bounds rectangle", () => {
    const contours = shapeResultContours("union", [rectangle, { ...rectangle, id: elementId("union-2"), position: { x: 25, y: 20 } }]);
    expect(contours).toHaveLength(1);
    expect(contours[0]!.points.length).toBeGreaterThan(4);
  });
  it("uses visually rotated line endpoints for bounds, hits, and stable nodes", () => {
    const line = { type: "line" as const, id: elementId("rotated-line"), layerId: layerId("l"), start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: Math.PI / 2, style };
    const [start, end] = rotatedLineEndpoints(line);
    expect(start).toEqual({ x: 5, y: -5 });
    expect(end).toEqual({ x: 5, y: 5 });
    expect(boundsOf(line)).toEqual({ x: 5, y: -5, width: 0, height: 10 });
    expect(hitTest(line, { x: 5, y: 4 }, 0.01)).toBe(true);
    expect(hitTest(line, { x: 9, y: 0 }, 0.01)).toBe(false);
    expect(realGeometryNodes(line)).toEqual([{ kind: "endpoint", nodeId: "start", point: start }, { kind: "center", nodeId: "center", point: { x: 5, y: 0 } }, { kind: "endpoint", nodeId: "end", point: end }]);
  });
  it("computes nine group handles and scales a group from one atomic geometry result", () => {
    const second = { ...rectangle, id: elementId("r2"), position: { x: 40, y: 30 }, size: { width: 10, height: 10 } };
    const elements = [rectangle, second];
    const bounds = boundsOfElements(elements);
    expect(Object.keys(groupHandlePoints(bounds))).toHaveLength(9);
    expect(groupCenter(bounds)).toEqual({ x: 30, y: 30 });
    expect(resizeGroup(elements, "se", { x: 70, y: 50 })[0]).toMatchObject({ position: { x: 10, y: 20 }, size: { width: 30, height: 15 } });
    expect(resizeGroup(elements, "e", { x: 70, y: 999 }, 1, true)[1]).toMatchObject({ size: { width: 15, height: 15 } });
  });
  it("transforms contour points in document space during group resize and rotation", () => {
    const contour = { type: "contour" as const, id: elementId("contour-transform"), layerId: layerId("l"), position: { x: 10, y: 20 }, size: { width: 20, height: 10 }, contours: [{ points: [{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }, { x: 10, y: 30 }, { x: 10, y: 20 }] }], fillRule: "evenodd" as const, rotation: 0, style };
    const resized = resizeGroup([contour], "se", { x: 50, y: 40 })[0];
    expect(resized?.type).toBe("contour");
    if (resized?.type === "contour") expect(resized.contours[0]?.points).toContainEqual({ x: 50, y: 20 });
    const rotated = rotateElements([contour], { x: 20, y: 25 }, Math.PI / 2)[0];
    expect(rotated?.type).toBe("contour");
    if (rotated?.type === "contour") expect(rotated.contours[0]?.points).toContainEqual({ x: 25, y: 15 });
  });
  it("resizes a single compound contour while preserving every ring", () => {
    const contour = { type: "contour" as const, id: elementId("contour-resize"), layerId: layerId("l"), position: { x: 10, y: 20 }, size: { width: 20, height: 20 }, contours: [
      { points: [{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 40 }, { x: 10, y: 40 }, { x: 10, y: 20 }] },
      { points: [{ x: 15, y: 25 }, { x: 25, y: 25 }, { x: 25, y: 35 }, { x: 15, y: 35 }, { x: 15, y: 25 }] },
    ], fillRule: "evenodd" as const, rotation: 0, style };
    const resized = resizeGroup([contour], "se", { x: 50, y: 60 })[0];
    expect(resized).toMatchObject({ position: { x: 10, y: 20 }, size: { width: 40, height: 40 } });
    expect(resized?.type).toBe("contour");
    if (resized?.type === "contour") {
      expect(resized.contours).toHaveLength(2);
      expect(resized.contours[1]?.points).toEqual([{ x: 20, y: 30 }, { x: 40, y: 30 }, { x: 40, y: 50 }, { x: 20, y: 50 }, { x: 20, y: 30 }]);
    }
  });

  it("rotates group members around the axis-aligned group center", () => {
    const second = { ...rectangle, id: elementId("r3"), position: { x: 40, y: 20 } };
    const line = { type: "line" as const, id: elementId("r-line"), layerId: layerId("l"), start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style };
    const next = rotateElements([rectangle, second], groupCenter(boundsOfElements([rectangle, second])), Math.PI / 2);
    expect(next[0]).toMatchObject({ position: { x: 25, y: 5 }, rotation: Math.PI / 2 });
    expect(next[1]).toMatchObject({ rotation: Math.PI / 2 });
    expect(rotateElements([line], { x: 5, y: 0 }, Math.PI / 2)[0]).toMatchObject({ start: { x: 5, y: -5 }, end: { x: 5, y: 5 }, rotation: 0 });
  });

  it("rotates spline handles as relative offsets", () => {
    const spline = {
      type: "spline" as const,
      id: elementId("spline-transform"),
      layerId: layerId("l"),
      nodes: [{
        id: "spline-node",
        anchor: { x: 10, y: 0 },
        continuity: "smooth" as const,
        inHandle: { dx: -2, dy: 0 },
        outHandle: { dx: 2, dy: 0 },
      }],
      closed: false,
      style,
    };
    const rotated = rotateElements([spline], { x: 0, y: 0 }, Math.PI / 2)[0];
    expect(rotated?.type).toBe("spline");
    if (rotated?.type === "spline") {
      expect(rotated.nodes[0]?.anchor.x).toBeCloseTo(0);
      expect(rotated.nodes[0]?.anchor.y).toBeCloseTo(10);
      expect(rotated.nodes[0]?.inHandle?.dx).toBeCloseTo(0);
      expect(rotated.nodes[0]?.inHandle?.dy).toBeCloseTo(-2);
      expect(rotated.nodes[0]?.outHandle?.dx).toBeCloseTo(0);
      expect(rotated.nodes[0]?.outHandle?.dy).toBeCloseTo(2);
    }
  });
});
