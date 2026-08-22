# Bézier V1 implementation plan

This branch adds a small, additive Bézier path model without changing the schema version or the legacy contour format. The review path is domain and validation first, geometry second, renderer third, and editor commands last.

## Quick path

1. Review the canonical `PathElement` model and its topology checks.
2. Review geometry tests for cubic evaluation, exact bounds, splitting, flattening, and hit testing.
3. Review SVG output and editor command/history tests.

## Decisions

| Area | V1 decision |
|---|---|
| Units | Millimetres, top-left origin, with finite coordinates only. |
| Compatibility | `type: "path"` is additive; schema version remains 3 and existing contours remain unchanged. |
| Model | Ordered nodes own anchors and join modes. Segments own line/cubic controls; controls are not duplicated as node handles. |
| Geometry | Cubic evaluation and derivatives are analytic. Bounds use derivative roots; flattening is adaptive De Casteljau subdivision. |
| Rendering | Validated snapshots render one-way to escaped SVG `M`, `L`, `C`, and `Z`, preserving existing layer and viewport behavior. |
| Editing | Discrete path commands use existing validation, revision, no-op, selection, undo, and redo semantics. |
| Rejected scope | No pen UI, NURBS, CAD constraints, workers, spatial indexes, or dependencies. |

## Invariants

- An open path has at least two nodes and `nodes.length - 1` segments.
- A closed path has at least three nodes and one segment per node; the final segment connects the last node to the first.
- Node IDs are non-empty and unique within a path.
- Every point, control, and numeric document field is finite.
- Legacy contours continue to use their existing closed-ring representation.

## Algorithm notes

Exact cubic bounds evaluate the endpoints and roots of each coordinate derivative. Splitting uses De Casteljau interpolation, preserving two equivalent cubic segments. Adaptive flattening subdivides until both interior controls are within tolerance of the chord, with a finite recursion cap. Hit testing uses flattened segments for tolerance and the existing point-in-ring approach for closed-path fill.

The local implementation is preferred over Paper.js, Maker.js, or another dependency: it keeps package boundaries and serialization explicit, has no bundle or lockfile cost, and is reversible if measured requirements later exceed these helpers. A worker or spatial index is intentionally deferred until profiling demonstrates a bottleneck.

## Review checklist

- [ ] Domain types are additive and canonical.
- [ ] Validation rejects malformed topology, duplicate node IDs, and non-finite geometry.
- [ ] Geometry tests cover normal, boundary, degenerate, and tolerance cases.
- [ ] Renderer tests cover path commands, escaping, hidden layers, and classification.
- [ ] Editor tests cover creation, node/handle edits, split, open/close, reverse, join mode, no-op, and undo/redo.
- [ ] No UI, persistence, dependency, generated-output, or unrelated changes are included.

## Verification

The clean checkout has Node 24 available but no `pnpm` executable and no installed `node_modules`. Therefore package-manager checks are recorded as unavailable rather than substituted with an installation or dependency change.
