import type { PointMm } from "@nodra/domain";
import { GEOMETRY_EPSILON, PARAMETER_EPSILON } from "./tolerances.js";
import { pointAt, splitCurveAtParameters, type Curve2D, type CurvePiece2D } from "./curve2d.js";
import type { Curve2DSource } from "./curve2d-adapters.js";
import { collectMixedIntersections, type MixedIntersectionCollection } from "./mixed-intersections.js";

export interface CurveTopologyNode { readonly id: string; readonly point: PointMm; readonly kind: "endpoint" | "intersection" | "mixed"; readonly references: readonly CurveTopologyParameterReference[] }
export interface CurveTopologyParameterReference { readonly source: Curve2DSource; readonly sourceParameter: number; readonly pieceParameter: number }
export interface CurveTopologyFragment { readonly id: string; readonly curve: Curve2D; readonly source: Curve2DSource; readonly sourceInterval: CurvePiece2D["sourceInterval"]; readonly orientation: CurvePiece2D["orientation"]; readonly sourcePieceId: string; readonly start: CurveTopologyParameterReference; readonly end: CurveTopologyParameterReference; readonly startNodeId: string; readonly endNodeId: string }
export interface CurveTopologyPiece { readonly id: string; readonly native: CurvePiece2D; readonly fragmentIds: readonly string[] }
export interface CurveTopologyComponent { readonly nodeIds: readonly string[]; readonly fragmentIds: readonly string[] }
export interface CurveTopologyDiagnostic { readonly code: "unsupported" | "overlap" | "ambiguous" | "degenerate" | "disconnected"; readonly message: string; readonly severity: "info" | "warning"; readonly sourcePieceIds?: readonly string[] }
export interface CurveTopologyGraph { readonly pieces: readonly CurveTopologyPiece[]; readonly fragments: readonly CurveTopologyFragment[]; readonly nodes: readonly CurveTopologyNode[]; readonly components: readonly CurveTopologyComponent[]; readonly openChains: readonly CurveTopologyComponent[]; readonly closedLoops: readonly CurveTopologyComponent[]; readonly diagnostics: readonly CurveTopologyDiagnostic[] }
export interface CurveTopologyOptions { readonly geometryEpsilon?: number; readonly parameterEpsilon?: number }

const sourceKey = (source: Curve2DSource): string => Object.keys(source).sort().map((key) => `${key}=${String(source[key as keyof Curve2DSource])}`).join(";");
const numberKey = (value: number): string => Number.isInteger(value) ? String(value) : value.toPrecision(15);
const hash = (value: string): string => { let result = 2166136261; for (let index = 0; index < value.length; index += 1) { result ^= value.charCodeAt(index); result = Math.imul(result, 16777619); } return (result >>> 0).toString(16).padStart(8, "0"); };
const identityKey = (piece: CurvePiece2D): string => `${sourceKey(piece.source)}|${numberKey(piece.sourceInterval.t0)}|${numberKey(piece.sourceInterval.t1)}|${piece.orientation}`;
const distance = (a: PointMm, b: PointMm): number => Math.hypot(a.x - b.x, a.y - b.y);
const sourceParameter = (piece: CurvePiece2D, t: number): number => piece.orientation === "forward" ? piece.sourceInterval.t0 + (piece.sourceInterval.t1 - piece.sourceInterval.t0) * t : piece.sourceInterval.t1 - (piece.sourceInterval.t1 - piece.sourceInterval.t0) * t;
const endpointIdentity = (piece: CurvePiece2D, t: number): string | undefined => t === 0 ? piece.endpointIdentity?.startNodeId : t === 1 ? piece.endpointIdentity?.endNodeId : undefined;

interface Candidate { readonly point: PointMm; readonly reference: CurveTopologyParameterReference; readonly kind: "endpoint" | "intersection"; readonly pieceIndex: number; readonly parameter: number; readonly identity?: string }

/** Builds a transient, exact-curve topology graph. It consumes collected intersections when supplied. */
export function buildCurveTopology(pieces: readonly CurvePiece2D[], intersections?: MixedIntersectionCollection, options: CurveTopologyOptions = {}): CurveTopologyGraph {
  const geometryEpsilon = options.geometryEpsilon ?? GEOMETRY_EPSILON;
  const parameterEpsilon = options.parameterEpsilon ?? PARAMETER_EPSILON;
  if (!Number.isFinite(geometryEpsilon) || geometryEpsilon < 0 || !Number.isFinite(parameterEpsilon) || parameterEpsilon < 0) throw new Error("topology tolerances must be finite and non-negative");
  const diagnostics: CurveTopologyDiagnostic[] = [];
  const identityCounts = new Map<string, number>();
  pieces.forEach((piece) => identityCounts.set(identityKey(piece), (identityCounts.get(identityKey(piece)) ?? 0) + 1));
  const duplicateKeys = new Set([...identityCounts].filter(([, count]) => count > 1).map(([key]) => key));
  const occurrenceCounts = new Map<string, number>();
  const ids = pieces.map((piece) => {
    const key = identityKey(piece); const occurrence = occurrenceCounts.get(key) ?? 0; occurrenceCounts.set(key, occurrence + 1);
    const base = `piece:${hash(key)}`;
    return duplicateKeys.has(key) ? `${base}:occurrence:${occurrence}` : base;
  });
  const topologyPieces = pieces.map((piece, index) => ({ id: ids[index]!, native: piece, fragmentIds: [] as string[] }));
  if (duplicateKeys.size > 0) {
    diagnostics.push({ code: "ambiguous", message: "Duplicate native source identity is ambiguous; topology was not derived.", severity: "warning", sourcePieceIds: ids });
    return { pieces: topologyPieces, fragments: [], nodes: [], components: [], openChains: [], closedLoops: [], diagnostics };
  }
  const collectedIntersections = intersections ?? collectMixedIntersections(pieces, { geometryEpsilon, parameterEpsilon });
  const cuts = pieces.map(() => [] as number[]);
  const candidates: Candidate[] = [];
  const addCandidate = (piece: CurvePiece2D, pieceIndex: number, t: number, kind: Candidate["kind"]): void => {
    try {
      const identity = endpointIdentity(piece, t);
      const candidate = { point: pointAt(piece.curve, t), kind, pieceIndex, parameter: t, reference: { source: piece.source, sourceParameter: sourceParameter(piece, t), pieceParameter: t } };
      candidates.push(identity === undefined ? candidate : { ...candidate, identity });
    } catch { diagnostics.push({ code: "degenerate", message: "A native piece could not be evaluated.", severity: "warning", sourcePieceIds: [ids[pieceIndex]!] }); }
  };
  pieces.forEach((piece, index) => { addCandidate(piece, index, 0, "endpoint"); addCandidate(piece, index, 1, "endpoint"); });
  const resolvePiece = (piece: CurvePiece2D): number => {
    const exact = pieces.map((candidate, index) => candidate === piece ? index : -1).filter((index) => index >= 0);
    if (exact.length === 1) return exact[0]!;
    const matches = pieces.map((candidate, index) => identityKey(candidate) === identityKey(piece) ? index : -1).filter((index) => index >= 0);
    if (matches.length === 1) return matches[0]!;
    return -1;
  };
  for (const pair of collectedIntersections.pairs) {
    if (pair.kind === "unsupported") diagnostics.push({ code: "unsupported", message: pair.diagnostics[0]?.message ?? "Unsupported curve pair.", severity: "warning" });
    if (pair.kind === "overlap") diagnostics.push({ code: "overlap", message: "Overlapping portions do not define crossing topology.", severity: "info" });
    const firstIndex = resolvePiece(pair.firstPiece); const secondIndex = resolvePiece(pair.secondPiece);
    if (firstIndex < 0 || secondIndex < 0) { diagnostics.push({ code: "ambiguous", message: "Intersection references a missing or ambiguous native piece.", severity: "warning" }); continue; }
    for (const point of pair.points) {
      const firstT = point.firstParameter; const secondT = point.secondParameter;
      if (firstT > parameterEpsilon && (pieces[firstIndex]!.curve.type !== "circle" || firstT < 1 - parameterEpsilon)) cuts[firstIndex]!.push(firstT);
      if (secondT > parameterEpsilon && (pieces[secondIndex]!.curve.type !== "circle" || secondT < 1 - parameterEpsilon)) cuts[secondIndex]!.push(secondT);
      candidates.push({ point: point.point, kind: "intersection", pieceIndex: firstIndex, parameter: firstT, reference: { source: pieces[firstIndex]!.source, sourceParameter: point.firstSourceParameter, pieceParameter: firstT } });
      candidates.push({ point: point.point, kind: "intersection", pieceIndex: secondIndex, parameter: secondT, reference: { source: pieces[secondIndex]!.source, sourceParameter: point.secondSourceParameter, pieceParameter: secondT } });
    }
  }
  const parent = candidates.map((_, index) => index);
  const find = (index: number): number => { let root = index; while (parent[root] !== root) root = parent[root]!; while (parent[index] !== index) { const next = parent[index]!; parent[index] = root; index = next; } return root; };
  const union = (first: number, second: number): void => { const a = find(first); const b = find(second); if (a !== b) parent[b] = a; };
  for (let first = 0; first < candidates.length; first += 1) for (let second = first + 1; second < candidates.length; second += 1) {
    const left = candidates[first]!; const right = candidates[second]!;
    if (left.identity !== undefined && left.identity === right.identity || distance(left.point, right.point) <= geometryEpsilon) union(first, second);
  }
  const grouped = new Map<number, Candidate[]>(); candidates.forEach((candidate, index) => { const root = find(index); grouped.set(root, [...(grouped.get(root) ?? []), candidate]); });
  const clusters = [...grouped.values()].sort((a, b) => `${sourceKey(a[0]!.reference.source)}|${a[0]!.reference.sourceParameter}`.localeCompare(`${sourceKey(b[0]!.reference.source)}|${b[0]!.reference.sourceParameter}`));
  const clusterIndex = new Map<Candidate, number>(); clusters.forEach((cluster, index) => cluster.forEach((candidate) => clusterIndex.set(candidate, index)));
  const nodes = clusters.map((cluster) => {
    const ordered = [...cluster].sort((a, b) => `${sourceKey(a.reference.source)}|${numberKey(a.reference.sourceParameter)}|${a.pieceIndex}|${a.parameter}`.localeCompare(`${sourceKey(b.reference.source)}|${numberKey(b.reference.sourceParameter)}|${b.pieceIndex}|${b.parameter}`));
    const references = ordered.map((candidate) => candidate.reference); const identity = ordered.map((candidate) => candidate.identity).find((value): value is string => value !== undefined);
    const kind: CurveTopologyNode["kind"] = new Set(cluster.map((candidate) => candidate.kind)).size > 1 ? "mixed" : ordered[0]!.kind;
    return { id: `node:${hash(identity ? `identity:${identity}` : references.map((reference) => `${sourceKey(reference.source)}@${numberKey(reference.sourceParameter)}`).join("|"))}`, point: ordered[0]!.point, kind, references };
  });
  const nodeFor = (pieceIndex: number, t: number): CurveTopologyNode => {
    const match = candidates.find((candidate) => candidate.pieceIndex === pieceIndex && Math.abs(candidate.parameter - t) <= parameterEpsilon);
    if (match) return nodes[clusterIndex.get(match)!]!;
    const point = pointAt(pieces[pieceIndex]!.curve, t); return nodes.reduce((best, node) => distance(node.point, point) < distance(best.point, point) ? node : best);
  };
  const fragments: CurveTopologyFragment[] = [];
  pieces.forEach((piece, index) => {
    const split = cuts[index]!.length === 0 ? [{ curve: piece.curve, sourceInterval: { t0: 0, t1: 1 } }] : splitCurveAtParameters(piece.curve, cuts[index]!, parameterEpsilon);
    split.forEach((fragment) => {
      const t0 = fragment.sourceInterval.t0; const t1 = fragment.sourceInterval.t1;
      const start: CurveTopologyParameterReference = { source: piece.source, sourceParameter: sourceParameter(piece, t0), pieceParameter: t0 }; const end: CurveTopologyParameterReference = { source: piece.source, sourceParameter: sourceParameter(piece, t1), pieceParameter: t1 };
      const id = `fragment:${hash(`${ids[index]}|${numberKey(sourceParameter(piece, t0))}|${numberKey(sourceParameter(piece, t1))}|${piece.orientation}`)}`;
      fragments.push({ id, curve: fragment.curve, source: piece.source, sourceInterval: { t0: Math.min(start.sourceParameter, end.sourceParameter), t1: Math.max(start.sourceParameter, end.sourceParameter) }, orientation: piece.orientation, sourcePieceId: ids[index]!, start, end, startNodeId: nodeFor(index, t0).id, endNodeId: nodeFor(index, t1).id });
      topologyPieces[index]!.fragmentIds.push(id);
    });
  });
  const components: CurveTopologyComponent[] = []; const unseen = new Set(fragments.map((fragment) => fragment.id));
  while (unseen.size) { const seed = fragments.find((fragment) => unseen.has(fragment.id))!; const found = new Set([seed.id]); const nodeIds = new Set([seed.startNodeId, seed.endNodeId]); let changed = true; while (changed) { changed = false; for (const fragment of fragments) if (!found.has(fragment.id) && (nodeIds.has(fragment.startNodeId) || nodeIds.has(fragment.endNodeId))) { found.add(fragment.id); nodeIds.add(fragment.startNodeId); nodeIds.add(fragment.endNodeId); changed = true; } } found.forEach((id) => unseen.delete(id)); components.push({ nodeIds: [...nodeIds].sort(), fragmentIds: [...found].sort() }); }
  const degree = new Map<string, number>(); fragments.forEach((fragment) => { degree.set(fragment.startNodeId, (degree.get(fragment.startNodeId) ?? 0) + 1); degree.set(fragment.endNodeId, (degree.get(fragment.endNodeId) ?? 0) + 1); });
  const closedLoops = components.filter((component) => component.fragmentIds.length > 0 && component.nodeIds.every((nodeId) => degree.get(nodeId) === 2));
  const openChains = components.filter((component) => !closedLoops.includes(component));
  if (components.length > 1) diagnostics.push({ code: "disconnected", message: "The derived graph contains disconnected components.", severity: "info" });
  return { pieces: topologyPieces, fragments, nodes, components, openChains, closedLoops, diagnostics };
}

export const deriveCurveTopology = buildCurveTopology;
