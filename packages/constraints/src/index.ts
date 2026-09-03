import type {
  CircleConstraintKind,
  DocumentSnapshot,
  Element,
  ElementId,
  PointMm,
  SketchConstraintKind,
} from "@nodra/domain";
import { solveCircleConstraints, solveSketchConstraints } from "@nodra/geometry";

export type ConstraintState = "underdefined" | "fully-defined" | "overdefined" | "conflict" | "invalid";
export type ParametricConstraintKind = SketchConstraintKind | CircleConstraintKind;
export type ParametricEntityKind = "sketch" | "circle";

export interface ParametricEntityCapabilities {
  readonly entityKind: ParametricEntityKind;
  readonly constraintKinds: readonly ParametricConstraintKind[];
}

export interface ElementConstraintState {
  readonly elementId: ElementId;
  readonly state: ConstraintState | "not-parametric";
  readonly entityKind?: ParametricEntityKind;
  readonly conflicts: readonly string[];
}

export interface ConstraintNodeReference {
  readonly elementId: ElementId;
  readonly nodeId: string;
}

export interface ConstraintComponent {
  readonly nodeKeys: readonly string[];
  readonly constraintIds: readonly string[];
}

export interface NormalizedConstraint {
  readonly id: string;
  readonly scope: "local" | "document";
  readonly ownerId?: ElementId;
  readonly references: readonly ConstraintNodeReference[];
  readonly kind: SketchConstraintKind;
  readonly value?: number;
}

export interface ConstraintDofMetadata {
  readonly nodeKeys: readonly string[];
  readonly coordinateCount: number;
  readonly constraintCount: number;
  readonly status: "pending-solver";
}

export interface ConstraintResidual {
  readonly constraintId: string;
  readonly residual: number;
  readonly satisfied: boolean;
  readonly supported: boolean;
}

export interface ConstraintSolveResult {
  readonly document: DocumentSnapshot;
  readonly changed: boolean;
  readonly states: readonly ConstraintComponentState[];
  readonly residuals: readonly ConstraintResidual[];
}

export interface ConstraintComponentState {
  readonly nodeKeys: readonly string[];
  readonly state: ConstraintState;
  readonly diagnostics: readonly string[];
}

export interface ConstraintComponentInput {
  readonly nodeKeys: readonly string[];
  readonly nodes: readonly ConstraintNodeReference[];
  readonly coordinates: readonly PointMm[];
  readonly constraints: readonly NormalizedConstraint[];
  readonly coordinateCount: number;
}

const constraintNodeKey = (reference: ConstraintNodeReference): string => JSON.stringify([reference.elementId, reference.nodeId]);
const constraintIdentity = (scope: "local" | "document", elementId: ElementId | undefined, id: string): string => JSON.stringify([scope, elementId ?? null, id]);

interface AdapterState {
  readonly state: ConstraintState;
  readonly conflicts: readonly string[];
}

interface ParametricAdapter {
  readonly capabilities: ParametricEntityCapabilities;
  readonly supports: (element: Element) => boolean;
  readonly state: (element: Element) => AdapterState;
}

const sketchConstraintKinds = [
  "horizontal",
  "vertical",
  "coincident",
  "parallel",
  "perpendicular",
  "equal",
  "distance-horizontal",
  "distance-vertical",
  "distance",
  "angle",
  "fixed",
] as const satisfies readonly SketchConstraintKind[];

const circleConstraintKinds = ["center-horizontal", "center-vertical", "radius", "diameter"] as const satisfies readonly CircleConstraintKind[];

const sketchAdapter: ParametricAdapter = {
  capabilities: { entityKind: "sketch", constraintKinds: sketchConstraintKinds },
  supports: (element) => element.type === "sketch",
  state: (element) => {
    if (element.type !== "sketch") return { state: "invalid", conflicts: ["adapter-type-mismatch"] };
    const solved = solveSketchConstraints(element);
    return { state: solved.status === "defined" ? "fully-defined" : solved.status, conflicts: solved.conflicts };
  },
};

const circleAdapter: ParametricAdapter = {
  capabilities: { entityKind: "circle", constraintKinds: circleConstraintKinds },
  supports: (element) => element.type === "ellipse" && element.size.width === element.size.height,
  state: (element) => {
    if (element.type !== "ellipse" || element.size.width !== element.size.height) return { state: "invalid", conflicts: ["adapter-type-mismatch"] };
    const solved = solveCircleConstraints(element);
    return { state: solved.status === "defined" ? "fully-defined" : solved.status, conflicts: solved.conflicts };
  },
};

const adapters: readonly ParametricAdapter[] = [sketchAdapter, circleAdapter];
const adapterFor = (element: Element): ParametricAdapter | undefined => adapters.find((adapter) => adapter.supports(element));

/** Returns a stable, namespaced structural view; callers must validate references before solving. */
export function normalizedConstraintsForDocument(document: DocumentSnapshot): readonly NormalizedConstraint[] {
  const sketches = document.elements.filter((element): element is Extract<Element, { type: "sketch" }> => element.type === "sketch");
  return [
    ...sketches.flatMap((sketch) => (sketch.constraints ?? []).map((constraint) => ({ id: constraintIdentity("local", sketch.id, constraint.id), scope: "local" as const, ownerId: sketch.id, references: constraint.references, kind: constraint.kind, ...(constraint.value !== undefined ? { value: constraint.value } : {}) }))),
    ...(document.constraints ?? []).map((constraint) => ({ id: constraintIdentity("document", undefined, constraint.id), scope: "document" as const, references: constraint.references, kind: constraint.kind, ...(constraint.value !== undefined ? { value: constraint.value } : {}) })),
  ].sort((first, second) => first.id < second.id ? -1 : first.id > second.id ? 1 : 0);

}

/** Groups sketch nodes connected by local or page-level constraints. */
export function constraintComponentsForDocument(document: DocumentSnapshot): readonly ConstraintComponent[] {
  const sketches = document.elements.filter((element): element is Extract<Element, { type: "sketch" }> => element.type === "sketch");
  const known = new Set(sketches.flatMap((sketch) => sketch.nodes.map((node) => constraintNodeKey({ elementId: sketch.id, nodeId: node.id }))));
  const parent = new Map<string, string>([...known].map((key) => [key, key]));
  const find = (key: string): string => {
    const current = parent.get(key);
    if (!current || current === key) return key;
    const root = find(current);
    parent.set(key, root);
    return root;
  };
  const union = (first: string, second: string): void => {
    const firstRoot = find(first); const secondRoot = find(second);
    if (firstRoot !== secondRoot) parent.set(secondRoot, firstRoot);
  };
  const constraints = normalizedConstraintsForDocument(document);
  const constraintKeys = new Map<string, string[]>();
  for (const constraint of constraints) {
    if (constraint.ownerId !== undefined && constraint.references.some((reference) => reference.elementId !== constraint.ownerId)) continue;
    const keys = constraint.references.map((reference) => constraintNodeKey(reference));
    if (!keys.length || keys.some((key) => !known.has(key))) continue;
    for (const key of keys.slice(1)) union(keys[0]!, key);
    const root = find(keys[0]!);
    constraintKeys.set(root, [...(constraintKeys.get(root) ?? []), constraint.id]);
  }
  const components = new Map<string, { readonly nodeKeys: string[]; readonly constraintIds: string[] }>();
  for (const key of known) {
    const root = find(key); const current = components.get(root) ?? { nodeKeys: [], constraintIds: [] };
    current.nodeKeys.push(key);
    components.set(root, current);
  }
  for (const [root, ids] of constraintKeys) {
    const component = components.get(find(root));
    if (component) component.constraintIds.push(...ids);
  }
  return [...components.values()]
    .map((component) => ({ nodeKeys: [...component.nodeKeys].sort(), constraintIds: [...component.constraintIds].sort() }))
    .sort((first, second) => first.nodeKeys[0]! < second.nodeKeys[0]! ? -1 : first.nodeKeys[0]! > second.nodeKeys[0]! ? 1 : 0);
}

/** Reports input coordinates and constraint-record counts without pretending to solve degrees of freedom. */
export function constraintDofMetadataForDocument(document: DocumentSnapshot): readonly ConstraintDofMetadata[] {
  return constraintComponentsForDocument(document).map((component) => ({ nodeKeys: component.nodeKeys, coordinateCount: component.nodeKeys.length * 2, constraintCount: component.constraintIds.length, status: "pending-solver" }));
}

/** Builds the validated component-scoped input boundary consumed by a future solver. */
export function constraintInputsForDocument(document: DocumentSnapshot): readonly ConstraintComponentInput[] {
  const sketches = document.elements.filter((element): element is Extract<Element, { type: "sketch" }> => element.type === "sketch");
  const nodes = sketches.flatMap((sketch) => sketch.nodes.map((node) => ({ elementId: sketch.id, nodeId: node.id })));
  const normalized = normalizedConstraintsForDocument(document);
  return constraintComponentsForDocument(document).map((component) => {
    const keys = new Set(component.nodeKeys);
    const componentNodes = nodes.filter((node) => keys.has(constraintNodeKey(node))).sort((first, second) => constraintNodeKey(first) < constraintNodeKey(second) ? -1 : constraintNodeKey(first) > constraintNodeKey(second) ? 1 : 0);
    const constraints = normalized.filter((constraint) => (constraint.ownerId === undefined || constraint.references.every((reference) => reference.elementId === constraint.ownerId)) && constraint.references.every((reference) => keys.has(constraintNodeKey(reference))));
    const coordinates = componentNodes.map((node) => {
      const point = sketches.find((sketch) => sketch.id === node.elementId)?.nodes.find((candidate) => candidate.id === node.nodeId)?.point;
      if (!point) throw new Error(`Missing coordinate for constraint node ${node.elementId}/${node.nodeId}`);
      return point;
    });
    return { nodeKeys: component.nodeKeys, nodes: componentNodes, coordinates, constraints, coordinateCount: coordinates.length * 2 };
  });
}

/** Solves only complete single-sketch components and returns a non-persisted preview snapshot. */
export function solveConstraintComponents(document: DocumentSnapshot): ConstraintSolveResult {
  const components = constraintComponentsForDocument(document);
  const normalized = normalizedConstraintsForDocument(document);
  const globalPoints = new Map<string, { x: number; y: number }>(document.elements.filter((element): element is Extract<Element, { type: "sketch" }> => element.type === "sketch").flatMap((sketch) => sketch.nodes.map((node) => [constraintNodeKey({ elementId: sketch.id, nodeId: node.id }), { ...node.point }] as const)));
  for (const constraint of normalized.filter((candidate) => candidate.scope === "document").sort((first, second) => first.id < second.id ? -1 : first.id > second.id ? 1 : 0)) {
    if (constraint.references.length !== 2 || constraint.kind !== "coincident" && constraint.kind !== "horizontal" && constraint.kind !== "vertical") continue;
    const first = globalPoints.get(constraintNodeKey(constraint.references[0]!)); const second = globalPoints.get(constraintNodeKey(constraint.references[1]!));
    if (!first || !second || !Number.isFinite(first.x) || !Number.isFinite(first.y) || !Number.isFinite(second.x) || !Number.isFinite(second.y)) continue;
    if (constraint.kind === "coincident") { second.x = first.x; second.y = first.y; }
    else if (constraint.kind === "horizontal") second.y = first.y;
    else second.x = first.x;
  }
  const globallySolvedElements = document.elements.map((element) => {
    if (element.type !== "sketch") return element;
    const nodes = element.nodes.map((node) => ({ ...node, point: globalPoints.get(constraintNodeKey({ elementId: element.id, nodeId: node.id })) ?? node.point }));
    return nodes.some((node, index) => node.point.x !== element.nodes[index]?.point.x || node.point.y !== element.nodes[index]?.point.y) ? { ...element, nodes } : element;
  });
  const solvedElements = globallySolvedElements.map((element) => {
    if (element.type !== "sketch") return element;
    const nodeKeys = new Set(element.nodes.map((node) => constraintNodeKey({ elementId: element.id, nodeId: node.id })));
    const component = components.find((candidate) => candidate.nodeKeys.length === nodeKeys.size && candidate.nodeKeys.every((key) => nodeKeys.has(key)));
    const hasGlobal = normalized.some((constraint) => constraint.scope === "document" && constraint.references.some((reference) => nodeKeys.has(constraintNodeKey(reference))));
    const localConstraints = element.constraints ?? [];
    const componentConstraints = localConstraints.filter((constraint) => constraint.references.every((reference) => nodeKeys.has(constraintNodeKey(reference))));
    const hasExcludedLocal = componentConstraints.length !== localConstraints.length;
    const hasUnsupportedAngle = componentConstraints.some((constraint) => constraint.kind === "angle");
    if (!component || hasGlobal || hasExcludedLocal || hasUnsupportedAngle || !componentConstraints.length || component.nodeKeys.length !== nodeKeys.size) return element;
    const solved = solveSketchConstraints({ ...element, constraints: componentConstraints });
    const geometryChanged = solved.sketch.nodes.some((node, index) => node.point.x !== element.nodes[index]?.point.x || node.point.y !== element.nodes[index]?.point.y);
    return solved.status === "conflict" || solved.status === "overdefined" || !geometryChanged ? element : solved.sketch;
  });
  const changed = solvedElements.some((element, index) => JSON.stringify(element) !== JSON.stringify(document.elements[index]));
  const preview = changed ? { ...document, elements: solvedElements } : document;
  return { document: preview, changed, states: constraintComponentStatesForDocument(preview), residuals: constraintResidualsForDocument(preview) };
}

/** Calculates normalized geometric residuals for every structural constraint record. */
export function constraintResidualsForDocument(document: DocumentSnapshot, tolerance = 1e-6): readonly ConstraintResidual[] {
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error("Constraint residual tolerance must be finite and non-negative");
  const points = new Map(document.elements.filter((element): element is Extract<Element, { type: "sketch" }> => element.type === "sketch").flatMap((sketch) => sketch.nodes.map((node) => [constraintNodeKey({ elementId: sketch.id, nodeId: node.id }), node.point] as const)));
  return normalizedConstraintsForDocument(document).map((constraint) => {
    const values = constraint.references.map((reference) => points.get(constraintNodeKey(reference)));
    const isPoint = (point: PointMm | undefined): point is PointMm => point !== undefined && typeof point === "object" && Number.isFinite(point.x) && Number.isFinite(point.y);
    const valid = values.every(isPoint) && (constraint.ownerId === undefined || constraint.references.every((reference) => reference.elementId === constraint.ownerId));
    const expected = constraint.kind === "fixed" ? 1 : ["parallel", "perpendicular", "equal"].includes(constraint.kind) ? 4 : 2;
    const usesValue = ["distance-horizontal", "distance-vertical", "distance", "angle"].includes(constraint.kind);
    const knownKind = ["horizontal", "vertical", "coincident", "parallel", "perpendicular", "equal", "distance-horizontal", "distance-vertical", "distance", "angle", "fixed"].includes(constraint.kind);
    if (!valid || !knownKind || values.length !== expected || values.some((value) => !isPoint(value)) || usesValue && (!Number.isFinite(constraint.value) || constraint.value === undefined || constraint.value <= 0) || !usesValue && constraint.value !== undefined) return { constraintId: constraint.id, residual: Number.POSITIVE_INFINITY, satisfied: false, supported: false };
    const first = values[0]!; const second = values[1];
    if (constraint.kind === "fixed") return { constraintId: constraint.id, residual: Math.hypot(first.x, first.y), satisfied: Math.hypot(first.x, first.y) <= tolerance, supported: true };
    const dx = second!.x - first.x; const dy = second!.y - first.y; const directionLength = Math.hypot(dx, dy); const requiresDirection = constraint.kind !== "coincident";
    if (requiresDirection && directionLength <= tolerance) return { constraintId: constraint.id, residual: Number.POSITIVE_INFINITY, satisfied: false, supported: false };
    let residual: number;
    if (constraint.kind === "coincident") residual = Math.hypot(dx, dy);
    else if (constraint.kind === "horizontal") residual = Math.abs(dy);
    else if (constraint.kind === "vertical") residual = Math.abs(dx);
    else if (constraint.kind === "distance-horizontal") residual = Math.abs(Math.abs(dx) - constraint.value!);
    else if (constraint.kind === "distance-vertical") residual = Math.abs(Math.abs(dy) - constraint.value!);
    else if (constraint.kind === "distance") residual = Math.abs(Math.hypot(dx, dy) - constraint.value!);
    else if (constraint.kind === "angle") { const difference = Math.atan2(dy, dx) * 180 / Math.PI - constraint.value!; residual = Math.abs(((difference + 180) % 360 + 360) % 360 - 180); }
    else { const third = values[2]!; const fourth = values[3]!; const ax = dx; const ay = dy; const bx = fourth.x - third.x; const by = fourth.y - third.y; const firstLength = Math.hypot(ax, ay); const secondLength = Math.hypot(bx, by); if (firstLength <= tolerance || secondLength <= tolerance) return { constraintId: constraint.id, residual: Number.POSITIVE_INFINITY, satisfied: false, supported: false }; const cross = (ax / firstLength) * (by / secondLength) - (ay / firstLength) * (bx / secondLength); const dot = (ax / firstLength) * (bx / secondLength) + (ay / firstLength) * (by / secondLength); residual = constraint.kind === "parallel" ? Math.abs(cross) : constraint.kind === "perpendicular" ? Math.abs(dot) : Math.abs(firstLength - secondLength); }
    return { constraintId: constraint.id, residual, satisfied: residual <= tolerance, supported: true };
  });
}

/** Derives component diagnostics from native sketch solvers without persisting solver output. */
export function constraintComponentStatesForDocument(document: DocumentSnapshot): readonly ConstraintComponentState[] {
  const sketches = document.elements.filter((element): element is Extract<Element, { type: "sketch" }> => element.type === "sketch");
  const normalized = normalizedConstraintsForDocument(document);
  return constraintComponentsForDocument(document).map((component) => {
    const nodeKeys = new Set(component.nodeKeys);
    const involved = sketches.filter((sketch) => sketch.nodes.some((node) => nodeKeys.has(constraintNodeKey({ elementId: sketch.id, nodeId: node.id }))));
    const globalIds = normalized.filter((constraint) => constraint.scope === "document" && constraint.references.some((reference) => nodeKeys.has(constraintNodeKey(reference)))).map((constraint) => constraint.id);
    const hasAngle = normalized.some((constraint) => constraint.scope === "local" && constraint.ownerId === involved[0]?.id && constraint.kind === "angle" && constraint.references.some((reference) => nodeKeys.has(constraintNodeKey(reference))));
    const canUseNativeSolver = globalIds.length === 0 && !hasAngle && involved.length === 1 && involved[0]!.nodes.length === component.nodeKeys.length;
    const localStates = canUseNativeSolver ? [sketchAdapter.state(involved[0]!)] : [];
    const diagnostics = [...localStates.flatMap((state) => state.conflicts.map((conflict) => `${involved[0]!.id}:${conflict}`)), ...(globalIds.length ? globalIds.map((id) => `global-constraint-solver-first-slice:${id}`) : []), ...(!canUseNativeSolver && component.constraintIds.length ? ["component-solver-pending"] : [])].sort();
    const state = localStates.some((value) => value.state === "conflict") ? "conflict" : localStates.some((value) => value.state === "overdefined") ? "overdefined" : localStates.some((value) => value.state === "invalid") ? "invalid" : localStates.every((value) => value.state === "fully-defined") && canUseNativeSolver ? "fully-defined" : "underdefined";
    return { nodeKeys: component.nodeKeys, state, diagnostics };
  });
}

/** Returns the parametric operations currently supported by an element. */
export function parametricCapabilitiesForElement(element: Element): ParametricEntityCapabilities | undefined {
  return adapterFor(element)?.capabilities;
}

/** Derives an element's parametric state without persisting solver output. */
export function constraintStateForElement(document: DocumentSnapshot, elementId: ElementId): ElementConstraintState {
  const element = document.elements.find((candidate) => candidate.id === elementId);
  if (!element) return { elementId, state: "invalid", conflicts: ["element-not-found"] };
  const adapter = adapterFor(element);
  if (!adapter) return { elementId, state: "not-parametric", conflicts: [] };
  return { elementId, entityKind: adapter.capabilities.entityKind, ...adapter.state(element) };
}
