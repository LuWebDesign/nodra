import type { ArcElement, CircleElement, LineElement, PathElement, PointMm, RectangleElement, SketchElement } from "@nodra/domain";
import { arcElementToCurve, circleElementToCurve, deriveCurvePieces, elementToCurves, rectangleElementToCurves, sketchEdgeToCurve } from "./curve2d-adapters.js";
import { pointAt, type CurvePiece2D } from "./curve2d.js";
import { buildCurveTopology, type CurveTopologyComponent, type CurveTopologyFragment, type CurveTopologyGraph, type CurveTopologyParameterReference } from "./curve-topology.js";
import { collectMixedIntersections } from "./mixed-intersections.js";

export type SketchProfileClassification = "valid-closed" | "open" | "invalid" | "degenerate" | "ambiguous";
export interface SketchProfileDiagnostic { readonly code: "open-chain" | "invalid-intersection" | "degenerate-segment" | "unsupported-geometry" | "closed-profile" | "invalid-fragment-reference" | "stale-source-interval" | "inconsistent-loop" | "inconsistent-region" | "source-provenance-mismatch"; readonly message: string }
export interface SketchProfileChain { readonly id: string; readonly fragmentIds: readonly string[]; readonly fragments: readonly CurveTopologyFragment[]; readonly endpoints: readonly [string, string]; readonly points: readonly PointMm[] }
export interface SketchProfileLoop extends SketchProfileChain { readonly area: number }
export interface SketchProfileRegion { readonly id: string; readonly outerLoopId: string; readonly holeLoopIds: readonly string[]; readonly holes: readonly SketchProfileLoop[] }
export type ProfileInputElement = SketchElement | RectangleElement | CircleElement | ArcElement | LineElement | PathElement;
/** Explicit transient eligibility boundary for profile derivation. */
export interface ProfileInputScope { readonly elements: readonly ProfileInputElement[] }
export interface SketchProfileResult {
  readonly status: SketchProfileClassification;
  /** Backwards-compatible sampled rings. Parametric fragments remain authoritative. */
  readonly outerRegions: readonly (readonly PointMm[])[];
  readonly holes: readonly (readonly PointMm[])[];
  readonly openChains: readonly (readonly PointMm[])[];
  readonly invalidIntersections: readonly PointMm[];
  readonly diagnostics: readonly SketchProfileDiagnostic[];
  readonly topology: CurveTopologyGraph;
  readonly parametricFragments: readonly CurveTopologyFragment[];
  readonly chains: readonly SketchProfileChain[];
  readonly loops: readonly SketchProfileLoop[];
  readonly regions: readonly SketchProfileRegion[];
  readonly endpointReferences: readonly CurveTopologyParameterReference[];
}

const area = (ring: readonly PointMm[]): number => ring.reduce((sum, point, index) => { const next = ring[(index + 1) % ring.length]!; return sum + point.x * next.y - next.x * point.y; }, 0) / 2;
const distance = (a: PointMm, b: PointMm): number => Math.hypot(a.x - b.x, a.y - b.y);
const pointKey = (point: PointMm, epsilon: number): string => `${Math.round(point.x / epsilon)}:${Math.round(point.y / epsilon)}`;
const sampleFragment = (fragment: CurveTopologyFragment, count = fragment.curve.type === "line" ? 1 : fragment.curve.type === "circle" ? 32 : 8): PointMm[] => Array.from({ length: count }, (_, index) => pointAt(fragment.curve, index / count));
const sampleChain = (fragments: readonly CurveTopologyFragment[]): PointMm[] => {
  if (!fragments.length) return [];
  const points = fragments.flatMap((fragment) => sampleFragment(fragment));
  const last = fragments.at(-1)!;
  return [...points, pointAt(last.curve, 1)];
};
const windingContains = (point: PointMm, ring: readonly PointMm[]): boolean => {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const current = ring[index]!; const prior = ring[previous]!;
    if ((current.y > point.y) !== (prior.y > point.y) && point.x < (prior.x - current.x) * (point.y - current.y) / (prior.y - current.y) + current.x) inside = !inside;
  }
  return inside;
};

type LegacySegment = { readonly start: PointMm; readonly end: PointMm };
const legacyArea = (ring: readonly PointMm[]): number => ring.reduce((sum, point, index) => { const next = ring[(index + 1) % ring.length]!; return sum + point.x * next.y - next.x * point.y; }, 0) / 2;
const legacyIntersection = (a: LegacySegment, b: LegacySegment, epsilon: number): { readonly point: PointMm; readonly aT: number; readonly bT: number } | undefined => {
  const ax = a.end.x - a.start.x, ay = a.end.y - a.start.y, bx = b.end.x - b.start.x, by = b.end.y - b.start.y;
  const cross = ax * by - ay * bx; if (Math.abs(cross) <= epsilon) return undefined;
  const cx = b.start.x - a.start.x, cy = b.start.y - a.start.y; const aT = (cx * by - cy * bx) / cross; const bT = (cx * ay - cy * ax) / cross;
  return aT >= -epsilon && aT <= 1 + epsilon && bT >= -epsilon && bT <= 1 + epsilon ? { point: { x: a.start.x + aT * ax, y: a.start.y + aT * ay }, aT, bT } : undefined;
};
const legacyOverlap = (a: LegacySegment, b: LegacySegment, epsilon: number): boolean => {
  const dx = a.end.x - a.start.x, dy = a.end.y - a.start.y; const cross = (p: PointMm) => dx * (p.y - a.start.y) - dy * (p.x - a.start.x);
  if (Math.abs(cross(b.start)) > epsilon || Math.abs(cross(b.end)) > epsilon) return false; const length = Math.hypot(dx, dy); if (length <= epsilon) return true;
  const along = (p: PointMm) => ((p.x - a.start.x) * dx + (p.y - a.start.y) * dy) / (length * length);
  return Math.min(1, along(b.end)) - Math.max(0, along(b.start)) > epsilon;
};
function legacyGraph(segments: readonly LegacySegment[], epsilon: number): { readonly cycles: PointMm[][]; readonly open: LegacySegment[] } {
  const vertices = new Map<string, PointMm>(); const adjacency = new Map<string, string[]>(); const edges = new Set<string>(); const key = (p: PointMm) => pointKey(p, epsilon);
  for (const segment of segments) { const a = key(segment.start), b = key(segment.end); if (a === b) continue; vertices.set(a, segment.start); vertices.set(b, segment.end); const edge = [a, b].sort().join("|"); if (edges.has(edge)) continue; edges.add(edge); adjacency.set(a, [...(adjacency.get(a) ?? []), b]); adjacency.set(b, [...(adjacency.get(b) ?? []), a]); }
  for (const [vertex, neighbors] of adjacency) neighbors.sort((a, b) => Math.atan2(vertices.get(a)!.y - vertices.get(vertex)!.y, vertices.get(a)!.x - vertices.get(vertex)!.x) - Math.atan2(vertices.get(b)!.y - vertices.get(vertex)!.y, vertices.get(b)!.x - vertices.get(vertex)!.x));
  const visited = new Set<string>(); const cycles: PointMm[][] = [];
  for (const [start, neighbors] of adjacency) for (const first of neighbors) { const directed = `${start}>${first}`; if (visited.has(directed)) continue; const points: PointMm[] = []; let from = start, to = first, guard = 0;
    while (guard++ <= edges.size * 2) { const marker = `${from}>${to}`; if (visited.has(marker)) break; visited.add(marker); points.push(vertices.get(from)!); const outgoing = adjacency.get(to) ?? []; const position = outgoing.findIndex((neighbor) => neighbor === from); if (position < 0) break; const next = outgoing[(position - 1 + outgoing.length) % outgoing.length]!; from = to; to = next; if (from === start && to === first) { if (legacyArea(points) > epsilon) cycles.push(points); break; } }
  }
  const cycleEdges = new Set(cycles.flatMap((cycle) => cycle.map((point, index) => [key(point), key(cycle[(index + 1) % cycle.length]!)].sort().join("|"))));
  return { cycles, open: segments.filter((segment) => !cycleEdges.has([key(segment.start), key(segment.end)].sort().join("|"))) };
}

function sourcePieces(input: SketchElement | readonly CurvePiece2D[]): readonly CurvePiece2D[] {
  if (!("type" in input)) return input;
  return input.edges.flatMap((edge) => { try { return [deriveCurvePieces([sketchEdgeToCurve(input, edge.id)])[0]!]; } catch { return []; } });
}
function faceComponents(component: CurveTopologyComponent, graph: CurveTopologyGraph): CurveTopologyComponent[] {
  const nodePoint = new Map(graph.nodes.map((node) => [node.id, node.point]));
  const edges = graph.fragments.filter((fragment) => component.fragmentIds.includes(fragment.id));
  const adjacency = new Map<string, CurveTopologyFragment[]>();
  for (const edge of edges) { adjacency.set(edge.startNodeId, [...(adjacency.get(edge.startNodeId) ?? []), edge]); adjacency.set(edge.endNodeId, [...(adjacency.get(edge.endNodeId) ?? []), edge]); }
  const result: CurveTopologyComponent[] = [];
  for (const edge of edges) for (const direction of [0, 1]) {
    const start = direction ? edge.endNodeId : edge.startNodeId; const initialTo = direction ? edge.startNodeId : edge.endNodeId; let from = start; let to = initialTo; let currentEdge = edge; const ids: string[] = []; let guard = 0;
    while (guard++ <= edges.length * 2) { ids.push(currentEdge.id); const outgoing = (adjacency.get(to) ?? []).slice().sort((a, b) => { const otherA = a.startNodeId === to ? a.endNodeId : a.startNodeId; const otherB = b.startNodeId === to ? b.endNodeId : b.startNodeId; const p = nodePoint.get(to)!; return Math.atan2(nodePoint.get(otherA)!.y - p.y, nodePoint.get(otherA)!.x - p.x) - Math.atan2(nodePoint.get(otherB)!.y - p.y, nodePoint.get(otherB)!.x - p.x); }); const incoming = outgoing.findIndex((candidate) => candidate.id === currentEdge.id && (candidate.startNodeId === to ? candidate.endNodeId : candidate.startNodeId) === from); if (incoming < 0) break; const next = outgoing[(incoming - 1 + outgoing.length) % outgoing.length]; if (!next) break; from = to; to = next.startNodeId === to ? next.endNodeId : next.startNodeId; currentEdge = next; if (from === start && to === initialTo) { const closedIds = ids.slice(0, -1); const idsUnique = [...new Set(closedIds)]; const candidateEdges = edges.filter((candidate) => idsUnique.includes(candidate.id)); const candidateDegree = new Map<string, number>(); candidateEdges.forEach((candidate) => { candidateDegree.set(candidate.startNodeId, (candidateDegree.get(candidate.startNodeId) ?? 0) + 1); candidateDegree.set(candidate.endNodeId, (candidateDegree.get(candidate.endNodeId) ?? 0) + 1); });
          if (closedIds.length === idsUnique.length && idsUnique.length >= 3 && candidateEdges.every((candidate) => candidateDegree.get(candidate.startNodeId) === 2 && candidateDegree.get(candidate.endNodeId) === 2) && !result.some((candidate) => candidate.fragmentIds.slice().sort().join(",") === idsUnique.slice().sort().join(","))) result.push({ nodeIds: [...candidateDegree.keys()].sort(), fragmentIds: closedIds }); break; } }
  }
  return result;
}
const reverseCurve = (curve: CurveTopologyFragment["curve"]): CurveTopologyFragment["curve"] => {
      if (curve.type === "line") return { type: "line", start: curve.end, end: curve.start };
      if (curve.type === "cubicBezier") return { type: "cubicBezier", p0: curve.p3, p1: curve.p2, p2: curve.p1, p3: curve.p0 };
      if (curve.type === "circle") return { type: "arc", center: curve.center, radius: curve.radius, startAngle: 0, endAngle: Math.PI * 2, direction: "counterclockwise", fullTurn: true };
      return { ...curve, startAngle: curve.endAngle, endAngle: curve.startAngle, direction: curve.direction === "clockwise" ? "counterclockwise" : "clockwise" };
    };
    const orientFragment = (fragment: CurveTopologyFragment, startNodeId: string): CurveTopologyFragment => fragment.startNodeId === startNodeId ? fragment : {
      ...fragment, curve: reverseCurve(fragment.curve), start: fragment.end, end: fragment.start,
      startNodeId: fragment.endNodeId, endNodeId: fragment.startNodeId,
    };
    function orderedFragments(component: CurveTopologyComponent, graph: CurveTopologyGraph): CurveTopologyFragment[] {
  const available = new Set(component.fragmentIds); const result: CurveTopologyFragment[] = [];
      const preferredOrder = component.fragmentIds.every((id, index, all) => index === 0 || id.localeCompare(all[index - 1]!) >= 0) ? undefined : new Map(component.fragmentIds.map((id, index) => [id, index]));
  const firstFragment = graph.fragments.find((fragment) => fragment.id === component.fragmentIds[0]);
      let current = firstFragment?.startNodeId ?? component.nodeIds[0];
  while (available.size) {
    const candidates = graph.fragments.filter((fragment) => available.has(fragment.id) && (fragment.startNodeId === current || fragment.endNodeId === current)).sort((a, b) => {
          const continuation = (fragment: CurveTopologyFragment): number => {
            const next = fragment.startNodeId === current ? fragment.endNodeId : fragment.startNodeId;
            return graph.fragments.filter((candidate) => available.has(candidate.id) && candidate.id !== fragment.id && (candidate.startNodeId === next || candidate.endNodeId === next)).length;
          };
          return (preferredOrder ? preferredOrder.get(a.id)! - preferredOrder.get(b.id)! : continuation(b) - continuation(a)) || a.id.localeCompare(b.id);
        });
    const fragment = candidates[0]; if (!fragment) break;
    const oriented = orientFragment(fragment, current!);
        available.delete(fragment.id); result.push(oriented); current = oriented.endNodeId;
  }
  return result;
}

/** Builds a deterministic profile from exact native Curve2D pieces, never from flattened geometry. */
export function sketchProfileResult(input: SketchElement | ProfileInputScope | readonly CurvePiece2D[], epsilon = 1e-9): SketchProfileResult {
      if ("elements" in input) {
        const pieces = input.elements.slice().sort((first, second) => first.id.localeCompare(second.id)).flatMap((element) => {
          try {
            const curves = element.type === "sketch" ? element.edges.map((edge) => sketchEdgeToCurve(element, edge.id)) : element.type === "circle" ? [circleElementToCurve(element)] : element.type === "arc" ? [arcElementToCurve(element)] : element.type === "rectangle" ? rectangleElementToCurves(element) : element.type === "path" ? elementToCurves(element) : [{ curve: { type: "line" as const, start: element.start, end: element.end }, source: { kind: "line-element" as const, elementId: element.id }, sourceIndex: 0 }];
            return deriveCurvePieces(curves);
          } catch { return []; }
        });
        return sketchProfileResult(pieces, epsilon);
      }
  const pieces = sourcePieces(input);
  const intersections = collectMixedIntersections(pieces, { geometryEpsilon: epsilon, parameterEpsilon: epsilon });
  const topology = buildCurveTopology(pieces, intersections, { geometryEpsilon: epsilon, parameterEpsilon: epsilon });
  const diagnostics: SketchProfileDiagnostic[] = [];
  if (pieces.some((piece) => piece.curve.type === "line" && distance(piece.curve.start, piece.curve.end) <= epsilon)) diagnostics.push({ code: "degenerate-segment", message: "Sketch contains a degenerate curve segment" });
  const topologyDiagnostics = topology.diagnostics;
  if (topologyDiagnostics.some((item) => item.code === "unsupported" || item.code === "ambiguous")) diagnostics.push({ code: "unsupported-geometry", message: "Sketch contains unsupported or ambiguous curve geometry" });
  if (topologyDiagnostics.some((item) => item.code === "degenerate")) diagnostics.push({ code: "degenerate-segment", message: "Sketch contains a degenerate curve segment" });

  const loopComponents = [...topology.closedLoops, ...topology.components.filter((component) => !topology.closedLoops.includes(component)).flatMap((component) => faceComponents(component, topology))];
        const closedFragmentIds = new Set(loopComponents.flatMap((component) => component.fragmentIds));
  const chains: SketchProfileChain[] = topology.openChains.flatMap((component) => orderedFragments(component, topology).filter((fragment) => !closedFragmentIds.has(fragment.id)).map((fragment) => {
    const fragments = [fragment]; const points = sampleChain(fragments);
    return { id: `chain:${fragment.id}`, fragmentIds: [fragment.id], fragments, endpoints: [fragment.startNodeId, fragment.endNodeId], points };
  }));
  const loops: SketchProfileLoop[] = loopComponents.map((component) => {
    const fragments = orderedFragments(component, topology); const points = sampleChain(fragments); const closed = points.length ? [...points, points[0]!] : points;
    return { id: `loop:${component.fragmentIds.join(",")}`, fragmentIds: fragments.map((fragment) => fragment.id), fragments, endpoints: [fragments[0]?.startNodeId ?? "", fragments.at(-1)?.endNodeId ?? ""] as [string, string], points: closed, area: area(closed) };
  }).sort((a, b) => Math.abs(b.area) - Math.abs(a.area) || a.id.localeCompare(b.id));

  const holes: SketchProfileLoop[] = []; const outers: SketchProfileLoop[] = [];

  for (const loop of loops) {
    const representative = loop.points.length ? loop.points[0] : undefined;
    const depth = representative ? loops.filter((other) => other !== loop && windingContains(representative, other.points)).length : 0;
    (depth % 2 === 1 ? holes : outers).push(loop);
  }
  const representative = (loop: SketchProfileLoop): PointMm | undefined => loop.points[0];
      const regions: SketchProfileRegion[] = outers.map((outer) => { const ownedHoles = holes.filter((hole) => { const point = representative(hole); return point !== undefined && windingContains(point, outer.points); }).sort((a, b) => a.id.localeCompare(b.id)); return { id: `region:${outer.id}`, outerLoopId: outer.id, holeLoopIds: ownedHoles.map((hole) => hole.id), holes: ownedHoles }; });
  if (chains.length) diagnostics.push({ code: "open-chain", message: "Sketch contains open curve chains" });
  const invalidIntersections = intersections.pairs.flatMap((pair) => pair.kind === "overlap" ? [pair.spans[0]?.firstInterval ? pointAt(pair.firstPiece.curve, pair.spans[0]!.firstInterval.t0) : pointAt(pair.firstPiece.curve, 0)] : pair.kind === "points" ? pair.points.filter((point) => point.firstParameter > epsilon && point.firstParameter < 1 - epsilon && point.secondParameter > epsilon && point.secondParameter < 1 - epsilon).map((point) => point.point) : []);
  if (invalidIntersections.length) diagnostics.push({ code: "invalid-intersection", message: "Sketch contains ambiguous curve intersections" });
  if (!diagnostics.length && outers.length) diagnostics.push({ code: "closed-profile", message: `${outers.length} closed profile${outers.length === 1 ? "" : "s"} detected` });
  let compatibilityOuter = outers.map((loop) => loop.points); let compatibilityHoles = holes.map((loop) => loop.points); let compatibilityOpen = chains.map((chain) => chain.points); let compatibilityInvalid = invalidIntersections; let compatibilityDiagnostics = diagnostics;
  let compatibilityStatus: SketchProfileClassification = diagnostics.some((item) => item.code === "degenerate-segment") ? "degenerate" : diagnostics.some((item) => item.code === "unsupported-geometry") ? "invalid" : invalidIntersections.length ? "ambiguous" : chains.length ? "open" : outers.length ? "valid-closed" : "invalid";
  if ("type" in input && input.type === "sketch") {
    const nodes = new Map(input.nodes.map((node) => [node.id, node.point])); const segments = input.edges.flatMap((edge) => { const start = nodes.get(edge.startNodeId); const end = nodes.get(edge.endNodeId); return start && end ? [{ start, end }] : []; });
    const legacy = legacyGraph(segments, epsilon); const ordered = [...legacy.cycles].sort((a, b) => Math.abs(legacyArea(b)) - Math.abs(legacyArea(a)));
    const legacyOuter: PointMm[][] = []; const legacyHoles: PointMm[][] = [];
    const edgeKeys = (ring: readonly PointMm[]) => new Set(ring.map((point, index) => `${pointKey(point, epsilon)}|${pointKey(ring[(index + 1) % ring.length]!, epsilon)}`));
    for (const cycle of ordered) { const current = edgeKeys(cycle); const depth = ordered.filter((other) => other !== cycle && ![...current].some((edge) => edgeKeys(other).has(edge) || edgeKeys(other).has(edge.split("|").reverse().join("|"))) && windingContains(cycle[0]!, other)).length; (depth % 2 ? legacyHoles : legacyOuter).push([...cycle, cycle[0]!]); }
    const legacyInvalid: PointMm[] = [];
    for (let first = 0; first < segments.length; first++) for (let second = first + 1; second < segments.length; second++) { const a = segments[first]!, b = segments[second]!, hit = legacyIntersection(a, b, epsilon); const duplicate = (distance(a.start, b.start) <= epsilon && distance(a.end, b.end) <= epsilon) || (distance(a.start, b.end) <= epsilon && distance(a.end, b.start) <= epsilon); if (duplicate || legacyOverlap(a, b, epsilon) || (hit && hit.aT > epsilon && hit.aT < 1 - epsilon && hit.bT > epsilon && hit.bT < 1 - epsilon)) legacyInvalid.push(hit?.point ?? a.start); }
    const legacyDiagnostics: SketchProfileDiagnostic[] = []; if (segments.length !== input.edges.length) legacyDiagnostics.push({ code: "unsupported-geometry", message: "Sketch contains an edge with missing or unsupported geometry" }); if (segments.some((segment) => distance(segment.start, segment.end) <= epsilon)) legacyDiagnostics.push({ code: "degenerate-segment", message: "Sketch contains a degenerate line segment" }); if (legacy.open.length) legacyDiagnostics.push({ code: "open-chain", message: "Sketch contains open line chains" }); if (legacyInvalid.length) legacyDiagnostics.push({ code: "invalid-intersection", message: "Sketch contains self-intersections or ambiguous crossings" }); if (!legacyDiagnostics.length && legacyOuter.length) legacyDiagnostics.push({ code: "closed-profile", message: `${legacyOuter.length} closed profile${legacyOuter.length === 1 ? "" : "s"} detected` });
    compatibilityOuter = legacyOuter; compatibilityHoles = legacyHoles; compatibilityOpen = legacy.open.map((segment) => [segment.start, segment.end]); compatibilityInvalid = legacyInvalid; compatibilityDiagnostics = legacyDiagnostics; compatibilityStatus = legacyDiagnostics.some((item) => item.code === "degenerate-segment") ? "degenerate" : legacyInvalid.length ? "ambiguous" : legacyDiagnostics.some((item) => item.code === "unsupported-geometry") ? "invalid" : legacy.open.length ? "open" : legacyOuter.length ? "valid-closed" : "invalid";
  }
  return {
    status: compatibilityStatus, outerRegions: compatibilityOuter, holes: compatibilityHoles, openChains: compatibilityOpen, invalidIntersections: compatibilityInvalid, diagnostics: compatibilityDiagnostics,
    topology, parametricFragments: topology.fragments, chains, loops, regions,
    endpointReferences: topology.nodes.flatMap((node) => node.references).sort((a, b) => `${a.source.kind}:${a.sourceParameter}`.localeCompare(`${b.source.kind}:${b.sourceParameter}`)),
  };
}

export const buildSketchProfile = sketchProfileResult;
export const deriveSketchProfile = sketchProfileResult;

const sameSource = (first: unknown, second: unknown): boolean => JSON.stringify(first) === JSON.stringify(second);
const samePoint = (first: PointMm, second: PointMm, epsilon: number): boolean => distance(first, second) <= epsilon;

/** Validates canonical topology, fragments, loops, regions, and provenance without rebuilding or using compatibility rings. */
export function validateSketchProfileResult(result: SketchProfileResult, epsilon = 1e-9): readonly SketchProfileDiagnostic[] {
  const diagnostics: SketchProfileDiagnostic[] = [];
  if (!Number.isFinite(epsilon) || epsilon < 0) return [{ code: "invalid-fragment-reference", message: "Profile validation tolerance is invalid" }];
  const fragments = new Map(result.parametricFragments.map((fragment) => [fragment.id, fragment]));
  const nodes = new Map(result.topology.nodes.map((node) => [node.id, node]));
  const pieces = new Map(result.topology.pieces.map((piece) => [piece.id, piece]));
  const reported = new Set<string>();
  const add = (code: SketchProfileDiagnostic["code"], message: string): void => { const key = `${code}:${message}`; if (!reported.has(key)) { reported.add(key); diagnostics.push({ code, message }); } };
  const checkFragment = (id: string, owner: string): CurveTopologyFragment | undefined => {
    const fragment = fragments.get(id);
    if (!fragment) { add("invalid-fragment-reference", `${owner} references missing fragment ${id}`); return undefined; }
    if (!nodes.has(fragment.startNodeId) || !nodes.has(fragment.endNodeId)) add("invalid-fragment-reference", `Fragment ${id} references a missing endpoint node`);
    const piece = pieces.get(fragment.sourcePieceId);
    if (!piece) add("source-provenance-mismatch", `Fragment ${id} references missing source piece ${fragment.sourcePieceId}`);
    else if (!sameSource(piece.native.source, fragment.source)) add("source-provenance-mismatch", `Fragment ${id} source does not match its native piece`);
    try {
      const start = pointAt(fragment.curve, 0); const end = pointAt(fragment.curve, 1);
      if (nodes.has(fragment.startNodeId) && !samePoint(start, nodes.get(fragment.startNodeId)!.point, epsilon)) add("inconsistent-loop", `Fragment ${id} start endpoint does not match its node`);
      if (nodes.has(fragment.endNodeId) && !samePoint(end, nodes.get(fragment.endNodeId)!.point, epsilon)) add("inconsistent-loop", `Fragment ${id} end endpoint does not match its node`);
      if (piece && (!samePoint(start, pointAt(piece.native.curve, fragment.start.pieceParameter), epsilon) || !samePoint(end, pointAt(piece.native.curve, fragment.end.pieceParameter), epsilon))) add("source-provenance-mismatch", `Fragment ${id} geometry does not match its native source`);
    } catch { add("source-provenance-mismatch", `Fragment ${id} curve cannot be evaluated`); }
    const interval = fragment.sourceInterval;
    const parameters = [fragment.start.pieceParameter, fragment.end.pieceParameter, fragment.start.sourceParameter, fragment.end.sourceParameter];
    if (!parameters.every(Number.isFinite) || interval.t0 > interval.t1 || !Number.isFinite(interval.t0) || !Number.isFinite(interval.t1) || fragment.start.pieceParameter < -epsilon || fragment.end.pieceParameter < -epsilon || fragment.start.pieceParameter > 1 + epsilon || fragment.end.pieceParameter > 1 + epsilon) add("stale-source-interval", `Fragment ${id} has an invalid source interval`);
    else {
      const low = Math.min(fragment.start.sourceParameter, fragment.end.sourceParameter); const high = Math.max(fragment.start.sourceParameter, fragment.end.sourceParameter);
      if (Math.abs(interval.t0 - low) > epsilon || Math.abs(interval.t1 - high) > epsilon) add("stale-source-interval", `Fragment ${id} interval does not match its endpoint references`);
      if (piece) {
        const native = piece.native.sourceInterval;
        if (interval.t0 < Math.min(native.t0, native.t1) - epsilon || interval.t1 > Math.max(native.t0, native.t1) + epsilon) add("stale-source-interval", `Fragment ${id} interval is outside its native source interval`);
        const expected = (parameter: number): number => piece.native.orientation === "forward" ? native.t0 + (native.t1 - native.t0) * parameter : native.t1 - (native.t1 - native.t0) * parameter;
        if (Math.abs(fragment.start.sourceParameter - expected(fragment.start.pieceParameter)) > epsilon || Math.abs(fragment.end.sourceParameter - expected(fragment.end.pieceParameter)) > epsilon) add("source-provenance-mismatch", `Fragment ${id} source parameters do not match its native piece`);
      }
    }
    if (!sameSource(fragment.start.source, fragment.source) || !sameSource(fragment.end.source, fragment.source)) add("source-provenance-mismatch", `Fragment ${id} endpoint provenance does not match its source`);
    return fragment;
  };
  for (const fragment of result.parametricFragments) checkFragment(fragment.id, "Profile");
  for (const piece of result.topology.pieces) for (const id of piece.fragmentIds) { const fragment = checkFragment(id, `Piece ${piece.id}`); if (fragment && fragment.sourcePieceId !== piece.id) add("source-provenance-mismatch", `Piece ${piece.id} contains fragment ${id} owned by another piece`); }
  const validateChain = (chain: SketchProfileChain, kind: string): void => {
    const chainFragments = chain.fragmentIds.map((id, index) => {
          const canonical = checkFragment(id, `${kind} ${chain.id}`);
          const view = chain.fragments[index];
          return canonical && view?.id === id ? view : canonical;
        }).filter((fragment): fragment is CurveTopologyFragment => fragment !== undefined);
    if (chain.fragments.length !== chain.fragmentIds.length || chain.fragments.some((fragment, index) => fragment.id !== chain.fragmentIds[index] || !fragments.has(fragment.id))) add("invalid-fragment-reference", `${kind} ${chain.id} has inconsistent fragment references`);
    for (let index = 1; index < chainFragments.length; index += 1) if (chainFragments[index - 1]!.endNodeId !== chainFragments[index]!.startNodeId) add("inconsistent-loop", `${kind} ${chain.id} fragment chain is not connected`);
    const first = chainFragments[0]; const last = chainFragments.at(-1); if (!first || !last || chain.endpoints[0] !== first.startNodeId || chain.endpoints[1] !== last.endNodeId) add("inconsistent-loop", `${kind} ${chain.id} endpoints do not match its fragments`);
  };
  for (const chain of result.chains) validateChain(chain, "Chain");
  for (const loop of result.loops) { validateChain(loop, "Loop"); if (loop.endpoints[0] !== loop.endpoints[1]) add("inconsistent-loop", `Loop ${loop.id} is not closed`); }
  const loops = new Map(result.loops.map((loop) => [loop.id, loop])); const owned = new Set<string>();
  for (const region of result.regions) {
    const outer = loops.get(region.outerLoopId); const holeIds = region.holeLoopIds;
    if (!outer || region.holes.length !== holeIds.length || region.holes.some((hole, index) => hole.id !== holeIds[index] || loops.get(hole.id) !== hole) || new Set(holeIds).size !== holeIds.length) add("inconsistent-region", `Region ${region.id} has inconsistent loop ownership`);
    if (outer) { if (owned.has(outer.id)) add("inconsistent-region", `Loop ${outer.id} is owned by multiple regions`); owned.add(outer.id); }
    for (const holeId of holeIds) { if (!loops.has(holeId) || holeId === region.outerLoopId) add("inconsistent-region", `Region ${region.id} has invalid hole ownership`); if (owned.has(holeId)) add("inconsistent-region", `Loop ${holeId} is owned by multiple regions`); owned.add(holeId); }
  }
  for (const loop of result.loops) if (!owned.has(loop.id)) add("inconsistent-region", `Loop ${loop.id} has no region ownership`);
  return diagnostics;
}

export const validateSketchProfile = validateSketchProfileResult;

/** Keeps curve source imports discoverable for consumers constructing mixed profiles. */
export { arcElementToCurve, circleElementToCurve, pointKey };
