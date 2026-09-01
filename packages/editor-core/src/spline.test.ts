import { describe, expect, it } from "vitest";
import { elementId, layerId, type SplineElement } from "@nodra/domain";
import {
  beginSplineGesture,
  cancelSplineGesture,
  commitSplineGesture,
  createSplineEditor,
  deleteSplineNode,
  dispatchSpline,
  hitTestSpline,
  insertSplineNode,
  moveSplineHandle,
  moveSplineNode,
  previewSplineGesture,
  redoSpline,
  selectSpline,
  setSplineContinuity,
  splineToPathElement,
  undoSpline,
} from "./spline.js";

const style = { stroke: "#000", strokeWidth: 0.2 };
const spline: SplineElement = {
  type: "spline",
  id: elementId("spline-1"),
  layerId: layerId("layer-1"),
  nodes: [
    {
      id: "a",
      anchor: { x: 0, y: 0 },
      continuity: "corner",
      outHandle: { dx: 4, dy: 0 },
    },
    {
      id: "b",
      anchor: { x: 10, y: 0 },
      continuity: "corner",
      inHandle: { dx: -4, dy: 0 },
    },
  ],
  closed: false,
  style,
};

describe("spline editing commands", () => {
  it("adapts relative-handle spline data to the legacy path renderer boundary", () => {
    const path = splineToPathElement({
      ...spline,
      nodes: [
        { ...spline.nodes[0]!, outHandle: { dx: 4, dy: 0 } },
        { ...spline.nodes[1]!, inHandle: { dx: -4, dy: 0 } },
      ],
    });
    expect(path.segments[0]).toEqual({
      id: "spline-segment:a:b",
      type: "cubicBezier",
      startNodeId: "a",
      endNodeId: "b",
      control1: { x: 4, y: 0 },
      control2: { x: 6, y: 0 },
    });
  });
  it("moves a node without changing its relative handles", () => {
    const result = moveSplineNode(spline, "a", { x: 3, y: 2 });
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.spline.nodes[0]).toMatchObject({
        anchor: { x: 3, y: 2 },
        outHandle: { dx: 4, dy: 0 },
      });
  });
  it("updates handles and continuity immutably", () => {
    const handle = moveSplineHandle(spline, "a", "out", { dx: 5, dy: 1 });
    expect(handle.success).toBe(true);
    if (handle.success) {
      const continuity = setSplineContinuity(handle.spline, "a", "smooth");
      expect(continuity.success).toBe(true);
      expect(spline.nodes[0]?.outHandle).toEqual({ dx: 4, dy: 0 });
    }
  });
  it("prioritizes handles over nodes during hit-testing", () => {
    expect(hitTestSpline(spline, { x: 4, y: 0 }, 0.5)).toEqual({
      kind: "handle",
      nodeId: "a",
      handle: "out",
    });
    expect(hitTestSpline(spline, { x: 0, y: 0 }, 0.5)).toEqual({
      kind: "node",
      nodeId: "a",
    });
    expect(hitTestSpline(spline, { x: 100, y: 100 }, 0.5)).toBeUndefined();
  });
  it("commits a gesture as one transaction and supports undo/redo", () => {
    const initial = createSplineEditor(spline);
    const selected = selectSpline(initial, { kind: "node", nodeId: "a" });
    const preview = previewSplineGesture(
      beginSplineGesture(selected),
      (current) => moveSplineNode(current, "a", { x: 3, y: 2 }),
    );
    const committed = commitSplineGesture(preview);
    expect(committed.undo).toHaveLength(1);
    const undone = undoSpline(committed);
    expect(undone.spline.nodes[0]?.anchor).toEqual({ x: 0, y: 0 });
    expect(redoSpline(undone).spline.nodes[0]?.anchor).toEqual({ x: 3, y: 2 });
    expect(cancelSplineGesture(beginSplineGesture(committed)).spline).toBe(
      committed.spline,
    );
    expect(
      dispatchSpline(committed, () => ({ success: false, error: "blocked" })),
    ).toBe(committed);
  });
  it("inserts and deletes nodes with stable preconditions", () => {
    const node = {
      id: "middle",
      anchor: { x: 5, y: 0 },
      continuity: "corner" as const,
    };
    const inserted = insertSplineNode(spline, node, "a");
    expect(inserted.success).toBe(true);
    if (inserted.success) {
      expect(inserted.spline.nodes.map(({ id }) => id)).toEqual([
        "a",
        "middle",
        "b",
      ]);
      expect(deleteSplineNode(inserted.spline, "middle").success).toBe(true);
    }
    expect(deleteSplineNode(spline, "a").success).toBe(false);
    expect(moveSplineNode(spline, "missing", { x: 0, y: 0 }).success).toBe(
      false,
    );
  });
});
