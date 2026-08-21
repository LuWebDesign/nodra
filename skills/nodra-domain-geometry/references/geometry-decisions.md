# Domain and geometry decisions

The domain currently has schemaVersion 3, stable branded IDs, revisions, pages/layers, rectangle/ellipse/line elements, styles, and inert laser operation metadata. Coordinates and sizes are millimetres with a top-left origin. Geometry provides bounds, rotation, hit testing, viewport conversion, resize handles, and selection helpers. Validation uses Zod and migrations.

| Area | Current solution | Candidate to evaluate | Use when | Do not use when |
|---|---|---|---|---|
| Geometry | Local TypeScript functions | Paper.js, Clipper2, Maker.js | Measured feature/precision gap exists | A helper is sufficient |
| Rendering | One-way validated snapshot -> escaped SVG | Canvas/WebGL | SVG measurement proves a bottleneck | Replacing a clear SVG projection prematurely |
| Storage | Dexie IndexedDB revisions | Other storage | Product requirements change | To bypass repository contract |
| Heavy computation | Main thread | Web Worker | Profiling shows blocking work | Before measurable need |
| Spatial indexing | Direct geometry queries | RBush | Dataset/query scale proves need | As speculative abstraction |
| Import/export | None installed | DXF/PDF parsers | A defined boundary and format exist | Inferring or installing one now |

Evaluate candidates by browser/TypeScript compatibility, license, maintenance, precision, bundle impact, performance, worker suitability, and API fit. Numeric robustness requires finite inputs, explicit tolerances, stable rotation conventions, and tests around boundaries; do not round model values for display concerns.
