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

- [x] **R2 — Reconcile descendant chain branches without rewriting original history**
  - Child07 (`77b4667`) inherits corrected child06; child08 (`e975edd`), child09 (`489cb21`), child10 (`5c66549`), child11 (`8d502a2`), and child12 (`a3a366e`) each merge the corrected immediate parent while retaining the original slice head as first parent. Child08 conflict resolution preserved WU7-V's `TextElement` inheritance and both input-immutability assertions. Original feature branch still points to `9467331`.
  - Independent full root gates passed on every reconciled tip. Units: 745/756/757/760/760/760 passed for child07–12; E2E: 73/73/77/80/81/82 passed respectively, with one existing skip each. Lint, typecheck and build passed; non-blocking Vite chunk warnings. Consecutive PR diffs: 298/277/323/255/314/76 lines, all under 400.
  - Tracker remains draft/no-merge; remaining tools and WU12 are excluded. No remote branches or PRs published yet.
