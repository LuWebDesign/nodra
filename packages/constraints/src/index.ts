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
  readonly converged: boolean;
  readonly iterations: number;
  readonly nonConvergedComponents: readonly (readonly string[])[];
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
const CONSTRAINT_TOLERANCE = 1e-6;
const MAX_CONSTRAINT_ITERATIONS = 32;
type MutablePoint = { x: number; y: number };

const solveGlobalSegmentRelation = (kind: SketchConstraintKind, first: MutablePoint, second: MutablePoint, third: MutablePoint, fourth: MutablePoint): boolean => {
  if (kind !== "parallel" && kind !== "perpendicular" && kind !== "equal") return false;
  const firstLength = Math.hypot(second.x - first.x, second.y - first.y);
  const secondLength = Math.hypot(fourth.x - third.x, fourth.y - third.y);
  if (firstLength <= CONSTRAINT_TOLERANCE || secondLength <= CONSTRAINT_TOLERANCE) return false;
  const firstDirection = { x: (second.x - first.x) / firstLength, y: (second.y - first.y) / firstLength };
  const secondDirection = { x: (fourth.x - third.x) / secondLength, y: (fourth.y - third.y) / secondLength };
  if (kind === "equal") {
    fourth.x = third.x + secondDirection.x * firstLength;
    fourth.y = third.y + secondDirection.y * firstLength;
  } else {
    const candidate = kind === "parallel" ? firstDirection : { x: -firstDirection.y, y: firstDirection.x };
    const orientation = candidate.x * secondDirection.x + candidate.y * secondDirection.y < 0 ? -1 : 1;
    fourth.x = third.x + candidate.x * secondLength * orientation;
    fourth.y = third.y + candidate.y * secondLength * orientation;
  }
  return true;
};

const projectGlobalConstraint = (points: Map<string, MutablePoint>, constraint: NormalizedConstraint): number => {
  const segmentRelation = constraint.kind === "parallel" || constraint.kind === "perpendicular" || constraint.kind === "equal";
  const supported = constraint.kind === "coincident" || constraint.kind === "horizontal" || constraint.kind === "vertical" || constraint.kind === "distance-horizontal" || constraint.kind === "distance-vertical" || constraint.kind === "distance" || constraint.kind === "angle" || segmentRelation;
  const requiresValue = constraint.kind === "distance-horizontal" || constraint.kind === "distance-vertical" || constraint.kind === "distance" || constraint.kind === "angle";
  if (constraint.references.length !== (segmentRelation ? 4 : 2) || !supported || requiresValue && (!Number.isFinite(constraint.value) || constraint.value === undefined || constraint.value <= 0) || !requiresValue && constraint.value !== undefined) return 0;
  const values = constraint.references.map((reference) => points.get(constraintNodeKey(reference)));
  if (values.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return 0;
  const previous = values.map((point) => ({ ...point! }));
  const first = values[0]!; const second = values[1]!;
  if (constraint.kind === "coincident") { second.x = first.x; second.y = first.y; }
  else if (constraint.kind === "horizontal") second.y = first.y;
  else if (constraint.kind === "vertical") second.x = first.x;
  else if (constraint.kind === "distance-horizontal") { if (Math.abs(second.x - first.x) <= CONSTRAINT_TOLERANCE) return 0; second.x = first.x + (second.x < first.x ? -constraint.value! : constraint.value!); }
  else if (constraint.kind === "distance-vertical") { if (Math.abs(second.y - first.y) <= CONSTRAINT_TOLERANCE) return 0; second.y = first.y + (second.y < first.y ? -constraint.value! : constraint.value!); }
  else if (constraint.kind === "distance") { const length = Math.hypot(second.x - first.x, second.y - first.y); if (length <= CONSTRAINT_TOLERANCE) return 0; second.x = first.x + (second.x - first.x) * constraint.value! / length; second.y = first.y + (second.y - first.y) * constraint.value! / length; }
  else if (constraint.kind === "angle") { const length = Math.hypot(second.x - first.x, second.y - first.y); if (length <= CONSTRAINT_TOLERANCE) return 0; const angle = constraint.value! * Math.PI / 180; second.x = first.x + length * Math.cos(angle); second.y = first.y + length * Math.sin(angle); }
  else if (!solveGlobalSegmentRelation(constraint.kind, first, second, values[2]!, values[3]!)) return 0;
  return Math.max(0, ...values.map((point, index) => Math.hypot(point!.x - previous[index]!.x, point!.y - previous[index]!.y)));
};

interface LocalProjectionResult { readonly delta: number; readonly valid: boolean }

const projectLocalSketchConstraints = (points: Map<string, MutablePoint>, sketch: Extract<Element, { type: "sketch" }>, constraintIds: ReadonlySet<string>, nodeKeys: ReadonlySet<string>): LocalProjectionResult => {
  const constraints = (sketch.constraints ?? []).filter((constraint) => constraintIds.has(constraintIdentity("local", sketch.id, constraint.id)));
  if (!constraints.length) return { delta: 0, valid: true };
  const candidate = { ...sketch, constraints, nodes: sketch.nodes.map((node) => ({ ...node, point: { ...(points.get(constraintNodeKey({ elementId: sketch.id, nodeId: node.id })) ?? node.point) } })) };
  const solved = solveSketchConstraints(candidate);
  if (solved.status === "conflict" || solved.status === "overdefined") return { delta: 0, valid: false };
  let maxDelta = 0;
  for (const node of solved.sketch.nodes) {
    const key = constraintNodeKey({ elementId: sketch.id, nodeId: node.id });
    if (!nodeKeys.has(key)) continue;
    const point = points.get(key);
    if (!point || !Number.isFinite(node.point.x) || !Number.isFinite(node.point.y)) return { delta: 0, valid: false };
    maxDelta = Math.max(maxDelta, Math.hypot(node.point.x - point.x, node.point.y - point.y));
  }
  for (const node of solved.sketch.nodes) {
    const key = constraintNodeKey({ elementId: sketch.id, nodeId: node.id });
    if (!nodeKeys.has(key)) continue;
    const point = points.get(key)!;
    point.x = node.point.x;
    point.y = node.point.y;
  }
  return { delta: maxDelta, valid: true };
};

const pointMapSignature = (points: ReadonlyMap<string, MutablePoint>, nodeKeys?: ReadonlySet<string>): string => JSON.stringify([...points].filter(([key]) => !nodeKeys || nodeKeys.has(key)).map(([key, point]) => [key, Math.round(point.x / CONSTRAINT_TOLERANCE), Math.round(point.y / CONSTRAINT_TOLERANCE)]));

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

/** Iteratively projects page constraints, then solves eligible local-only components without persisting the preview. */
export function solveConstraintComponents(document: DocumentSnapshot): ConstraintSolveResult {
  const components = constraintComponentsForDocument(document);
  const normalized = normalizedConstraintsForDocument(document);
  const globalConstraints = normalized.filter((constraint) => constraint.scope === "document");
  const constrainedComponents = components.filter((component) => component.constraintIds.length > 0);
  const iteratedConstraintIds = new Set(normalized.map((constraint) => constraint.id));
  const sketches = document.elements.filter((element): element is Extract<Element, { type: "sketch" }> => element.type === "sketch").sort((first, second) => first.id < second.id ? -1 : first.id > second.id ? 1 : 0);
  const globalPoints = new Map<string, MutablePoint>(sketches.flatMap((sketch) => sketch.nodes.map((node) => [constraintNodeKey({ elementId: sketch.id, nodeId: node.id }), { ...node.point }] as const)));
  let iterations = 0;
  let reachedFixedPoint = true;
  const nonConvergedComponents: (readonly string[])[] = [];
  for (const component of constrainedComponents) {
    const nodeKeys = new Set(component.nodeKeys);
    const constraintIds = new Set(component.constraintIds);
    const componentGlobals = globalConstraints.filter((constraint) => constraintIds.has(constraint.id));
    const componentSketches = sketches.filter((sketch) => sketch.nodes.some((node) => nodeKeys.has(constraintNodeKey({ elementId: sketch.id, nodeId: node.id }))));
    const initialPoints = new Map(component.nodeKeys.map((key) => [key, { ...globalPoints.get(key)! }] as const));
    const seen = new Set<string>([pointMapSignature(globalPoints, nodeKeys)]);
    let componentReachedFixedPoint = false;
    let componentIterations = 0;
    for (let iteration = 0; iteration < MAX_CONSTRAINT_ITERATIONS; iteration += 1) {
      componentIterations = iteration + 1;
      const localResults = componentSketches.map((sketch) => projectLocalSketchConstraints(globalPoints, sketch, constraintIds, nodeKeys));
      if (localResults.some((result) => !result.valid)) break;
      const maxProjectionDelta = Math.max(0, ...localResults.map((result) => result.delta), ...componentGlobals.map((constraint) => projectGlobalConstraint(globalPoints, constraint)));
      if (maxProjectionDelta <= CONSTRAINT_TOLERANCE) { componentReachedFixedPoint = true; break; }
      const signature = pointMapSignature(globalPoints, nodeKeys);
      if (seen.has(signature)) break;
      seen.add(signature);
    }
    iterations = Math.max(iterations, componentIterations);
    reachedFixedPoint = reachedFixedPoint && componentReachedFixedPoint;
    if (!componentReachedFixedPoint) nonConvergedComponents.push(component.nodeKeys);
    if (!componentReachedFixedPoint) for (const [key, point] of initialPoints) { const target = globalPoints.get(key)!; target.x = point.x; target.y = point.y; }
  }
  const solvedElements = document.elements.map((element) => {
    if (element.type !== "sketch") return element;
    const nodes = element.nodes.map((node) => ({ ...node, point: globalPoints.get(constraintNodeKey({ elementId: element.id, nodeId: node.id })) ?? node.point }));
    return nodes.some((node, index) => node.point.x !== element.nodes[index]?.point.x || node.point.y !== element.nodes[index]?.point.y) ? { ...element, nodes } : element;
  });
  const changed = solvedElements.some((element, index) => JSON.stringify(element) !== JSON.stringify(document.elements[index]));
  const preview = changed ? { ...document, elements: solvedElements } : document;
  const residuals = constraintResidualsForDocument(preview);
  const failedResiduals = residuals.filter((residual) => iteratedConstraintIds.has(residual.constraintId) && (!residual.supported || !residual.satisfied));
  for (const residual of failedResiduals) {
    const constraint = normalized.find((candidate) => candidate.id === residual.constraintId);
    const nodeKeys = constraint?.references.map(constraintNodeKey).sort() ?? [];
    if (nodeKeys.length && !nonConvergedComponents.some((current) => current.length === nodeKeys.length && current.every((key, index) => key === nodeKeys[index]))) nonConvergedComponents.push(nodeKeys);
  }
  const converged = reachedFixedPoint && failedResiduals.length === 0;
  return { document: preview, changed, converged, iterations, nonConvergedComponents, states: constraintComponentStatesForDocument(preview), residuals };
}

/** Calculates normalized geometric residuals for every structural constraint record. */
export function constraintResidualsForDocument(document: DocumentSnapshot, tolerance = CONSTRAINT_TOLERANCE): readonly ConstraintResidual[] {
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
  const residuals = constraintResidualsForDocument(document);
  return constraintComponentsForDocument(document).map((component) => {
    const nodeKeys = new Set(component.nodeKeys);
    const involved = sketches.filter((sketch) => sketch.nodes.some((node) => nodeKeys.has(constraintNodeKey({ elementId: sketch.id, nodeId: node.id }))));
    const globalIds = normalized.filter((constraint) => constraint.scope === "document" && constraint.references.some((reference) => nodeKeys.has(constraintNodeKey(reference)))).map((constraint) => constraint.id);
    const hasAngle = normalized.some((constraint) => constraint.scope === "local" && constraint.ownerId === involved[0]?.id && constraint.kind === "angle" && constraint.references.some((reference) => nodeKeys.has(constraintNodeKey(reference))));
    const canUseNativeSolver = globalIds.length === 0 && !hasAngle && involved.length === 1 && involved[0]!.nodes.length === component.nodeKeys.length;
    const localStates = canUseNativeSolver ? [sketchAdapter.state(involved[0]!)] : [];
    const globalResiduals = residuals.filter((residual) => globalIds.includes(residual.constraintId));
    const unsatisfiedGlobal = globalResiduals.filter((residual) => residual.supported && !residual.satisfied);
    const pendingGlobal = globalResiduals.some((residual) => !residual.supported);
    const diagnostics = [...localStates.flatMap((state) => state.conflicts.map((conflict) => `${involved[0]!.id}:${conflict}`)), ...unsatisfiedGlobal.map((residual) => `global-constraint-conflict:${residual.constraintId}`), ...(pendingGlobal ? globalIds.filter((id) => globalResiduals.some((residual) => residual.constraintId === id && !residual.supported)).map((id) => `global-constraint-solver-pending:${id}`) : []), ...(!canUseNativeSolver && component.constraintIds.length ? ["component-solver-pending"] : [])].sort();
    const state = unsatisfiedGlobal.length || localStates.some((value) => value.state === "conflict") ? "conflict" : localStates.some((value) => value.state === "overdefined") ? "overdefined" : localStates.some((value) => value.state === "invalid") ? "invalid" : localStates.every((value) => value.state === "fully-defined") && canUseNativeSolver ? "fully-defined" : "underdefined";
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
