---
name: nodra-rendering-performance
description: "Trigger: Nodra rendering, SVG, performance, escaping, viewport, frame rate. Keep rendering one-way, safe, and measured."
license: Apache-2.0
metadata:
  author: "nodra-maintainers"
  version: "1.0"
---

## Activation Contract
Load for SVG output, render cost, viewport updates, escaping, or performance review. Read `packages/renderer-svg/src/index.ts`, `App.tsx`, and the performance reference first.

## Hard Rules
- Render a validated snapshot one way to SVG; never mutate the source document.
- Escape generated SVG values/content and preserve layer visibility/order semantics.
- Keep viewport interaction separate from document persistence; Preview != persistent document.
- Classify a structurally invalid document with a supported schema version as `invalid`; reserve `unsupported` for unsupported schema versions or features. Derive supported-version guidance from the repository constant/set rather than hardcoding the current number.
- Do not claim Canvas/WebGL/workers or install rendering libraries without evidence.
- Measure before adding memoization, indexing, batching, or workers.

## Decision Gates
| Signal | Action |
|---|---|
| Correctness/security issue | fix validation/escaping first |
| Repeated render cost | profile, then narrow the hot path |
| Main-thread blocking | evaluate worker suitability after measurement |
| Format requirement | define import/export boundary before parser choice |

## Execution Steps
1. Capture a reproducible workload and baseline.
2. Verify snapshot classification, escaping, transforms, and viewport conversion.
3. Check malformed/edge inputs and focused rendering tests, including regression coverage for both `invalid` and `unsupported`; optimize only the measured bottleneck and add regression evidence.

## Output Contract
Return baseline, bottleneck, chosen change, rejected premature abstractions, and tests.

## References
- [Rendering performance](references/rendering-performance.md)
