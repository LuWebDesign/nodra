# Issue #230 — Parametric Sketch Architecture Audit

## Status

- Branch: `chore/audit-parametric-sketch-architecture-230`
- Workflow: Organic Driven Development (ODD)
- Current phase: Audit
- Source changes: Forbidden during the audit
- Implementation authorization: Not granted
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

- [ ] **WU3 — Atomic role command**
  - Authorization: not granted.
  - Scope after approval: editor-core command-only role mutation for native elements and sketch-edge targets.
  - Out of scope: topology propagation, UI, renderer/export, schema changes, WU4+.
  - Status: blocked pending explicit authorization.

## Deliverable

`docs/audits/parametric-sketch-architecture-230.md`

The final report must contain the sections A–M requested by issue #230 and answer whether KOND's observed behavior is caused partially or primarily by missing separation of responsibilities.
