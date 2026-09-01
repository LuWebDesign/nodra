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
