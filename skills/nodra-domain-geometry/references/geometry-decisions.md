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

Cutting uses the true finite segment intersection and is destructive for the clicked segment: it may open closed sketches or convert a contour ring to an open path. Intersecting sketch edges and supported external line geometry receive split nodes in the same atomic command, while unrelated geometry is preserved. Sketch-edge dimension references resolve stable `edgeId` values before legacy indexes; surviving replacements are mapped explicitly and dependents of removed topology are cleaned atomically. Cross-object dimensions use stable node references and drive the second node for aligned/horizontal/vertical edits. Cut supports an exact Bézier vertical slice: a cubic segment in an open path crossed once by one visible native line or one-edge sketch removes the clicked curve side and its continuation toward that path endpoint, preserves the opposite prefix or suffix with De Casteljau, and splits the crossing line atomically. Closed Bézier paths, multiple curve intersections, Bézier-Bézier cuts, and rounded rectangle boundaries remain unsupported.

Evaluate candidates by browser/TypeScript compatibility, license, maintenance, precision, bundle impact, performance, worker suitability, and API fit. Numeric robustness requires finite inputs, explicit tolerances, stable rotation conventions, and tests around boundaries; do not round model values for display concerns.
