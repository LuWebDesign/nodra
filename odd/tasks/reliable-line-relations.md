# Reliable line relations

## Goal

Improve the existing 2D Sketch line lifecycle by closing only demonstrated gaps across relation creation, persisted feedback, editing, history, and reload behavior. Preserve the current Sketch Kernel, stable IDs, validation, and solver boundaries.

## Scope

- Relations: horizontal, vertical, coincidence, midpoint, parallel, perpendicular, equal, supported length/angle dimensions, origin anchoring, and construction roles.
- Explicit application is valid; do not infer every relation.
- No 3D, curves, JogLine, solver replacement, proprietary implementation, or generated-output edits.
- Topology split/delete policy remains deferred until core creation and editing are stable.

## Preserved working tree

- `tests/e2e/app.smoke.spec.ts`
- `NUL`
- `odd/tasks/line-irregular-closure.md`
- `odd/tasks/ghidra-mcp-user-install.md`
- `odd/tasks/ilspy-user-install.md`
- `odd/tasks/ilspycmd-user-install.md`

## Tasks

- [x] **A1 — Audit the relation lifecycle matrix.** Classified current source evidence as proven working, unsupported, or missing coverage. Confirmed that the midpoint state/rank discrepancy is only a hypothesis. Evidence: read-only audit on `experiment/sketch-tool-study` at `bfdf3301019c8ce4a777f93ad0c516e5447722a3`; no commit because the handoff explicitly withheld commit authority.
- [x] **B1 — Render persisted parallel and equal relation feedback.** Added editor-only `∥` and `=` glyphs derived from stable edge references, with accepted legacy four-node references retained. Glyphs anchor to the target edge and inherit existing cross-sketch ownership, hidden-layer omission, export omission, escaping, and pointer-event behavior. RED: focused renderer test reported 31 passed / 1 failed before implementation. GREEN: 32 passed. Touched: `packages/renderer-svg/src/index.ts`, `packages/renderer-svg/src/index.test.ts`. No commit because the handoff explicitly withheld commit authority.
- [x] **B2 — Verify the first slice and reassess the matrix.** Delegated verification passed: focused renderer 32/32, root lint exit 0, root typecheck exit 0. An initial typecheck found two TS2322 fixture tuple errors; fixture-only `as const` corrections were applied and independently reverified. Full unit, E2E, and build gates remain pending until a broader candidate is ready.
- [x] **C1 — Preserve accepted relations when committing into an existing piece.** Reproduced the early-return loss with an accepted cross-sketch parallel constraint: RED was 9 passed / 1 failed because the project page omitted the accepted relation. The existing-piece branch now synchronizes through `projectFromDocument`, assigns the new sketch `pieceId`, and restores the prior piece state/sketch references. GREEN: focused store tests 10/10. Touched: `apps/web/src/stores.ts`, `apps/web/src/stores.test.ts`. No commit because the handoff explicitly withheld commit authority.
- [x] **C2 — Verify existing-piece relation synchronization.** Combined focused renderer/store tests passed 42/42; root lint and root typecheck passed. Initial typecheck found one TS2322 fixture tuple error; a fixture-only `as const` correction was independently reverified. Store-level proof exercises the accepted relation command and project association boundary, so browser coverage was not added for this bounded synchronization fix.
- [x] **C3 — Add lifecycle coverage without inventing a defect.** Retracted the proposed project/document mapping defect after full-flow review. Added deterministic coverage showing a persisted parallel edge relation survives an accepted endpoint edit (`{ x: 12, y: 0 }`), undo restores the exact post-relation baseline, and redo restores the exact edited document. Added repository round-trip coverage for explicit parallel/equal relation IDs, kinds, and stable edge references. Baseline 241 tests; post-edit 243 tests. Touched tests only: `packages/editor-core/src/index.test.ts`, `packages/persistence/src/index.test.ts`.
- [x] **C4 — Verify relation edit and reload coverage.** Delegated focused verification passed 243/243 (editor-core 221, persistence 22), root lint passed, and root typecheck passed. Separate-node coincident edit/reload remains missing coverage; no failure or source defect was claimed.
- [x] **V1 — Run the complete repository quality gates.** Root gates passed in CI order: lint exit 0; typecheck exit 0; unit tests 40 files / 783 passed; E2E 91 passed / 1 skipped with the pre-existing dirty `tests/e2e/app.smoke.spec.ts` included; build exit 0. No retries, flakes, or tooling failures were reported. Build warning: minified JS chunk 1,079.10 kB exceeds Vite's 500 kB warning threshold. Final Git status contained no generated or unexpected changes.
- [x] **E1 — Map bounded browser-closure reachability.** Current UI can create cross-sketch parallel/equal relations by drawing separate sketches, selecting both sketch edges in Forma, applying the inspector relation, and confirming the preview. A disposable project/piece can isolate browser state. The UI has no evidenced layer visibility control or SVG export action, so browser hide/show and actual export omission cannot be claimed; close those mechanisms with explicit renderer unit regressions. Existing second-sketch association uses the store boundary fixed in C1. No test-only runtime globals or persistence seeding will be added.
- [x] **E2 — Close inherited-only unit evidence.** Added explicit cross-sketch parallel/equal ownership, target placement, hidden-owner, restored-editor, and export-omission regressions plus store preservation/no-op integrity cases. Focused RED reproduced parallel/equal glyphs anchored on the first owner edge (`translate(5 0)`) instead of the second target (`translate(20 5)`): 42 passed / 1 failed. Minimal GREEN now prefers the resolved second edge/pair with first-edge fallback, without changing perpendicular placement. Independent verification passed 43/43 plus typecheck; store coverage directly preserves prior+new constraints, prior refs/state, second-sketch `pieceId`, and unrelated page/piece deep equality. Missing-sketch association is verified as an exact no-op.
- [x] **E3 — Exercise browser-visible relation and lifecycle paths.** Added supported-UI Playwright coverage in `tests/e2e/line-relations.spec.ts`. Each relation creates one disposable project and one piece, draws two distinct single-edge sketches, applies parallel/equal through Forma and inspector confirmation, and verifies one readable browser DOM glyph with stable owner, relation ID, label, and target-midpoint placement. Undo/redo, reload recovery with stable IDs, and parallel source-endpoint movement with retained feedback pass. Independent focused run: 3 passed (setup + 2 tests), 0 failed/skipped/retried. Artifacts: `test-results/line-relations-cross-sketc-7812e-ves-history-and-persistence-workflow-chromium/parallel-created.png`, `parallel-edited.png`; `test-results/line-relations-cross-sketc-84472-ves-history-and-persistence-workflow-chromium/equal-created.png`. Browser reload proves recovery/reconstruction after stable UI revision, not official repository-save completion; package tests own durable repository round-trip. Browser layer hide/show and SVG export remain unsupported by current UI and are covered only at renderer unit boundary.
- [x] **E4 — Verify and close the normalized candidate.** All normalized checks passed in order: focused Vitest 4 files / 286 passed; focused Playwright 3 passed (setup + 2 relation cases); root lint exit 0; root typecheck exit 0; root unit tests 40 files / 784 passed; root E2E 93 passed / 1 pre-existing angular-Cota skip, with no retries/flakes; root build exit 0; `git diff --check` clean. Vite still reports an unattributed 1,079.05 kB chunk warning. Independent structural review found no blocking candidate-caused issue or scope creep. Final browser limits remain explicit: no UI layer hide/show or SVG export controls, no direct DOM piece-association identity, and reload proves recovery after stable UI revision rather than official repository-write completion. Package repository tests independently cover durable relation round-trip. At this verification boundary the candidate was uncommitted; the user subsequently authorized a bounded Conventional Commit and ordinary push of only the listed candidate paths to the current feature branch.
- [ ] **D1 — Define topology mutation policy after A–C.** Deferred to a later bounded candidate to protect review focus. Test each supported relation’s preserve/reassign/remove behavior for split/delete before implementation; reject dangling IDs and blanket dropping.

## Audit summary

| Relation/case | Proven current behavior | Confirmed gap or missing evidence |
| --- | --- | --- |
| Horizontal / vertical | Inferred creation, solver/rank path, glyph | Edit/drag and full history/reload coverage missing |
| Coincidence, shared node | Shared topology model exists | Dedicated lifecycle evidence missing; do not add redundant relation |
| Coincidence, separate nodes | Explicit relation and solver path | Edit/feedback/reload coverage missing |
| Midpoint | Inference, solve, glyph, persistence fixture | Adapter-state/rank discrepancy not reproduced; edit coverage incomplete |
| Parallel | Explicit relation and solver/rank path | Persisted glyph absent; lifecycle coverage incomplete |
| Perpendicular | Inference, explicit relation, solver/rank path, glyph | Full edit/history/reload coverage missing |
| Equal | Explicit relation and solver/rank path | Persisted glyph absent; lifecycle coverage incomplete |
| Length / angle | Constraint kinds and solver projection exist | Driving-vs-measured and edit lifecycle coverage missing |
| Origin anchoring | No direct verified line workflow | Missing coverage / capability unproven |
| Construction roles | UI mutation, solver participation, rendering, undo/redo, persistence | Relation-specific construction-edge coverage missing |

## Verification policy

Use test-first RED/GREEN where deterministic. Focused commands precede root gates. Root gates, when the bounded implementation is ready, run in CI order: `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm test:e2e`, `corepack pnpm build`.

## Review and commit policy

Latest native review preflight returned `rdd_disabled`, so no native lineage was started. Read-only assessment remained unassessable because the worktree contains unrelated untracked files; its exact fallback requires writer self-verification plus an independent verifier. Both were satisfied through slice-level writer checks, independent focused reruns, full repository gates, and final structural review. The native preflight scope did not include the new untracked closure spec/task document, so it is not claimed as native-reviewed. The user later explicitly authorized one bounded commit and ordinary push of only this verified candidate to `experiment/sketch-tool-study`; this does not authorize PR creation, merge, release, force-push, destructive Git operations, or unrelated files.
