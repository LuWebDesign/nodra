# Domain and geometry decisions

The domain currently has schemaVersion 7, stable branded IDs, revisions, pages/layers, rectangle/ellipse/line/sketch/dimension elements, styles, and inert laser operation metadata. Coordinates and sizes are millimetres with a top-left origin. Geometry provides bounds, rotation, hit testing, viewport conversion, resize handles, selection helpers, and deterministic sketch-constraint solving. Validation uses Zod and migrations.

| Area | Current solution | Candidate to evaluate | Use when | Do not use when |
|---|---|---|---|---|
| Geometry | Local TypeScript functions | Paper.js, Clipper2, Maker.js | Measured feature/precision gap exists | A helper is sufficient |
| Rendering | One-way validated snapshot -> escaped SVG | Canvas/WebGL | SVG measurement proves a bottleneck | Replacing a clear SVG projection prematurely |
| Storage | Dexie IndexedDB revisions | Other storage | Product requirements change | To bypass repository contract |
| Heavy computation | Main thread | Web Worker | Profiling shows blocking work | Before measurable need |
| Spatial indexing | Direct geometry queries | RBush | Dataset/query scale proves need | As speculative abstraction |
| Import/export | None installed | DXF/PDF parsers | A defined boundary and format exist | Inferring or installing one now |

Sketches are graphs of stable nodes and edges. Native path and glyph segments also carry stable IDs; reverse and geometric edits preserve them, while split or reconstruction creates replacement IDs explicitly. Path split, node deletion, opening, and cutting expose ephemeral `preserved`/`replaced`/`removed` maps; planar cut reconstruction maps outputs from source segment identity rather than coordinate matching. Shared nodes preserve topology; constraints express design intent. Current solver relations include horizontal, vertical, coincident, perpendicular, parallel, equal, distance, angle, and fixed, with four node references for line-pair relations. Inferred relations are only added for clearly axis-aligned or orthogonal geometry; free-angle segments remain unconstrained.

Cutting a sketch edge at a crossing uses the true finite segment intersection, creates a split node, and preserves the other geometry. Sketch-edge dimension references resolve stable `edgeId` values before legacy indexes; splitting remaps a referenced edge to the first replacement, while deleting it removes the dependent dimension atomically. The cut command modifies only the clicked geometry. Cross-object dimensions use stable node references and drive the second node for aligned/horizontal/vertical edits.

Evaluate candidates by browser/TypeScript compatibility, license, maintenance, precision, bundle impact, performance, worker suitability, and API fit. Numeric robustness requires finite inputs, explicit tolerances, stable rotation conventions, and tests around boundaries; do not round model values for display concerns.
