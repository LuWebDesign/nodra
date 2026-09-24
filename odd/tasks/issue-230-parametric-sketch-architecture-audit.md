# Issue #230 — Parametric Sketch Architecture Audit

## Status

- Branch: `chore/audit-parametric-sketch-architecture-230`
- Workflow: Organic Driven Development (ODD)
- Current phase: Audit
- Source changes: Forbidden during the audit
- Implementation authorization: WU4 topology role propagation explicitly authorized.
- Issue: <https://github.com/LuWebDesign/nodra/issues/230>

## Goal

Produce a repository-evidence-based audit of KOND's current parametric sketch architecture, then propose a bounded target architecture and incremental migration plan for explicit human review before implementation.

## Invariants

- Do not modify product code during the audit.
- Do not remove tools or replace the solver.
- Do not introduce services or packages during the audit.
- Revalidate current source and tests; do not treat historical plans or memories as current evidence.
- Distinguish temporary snap/inference state from persistent relations and constraints.
- Preserve package dependency direction and the web composition boundary.
- Stop after the audit deliverable and wait for explicit architecture approval.

## Tasks

- [x] **T1 — Establish the repository baseline and capability inventory**
  - Record package boundaries, model/schema invariants, solver scope, relevant exports, tests, and known limitations.
  - Classify the eleven requested systems as `YES | PARTIAL | NO` and `GOOD | COUPLED | DUPLICATED | LEAKING | MISSING` using cited evidence.
  - Create the initial audit report structure.
  - Evidence: `docs/audits/parametric-sketch-architecture-230.md` at baseline `9434cfdd`; independent structural/evidence verification found no remaining blocking factual inaccuracies and confirmed documentation-only scope.
  - Status: complete.
  - Commit: `0af8d7a16cb8be02ea08e89ddb2bc6439614f3d8` (`docs(architecture): establish issue 230 audit baseline`).

- [x] **T2 — Map current architecture and sources of truth**
  - Identify ownership of geometry, constraints, dimensions, solved state, selection, interaction state, history, rendering, and persistence.
  - Produce a current-state dependency/call-flow diagram.
  - Status: complete.
  - Evidence: report sections B.4, B.5, C.4, and H; three independent verification passes corrected call ordering, rollback ownership, topology-path scope, and project/document preservation wording; final verification found no blockers and `git diff --check` passed.
  - Commit: `4204f599cfc1606c6a5bf630b59880e81a98b30f` (`docs(architecture): map current sketch state ownership`).

- [x] **T3 — Trace required end-to-end flows**
  - Trace line creation, rectangle creation, entity snap, dimension creation/editing, and geometry movement through real calls and tests.
  - Record preview/commit, solver, validation, persistence, rendering, and undo behavior.
  - Status: complete.
  - Evidence: report sections B.6 and B.7; independent verification corrected the existing-sketch-node line branch, native rectangle E2E coverage, and positional-coincidence propagation scope; final verification found no blocking factual inaccuracies and confirmed product source unchanged.
  - Commit: `676b022d9bac98a25bc6cfe80118b3a9a234934b` (`docs(architecture): trace parametric sketch workflows`).

- [x] **T4 — Build the responsibility and tool-coupling matrices**
  - Map Line, Rectangle, Circle, Arc, Spline/Bezier, Trim, Move/Edit, and Dimension responsibilities.
  - Identify duplicated mathematics, leaked responsibilities, and intentional specialization.
  - Status: complete.
  - Evidence: report section D; matrix distinguishes transient inference from persistent relations, native from sketch entities, duplicated mechanics from intentional specialization, and factual cross-layer ownership from severity. Independent verification found no blockers and confirmed product source unchanged.
  - Commit: `64410c3cdfe63e365ca90e4660a100b9e128f0ef` (`docs(architecture): map sketch tool coupling`).

- [x] **T5 — Produce severity-ranked findings and disposition matrix**
  - Classify findings as `CRITICAL | HIGH | MEDIUM | LOW`.
  - Classify components as `KEEP | REFACTOR | REPLACE | REMOVE | CREATE` only after consumer and test evidence.
  - Separate verified defects, architectural gaps, deliberate limitations, and hypotheses.
  - Status: complete.
  - Evidence: report sections E and F; findings were independently challenged for factual support and severity, then integrated with no CRITICAL/HIGH claims, explicit unproven hypotheses, and no unsupported REMOVE/REPLACE disposition. Final verification found no blockers and confirmed product source unchanged.
  - Commit: `ecdedc97917d6d2fa3f621a0389c866d220d6e72` (`docs(architecture): classify parametric sketch findings`).

- [x] **T6 — Define target architecture and minimal contracts**
  - Propose repository-adapted boundaries for snap, inference, relations, automatic relations, dimensions, solver/DOF, and construction geometry.
  - Define sources of truth and compatibility constraints without creating code.
  - Status: complete.
  - Evidence: report sections G, H.4, and I; independent design challenge required target-only construction semantics, native/edge role granularity, existing reference/ID reuse, geometric-vs-fabricable profile separation, future role inheritance, and state normalization. Re-verification found no blocking contradiction, over-modeling, hidden T7 decision, or dependency violation.
  - Commit: `0b4816b5abc7b887e28460137d584abfd0ed1620` (`docs(architecture): define parametric sketch target`).

- [x] **T7 — Define migration, testing, performance, UX, and rollback plans**
  - Order migration work units by verified dependencies.
  - Define coexistence, acceptance criteria, rollback, schema compatibility, and review-size boundaries.
  - Status: complete.
  - Evidence: report sections J, K.2, and L; independent review corrected forward-only migration language and split role command/topology propagation, derived definition/tool migration, persistence/recovery, UX/performance, and cleanup into independently gated slices. Final verification found no blockers and confirmed product source unchanged.
  - Commit: `4befe48104820064ad35ee2df777e264fa651491` (`docs(architecture): plan parametric sketch migration`).

- [x] **T8 — Review and approval gate**
  - Verify that every claim is cited and every unresolved decision is explicit.
  - Present the completed audit and stop before implementation.
  - Status: complete; architecture/migration approved, with WU1 characterization/contracts as the only authorized implementation unit.
  - Evidence: final T8 verification confirmed A–M coverage, grounded partial-cause recommendation, no product-source changes, explicit decisions, and forward-only migration caveats.
  - Commit: pending closure commit.

## Post-audit implementation gate

- [x] **WU1 — Characterization and compatibility contracts**
  - Authorization: explicitly approved after T8; this was the only authorized WU.
  - Scope: behavior-first tests/contracts for current line representation, relation forms, dimension eligibility, topology/reference behavior, and preview/history/persistence boundaries.
  - Out of scope: product behavior, schema, solver changes, role writers, WU2+.
  - Status: complete.
  - Evidence: `packages/editor-core/src/index.test.ts` characterizes non-driving dimension identity/references and repeated same-value numerical drift/history; `tests/e2e/project-workflow.spec.ts` proves canceled pre-commit line draft is absent after reload and committed line IDs persist. Independent verification: 198/198 editor-core tests and 3/3 targeted Playwright tests passed. Click-vs-drag representation remains package-evidence-only because no stable public browser selector exists.
  - Commit: `ad2c13caabd8cfa1393c5904c957cad0fc123e97` (`test(editor): characterize sketch dimension boundaries`).

- [x] **WU2 — Schema read compatibility and validation**
  - Authorization: explicitly approved; this was the only newly authorized WU.
  - Scope: forward-compatible read/default behavior and validation for target `normal | construction` roles, with legacy records normalized to `normal`.
  - Out of scope: role writer/commands, UI, renderer/export, topology propagation, schema downgrade, WU3+.
  - Status: complete.
  - Evidence: all native schemas (including dimension/path/spline) and individual sketch edges accept optional roles, default omissions to `normal`, and reject invalid values. Legacy v9 migration, serialization and persistence round trips pass. Independent verification: 76/76 focused tests, typecheck, and lint passed.
  - Commit: pending WU2 commit.

- [x] **WU3 — Atomic role command**
  - Authorization: explicitly approved; this was the only newly authorized WU.
  - Scope: editor-core command-only role mutation for native elements and sketch-edge targets.
  - Out of scope: topology propagation, UI, renderer/export, schema changes, WU4+.
  - Status: complete.
  - Evidence: `setGeometryRole` is atomic for native/edge targets, preserves same-role identity and history no-ops, and supports undo/redo. Tests prove target isolation and preservation of geometry, nodes, constraints, dimensions/references, connections, positional coincidences, and parent/sibling roles. Canonical `normal` intersect output now preserves up-to-date rebuild no-op identity/history. Independent verification: 202/202 editor-core tests, typecheck, and lint passed.
  - Commit: pending WU3 commit.

- [ ] **WU4 — Topology role propagation**
  - Authorization: explicitly granted.
  - Scope: role propagation/remapping through split, trim, cut, and topology replacement.
  - Out of scope: UI, renderer/export, automatic relations, WU5+.
  - Status: complete; independently verified.
  - Discovery: direct split/trim/replacement constructors in `packages/editor-core/src/index.ts` omitted source roles, so validation silently defaulted replacements to `normal`. Pure one-source replacements now preserve their source role, including cubic-path transversal replacement edges.
  - Decision: when planar cut reconstruction would combine `normal` and `construction` native sources into one path, reject that mixed-role reconstruction rather than inventing a precedence.
  - Evidence: `packages/editor-core/src/index.ts` propagates roles through sketch-edge split/cut, native path/line replacement, contour reconstruction, arc/circle trim, and cubic-path transversal replacement. Regression tests prove these paths and atomic mixed-role rejection. Independent verification passed `corepack pnpm exec vitest run packages/editor-core/src/index.test.ts` (205/205) and `git diff --check`. Commit: `3c0bd5b` (`feat(editor): propagate geometry roles through topology edits`).

- [ ] **WU5 — Derived role consumers**
  - Authorization: explicitly granted.
  - Scope: show construction geometry in the editor with a subdued dashed, no-fill presentation; apply that presentation independently to native elements and individual sketch edges; preserve ordinary interaction behavior; add a pure explicit fabricable projection that excludes construction without changing profile/topology APIs; hide construction in renderer `export` mode.
  - Out of scope: role writers, topology propagation, selection/snap/dimension/cut eligibility, schema/persistence changes, export format/parser, relation/dimension behavior, WU6+.
  - Status: complete; independently verified.
  - Evidence: renderer presentation distinguishes native and individual sketch-edge construction geometry with a subdued dashed, no-fill style; normal geometry is unchanged. `projectFabricableDocument` provides a pure explicit construction-excluding projection, while renderer `export` mode hides construction. Independent verification passed `corepack pnpm exec vitest run packages/renderer-svg/src/index.test.ts` (26/26) and `git diff --check`. Commit: `cc8b049` (`feat(renderer): present construction geometry`).

- [ ] **WU6 — Relation and dimension eligibility**
  - Authorization: explicitly granted with the mapped recommendations.
  - Scope: centralize persistent relation/dimension eligibility at the editor-core command boundary; unsupported driving requests create a non-driving annotation; native-line angular dimensions remain non-driving while direct native value editing remains supported; construction remains eligible wherever its geometric type is supported; correct repeated same-value non-driving dimension updates to be no-ops without history/revision changes.
  - Out of scope: automatic-relation lifecycle, solver rewrite/capability additions, conversion among connections/positional coincidences/constraints, persistence/schema changes, renderer/export, tool/UI redesign, WU7+.
  - Status: complete; independently verified.
  - Evidence: `dimensionDrivingCapability` centralizes durable eligibility in editor-core and `App.tsx` consumes it. Unsupported driving normalizes to non-driving annotation; native-line angular dimensions remain non-driving; construction follows ordinary type eligibility; repeated same-value non-driving edits preserve document identity, revision, and history. Independent verification passed `corepack pnpm exec vitest run packages/editor-core/src/index.test.ts apps/web/src/App.test.tsx` (209/209) and `git diff --check`. Commit: `33a0e7d` (`feat(editor): centralize dimension driving eligibility`).

- [x] **WU7 — Automatic relation lifecycle**
  - Authorization: explicitly granted after a read-only mapping.
  - Scope: centralize the existing sketch-line automatic relation lifecycle in editor-core: receive an explicit inference-derived candidate, validate its supported persistent form and references, run it through the existing sketch kernel/solver, and commit geometry plus accepted relation as one normal command/history transaction. Preserve existing `auto:<edgeId>:<kind>` identity and current horizontal/vertical plus continuation-perpendicular behavior.
  - Product decision: an eligible automatic-relation candidate rejected by validation or solver rejects the complete geometry-plus-relation command atomically; it must not persist geometry alone as an unconstrained fallback.
  - Out of scope: snap priority/tolerance or guide UX; general snap-to-constraint conversion; explicit connections, positional-coincidence and dimension lifecycle changes; native drag-line behavior; schema/persistence/renderer changes; solver capability/rewrite; WU8+.
  - Acceptance: transient guides/candidates do not mutate a document; accepted candidates persist only supported relation kinds with stable IDs and solve through the existing kernel; malformed, degenerate, redundant, conflicting, or solver-rejected candidates leave document identity, revision, and history untouched; successful geometry plus relation is one undoable transaction and undo/redo restores both; no conversion among relation models occurs.
  - Status: complete; independently validated with the authorized WU7-V typing/test repair below. Work-unit commit: `aa499c4e23cdab99edb61bec224686ff1e593b58` (`feat(editor): commit automatic sketch relations atomically`). Candidate admission rejects invalid, degenerate, redundant, and solver-conflicting relations atomically; reversed perpendicular pairs are accepted and undo/redo covers the transaction. Independent verification passed `corepack pnpm exec vitest run packages/editor-core/src/index.test.ts` (213/213) and `git diff --check` after adding direct transient-candidate nonmutation and legacy continuation-perpendicular regression tests; writer lint passed after the same edits. `corepack pnpm typecheck` now exits 0 after the explicitly authorized WU7-V repair. Full unit suite passes 751/751 and E2E passes 73 with 1 skip on retry; see WU7-V for the initial E2E timeout and all gate evidence. No WU8 work started.
  - Route: delegated bounded editor-core source/test writer (two nontrivial files), independent verifier after native assessment returned unassessable (schema-incompatible native response, RDD off). TDD mode has not been established by configuration; no strict TDD claim. Focused runner: `corepack pnpm exec vitest run packages/editor-core/src/index.test.ts`. Next: await separate authorization before starting WU8.

- [x] **WU7-V — Repair typecheck baseline before WU7 closure**
  - Authorization: user explicitly requested investigation, correction of the 11 typecheck errors, and revalidation before continuing.
  - Scope: correct domain element role typings and affected editor-core/renderer typings without changing product behavior; preserve the in-progress WU7 diff. No WU8+ implementation and no commit without a separate decision.
  - Evidence before repair: `corepack pnpm typecheck` exits 2 with 11 diagnostics in editor-core tests/source and renderer. Domain/renderer files are unchanged from HEAD; the WU7 source diff does not alter the diagnosed editor-core code sites. This is source-level baseline evidence, not a clean-HEAD typecheck run.
  - Status: complete; independently validated in the WU7 work-unit commit `aa499c4e23cdab99edb61bec224686ff1e593b58`. Concrete domain interfaces extend `ElementBase`; typed editor-core annotation normalization drops `constraintId`; renderer fabricable projection returns `Element`. Three stale test fixtures now explicitly assert normalized roles without mutating inputs and use equivalent canonical arc angles. First full unit run failed 9/751 (8 stale role expectations, 1 negative-angle fixture); after fixture repairs, independent root gates in order passed: lint exit 0, typecheck exit 0, unit tests 751/751 exit 0, build exit 0, diff check exit 0. Initial E2E run exited 1 (72 passed, 1 failed, 1 skipped) because an arc-edit test timed out obtaining `.page`; focused arc retry passed 2/2 and full `corepack pnpm test:e2e` retry exited 0 (73 passed, 1 skipped). The build reported a non-failing chunk-size warning; Git reported non-failing LF-to-CRLF warnings. No clean HEAD test comparison was run, so baseline attribution of the earlier failures remains unproven. Evidence was recorded in the WU7 work-unit commit.

- [x] **WU8 — Derived definition-state projection**
  - Authorization: explicitly approved after the read-only current-state map, for a test-first bounded slice only.
  - Scope: characterize existing non-persisted component definition states and renderer consumption. Prove normalization of raw `defined` to `fully-defined`, aggregate precedence `invalid → conflict → overdefined → underdefined → fully-defined`, deterministic recomputation without snapshot mutation, and solver visibility of supported `construction` geometry. Add production code only for a demonstrated failure in this scope.
  - Out of scope: persisting derived definition state, auto-synchronizing `PieceSnapshot.state`, tool migration, rectangle decomposition, solver capability/rewrite, broad UI changes, schema/persistence changes, WU9+.
  - Baseline: `packages/constraints/src/index.ts` already normalizes raw solver status and derives component states; `packages/renderer-svg/src/index.ts` already colors editor sketches from component states. Existing tests cover individual states but leave aggregate precedence, construction visibility and read-only rendering integration less explicit. `PieceSnapshot.state` is an independent persisted field.
  - Acceptance: focused constraints and renderer tests demonstrate the planned invariants without inventing new solver semantics; failed tests trigger only minimal bounded repair; existing behavior remains compatible. Forecast approximately 100–150 authored diff lines, to be revised from actual evidence. Route: one bounded `gentle-ai-worker` for two nontrivial test files, with source files added only upon corroborated failure; independent verifier according to native risk assessment (RDD currently off). TDD mode unknown; do not claim strict TDD without configuration. Exact focused runner: `corepack pnpm exec vitest run packages/constraints/src/index.test.ts packages/renderer-svg/src/index.test.ts`; also root lint and typecheck.
  - Status: complete; test-only scope independently validated. Constraints proves full precedence including `invalid`; renderer validates and rejects unsupported-constraint documents before color aggregation, so it proves only validated renderable states `conflict → overdefined → underdefined → fully-defined`. The unreachable renderer-invalid fixture was removed after demonstrating that boundary. Independent focused tests pass (58), lint/typecheck/diff check pass. No production code changed. Commit: `e2e6e3c448bc7499fa17b7c560e141bfb8a0b1b4` (`test(constraints): characterize definition state projection`).

- [x] **WU9-Line — Characterize preserved Line representation split**
  - Authorization: explicitly approved after WU9 read-only mapping.
  - Scope: test-first characterization of the existing contract: click Line creates or extends a `SketchElement`; drag Line creates a native `LineElement`; preview is provisional; cancel persists nothing; commit is one editor-core history transaction; no implicit conversion between representations.
  - Out of scope: changing either representation, Rectangle/Circle/Arc/Spline/Move/Trim, shared interaction thresholds/coordinates, renderer/solver/schema/persistence changes, WU10+.
  - Likely surfaces: `apps/web/src/App.test.tsx`, `packages/editor-core/src/index.test.ts`, and only a focused E2E test if App-level proof cannot provide contract coverage. Production source only after a demonstrated gap.
  - Status: complete; independently verified. Work-unit commit: `6b76abc` (`fix(editor): restore native Line drag gestures`). Model gate: `PI_MODEL=gpt-6-luna`, `PI_PROVIDER=openai-codex`. Test-first RED: the focused release-outside E2E failed before repair because `.creation-pending-overlay` remained after a captured pointerup outside `.canvas`. The Line-only `finishPointer` replay guard now checks pointerup client coordinates against the current canvas bounding rect; a release outside falls through to gesture cancellation without replaying a click. GREEN: `corepack pnpm exec playwright test tests/e2e/app.smoke.spec.ts -g 'released outside the canvas|continues a click line|cancels a short Line gesture|Line clicks create sketch edges'` (5 passed including setup), preserving click continuation, cancellation, and drag-native behavior. The synthetic pointercancel test now reads the pointer ID from its actual pointerdown event. Editor-core characterization verifies preview/cancel and one-transaction commit/undo while keeping sketch and native line representations distinct. Writer validation: `corepack pnpm exec vitest run packages/editor-core/src/index.test.ts apps/web/src/App.test.tsx` (216 passed), `corepack pnpm lint` (passed), `corepack pnpm typecheck` (passed after correcting test-only PointerEvent typing), and `git diff --check` (passed). Independent GPT-6 Luna verification passed root gates in repository order: lint, typecheck, unit tests (757/757), E2E (77 passed, 1 skipped), and build; `git diff --check` passed. The build emitted a non-blocking large-chunk warning. No WU10 or unrelated product changes.

- [x] **WU10-A — Current durable role-write integrity**
  - Authorization: explicitly approved for current-version correctness only; no historical record or reverted-binary compatibility requirement because no real projects exist yet.
  - Scope: test durable round-trip for native and sketch-edge roles and invalid-role write rejection that preserves the last valid project revision. Reuse the current fake-indexeddb repository and validation boundaries; production changes only if tests prove a gap.
  - Out of scope: schema/migration changes, legacy fixture matrix, web UI, mirror behavior, WU11+.
  - Route: bounded persistence test writer; independent verification. Focused runner: `corepack pnpm exec vitest run packages/persistence/src/index.test.ts`.
  - Status: complete; independently verified. Work-unit commit: `8be02dd` (`test(persistence): guard valid revision on invalid role writes`). No production change was warranted: the new regression passed immediately against existing validation.
  - Writer evidence: test-first characterization seeds a valid revision containing a construction native line and construction sketch edge, then rejects higher-revision invalid native-role and edge-role writes and confirms `getProject` still recovers revision 1 with the identical saved project after each rejection. `corepack pnpm exec vitest run packages/persistence/src/index.test.ts` passed (20/20). Initial `corepack pnpm typecheck` caught an unchecked-index typing issue in the new test; after correcting its fixture typing, typecheck and root lint pass. `git diff --check` passed (Git emitted a non-failing LF-to-CRLF warning for this ledger). No production code changed. RED: none observed; repository already rejected both invalid writes without mutation. GREEN: focused test passes against unchanged production code. Independent GPT-6 Luna verification confirmed the rejection/recovery assertions and reran focused persistence tests (20/20), root lint, typecheck and `git diff --check` successfully.

- [x] **WU10-B — Current recovery-mirror failure honesty**
  - Authorization: explicitly approved as the second, separate current-version correctness slice.
  - Scope: verify localStorage write/remove failures remain best-effort and cannot claim that an unsaved mirror was updated; preserve durable repository save status and recovery arbitration. Test error and stale-cleanup cases, with minimal web status wiring correction only if confirmed.
  - Out of scope: treating the mirror as durable history, changing repository/migration policy, historical reader compatibility, new UX workflows/E2E, WU11+.
  - Route: bounded web writer after WU10-A, independent verification. Focused runners: `corepack pnpm exec vitest run apps/web/src/appPersistence.test.ts apps/web/src/appRecovery.test.ts apps/web/src/App.test.tsx` as applicable.
  - Status: complete; independently verified. Work-unit commit: `aa9d36d` (`fix(web): report recovery mirror write failures`). Direct App UI assertion for mirror-failure copy is not present; this is an explicit coverage limit, not a passing UI test.
  - Test-first RED: `corepack pnpm exec vitest run apps/web/src/appPersistence.test.ts` failed as intended because `saveProjectMirror` returned `undefined` instead of reporting successful storage; 7 other tests passed. Initial GREEN: `corepack pnpm exec vitest run apps/web/src/appPersistence.test.ts apps/web/src/appRecovery.test.ts apps/web/src/App.test.tsx` passed (15/15). Writer correction: mirror-write failure test now seeds a valid mirror and asserts `false` plus unchanged, readable saved data; throwing cleanup test seeds a valid mirror and asserts no throw plus readability afterward. Offline status now truthfully distinguishes mirror failure (`Sin conexión — no se pudo guardar la recuperación local`) from successful local mirror persistence. The App offline copy has no direct UI assertion; existing `App.test.tsx` does not verify it. `appRecovery.test.ts` covers arbitration separately; no integration-test claim. Durable repository save status and other callers remain unchanged. Writer validation: focused Vitest command passed 15/15, root `corepack pnpm lint` and `corepack pnpm typecheck` passed, and `git diff --check` passed (non-failing LF-to-CRLF warnings). Independent GPT-6 Luna verification passed root lint, typecheck, unit tests (760/760), E2E (77 passed, 1 skipped), build, and `git diff --check`. Build emitted a non-blocking large-chunk warning; Git emitted non-failing LF-to-CRLF warnings. No WU11 or unrelated product change.

- [x] **WU11-A — Native construction-role inspector UX**
  - Authorization: user approved WU11 and chose an inspector control for normal/construction conversion. Scope is one selected native geometric element through the existing `setGeometryRole` editor-core command; Spanish copy, visible dashed construction presentation, undo/redo, cancellation/no-op, and persisted reload in a focused public browser workflow.
  - Out of scope: sketch-edge targeting, multi-selection, new commands/schema, renderer/export policy, solver changes, broad tool migration, optimization, WU12.
  - Likely surfaces: `apps/web/src/App.tsx`, a focused existing `tests/e2e/*.spec.ts` file, and narrow tests only if required by an observed gap. Run focused Playwright and relevant editor/renderer tests, then independent verification.
  - Status: complete; independently verified. Work-unit commit: `447e5ec` (`feat(web): expose native construction role in inspector`).
  - Writer evidence: test-first Playwright flow creates a native Line by drag, selects that single element, exercises the Spanish role control, verifies the existing renderer's dashed construction style, undo/redo rollback, same-role no-op revision/history behavior, and persisted reload. RED: `corepack pnpm exec playwright test tests/e2e/project-workflow.spec.ts -g 'changes one native line role from the inspector with history and persisted reload'` failed because the inspector had no role control. GREEN: the same command passed (2/2 including setup). Writer validation: `corepack pnpm lint`, `corepack pnpm typecheck`, and `git diff --check` passed; Git emitted non-failing LF-to-CRLF warnings. No direct document mutation, new role preview, edge role UI, schema, or renderer change. Undo reverses a committed role transaction; it is not cancellation of a provisional role preview, which this discrete command does not have. Independent GPT-6 Luna verification reran focused Playwright (2 passed including setup), editor-core/renderer unit tests (241 passed), root lint, typecheck and `git diff --check` successfully. Native-Line browser evidence does not imply every eligible native type was exercised. Commit pending.

- [ ] **WU11-B — Sketch-edge construction-role inspector UX**
  - Authorization: WU11 inspector selection; implement only after WU11-A. Explicitly selected sketch-edge keys target one edge, and sketch selection without an edge key targets the whole sketch; avoid mixed/multiple-edge implicit mutation. Preserve separate roles and no-op history.
  - Out of scope: new edge selection semantics, multi-edge batch actions, profile/solver/renderer rewrite, optimization, WU12.
  - Likely surfaces: `apps/web/src/App.tsx` and focused tests; use existing `setGeometryRole` command, no direct document mutations.
  - Status: pending.

- [ ] **WU11-C — Reproducible performance baseline**
  - Authorization: WU11 performance evidence, separate work-unit commit after focused UX slices. Fixed workloads and runtime metadata; report pointermove, preview solve, commit solve, render cost, iteration/complexity scale and p50/p95/p99 before any optimization.
  - Out of scope: workers/index/cache, universal pass thresholds, new rendering engine, product optimization, WU12.
  - Likely surfaces: focused measurement harness and audit evidence; choose exact runner after mapping instrumentable boundaries. Measurements are descriptive and machine-specific.
  - Status: pending.

## Deliverable

`docs/audits/parametric-sketch-architecture-230.md

The final report must contain the sections A–M requested by issue #230 and answer whether KOND's observed behavior is caused partially or primarily by missing separation of responsibilities.
