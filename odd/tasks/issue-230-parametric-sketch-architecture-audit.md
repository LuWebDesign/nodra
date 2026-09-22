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

- [ ] **T6 — Define target architecture and minimal contracts**
  - Propose repository-adapted boundaries for snap, inference, relations, automatic relations, dimensions, solver/DOF, and construction geometry.
  - Define sources of truth and compatibility constraints without creating code.
  - Status: in progress.
  - Evidence: pending.
  - Commit: pending explicit authorization.

- [ ] **T7 — Define migration, testing, performance, UX, and rollback plans**
  - Order migration work units by verified dependencies.
  - Define coexistence, acceptance criteria, rollback, schema compatibility, and review-size boundaries.
  - Evidence: pending.
  - Commit: pending explicit authorization.

- [ ] **T8 — Review and approval gate**
  - Verify that every claim is cited and every unresolved decision is explicit.
  - Present the completed audit and stop before implementation.
  - Evidence: pending.
  - Commit: pending explicit authorization.

## Deliverable

`docs/audits/parametric-sketch-architecture-230.md`

The final report must contain the sections A–M requested by issue #230 and answer whether KOND's observed behavior is caused partially or primarily by missing separation of responsibilities.
