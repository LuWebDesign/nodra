import {
  createDocument,
  elementId,
  layerId,
  withElements,
  type DocumentConstraint,
  type Element,
  type SketchConstraint,
  type SketchEdge,
  type SketchElement,
  type SketchNode,
  type VisualStyle,
} from "@nodra/domain";

export interface SketchFixtureOptions {
  readonly id?: string;
  readonly nodes?: readonly SketchNode[];
  readonly edges?: readonly SketchEdge[];
  readonly constraints?: readonly SketchConstraint[];
}

export const fixtureLayer = () => ({ id: layerId("constraints"), name: "Croquis", visible: true, order: 0 } as const);
export const fixtureStyle = (): VisualStyle => ({ stroke: "#111827", strokeWidth: 1 });

const cloneConstraints = (constraints: readonly SketchConstraint[]): readonly SketchConstraint[] => structuredClone(constraints);
const isConstraintList = (value: SketchFixtureOptions | readonly SketchConstraint[]): value is readonly SketchConstraint[] => Array.isArray(value);

/** Builds a deterministic sketch fixture without sharing mutable nested records. */
export function sketch(options?: SketchFixtureOptions): SketchElement;
export function sketch(constraints?: readonly SketchConstraint[]): SketchElement;
export function sketch(optionsOrConstraints: SketchFixtureOptions | readonly SketchConstraint[] = {}): SketchElement {
  const options = isConstraintList(optionsOrConstraints) ? { constraints: optionsOrConstraints } : optionsOrConstraints;
  const { id = "sketch", nodes, edges, constraints = [] } = options;
  return {
    type: "sketch",
    id: elementId(id),
    layerId: layerId("constraints"),
    nodes: (nodes ?? [
      { id: "a", point: { x: 10, y: 10 } },
      { id: "b", point: { x: 30, y: 10 } },
    ]).map((node) => ({ ...node, point: { ...node.point } })),
    edges: (edges ?? [{ id: "ab", startNodeId: "a", endNodeId: "b" }]).map((edge) => ({ ...edge })),
    constraints: cloneConstraints(constraints),
    style: fixtureStyle(),
  };
}

/** Creates a domain document using the current schema and preserves optional page constraints. */
export const documentWith = (elements: readonly Element[], constraints?: readonly DocumentConstraint[]) => {
  const document = withElements(createDocument("constraint-state", [fixtureLayer()]), elements);
  return constraints && constraints.length > 0 ? { ...document, constraints: structuredClone(constraints) } : document;
};
