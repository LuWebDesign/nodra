# Bézier Path V1

## Outcome

V1 adds an additive `path` element without changing legacy contour persistence. A path stores ordered anchors and ordered segments; cubic controls live only on cubic segments.

## Contracts

- Documents remain schema 3, millimetres, and top-left origin.
- Nodes have stable IDs, anchors, and `corner`, `smooth`, or `symmetric` joins.
- Open paths contain `nodes - 1` contiguous segments; closed paths contain `nodes` segments, including the final-to-first segment.
- Validation rejects non-finite values, duplicate or unknown IDs, broken ordering, and invalid topology.

## Geometry and projection

The geometry package owns cubic evaluation, derivatives, exact extrema bounds, De Casteljau splitting, adaptive flattening, hit testing, bounds, and derived anchor/control nodes. The SVG renderer projects validated paths as escaped `M`, `L`, `C`, and optional `Z` commands while preserving layer order and visibility.

## Editing

Editor-core owns path creation, node and handle movement, splitting, opening, closing, reversing, and join-mode commands. Moving an anchor translates adjacent cubic controls. Commands use the existing validation, revision, no-op, gesture, and history contracts.

## Explicit non-goals

Full pen tooling, NURBS, CAD constraints, workers, spatial indexes, and new dependencies are outside V1.

## Review checklist

- [ ] Legacy contours still validate and render unchanged.
- [ ] Cubic extrema and split preservation are covered by focused tests.
- [ ] Open/closed topology and reverse operations preserve canonical ordering.
- [ ] Node movement synchronizes adjacent controls.
- [ ] Join modes produce the documented tangent relationships.
- [ ] Invalid supported-schema documents are classified separately from unsupported schema/features.
