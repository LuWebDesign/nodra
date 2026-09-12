import { describe, expect, it } from "vitest";
import type { ElementId } from "@nodra/domain";
import { buildCurveTopology } from "./curve-topology.js";
import { collectMixedIntersections } from "./mixed-intersections.js";
import type { MixedIntersectionCollection } from "./mixed-intersections.js";
import type { CurvePiece2D } from "./curve2d.js";

const line = (start: { x: number; y: number }, end: { x: number; y: number }) => ({ type: "line" as const, start, end });
const piece = (curve: CurvePiece2D["curve"], id: string, endpointIdentity?: CurvePiece2D["endpointIdentity"]): CurvePiece2D => ({ curve, sourceInterval: { t0: 0, t1: 1 }, orientation: "forward", source: { kind: "line-element", elementId: id as unknown as ElementId }, ...(endpointIdentity ? { endpointIdentity } : {}) });
const topology = (pieces: readonly CurvePiece2D[]) => buildCurveTopology(pieces, collectMixedIntersections(pieces));

describe("derived curve topology", () => {
  it("splits a line and circle at reused exact intersection nodes", () => {
    const pieces = [piece(line({ x: -2, y: 0 }, { x: 2, y: 0 }), "line"), piece({ type: "circle", center: { x: 0, y: 0 }, radius: 1 }, "circle")];
    const graph = topology(pieces);
    expect(graph.fragments).toHaveLength(5);
    expect(graph.nodes.filter((node) => node.kind === "intersection" || node.kind === "mixed")).toHaveLength(2);
    expect(graph.fragments.every((fragment) => fragment.curve.type !== "cubicBezier")).toBe(true);
  });

  it("preserves provenance and stable IDs for an exact mixed loop plus an open chain", () => {
    const arc = piece({ type: "arc", center: { x: 0, y: 0 }, radius: 2, startAngle: 0, endAngle: Math.PI, direction: "clockwise" }, "arc");
    const diameter = piece(line({ x: -2, y: 0 }, { x: 2, y: 0 }), "diameter");
    const open = piece(line({ x: 5, y: 0 }, { x: 6, y: 0 }), "open");
    const graph = topology([arc, diameter, open]);

    expect(graph.closedLoops).toHaveLength(1);
    expect(graph.openChains).toHaveLength(1);
    expect(graph.fragments.map((fragment) => fragment.source)).toEqual(expect.arrayContaining([arc.source, diameter.source, open.source]));
    expect(graph.pieces.every((candidate) => candidate.id.startsWith("piece:") && candidate.fragmentIds.length > 0)).toBe(true);
    expect(graph.fragments.every((fragment) => fragment.id.startsWith("fragment:") && fragment.sourcePieceId.startsWith("piece:"))).toBe(true);
    expect(graph.diagnostics).toEqual([expect.objectContaining({ code: "disconnected", severity: "info" })]);
    expect(topology([arc, diameter, open])).toEqual(graph);
  });

  it("keeps an unsplit circle native and creates two arcs when cut", () => {
    const circle = piece({ type: "circle", center: { x: 0, y: 0 }, radius: 1 }, "circle");
    expect(buildCurveTopology([circle]).fragments[0]?.curve.type).toBe("circle");
    const pieces = [circle, piece(line({ x: -2, y: 0 }, { x: 2, y: 0 }), "line")];
    const arcs = topology(pieces).fragments.filter((fragment) => fragment.source === circle.source);
    expect(arcs).toHaveLength(2);
    expect(arcs.every((fragment) => fragment.curve.type === "arc")).toBe(true);
  });

  it("honors a separately supplied intersection collection for splitting and nodes", () => {
    const pieces = [piece(line({ x: -2, y: 0 }, { x: 2, y: 0 }), "line"), piece({ type: "circle", center: { x: 0, y: 0 }, radius: 1 }, "circle")];
    const collected = collectMixedIntersections(pieces);
    const firstPair = collected.pairs[0]!;
    const intersections: MixedIntersectionCollection = { pairs: [{ ...firstPair, points: firstPair.points.slice(0, 1) }] };
    const graph = buildCurveTopology(pieces, intersections);

    expect(graph.fragments).toHaveLength(4);
    expect(graph.nodes.filter((node) => node.kind === "intersection" || node.kind === "mixed")).toHaveLength(1);
  });

  it("is deterministic, immutable, and derives closed mixed loops", () => {
    const pieces = [piece(line({ x: 0, y: 0 }, { x: 2, y: 0 }), "a", { startNodeId: "n0", endNodeId: "n1" }), piece(line({ x: 2, y: 0 }, { x: 2, y: 2 }), "b", { startNodeId: "n1", endNodeId: "n2" }), piece(line({ x: 2, y: 2 }, { x: 0, y: 0 }), "c", { startNodeId: "n2", endNodeId: "n0" })];
    const snapshot = structuredClone(pieces);
    const first = topology(pieces); const second = topology(pieces);
    expect(first.fragments.map((fragment) => fragment.id)).toEqual(second.fragments.map((fragment) => fragment.id));
    expect(first.closedLoops).toHaveLength(1);
    expect(pieces).toEqual(snapshot);
  });

  it("fails closed for duplicate native identities without collapsing fragments", () => {
    const duplicate = piece(line({ x: 0, y: 0 }, { x: 1, y: 0 }), "same");
    const graph = buildCurveTopology([duplicate, { ...duplicate }]);
    expect(graph.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "ambiguous" })]));
    expect(graph.fragments).toHaveLength(0);
    expect(new Set(graph.pieces.map((candidate) => candidate.id)).size).toBe(2);
  });

  it("clusters endpoint candidates transitively within tolerance", () => {
    const pieces = [piece(line({ x: 0, y: 0 }, { x: 1, y: 0 }), "a"), piece(line({ x: 0.75, y: 0 }, { x: 1.75, y: 0 }), "b"), piece(line({ x: 1.5, y: 0 }, { x: 2.5, y: 0 }), "c")];
    expect(buildCurveTopology(pieces, undefined, { geometryEpsilon: 0.8 }).nodes).toHaveLength(1);
  });

  it("preserves reverse orientation and classifies branches conservatively", () => {
    const reversed = { ...piece(line({ x: 0, y: 1 }, { x: 0, y: 0 }), "reverse"), orientation: "reverse" as const };
    expect(buildCurveTopology([reversed]).fragments[0]?.orientation).toBe("reverse");
    const graph = buildCurveTopology([piece(line({ x: 0, y: 0 }, { x: 1, y: 0 }), "a"), piece(line({ x: 0, y: 0 }, { x: 0, y: 1 }), "b"), piece(line({ x: 0, y: 0 }, { x: -1, y: 0 }), "c")]);
    expect(graph.closedLoops).toHaveLength(0);
    expect(graph.openChains).toHaveLength(1);
  });

  it("keeps disconnected loops and open components separate", () => {
    const loop = [piece(line({ x: 0, y: 0 }, { x: 1, y: 0 }), "a"), piece(line({ x: 1, y: 0 }, { x: 0.5, y: 1 }), "b"), piece(line({ x: 0.5, y: 1 }, { x: 0, y: 0 }), "c")];
    const graph = buildCurveTopology([...loop, piece(line({ x: 3, y: 0 }, { x: 4, y: 0 }), "open")]);
    expect(graph.closedLoops).toHaveLength(1);
    expect(graph.openChains).toHaveLength(1);
  });

  it("reports overlap and unsupported pair diagnostics", () => {
    const overlap = [piece(line({ x: 0, y: 0 }, { x: 2, y: 0 }), "a"), piece(line({ x: 1, y: 0 }, { x: 3, y: 0 }), "b")];
    expect(topology(overlap).diagnostics.some((diagnostic) => diagnostic.code === "overlap")).toBe(true);
    const unsupported = [piece({ type: "arc", center: { x: 0, y: 0 }, radius: 1, startAngle: 0, endAngle: Math.PI, direction: "clockwise" }, "arc"), piece({ type: "cubicBezier", p0: { x: 0, y: 0 }, p1: { x: 1, y: 0 }, p2: { x: 1, y: 1 }, p3: { x: 0, y: 1 } }, "cubic")];
    expect(topology(unsupported).diagnostics.some((diagnostic) => diagnostic.code === "unsupported")).toBe(true);
  });
});
