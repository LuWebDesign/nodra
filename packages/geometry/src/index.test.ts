import { describe, expect, it } from "vitest";
import { boundsOf, boundsOfElements, closedElementToPolygon, degreesToRadians, elementCenter, ELLIPSE_APPROXIMATION_SEGMENTS, groupCenter, groupHandlePoints, hitTest, mmToScreen, radiansToDegrees, realGeometryNodes, resizeGroup, resizeHandle, rotatedLineEndpoints, rotateElements, rotationFromDrag, rotationHandlePoints, screenToMm, shapeResultContours, validateSize } from "./index.js";
import { elementId, layerId } from "@nodra/domain";

const style = { stroke: "#000", strokeWidth: 0.2 };
const rectangle = { type: "rectangle" as const, id: elementId("r"), layerId: layerId("l"), position: { x: 10, y: 20 }, size: { width: 20, height: 10 }, cornerRadius: 0, rotation: 0, style };

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
    expect(realGeometryNodes(line)).toEqual([{ kind: "endpoint", point: start }, { kind: "center", point: { x: 5, y: 0 } }, { kind: "endpoint", point: end }]);
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

  it("rotates group members around the axis-aligned group center", () => {
    const second = { ...rectangle, id: elementId("r3"), position: { x: 40, y: 20 } };
    const line = { type: "line" as const, id: elementId("r-line"), layerId: layerId("l"), start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style };
    const next = rotateElements([rectangle, second], groupCenter(boundsOfElements([rectangle, second])), Math.PI / 2);
    expect(next[0]).toMatchObject({ position: { x: 25, y: 5 }, rotation: Math.PI / 2 });
    expect(next[1]).toMatchObject({ rotation: Math.PI / 2 });
    expect(rotateElements([line], { x: 5, y: 0 }, Math.PI / 2)[0]).toMatchObject({ start: { x: 5, y: -5 }, end: { x: 5, y: 5 }, rotation: 0 });
  });
});
