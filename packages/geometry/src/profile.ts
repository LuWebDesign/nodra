import type { PointMm, SketchElement } from "@nodra/domain";

export type SketchProfileClassification = "valid-closed" | "open" | "invalid" | "degenerate" | "ambiguous";
export interface SketchProfileDiagnostic { readonly code: "open-chain" | "invalid-intersection" | "degenerate-segment" | "unsupported-geometry" | "closed-profile"; readonly message: string }
export interface SketchProfileResult { readonly status: SketchProfileClassification; readonly outerRegions: readonly (readonly PointMm[])[]; readonly holes: readonly (readonly PointMm[])[]; readonly openChains: readonly (readonly PointMm[])[]; readonly invalidIntersections: readonly PointMm[]; readonly diagnostics: readonly SketchProfileDiagnostic[] }

type Segment = { readonly start: PointMm; readonly end: PointMm };
const area = (ring: readonly PointMm[]) => ring.reduce((sum, point, index) => { const next = ring[(index + 1) % ring.length]!; return sum + point.x * next.y - next.x * point.y; }, 0) / 2;
const inside = (point: PointMm, ring: readonly PointMm[]) => { let result = false; for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) { const current = ring[index]!; const prior = ring[previous]!; if ((current.y > point.y) !== (prior.y > point.y) && point.x < (prior.x - current.x) * (point.y - current.y) / (prior.y - current.y) + current.x) result = !result; } return result; };
const pointKey = (point: PointMm, epsilon: number) => `${Math.round(point.x / epsilon)}:${Math.round(point.y / epsilon)}`;
const ringKey = (ring: readonly PointMm[]) => ring.map((point) => `${point.x}:${point.y}`).join(";");

const intersection = (first: Segment, second: Segment, epsilon: number): { readonly point: PointMm; readonly firstT: number; readonly secondT: number } | undefined => {
  const ax = first.end.x - first.start.x; const ay = first.end.y - first.start.y;
  const bx = second.end.x - second.start.x; const by = second.end.y - second.start.y;
  const cross = ax * by - ay * bx; const cx = second.start.x - first.start.x; const cy = second.start.y - first.start.y;
  if (Math.abs(cross) <= epsilon) return undefined;
  const firstT = (cx * by - cy * bx) / cross; const secondT = (cx * ay - cy * ax) / cross;
  return firstT >= -epsilon && firstT <= 1 + epsilon && secondT >= -epsilon && secondT <= 1 + epsilon
    ? { point: { x: first.start.x + firstT * ax, y: first.start.y + firstT * ay }, firstT, secondT } : undefined;
};
const collinearOverlap = (first: Segment, second: Segment, epsilon: number): boolean => {
  const dx = first.end.x - first.start.x; const dy = first.end.y - first.start.y; const crossStart = dx * (second.start.y - first.start.y) - dy * (second.start.x - first.start.x); const crossEnd = dx * (second.end.y - first.start.y) - dy * (second.end.x - first.start.x);
  if (Math.abs(crossStart) > epsilon || Math.abs(crossEnd) > epsilon) return false;
  const length = Math.hypot(first.end.x - first.start.x, first.end.y - first.start.y);
  if (length <= epsilon) return true;
  const along = (point: PointMm) => ((point.x - first.start.x) * (first.end.x - first.start.x) + (point.y - first.start.y) * (first.end.y - first.start.y)) / (length * length);
  return Math.min(1, along(second.end)) - Math.max(0, along(second.start)) > epsilon;
};

const graphCycles = (segments: readonly Segment[], epsilon: number): { readonly cycles: readonly PointMm[][]; readonly open: readonly Segment[] } => {
  const vertices = new Map<string, PointMm>(); const adjacency = new Map<string, string[]>(); const edges = new Set<string>();
  for (const segment of segments) {
    const start = pointKey(segment.start, epsilon); const end = pointKey(segment.end, epsilon); if (start === end) continue;
    vertices.set(start, segment.start); vertices.set(end, segment.end); const edge = [start, end].sort().join("|");
    if (edges.has(edge)) continue; edges.add(edge); adjacency.set(start, [...(adjacency.get(start) ?? []), end]); adjacency.set(end, [...(adjacency.get(end) ?? []), start]);
  }
  for (const [key, neighbors] of adjacency) neighbors.sort((a, b) => Math.atan2(vertices.get(a)!.y - vertices.get(key)!.y, vertices.get(a)!.x - vertices.get(key)!.x) - Math.atan2(vertices.get(b)!.y - vertices.get(key)!.y, vertices.get(b)!.x - vertices.get(key)!.x));
  const visited = new Set<string>(); const cycles: PointMm[][] = [];
  for (const [start, neighbors] of adjacency) for (const first of neighbors) {
    const directed = `${start}>${first}`; if (visited.has(directed)) continue;
    const points: PointMm[] = []; let from = start; let to = first; let guard = 0;
    while (guard++ <= edges.size * 2) {
      const marker = `${from}>${to}`; if (visited.has(marker)) break; visited.add(marker); points.push(vertices.get(from)!);
      const outgoing = adjacency.get(to) ?? []; const position = outgoing.findIndex((neighbor) => neighbor === from); if (position < 0) break;
      const next = outgoing[(position - 1 + outgoing.length) % outgoing.length]!; from = to; to = next;
      if (from === start && to === first) { if (area(points) > epsilon) cycles.push(points); break; }
    }
  }
  const cycleEdges = new Set(cycles.flatMap((cycle) => cycle.map((point, index) => [pointKey(point, epsilon), pointKey(cycle[(index + 1) % cycle.length]!, epsilon)].sort().join("|"))));
  return { cycles, open: segments.filter((segment) => !cycleEdges.has([pointKey(segment.start, epsilon), pointKey(segment.end, epsilon)].sort().join("|"))) };
};

export function sketchProfileResult(sketch: SketchElement, epsilon = 1e-9): SketchProfileResult {
  const nodes = new Map(sketch.nodes.map((node) => [node.id, node.point]));
  const segments = sketch.edges.flatMap((edge) => { const start = nodes.get(edge.startNodeId); const end = nodes.get(edge.endNodeId); return start && end ? [{ start, end }] : []; });
  const diagnostics: SketchProfileDiagnostic[] = [];
  if (segments.length !== sketch.edges.length) diagnostics.push({ code: "unsupported-geometry", message: "Sketch contains an edge with missing or unsupported geometry" });
  if (segments.some((segment) => Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y) <= epsilon)) diagnostics.push({ code: "degenerate-segment", message: "Sketch contains a degenerate line segment" });
  const invalidIntersections: PointMm[] = [];
  for (let first = 0; first < segments.length; first++) for (let second = first + 1; second < segments.length; second++) {
    const a = segments[first]!; const b = segments[second]!; const hit = intersection(a, b, epsilon);
    const duplicate = (Math.hypot(a.start.x - b.start.x, a.start.y - b.start.y) <= epsilon && Math.hypot(a.end.x - b.end.x, a.end.y - b.end.y) <= epsilon) || (Math.hypot(a.start.x - b.end.x, a.start.y - b.end.y) <= epsilon && Math.hypot(a.end.x - b.start.x, a.end.y - b.start.y) <= epsilon);
    if (duplicate || collinearOverlap(a, b, epsilon) || (hit && hit.firstT > epsilon && hit.firstT < 1 - epsilon && hit.secondT > epsilon && hit.secondT < 1 - epsilon)) invalidIntersections.push(hit?.point ?? a.start);
  }
  const parameters = segments.map(() => [] as number[]);
  for (let first = 0; first < segments.length; first++) for (let second = first + 1; second < segments.length; second++) {
    const hit = intersection(segments[first]!, segments[second]!, epsilon);
    if (hit) { parameters[first]!.push(hit.firstT); parameters[second]!.push(hit.secondT); }
  }
  const pieces = segments.flatMap((segment, index) => {
    const cuts = [...new Set(parameters[index]!.filter((value) => value > epsilon && value < 1 - epsilon))].sort((a, b) => a - b);
    const values = [0, ...cuts, 1];
    return values.slice(0, -1).map((value, cutIndex) => ({ start: { x: segment.start.x + (segment.end.x - segment.start.x) * value, y: segment.start.y + (segment.end.y - segment.start.y) * value }, end: { x: segment.start.x + (segment.end.x - segment.start.x) * values[cutIndex + 1]!, y: segment.start.y + (segment.end.y - segment.start.y) * values[cutIndex + 1]! } }));
  });
  const graph = graphCycles(pieces, epsilon); const ordered = [...graph.cycles].sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)) || ringKey(a).localeCompare(ringKey(b)));
  const outerRegions: PointMm[][] = []; const holes: PointMm[][] = [];
  const edgeKeys = (ring: readonly PointMm[]) => new Set(ring.map((point, index) => `${pointKey(point, epsilon)}|${pointKey(ring[(index + 1) % ring.length]!, epsilon)}`));
  for (const cycle of ordered) { const currentEdges = edgeKeys(cycle); const depth = ordered.filter((other) => other !== cycle && ![...currentEdges].some((edge) => edgeKeys(other).has(edge) || edgeKeys(other).has(edge.split("|").reverse().join("|")) ) && inside(cycle[0]!, other)).length; (depth % 2 ? holes : outerRegions).push([...cycle, cycle[0]!]); }
  if (graph.open.length) diagnostics.push({ code: "open-chain", message: "Sketch contains open line chains" });
  if (invalidIntersections.length) diagnostics.push({ code: "invalid-intersection", message: "Sketch contains self-intersections or ambiguous crossings" });
  if (!diagnostics.length && outerRegions.length) diagnostics.push({ code: "closed-profile", message: `${outerRegions.length} closed profile${outerRegions.length === 1 ? "" : "s"} detected` });
  const status: SketchProfileClassification = diagnostics.some((item) => item.code === "degenerate-segment") ? "degenerate" : invalidIntersections.length ? "ambiguous" : diagnostics.some((item) => item.code === "unsupported-geometry") ? "invalid" : graph.open.length ? "open" : outerRegions.length ? "valid-closed" : "invalid";
  return { status, outerRegions, holes, openChains: graph.open.map((segment) => [segment.start, segment.end]), invalidIntersections, diagnostics };
}
