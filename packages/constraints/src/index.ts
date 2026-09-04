import type {
  CircleConstraintKind,
  DocumentSnapshot,
  Element,
  ElementId,
  PointMm,
  SketchConstraintKind,
  SketchConstraint,
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
  readonly rank: number;
  readonly degreesOfFreedom: number;
  readonly status: ConstraintState;
}

export interface ConstraintResidual {
  readonly constraintId: string;
  readonly residual: number;
  readonly satisfied: boolean;
  readonly supported: boolean;
}

export interface ConstraintDiagnostic {
  readonly code: "unsupported-constraint" | "constraint-conflict" | "redundant-component" | "non-converged-component";
  readonly constraintIds: readonly string[];
  readonly referenceKeys: readonly string[];
  readonly message: string;
}

export interface ConstraintSolveResult {
  readonly document: DocumentSnapshot;
  readonly changed: boolean;
  readonly converged: boolean;
  readonly iterations: number;
  readonly nonConvergedComponents: readonly (readonly string[])[];
  readonly degreesOfFreedom: number;
  readonly affectedElementIds: readonly ElementId[];
  readonly states: readonly ConstraintComponentState[];
  readonly residuals: readonly ConstraintResidual[];
  readonly diagnostics: readonly ConstraintDiagnostic[];
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
const documentConstraintKinds = new Set<SketchConstraintKind>(["coincident", "horizontal", "vertical", "distance-horizontal", "distance-vertical", "distance", "parallel", "perpendicular", "equal", "angle"]);

/** Reports whether the page-level solver supports a constraint kind. */
export const supportsDocumentConstraintKind = (kind: SketchConstraintKind): boolean => documentConstraintKinds.has(kind);
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
  const supported = supportsDocumentConstraintKind(constraint.kind);
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
  const candidatePoints = new Map(candidate.nodes.map((node) => [node.id, node.point]));
  const degenerateAxis = constraints.some((constraint) => {
    if (constraint.kind !== "horizontal" && constraint.kind !== "vertical" || constraint.references.length !== 2 || !constraint.references.every((reference) => "nodeId" in reference)) return false;
    const [firstReference, secondReference] = constraint.references;
    const first = firstReference && "nodeId" in firstReference ? candidatePoints.get(firstReference.nodeId) : undefined;
    const second = secondReference && "nodeId" in secondReference ? candidatePoints.get(secondReference.nodeId) : undefined;
    return first !== undefined && second !== undefined && Math.hypot(second.x - first.x, second.y - first.y) <= CONSTRAINT_TOLERANCE;
  });
  if (degenerateAxis) return { delta: 0, valid: false };
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

const pointReferencesForConstraint = (sketches: readonly Extract<Element, { type: "sketch" }>[], constraint: SketchConstraint): readonly ConstraintNodeReference[] => {
  if (constraint.references.every((reference) => "nodeId" in reference)) return constraint.references;
  const segmentRelation = constraint.kind === "parallel" || constraint.kind === "perpendicular" || constraint.kind === "equal";
  if (!segmentRelation || constraint.references.length !== 2 || !constraint.references.every((reference) => "edgeId" in reference)) return [];
  const references = constraint.references.flatMap((reference) => {
    if (!("edgeId" in reference)) return [];
    const sketch = sketches.find((candidate) => candidate.id === reference.elementId);
    const edge = sketch?.edges.find((candidate) => candidate.id === reference.edgeId);
    return sketch && edge ? [{ elementId: sketch.id, nodeId: edge.startNodeId }, { elementId: sketch.id, nodeId: edge.endNodeId }] : [];
  });
  return references.length === 4 ? references : [];
};

/** Returns a stable, namespaced structural view; callers must validate references before solving. */
export function normalizedConstraintsForDocument(document: DocumentSnapshot): readonly NormalizedConstraint[] {
  const sketches = document.elements.filter((element): element is Extract<Element, { type: "sketch" }> => element.type === "sketch");
  return [
    ...sketches.flatMap((sketch) => (sketch.constraints ?? []).map((constraint) => ({ id: constraintIdentity("local", sketch.id, constraint.id), scope: "local" as const, ownerId: sketch.id, references: pointReferencesForConstraint(sketches, constraint), kind: constraint.kind, ...(constraint.value !== undefined ? { value: constraint.value } : {}) }))),
    ...(document.constraints ?? []).map((constraint) => ({ id: constraintIdentity("document", undefined, constraint.id), scope: "document" as const, references: pointReferencesForConstraint(sketches, constraint), kind: constraint.kind, ...(constraint.value !== undefined ? { value: constraint.value } : {}) })),
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

const matrixRank = (matrix: readonly number[][]): number => {
  const values = matrix.map((row) => [...row]);
  let pivot = 0;
  for (let column = 0; column < (values[0]?.length ?? 0) && pivot < values.length; column++) {
    const candidate = values.slice(pivot).findIndex((row) => Math.abs(row[column] ?? 0) > CONSTRAINT_TOLERANCE);
    if (candidate < 0) continue;
    [values[pivot], values[pivot + candidate]] = [values[pivot + candidate]!, values[pivot]!];
    const divisor = values[pivot]![column]!;
    values[pivot] = values[pivot]!.map((value) => value / divisor);
    for (let row = 0; row < values.length; row++) {
      if (row === pivot) continue;
      const factor = values[row]![column] ?? 0;
      if (Math.abs(factor) > CONSTRAINT_TOLERANCE) values[row] = values[row]!.map((value, index) => value - factor * values[pivot]![index]!);
    }
    pivot += 1;
  }
  return pivot;
};

const constraintRankForInput = (input: ConstraintComponentInput): { readonly rank: number; readonly rowCount: number } => {
  const indexes = new Map(input.nodes.map((node, index) => [constraintNodeKey(node), index]));
  const points = new Map(input.nodes.map((node, index) => [constraintNodeKey(node), input.coordinates[index]!]));
  const rows: number[][] = [];
  const addRow = (entries: readonly { readonly reference: ConstraintNodeReference; readonly x: number; readonly y: number }[]): void => {
    const row = Array.from({ length: input.coordinateCount }, () => 0);
    for (const entry of entries) {
      const index = indexes.get(constraintNodeKey(entry.reference));
      if (index === undefined) return;
      row[index * 2] = (row[index * 2] ?? 0) + entry.x;
      row[index * 2 + 1] = (row[index * 2 + 1] ?? 0) + entry.y;
    }
    const scale = Math.max(0, ...row.map(Math.abs));
    if (scale > Number.EPSILON) rows.push(row.map((value) => value / scale));
  };
  for (const constraint of input.constraints) {
    const [first, second, third, fourth] = constraint.references;
    const expected = constraint.kind === "fixed" ? 1 : constraint.kind === "parallel" || constraint.kind === "perpendicular" || constraint.kind === "equal" ? 4 : 2;
    const usesValue = constraint.kind === "distance-horizontal" || constraint.kind === "distance-vertical" || constraint.kind === "distance" || constraint.kind === "angle";
    if (!first || constraint.references.length !== expected || constraint.scope === "document" && !supportsDocumentConstraintKind(constraint.kind) || usesValue && (constraint.value === undefined || !Number.isFinite(constraint.value) || constraint.value <= 0) || !usesValue && constraint.value !== undefined) continue;
    const finiteReferences = constraint.references.every((reference) => { const point = points.get(constraintNodeKey(reference)); return point !== undefined && Number.isFinite(point.x) && Number.isFinite(point.y); });
    if (!finiteReferences) continue;
    if (constraint.kind === "fixed") { addRow([{ reference: first, x: 1, y: 0 }]); addRow([{ reference: first, x: 0, y: 1 }]); continue; }
    if (!second) continue;
    if (constraint.kind === "coincident") { addRow([{ reference: first, x: -1, y: 0 }, { reference: second, x: 1, y: 0 }]); addRow([{ reference: first, x: 0, y: -1 }, { reference: second, x: 0, y: 1 }]); continue; }
    const firstPoint = points.get(constraintNodeKey(first)); const secondPoint = points.get(constraintNodeKey(second));
    if (!firstPoint || !secondPoint) continue;
    const ux = secondPoint.x - firstPoint.x; const uy = secondPoint.y - firstPoint.y; const firstLength = Math.hypot(ux, uy);
    if (firstLength <= CONSTRAINT_TOLERANCE) continue;
    if (constraint.kind === "distance-horizontal" && Math.abs(ux) <= CONSTRAINT_TOLERANCE || constraint.kind === "distance-vertical" && Math.abs(uy) <= CONSTRAINT_TOLERANCE) continue;
    if (constraint.kind === "horizontal" || constraint.kind === "distance-vertical") { addRow([{ reference: first, x: 0, y: -1 }, { reference: second, x: 0, y: 1 }]); continue; }
    if (constraint.kind === "vertical" || constraint.kind === "distance-horizontal") { addRow([{ reference: first, x: -1, y: 0 }, { reference: second, x: 1, y: 0 }]); continue; }
    if (constraint.kind === "distance" || constraint.kind === "angle") {
      const x = constraint.kind === "distance" ? ux / firstLength : -uy / (firstLength * firstLength);
      const y = constraint.kind === "distance" ? uy / firstLength : ux / (firstLength * firstLength);
      addRow([{ reference: first, x: -x, y: -y }, { reference: second, x, y }]);
      continue;
    }
    if (!third || !fourth) continue;
    const thirdPoint = points.get(constraintNodeKey(third)); const fourthPoint = points.get(constraintNodeKey(fourth));
    if (!thirdPoint || !fourthPoint) continue;
    const vx = fourthPoint.x - thirdPoint.x; const vy = fourthPoint.y - thirdPoint.y; const secondLength = Math.hypot(vx, vy);
    if (firstLength <= CONSTRAINT_TOLERANCE || secondLength <= CONSTRAINT_TOLERANCE) continue;
    if (constraint.kind === "parallel") addRow([{ reference: first, x: -vy, y: vx }, { reference: second, x: vy, y: -vx }, { reference: third, x: uy, y: -ux }, { reference: fourth, x: -uy, y: ux }]);
    else if (constraint.kind === "perpendicular") addRow([{ reference: first, x: -vx, y: -vy }, { reference: second, x: vx, y: vy }, { reference: third, x: -ux, y: -uy }, { reference: fourth, x: ux, y: uy }]);
    else if (constraint.kind === "equal") addRow([{ reference: first, x: -ux / firstLength, y: -uy / firstLength }, { reference: second, x: ux / firstLength, y: uy / firstLength }, { reference: third, x: vx / secondLength, y: vy / secondLength }, { reference: fourth, x: -vx / secondLength, y: -vy / secondLength }]);
  }
  return { rank: matrixRank(rows), rowCount: rows.length };
};

/** Builds the validated component-scoped input boundary consumed by the solver. */
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

/** Reports solved Jacobian rank and remaining degrees of freedom for each component. */
export function constraintDofMetadataForDocument(document: DocumentSnapshot): readonly ConstraintDofMetadata[] {
  const inputs = constraintInputsForDocument(document);
  const normalized = normalizedConstraintsForDocument(document);
  const states = deriveConstraintComponentStates(document, normalized, constraintResidualsForDocument(document), inputs);
  return inputs.map((input) => {
    const { rank } = constraintRankForInput(input);
    const status = states.find((state) => state.nodeKeys[0] === input.nodeKeys[0])?.state ?? "invalid";
    return { nodeKeys: input.nodeKeys, coordinateCount: input.coordinateCount, constraintCount: input.constraints.length, rank, degreesOfFreedom: input.coordinateCount - rank, status };
  });
}

const structuredConstraintDiagnostics = (
  normalized: readonly NormalizedConstraint[],
  states: readonly ConstraintComponentState[],
  residuals: readonly ConstraintResidual[],
  nonConvergedComponents: readonly (readonly string[])[],
): readonly ConstraintDiagnostic[] => {
  const byId = new Map(normalized.map((constraint) => [constraint.id, constraint]));
  const details = (constraintIds: readonly string[]): Pick<ConstraintDiagnostic, "constraintIds" | "referenceKeys"> => ({
    constraintIds: [...constraintIds].sort(),
    referenceKeys: [...new Set(constraintIds.flatMap((id) => byId.get(id)?.references.map(constraintNodeKey) ?? []))].sort(),
  });
  const diagnostics: ConstraintDiagnostic[] = [];
  const supportedIds = new Set(residuals.filter((residual) => residual.supported).map((residual) => residual.constraintId));
  for (const residual of residuals) {
    if (!residual.supported) diagnostics.push({ code: "unsupported-constraint", ...details([residual.constraintId]), message: "Constraint kind, references, value, or geometry is unsupported" });
    else if (!residual.satisfied) diagnostics.push({ code: "constraint-conflict", ...details([residual.constraintId]), message: "Constraint is not satisfied" });
  }
  for (const state of states.filter((candidate) => candidate.state === "overdefined")) {
    const keys = new Set(state.nodeKeys);
    const ids = normalized.filter((constraint) => supportedIds.has(constraint.id) && constraint.references.length > 0 && constraint.references.every((reference) => keys.has(constraintNodeKey(reference)))).map((constraint) => constraint.id);
    diagnostics.push({ code: "redundant-component", ...details(ids), message: "Constraint component contains redundant equations" });
  }
  for (const nodeKeys of nonConvergedComponents) {
    const keys = new Set(nodeKeys);
    const ids = normalized.filter((constraint) => supportedIds.has(constraint.id) && constraint.references.length > 0 && constraint.references.every((reference) => keys.has(constraintNodeKey(reference)))).map((constraint) => constraint.id);
    diagnostics.push({ code: "non-converged-component", ...details(ids), referenceKeys: [...nodeKeys].sort(), message: "Constraint component did not converge" });
  }
  return diagnostics.sort((first, second) => `${first.code}:${first.constraintIds.join(",")}`.localeCompare(`${second.code}:${second.constraintIds.join(",")}`));
};

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
  const invalidLocalComponents: ConstraintComponent[] = [];
  for (const component of constrainedComponents) {
    const nodeKeys = new Set(component.nodeKeys);
    const constraintIds = new Set(component.constraintIds);
    const componentGlobals = globalConstraints.filter((constraint) => constraintIds.has(constraint.id));
    const componentSketches = sketches.filter((sketch) => sketch.nodes.some((node) => nodeKeys.has(constraintNodeKey({ elementId: sketch.id, nodeId: node.id }))));
    const initialPoints = new Map(component.nodeKeys.map((key) => [key, { ...globalPoints.get(key)! }] as const));
    const seen = new Set<string>([pointMapSignature(globalPoints, nodeKeys)]);
    let componentReachedFixedPoint = false;
    let invalidLocalProjection = false;
    let componentIterations = 0;
    for (let iteration = 0; iteration < MAX_CONSTRAINT_ITERATIONS; iteration += 1) {
      componentIterations = iteration + 1;
      const localResults = componentSketches.map((sketch) => projectLocalSketchConstraints(globalPoints, sketch, constraintIds, nodeKeys));
      if (localResults.some((result) => !result.valid)) { invalidLocalProjection = true; invalidLocalComponents.push(component); break; }
      const maxProjectionDelta = Math.max(0, ...localResults.map((result) => result.delta), ...componentGlobals.map((constraint) => projectGlobalConstraint(globalPoints, constraint)));
      if (maxProjectionDelta <= CONSTRAINT_TOLERANCE) { componentReachedFixedPoint = true; break; }
      const signature = pointMapSignature(globalPoints, nodeKeys);
      if (seen.has(signature)) break;
      seen.add(signature);
    }
    iterations = Math.max(iterations, componentIterations);
    reachedFixedPoint = reachedFixedPoint && componentReachedFixedPoint;
    if (!componentReachedFixedPoint && !invalidLocalProjection) nonConvergedComponents.push(component.nodeKeys);
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
  for (const component of invalidLocalComponents) {
    const componentResiduals = residuals.filter((residual) => component.constraintIds.includes(residual.constraintId));
    if (componentResiduals.length > 0 && componentResiduals.every((residual) => residual.supported)) nonConvergedComponents.push(component.nodeKeys);
  }
  for (const residual of failedResiduals.filter((candidate) => candidate.supported)) {
    const component = components.find((candidate) => candidate.constraintIds.includes(residual.constraintId));
    const componentResiduals = component ? residuals.filter((candidate) => component.constraintIds.includes(candidate.constraintId)) : [];
    const nodeKeys = componentResiduals.some((candidate) => !candidate.supported) ? [] : component?.nodeKeys ?? [];
    if (nodeKeys.length && !nonConvergedComponents.some((current) => current.length === nodeKeys.length && current.every((key, index) => key === nodeKeys[index]))) nonConvergedComponents.push(nodeKeys);
  }
  const converged = reachedFixedPoint && failedResiduals.length === 0;
  const previewInputs = constraintInputsForDocument(preview);
  const states = deriveConstraintComponentStates(preview, normalized, residuals, previewInputs);
  const degreesOfFreedom = previewInputs.reduce((total, input) => total + input.coordinateCount - constraintRankForInput(input).rank, 0);
  const supportedIds = new Set(residuals.filter((residual) => residual.supported).map((residual) => residual.constraintId));
  const affectedElementIds = [...new Set(normalized.filter((constraint) => supportedIds.has(constraint.id)).flatMap((constraint) => constraint.references.map((reference) => reference.elementId)))].sort();
  const diagnostics = structuredConstraintDiagnostics(normalized, states, residuals, nonConvergedComponents);
  return { document: preview, changed, converged, iterations, nonConvergedComponents, degreesOfFreedom, affectedElementIds, states, residuals, diagnostics };
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
    const knownKind = ["horizontal", "vertical", "coincident", "parallel", "perpendicular", "equal", "distance-horizontal", "distance-vertical", "distance", "angle", "fixed"].includes(constraint.kind) && !(constraint.scope === "document" && !supportsDocumentConstraintKind(constraint.kind));
    if (!valid || !knownKind || values.length !== expected || values.some((value) => !isPoint(value)) || usesValue && (!Number.isFinite(constraint.value) || constraint.value === undefined || constraint.value <= 0) || !usesValue && constraint.value !== undefined) return { constraintId: constraint.id, residual: Number.POSITIVE_INFINITY, satisfied: false, supported: false };
    const first = values[0]!; const second = values[1];
    if (constraint.kind === "fixed") return { constraintId: constraint.id, residual: Math.hypot(first.x, first.y), satisfied: Math.hypot(first.x, first.y) <= tolerance, supported: true };
    const dx = second!.x - first.x; const dy = second!.y - first.y; const directionLength = Math.hypot(dx, dy); const requiresDirection = constraint.kind !== "coincident";
    const ambiguousAxisDistance = constraint.kind === "distance-horizontal" && Math.abs(dx) <= tolerance || constraint.kind === "distance-vertical" && Math.abs(dy) <= tolerance;
    if (requiresDirection && directionLength <= tolerance || ambiguousAxisDistance) return { constraintId: constraint.id, residual: Number.POSITIVE_INFINITY, satisfied: false, supported: false };
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

const deriveConstraintComponentStates = (document: DocumentSnapshot, normalized: readonly NormalizedConstraint[], residuals: readonly ConstraintResidual[], componentInputs: readonly ConstraintComponentInput[]): readonly ConstraintComponentState[] => {
  const sketches = document.elements.filter((element): element is Extract<Element, { type: "sketch" }> => element.type === "sketch");
  const inputs = new Map(componentInputs.map((input) => [input.nodeKeys[0], input]));
  return constraintComponentsForDocument(document).map((component) => {
    const nodeKeys = new Set(component.nodeKeys);
    const componentConstraints = normalized.filter((constraint) => component.constraintIds.includes(constraint.id));
    const componentResiduals = residuals.filter((residual) => component.constraintIds.includes(residual.constraintId));
    const localStates = sketches.flatMap((sketch) => {
      const constraints = (sketch.constraints ?? []).filter((constraint) => component.constraintIds.includes(constraintIdentity("local", sketch.id, constraint.id)));
      if (!constraints.length) return [];
      const nodes = sketch.nodes.filter((node) => nodeKeys.has(constraintNodeKey({ elementId: sketch.id, nodeId: node.id })));
      const nodeIds = new Set(nodes.map((node) => node.id));
      const edges = sketch.edges.filter((edge) => nodeIds.has(edge.startNodeId) && nodeIds.has(edge.endNodeId));
      const solved = solveSketchConstraints({ ...sketch, nodes, edges, constraints });
      return [{ ownerId: sketch.id, state: solved.status === "defined" ? "fully-defined" as const : solved.status, conflicts: solved.conflicts }];
    });
    const globalIds = new Set(componentConstraints.filter((constraint) => constraint.scope === "document").map((constraint) => constraint.id));
    const unsupported = componentResiduals.filter((residual) => !residual.supported);
    const unsatisfiedGlobal = componentResiduals.filter((residual) => globalIds.has(residual.constraintId) && residual.supported && !residual.satisfied);
    const input = inputs.get(component.nodeKeys[0]);
    const analysis = input ? constraintRankForInput(input) : { rank: 0, rowCount: 0 };
    const degreesOfFreedom = (input?.coordinateCount ?? component.nodeKeys.length * 2) - analysis.rank;
    const redundant = analysis.rowCount > analysis.rank;
    const diagnostics = [
      ...localStates.flatMap((value) => value.conflicts.map((conflict) => `${value.ownerId}:${conflict}`)),
      ...unsupported.map((residual) => `${globalIds.has(residual.constraintId) ? "global" : "local"}-constraint-unsupported:${residual.constraintId}`),
      ...unsatisfiedGlobal.map((residual) => `global-constraint-conflict:${residual.constraintId}`),
      ...localStates.filter((value) => value.state === "overdefined").map((value) => `${value.ownerId}:overdefined`),
      ...(redundant ? ["component:overdefined"] : []),
    ].sort();
    const state: ConstraintState = unsupported.length ? "invalid"
      : unsatisfiedGlobal.length || localStates.some((value) => value.state === "conflict") ? "conflict"
        : redundant || localStates.some((value) => value.state === "overdefined") ? "overdefined"
          : degreesOfFreedom === 0 ? "fully-defined"
            : "underdefined";
    return { nodeKeys: component.nodeKeys, state, diagnostics };
  });
};

/** Derives component-scoped diagnostics without persisting solver output. */
export function constraintComponentStatesForDocument(document: DocumentSnapshot): readonly ConstraintComponentState[] {
  return deriveConstraintComponentStates(document, normalizedConstraintsForDocument(document), constraintResidualsForDocument(document), constraintInputsForDocument(document));
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
