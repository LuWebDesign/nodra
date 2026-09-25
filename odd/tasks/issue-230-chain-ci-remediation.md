# Issue #230 — Chained PR CI remediation

- Branches: local `chore/issue-230-06-role-foundation` and descendants; original feature branch stays unchanged.
- Authorization: user approved test-only repair of stale role fixtures and descendant branch reconciliation before PR publication.
- Invariant: preserve the original `chore/audit-parametric-sketch-architecture-230` branch and the production behavior. No push or PR until each child passes its CI gates.

## Tasks

- [x] **R1 — Make role-foundation slice independently CI-green**
  - Writer evidence: child06's first typecheck failed because role fields had been added to typed input fixtures in `stores.test.ts` and `sketchKernel.test.ts`; removed those fixture-field edits and moved role normalization into expected outputs, with explicit input-immutability assertions. Updated Trim expected outputs to account for normalized roles. No production code or arc angle fixtures changed.
  - Independent GPT-6 Luna verification passed root lint, typecheck, unit tests (736/736), E2E (73 passed, 1 skipped), build and `git diff --check`; focused writer tests passed (41/41). Build chunk-size warning was non-blocking. Work-unit commit: `3d3fa0a` (`test(editor): normalize role expectations in chain slice`).
  - Do not backport unrelated arc fixture changes unless directly required by a failing test.

- [x] **R1b — Make role-consumer slice type-safe without behavioral changes**
  - Authorization: user approved only the necessary type corrections after child07 failed with 14 TypeScript diagnostics in editor-core tests, editor-core implementation, and renderer.
  - Constrain edits to domain concrete element interface inheritance, the unsafe annotation cast in editor-core, renderer `flatMap<Element>` inference, and this task record. Do not move WU7 candidate relation logic or unrelated fixtures earlier.
  - Writer evidence: backported only the concrete element `ElementBase` inheritance needed for role typing, typed annotation projection, and renderer `flatMap<Element>` inference. Writer lint, typecheck, and diff check passed. Independent verification passed root lint, typecheck, unit (745/745), E2E (73 passed, 1 skipped), build and diff check with R1c. Child07 working-tree diff against child06 is 296 lines, within 400. Non-blocking build chunk warning; work-unit commit `c27d1bf` (`fix(editor): type role consumers in chain slice`).

- [x] **R1c — Canonicalize the Trim test arc fixture**
  - User authorized exactly two test fixture line corrections after the child07 unit gate failed with `Arc angles must define a canonical partial sweep` (744 passed, 1 failed).
  - Change only the `radius-first` and `radius-second` arc angle expressions in `packages/editor-core/src/trim.test.ts`; no production arc changes.
  - Verified with R1b: root lint, typecheck, unit (745/745), E2E (73 passed, 1 skipped), build and diff check all passed. Work-unit commit `c27d1bf`.

- [ ] **R3 — Reject orphaned references in fabricable export (PR #239)**
  - Authorized policy: fail closed rather than prune annotations or relations. A source may validate while filtering construction geometry makes its dimensions or constraints invalid.
  - Writer evidence: regression covers dimension references to removed construction elements, sketch constraints to removed construction edges, and invalid construction geometry filtered out by direct projection; verifies renderer rejection, direct projection rejection with typed validation issues, unchanged source, editor render, and valid export projection. `projectFabricableDocument` keeps its public `DocumentSnapshot` success return and throws `FabricableDocumentProjectionError` for invalid source or post-filter projection; export rendering catches only that expected error. No Circle, Trim, profiles, Extrude or unrelated behavior touched.
  - RED: focused renderer suite failed (27 passed, 1 failed) because direct projection returned success after removing malformed construction geometry. GREEN: focused renderer suite passed (28/28). Independent verifier passed root lint, typecheck, unit (747/747), E2E (73 passed, 1 skipped), build and diff check. One transient ESLint host failure was not reproducible on retry; build chunk warning was non-blocking. Child07 worktree diff versus child06 is 372 lines, within 400. Commit evidence pending.
  - Keep #239 within 400 changed lines; run root gates before commit. Propagate the corrected parent into #240–#244 and verify each child independently before declaring the chain ready.

- [ ] **R2 — Reconcile descendant chain branches without rewriting original history**
  - Make child07–12 inherit the repaired child06 while preserving original feature commits and keeping each immediate-parent PR diff clean.
  - Resolve already-applied test expectations at the later WU7-V commit deliberately; verify slice budgets and each branch's gates before publication.
  - Tracker remains draft/no-merge; remaining tools and WU12 are excluded.
