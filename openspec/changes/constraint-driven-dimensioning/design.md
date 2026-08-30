# Design: Constraint-driven dimensioning

## Decision

Store constraints on sketch-like geometry as explicit domain data and solve only a bounded deterministic subset in the first slice. Keep dimensions as persisted annotations with optional driving metadata; do not infer constraints from visual proximity.

## Model

A constraint has an id, kind, references, and optional driving dimension value. References use stable element/node identifiers where available. Legacy dimensions continue resolving by node index.

Initial relation kinds:

- `horizontal` and `vertical`: one segment or two endpoint references;
- `coincident`: two point references;
- `distance-horizontal` and `distance-vertical`: two point references and a positive millimeter value;
- `fixed`: one point reference to the document origin.

Constraint status is derived, never stored: `underdefined`, `defined`, `conflict`, or `overdefined`.

## Solver boundary

The first solver accepts a sketch/rectangle graph with finite coordinates, applies explicit relations in deterministic id order, and returns either a preview document plus status or a rejection reason. It MUST reject cycles and unsupported geometry rather than guess. Preview uses the existing editor gesture base and commits once.

A future general solver may replace the bounded implementation behind the same result contract.

## Dimension editing

Double-click opens a millimeter editor. The editor dispatches a validated command. Horizontal/vertical rectangle dimensions remain the first driving implementation. The command preserves the rectangle center, rejects rotated/ambiguous targets, and leaves the document unchanged on failure.

## State and rendering

The solver result maps to visual state: blue underdefined, black defined, red conflict, yellow overdefined. Renderer and UI consume the same result; neither calculates state independently.

## Sequence

```text
pointer/double-click -> web draft -> editor-core command -> validation
                                      -> bounded solver -> preview/result
                                      -> commit history + persistence
renderer/UI <- immutable solver status and document
```

## Decisions deferred

- Arc parameterization and tangent solving.
- General nonlinear constraint solving.
- Automatic constraint inference.
- Persistence migration for a future `constraints` collection until the first domain shape is finalized.
