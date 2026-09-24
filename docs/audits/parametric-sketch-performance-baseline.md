# WU11-C1 package performance measurements

Status: measurement harness and report repaired; WU11-C1 remains pending independent verification and commit. These are machine-specific package/API measurements, not product targets or browser latency claims.

## Method and scope

The fixed deterministic workloads in `packages/constraints/src/solver.bench.ts` and `packages/editor-core/src/performance-baseline.bench.ts` are run as ordinary modules through Vitest's existing `vite-node` runner, not Vitest's adaptive `bench()` harness. Vitest bench repeatedly invokes callbacks adaptively and reports its own sample set, so it cannot represent one bounded custom sample batch per task. The supported `vite-node` approach executes each selected module once; command: `corepack pnpm exec vite-node --config vitest.config.ts <bench-file>`. No dependencies or normal test discovery were changed.

Each case executes 20 unmeasured warmups and exactly 100 timed API calls. Timings use `performance.now()` around only the named API call. Percentiles use nearest rank (`sorted[ceil(p*n)-1]`) for p50, p95, and p99. There are no latency assertions. SVG rendering and UTF-8 byte counting are performed outside timed sections. Solver convergence, iteration count, component count, diagnostic count, and non-converged component count are sampled outside timed sections. The preview timing encloses the complete sequence `createEditor → beginGesture → moveElements → previewGestureFromBase`; it is not an isolated preview solve. The commit timing encloses that same sequence plus `commitGesture`; it is not an isolated commit solve. Solver and renderer rows likewise name the measured public API operations (`solveConstraintComponents` and `renderSvg generation`), not isolated internal phases. The solver scale is independent 2-node sketches, each with one horizontal constraint. Editor and SVG scale is deterministic native lines. This does not measure browser pointermove, rendering to DOM, or frame scheduling.

## Custom samples (observed)

Observed on Windows 10 (build 26200), x64, AMD Ryzen 7 5700G with Radeon Graphics, Node v24.14.0, Vitest 3.2.4. The recorded base revision is `1eb9559dd8cb740a8bddddf5f892d583c457a02d` (`git rev-parse HEAD`) before this correction; benchmark/audit changes were uncommitted during collection. Values are milliseconds; all cases have 20 warmups and 100 timed samples. Reported percentiles below are exclusively the custom measured arrays, not Vitest's benchmark output.

| API | Scale | p50 | p95 | p99 | Additional observed output |
|---|---:|---:|---:|---:|---|
| `solveConstraintComponents` | 10 components | 0.5422 | 0.9459 | 1.2742 | converged; 2 iterations; 10 components; 0 diagnostics; 0 non-converged |
| `solveConstraintComponents` | 50 components | 5.1497 | 7.1976 | 8.8913 | converged; 2 iterations; 50 components; 0 diagnostics; 0 non-converged |
| `solveConstraintComponents` | 100 components | 14.4373 | 15.6658 | 19.7333 | converged; 2 iterations; 100 components; 0 diagnostics; 0 non-converged |
| `renderSvg generation` | 10 lines | 0.1104 | 0.1711 | 0.2253 | SVG: 1,868 UTF-8 bytes; 10 rendered elements |
| `renderSvg generation` | 50 lines | 0.2247 | 0.3178 | 0.3459 | SVG: 8,988 UTF-8 bytes; 50 rendered elements |
| `renderSvg generation` | 100 lines | 0.4681 | 0.8504 | 1.0371 | SVG: 17,908 UTF-8 bytes; 100 rendered elements |
| `editor preview flow (createEditor → beginGesture → moveElements → previewGestureFromBase)` | 10 lines | 0.0442 | 0.0686 | 0.0980 | 10 selected elements |
| `editor preview flow (createEditor → beginGesture → moveElements → previewGestureFromBase)` | 50 lines | 0.1783 | 0.3020 | 0.5157 | 50 selected elements |
| `editor preview flow (createEditor → beginGesture → moveElements → previewGestureFromBase)` | 100 lines | 0.1913 | 0.2828 | 0.3593 | 100 selected elements |
| `editor commit flow (createEditor → beginGesture → moveElements → previewGestureFromBase → commitGesture)` | 10 lines | 0.0465 | 0.0662 | 0.0945 | 10 selected elements |
| `editor commit flow (createEditor → beginGesture → moveElements → previewGestureFromBase → commitGesture)` | 50 lines | 0.1005 | 0.1646 | 0.2705 | 50 selected elements |
| `editor commit flow (createEditor → beginGesture → moveElements → previewGestureFromBase → commitGesture)` | 100 lines | 0.2083 | 0.3031 | 0.3442 | 100 selected elements |

## Vitest bench output versus custom measurements

`vitest bench` is not the source of the table above. Its adaptive callback counts and p75/p99 summary are a separate harness measurement and cannot be labeled as the fixed 100-sample custom protocol. The first attempted run demonstrated this mismatch, so the report uses the existing `vite-node` execution path for exactly-once module execution and records only observed custom sample output. Do not compare historical Vitest bench means/p99 against these custom percentiles as if they used the same protocol.

## Interpretation limits

No universal baseline or latency threshold is asserted. These values describe one observed machine/run and fixed public API workloads only. They do not establish end-to-end UI responsiveness, pointer delivery cost, rendering-frame cost, or isolated commit-only cost. No product source or behavior changed.
