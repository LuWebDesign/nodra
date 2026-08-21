---
name: nodra-domain-geometry
description: "Trigger: Nodra domain, geometry, mm, hit testing, bounds, handles, numeric robustness. Protect model invariants and coordinate semantics."
license: Apache-2.0
metadata:
  author: "nodra-maintainers"
  version: "1.0"
---

## Activation Contract
Load for model fields, coordinates, transforms, bounds, rotation, hit testing, handles, or viewport conversion. Read domain/geometry exports and `references/geometry-decisions.md` first.

## Hard Rules
- Use mm coordinates with a top-left origin; do not silently convert model units.
- Keep stable branded IDs, schemaVersion 3, revisions, pages/layers, and element discriminants intact.
- Keep domain != geometry != renderer/UI responsibilities.
- Do not install or infer libraries; candidates are not selected dependencies.
- Preview != persistent document and no premature spatial index/worker abstraction.

## Decision Gates
| Need | Current choice |
|---|---|
| Model truth | domain types and validation |
| Bounds/hit/handles | geometry functions |
| Rendering projection | renderer-svg |
| Large-scale acceleration | measure first; evaluate an index later |

## Execution Steps
1. State the invariant and coordinate frame.
2. Handle finite values, zero/negative dimensions, rotation, and tolerance explicitly.
3. Add focused numeric tests before optimizing.

## Output Contract
Return changed invariant, units/tolerance assumptions, edge cases, and tests.

## References
- [Geometry decisions](references/geometry-decisions.md)
