# Rendering and performance

`renderer-svg` is a one-way validated snapshot-to-SVG projection with escaping and no source mutation. The web currently renders the document and applies viewport transforms in the composition layer. There are no product Web Workers, Canvas/WebGL renderer, or import/export flow.

| Area | Current solution | Candidate to evaluate | Use when | Do not use when |
|---|---|---|---|---|
| Rendering | escaped SVG | Canvas/WebGL | profiled SVG bottleneck requires it | for assumed scale |
| Heavy computation | synchronous TypeScript | Web Worker | measured blocking, transferable data/API fit | to hide unclear ownership |
| Spatial queries | geometry functions | RBush | measured query volume warrants index | for small documents |
| Import/export | none | DXF/PDF parser | format and trust boundary are specified | by assumption |

Evaluate candidates for browser/TypeScript compatibility, license, maintenance, precision, bundle impact, performance, worker suitability, and API fit. Known finding: renderer schema classification needs a deliberate schema 3 versus invalid-input policy; treat this as a finding, not a fix in an audit.
