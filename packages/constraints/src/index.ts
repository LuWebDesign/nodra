import type {
  CircleConstraintKind,
  DocumentSnapshot,
  Element,
  ElementId,
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

export interface ConstraintComponentState {
  readonly nodeKeys: readonly string[];
  readonly state: ConstraintState;
  readonly diagnostics: readonly string[];
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

/** Derives component diagnostics from native sketch solvers without persisting solver output. */
export function constraintComponentStatesForDocument(document: DocumentSnapshot): readonly ConstraintComponentState[] {
  const sketches = document.elements.filter((element): element is Extract<Element, { type: "sketch" }> => element.type === "sketch");
  const normalized = normalizedConstraintsForDocument(document);
  return constraintComponentsForDocument(document).map((component) => {
    const nodeKeys = new Set(component.nodeKeys);
    const involved = sketches.filter((sketch) => sketch.nodes.some((node) => nodeKeys.has(constraintNodeKey({ elementId: sketch.id, nodeId: node.id }))));
    const globalIds = normalized.filter((constraint) => constraint.scope === "document" && constraint.references.some((reference) => nodeKeys.has(constraintNodeKey(reference)))).map((constraint) => constraint.id);
    const canUseNativeSolver = globalIds.length === 0 && involved.length === 1 && involved[0]!.nodes.length === component.nodeKeys.length;
    const localStates = canUseNativeSolver ? [sketchAdapter.state(involved[0]!)] : [];
    const diagnostics = [...localStates.flatMap((state) => state.conflicts.map((conflict) => `${involved[0]!.id}:${conflict}`)), ...(globalIds.length ? globalIds.map((id) => `global-constraint-requires-component-solver:${id}`) : []), ...(!canUseNativeSolver && component.constraintIds.length ? ["component-solver-pending"] : [])].sort();
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
