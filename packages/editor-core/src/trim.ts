import type { DocumentSnapshot, ElementId, PointMm } from "@nodra/domain";
import { buildSketchProfile, type ProfileInputScope, type SketchProfileResult } from "@nodra/geometry";
import type { CommandDiagnostic, CommandResult, EditorCommand } from "./index.js";

export interface TrimTarget {
  readonly elementId: ElementId;
  readonly segmentIndex: number;
  readonly point: PointMm;
  readonly ringIndex?: number;
  readonly scope: ProfileInputScope;
  readonly profile: SketchProfileResult;
}
export interface TrimCandidate { readonly target: TrimTarget; readonly diagnostics: readonly CommandDiagnostic[]; readonly supported: boolean }
export type TrimGeometryTarget = Omit<TrimTarget, "point" | "scope" | "profile"> & { readonly point?: PointMm };
export type TrimApply = (document: DocumentSnapshot, target: TrimGeometryTarget) => CommandResult;

/** Canonical geometric mutation seam shared by Trim and legacy Cut. */
export function applyTrimGeometry(document: DocumentSnapshot, target: TrimGeometryTarget, apply: TrimApply): CommandResult {
  return apply(document, target);
}

const diagnostic = (code: string, message: string): CommandDiagnostic => ({ kind: "topology", code, message });
const stable = (value: unknown): string => JSON.stringify(value);
const unsafeCodes = new Set(["unsupported-geometry", "degenerate-segment", "invalid-fragment-reference", "stale-source-interval", "inconsistent-loop", "inconsistent-region", "source-provenance-mismatch"]);
const profileDiagnostics = (profile: SketchProfileResult): readonly CommandDiagnostic[] => profile.diagnostics.filter((item) => unsafeCodes.has(item.code)).map((item) => diagnostic(`profile-${item.code}`, item.message));

/** Rebinds the explicit transient scope to the current snapshot and validates its derived profile. */
export function buildTrimCandidate(document: DocumentSnapshot, target: TrimTarget): TrimCandidate {
  const source = document.elements.find((element) => element.id === target.elementId);
  if (!source) return { target, supported: false, diagnostics: [diagnostic("trim-target-not-found", "Trim target was not found")] };
  const current = new Map(document.elements.map((element) => [element.id, element]));
  const rebound = target.scope.elements.map((element) => current.get(element.id));
  if (rebound.some((element) => element === undefined)) return { target, supported: false, diagnostics: [diagnostic("stale-trim-scope", "Trim profile scope references a missing element")] };
  const scope = { elements: rebound as NonNullable<typeof rebound[number]>[] } as ProfileInputScope;
  if (!scope.elements.some((element) => element.id === source.id)) return { target, supported: false, diagnostics: [diagnostic("trim-scope-mismatch", "Trim target is not part of the explicit profile scope")] };
  if (!Number.isInteger(target.segmentIndex) || target.segmentIndex < 0 || !Number.isFinite(target.point.x) || !Number.isFinite(target.point.y)) return { target, supported: false, diagnostics: [diagnostic("invalid-trim-target", "Trim target coordinates or segment are invalid")] };
  if (source.type === "spline" || source.type === "ellipse") return { target, supported: false, diagnostics: [diagnostic("unsupported-trim-geometry", `Trim does not support ${source.type} geometry`)] };
  const profile = buildSketchProfile(scope);
  const diagnostics = profileDiagnostics(profile);
  const statusDiagnostic = profile.status === "open" || profile.status === "valid-closed" || profile.status === "ambiguous" ? [] : [diagnostic(`profile-${profile.status}`, `Trim profile is ${profile.status}`)];
  if (profile.status !== "open" && profile.status !== "valid-closed" && profile.status !== "ambiguous" || diagnostics.length || stable(target.profile) !== stable(profile)) {
    const mismatch = stable(target.profile) !== stable(profile) ? [diagnostic("stale-trim-profile", "Trim profile is stale or does not match the current scope")] : [];
    return { target: { ...target, scope, profile }, supported: false, diagnostics: [...statusDiagnostic, ...diagnostics, ...mismatch] };
  }
  return { target: { ...target, scope, profile }, supported: true, diagnostics: [] };
}

/** Single shared pure candidate/apply path used by both preview and commit. */
export function applyTrimCandidate(document: DocumentSnapshot, target: TrimTarget, apply: TrimApply): CommandResult {
  const candidate = buildTrimCandidate(document, target);
  if (!candidate.supported) return { success: false, error: candidate.diagnostics.map((item) => item.message).join("; ") || "Trim candidate is unsupported", diagnostics: candidate.diagnostics };
  const applied = applyTrimGeometry(document, candidate.target, apply);
  return applied.success ? { ...applied, diagnostics: [...candidate.diagnostics, ...(applied.diagnostics ?? [])] } : applied;
}
export function trimCommand(target: TrimTarget, apply: TrimApply): EditorCommand { return { name: `trim:${target.elementId}:${target.ringIndex ?? 0}:${target.segmentIndex}`, apply: (document) => applyTrimCandidate(document, target, apply) }; }
export function previewTrim(document: DocumentSnapshot, target: TrimTarget, apply: TrimApply): CommandResult { const result = applyTrimCandidate(document, target, apply); return result.success ? { ...result, document: { ...result.document, revision: document.revision } } : result; }
