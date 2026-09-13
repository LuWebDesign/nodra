import { describe, expect, it } from "vitest";
import { createDocument, elementId, layerId, nextRevision, type ArcElement, type CircleElement, type DocumentSnapshot, type LineElement, type RectangleElement } from "@nodra/domain";
import { buildSketchProfile, type ProfileInputScope } from "@nodra/geometry";
import { createEditor, dispatch, redo, trimCommand, trimPreview, trimSegment, undo, updateDimensionValue, type TrimTarget } from "./index.js";
import { previewTrim } from "./trim.js";

const layer = layerId("trim-test");
const style = { stroke: "#000", strokeWidth: 1 };
const circle: CircleElement = { type: "circle", id: elementId("trim-circle"), layerId: layer, center: { x: 10, y: 10 }, radius: 5, style };
const source = createDocument("trim-document", [{ id: layer, name: "Trim", visible: true, order: 0 }]);
const document = { ...source, elements: [circle] };
const applyCandidate = (current: DocumentSnapshot): ReturnType<typeof previewTrim> => ({ success: true, document: { ...current, revision: nextRevision(current.revision) } });
const line = (id: string, start: { x: number; y: number }, end: { x: number; y: number }): LineElement => ({ type: "line", id: elementId(id), layerId: layer, start, end, rotation: 0, style });
const rect = (id: string): RectangleElement => ({ type: "rectangle", id: elementId(id), layerId: layer, position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, cornerRadius: 0, rotation: 0, style });
const documentWith = (...elements: readonly DocumentSnapshot["elements"][number][]): DocumentSnapshot => ({ ...document, elements });
const targetFor = (current: DocumentSnapshot, element: DocumentSnapshot["elements"][number], point: { x: number; y: number }, segmentIndex = 0): TrimTarget => {
  const scope: ProfileInputScope = { elements: current.elements.filter((candidate): candidate is ProfileInputScope["elements"][number] => ["line", "circle", "arc", "rectangle", "path", "sketch"].includes(candidate.type)) };
  return { elementId: element.id, segmentIndex, point, scope, profile: buildSketchProfile(scope) };
};

 describe("Trim", () => {
  it("uses identical pure candidate semantics for preview and commit", () => {
    const target: TrimTarget = { elementId: circle.id, segmentIndex: 0, point: { x: 10, y: 15 }, scope: { elements: [circle] }, profile: buildSketchProfile({ elements: [circle] }) };
    const preview = previewTrim(document, target, applyCandidate);
    const committed = dispatch(createEditor(document), trimCommand(target, applyCandidate)).document;
    expect(preview.success).toBe(true);
    if (preview.success) expect({ ...preview.document, revision: committed.revision }).toEqual(committed);
  });
  it("keeps preview immutable and preserves one revision/history transaction", () => {
    const target: TrimTarget = { elementId: circle.id, segmentIndex: 0, point: { x: 10, y: 15 }, scope: { elements: [circle] }, profile: buildSketchProfile({ elements: [circle] }) };
    const before = JSON.stringify(document);
    const preview = previewTrim(document, target, applyCandidate);
    expect(JSON.stringify(document)).toBe(before);
    expect(preview.success && preview.document.revision).toBe(document.revision);
    const state = dispatch(createEditor(document), trimCommand(target, applyCandidate));
    expect(state.undo).toHaveLength(1);
    expect(undo(state).document).toEqual(document);
    expect(redo(undo(state)).document).toEqual(state.document);
  });
  it("returns structured diagnostics and rolls back unsupported or invalid targets", () => {
    const target: TrimTarget = { elementId: circle.id, segmentIndex: 0, point: { x: 10, y: 15 }, scope: { elements: [circle] }, profile: buildSketchProfile({ elements: [circle] }) };
    expect(previewTrim(document, { ...target, elementId: elementId("missing") }, applyCandidate)).toMatchObject({ success: false, diagnostics: [{ code: "trim-target-not-found" }] });
    const state = dispatch(createEditor(document), trimSegment({ ...target, elementId: elementId("missing") }));
    expect(state.document).toEqual(document);
    expect(state.undo).toHaveLength(0);
    expect(previewTrim(document, { ...target, point: { x: Number.NaN, y: 0 } }, applyCandidate)).toMatchObject({ success: false, diagnostics: [{ code: "invalid-trim-target" }] });
  });
  it("trims a line at a circle intersection", () => {
    const target = line("trim-line", { x: 0, y: 10 }, { x: 20, y: 10 });
    const current = documentWith(target, circle);
    const result = dispatch(createEditor(current), trimSegment(targetFor(current, target, { x: 2, y: 10 })));
    expect(result.document.elements.some((element) => element.id === target.id)).toBe(true);
    expect(result.undo).toHaveLength(1);
  });
  it("keeps preview and commit geometrically identical across Trim parity cases", () => {
        const compare = (current: DocumentSnapshot, target: TrimTarget): void => {
          const preview = trimPreview(current, target);
          const committed = dispatch(createEditor(current), trimSegment(target));
          expect(preview.success).toBe(committed.document !== current);
          if (preview.success) {
            const stable = (value: unknown): unknown => JSON.parse(JSON.stringify(value).replace(/path-segment-[0-9a-f-]{36}/g, "path-segment-generated"));
            expect(stable({ ...preview.document, revision: committed.document.revision })).toEqual(stable(committed.document));
          }
        };
        const lineTarget = line("parity-line", { x: 0, y: 10 }, { x: 20, y: 10 });
        const lineDocument = documentWith(lineTarget, circle);
        compare(lineDocument, targetFor(lineDocument, lineTarget, { x: 2, y: 10 }));
        const second: CircleElement = { ...circle, id: elementId("parity-circle-2"), center: { x: 18, y: 10 } };
        const circles = documentWith(circle, second);
        compare(circles, targetFor(circles, circle, { x: 10, y: 15 }));
        const arc: ArcElement = { type: "arc", id: elementId("parity-arc"), layerId: layer, center: { x: 10, y: 10 }, radius: 5, startAngle: 0, endAngle: Math.PI * 1.8, direction: "clockwise", style };
        const arcDocument = documentWith(arc, line("parity-arc-cutter", { x: 12, y: 0 }, { x: 12, y: 20 }));
        compare(arcDocument, targetFor(arcDocument, arc, { x: 14, y: 10 }));
        const outer = rect("parity-outer");
        const hole: RectangleElement = { ...outer, id: elementId("parity-hole"), position: { x: 2, y: 2 }, size: { width: 6, height: 6 } };
        const loopDocument = documentWith(outer, hole, line("parity-loop-cutter", { x: 0, y: 5 }, { x: 10, y: 5 }));
        compare(loopDocument, targetFor(loopDocument, outer, { x: 5, y: 0 }));
        const constrained: CircleElement = { ...circle, id: elementId("parity-constrained"), circleConstraints: [{ id: "parity-radius", kind: "radius", value: 5, driving: true }] };
        const constrainedDocument = documentWith(constrained, line("parity-reference-cutter", { x: 0, y: 10 }, { x: 20, y: 10 }));
        compare(constrainedDocument, targetFor(constrainedDocument, constrained, { x: 10, y: 15 }));
      });
      it("preserves preview/commit rollback parity for unsupported Trim", () => {
        const tangent = line("parity-tangent", { x: 0, y: 5 }, { x: 20, y: 5 });
        const current = documentWith(circle, tangent);
        const target = targetFor(current, circle, { x: 10, y: 15 });
        const preview = trimPreview(current, target);
        const committed = dispatch(createEditor(current), trimSegment(target));
        expect(preview.success).toBe(false);
        expect(committed.document).toEqual(current);
        expect(committed.undo).toHaveLength(0);
      });
      it("splits a circle using multiple intersection intervals deterministically", () => {
    const horizontal = line("trim-horizontal", { x: 0, y: 10 }, { x: 20, y: 10 });
    const vertical = line("trim-vertical", { x: 10, y: 0 }, { x: 10, y: 20 });
    const current = documentWith(circle, horizontal, vertical);
    const first = dispatch(createEditor(current), trimSegment(targetFor(current, circle, { x: 13, y: 13 })));
    const second = dispatch(createEditor(current), trimSegment(targetFor(current, circle, { x: 13, y: 13 })));
    const arcs = first.document.elements.filter((element): element is ArcElement => element.type === "arc");
    expect(arcs.length).toBeGreaterThan(0);
    expect(arcs[0]?.id).toBe(circle.id);
    expect(first.document).toEqual(second.document);
  });
  it("trims a partial arc while preserving its stable ID", () => {
    const arc: ArcElement = { type: "arc", id: elementId("trim-partial-arc"), layerId: layer, center: { x: 10, y: 10 }, radius: 5, startAngle: 0, endAngle: Math.PI * 1.8, direction: "clockwise", style };
    const cutter = line("trim-arc-cutter", { x: 12, y: 0 }, { x: 12, y: 20 });
    const current = documentWith(arc, cutter);
    const result = dispatch(createEditor(current), trimSegment(targetFor(current, arc, { x: 14, y: 10 })));
    expect(result.document.elements.some((element) => element.id === arc.id && element.type === "arc")).toBe(true);
  });
  it("handles rectangle-circle and circle-circle mixed scopes without changing cutters", () => {
    const rectangle = rect("trim-rectangle");
    const cutterCircle: CircleElement = { ...circle, id: elementId("trim-cutter-circle"), center: { x: 5, y: 5 }, radius: 3 };
    const mixed = documentWith(rectangle, cutterCircle);
    const mixedResult = dispatch(createEditor(mixed), trimSegment(targetFor(mixed, rectangle, { x: 5, y: 0 })));
    expect(mixedResult.document.elements.find((element) => element.id === cutterCircle.id)).toEqual(cutterCircle);
    const first: CircleElement = { ...circle, id: elementId("trim-circle-first"), center: { x: 0, y: 0 }, radius: 5 };
    const second: CircleElement = { ...circle, id: elementId("trim-circle-second"), center: { x: 8, y: 0 }, radius: 5 };
    const circles = documentWith(first, second);
    const circleResult = dispatch(createEditor(circles), trimSegment(targetFor(circles, first, { x: 0, y: 5 })));
    expect(circleResult.document.elements.find((element) => element.id === second.id)).toEqual(second);
    expect(circleResult.document.elements.find((element) => element.id === first.id)?.type).toBe("arc");
  });
  it("classifies outer, hole, and open-loop profiles", () => {
    const outer = rect("trim-outer");
    const inner: RectangleElement = { ...outer, id: elementId("trim-hole"), position: { x: 2, y: 2 }, size: { width: 6, height: 6 } };
    const closed = buildSketchProfile({ elements: [outer, inner] });
    expect(closed.status).toBe("valid-closed");
    expect(closed.outerRegions).toHaveLength(1);
    expect(closed.holes).toHaveLength(1);
    const open = buildSketchProfile({ elements: [line("trim-open", { x: 0, y: 0 }, { x: 1, y: 0 })] });
    expect(open.status).toBe("open");
    expect(open.openChains).toHaveLength(1);
  });
  it("reports tangent, endpoint, and ambiguous outcomes without a transaction", () => {
    const tangent: LineElement = line("trim-tangent", { x: 0, y: 5 }, { x: 20, y: 5 });
    const tangentDocument = documentWith(circle, tangent);
    const tangentResult = dispatch(createEditor(tangentDocument), trimSegment(targetFor(tangentDocument, circle, { x: 10, y: 15 })));
    expect(tangentResult.document).toEqual(tangentDocument);
    const endpoint = line("trim-endpoint", { x: 15, y: 10 }, { x: 20, y: 10 });
    const endpointDocument = documentWith(circle, endpoint);
    expect(dispatch(createEditor(endpointDocument), trimSegment(targetFor(endpointDocument, circle, { x: 10, y: 15 }))).document).toEqual(endpointDocument);
    expect(previewTrim(tangentDocument, { ...targetFor(tangentDocument, circle, { x: 2, y: 0 }), segmentIndex: -1 }, applyCandidate)).toMatchObject({ success: false, diagnostics: [{ code: "invalid-trim-target" }] });
  });
  it("rejects stale scope, mismatched scope, and stale profiles", () => {
    const target = line("trim-stale-line", { x: 0, y: 0 }, { x: 10, y: 0 });
    const current = documentWith(target, circle);
    const valid = targetFor(current, target, { x: 2, y: 0 });
    const missing = { ...valid, scope: { elements: [circle, line("not-in-document", { x: 0, y: 1 }, { x: 1, y: 1 })] } };
    expect(previewTrim(current, missing, applyCandidate)).toMatchObject({ success: false, diagnostics: [{ code: "stale-trim-scope" }] });
    expect(previewTrim(current, { ...valid, scope: { elements: [circle] } }, applyCandidate)).toMatchObject({ success: false, diagnostics: [{ code: "trim-scope-mismatch" }] });
    expect(previewTrim(current, { ...valid, profile: { ...valid.profile, status: "invalid" } }, applyCandidate)).toMatchObject({ success: false, diagnostics: [{ code: "stale-trim-profile" }] });
  });
  it("trims both crossing circles into the primary outer union through explicit canonical profile scope", () => {
    const first: CircleElement = { ...circle, id: elementId("lens-first"), center: { x: 0, y: 0 }, radius: 5 };
    const second: CircleElement = { ...circle, id: elementId("lens-second"), center: { x: 6, y: 0 }, radius: 5 };
    const current = documentWith(first, second);
    const profile = buildSketchProfile({ elements: [first, second] });
    expect(profile.parametricFragments.filter((fragment) => fragment.curve.type === "arc")).toHaveLength(4);
    expect(profile.parametricFragments.filter((fragment) => fragment.source.elementId === first.id)).toHaveLength(2);
    expect(profile.parametricFragments.filter((fragment) => fragment.source.elementId === second.id)).toHaveLength(2);
    const firstTarget = targetFor(current, first, { x: 5, y: 0 });
    const preview = trimPreview(current, firstTarget);
    const committed = dispatch(createEditor(current), trimSegment(firstTarget));
    expect(preview.success).toBe(true);
    expect(committed.document).not.toEqual(current);
    const afterFirst = committed.document;
    const secondCurrent = afterFirst.elements.find((element) => element.id === second.id);
    expect(secondCurrent).toEqual(second);
    const secondTarget = targetFor(afterFirst, secondCurrent!, { x: 1, y: 0 });
    const finalPreview = trimPreview(afterFirst, secondTarget);
    const final = dispatch(createEditor(afterFirst), trimSegment(secondTarget));
    expect(finalPreview.success).toBe(true);
    const surviving = final.document.elements.filter((element): element is ArcElement => element.type === "arc");
    expect(surviving).toHaveLength(2);
    expect(new Set(surviving.map((arc) => arc.id)).size).toBe(2);
    expect(surviving.every((arc) => arc.startAngle !== arc.endAngle)).toBe(true);
    const finalProfile = buildSketchProfile({ elements: surviving });
    expect(finalProfile.status).toBe("valid-closed");
    expect(finalProfile.regions).toHaveLength(1);
    expect(finalProfile.loops[0]?.endpoints[0]).toBe(finalProfile.loops[0]?.endpoints[1]);
    expect(finalProfile.regions[0]?.holes).toHaveLength(0);
    expect(undo(final).document).toEqual(afterFirst);
    expect(redo(undo(final)).document).toEqual(final.document);
  });
  it("recomputes shared circle intersections when a surviving arc radius changes", () => {
    const angle = Math.atan2(4, 3);
    const first: ArcElement = { type: "arc", id: elementId("radius-first"), layerId: layer, center: { x: 0, y: 0 }, radius: 5, startAngle: angle, endAngle: -angle, direction: "clockwise", style };
    const second: ArcElement = { type: "arc", id: elementId("radius-second"), layerId: layer, center: { x: 6, y: 0 }, radius: 5, startAngle: -Math.PI + angle, endAngle: Math.PI - angle, direction: "clockwise", style };
    const dimension = { type: "dimension" as const, id: elementId("radius-dimension"), layerId: layer, kind: "radius" as const, driving: true, constraintId: "radius-dimension", references: [{ kind: "node" as const, elementId: first.id, nodeIndex: 0, nodeId: "center" }, { kind: "node" as const, elementId: first.id, nodeIndex: 1, nodeId: "start" }] as const, offset: { x: 0, y: -8 }, precision: 2, units: "mm" as const, rotation: 0 as const, style };
    const initial = documentWith(first, second, dimension);
    const updated = dispatch(createEditor(initial), updateDimensionValue(dimension.id, 6));
    expect(updated.document.elements.find((element) => element.id === first.id)).toMatchObject({ type: "arc", radius: 6 });
    const arcs = updated.document.elements.filter((element): element is ArcElement => element.type === "arc");
    expect(arcs).toHaveLength(2);
    expect(buildSketchProfile({ elements: arcs }).status).toBe("valid-closed");
    const point = (arc: ArcElement, t: number) => ({ x: arc.center.x + arc.radius * Math.cos(t === 0 ? arc.startAngle : arc.endAngle), y: arc.center.y + arc.radius * Math.sin(t === 0 ? arc.startAngle : arc.endAngle) });
    expect(Math.hypot(point(arcs[0]!, 0).x - point(arcs[1]!, 1).x, point(arcs[0]!, 0).y - point(arcs[1]!, 1).y)).toBeLessThan(1e-7);
    expect(Math.hypot(point(arcs[0]!, 1).x - point(arcs[1]!, 0).x, point(arcs[0]!, 1).y - point(arcs[1]!, 0).y)).toBeLessThan(1e-7);
  });
});
