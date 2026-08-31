# Tasks: Constraint-driven dimensioning

## Phase 1 — model and contracts

- [x] 1.1 Define stable point references and initial constraint kinds in `@nodra/domain`.
- [x] 1.2 Add schema validation for references, values, duplicate constraints, and unsupported combinations.
- [x] 1.3 Add migration/default behavior without breaking existing documents.

## Phase 2 — deterministic solver

- [x] 2.1 Implement relation evaluation for horizontal and vertical segments.
- [x] 2.2 Implement coincident and origin-fixed point evaluation.
- [x] 2.3 Implement horizontal/vertical distance evaluation with conflict detection.
- [x] 2.4 Return status and immutable preview results with focused unit tests.

## Phase 3 — editor integration

- [x] 3.1 Add validated create/update/delete constraint commands.
- [x] 3.2 Integrate preview, commit, cancel, undo, and redo as one transaction.
- [x] 3.3 Connect supported dimension editing to the solver and preserve safe rectangle behavior.

## Phase 4 — rendering and UX

- [x] 4.1 Render shared underdefined/defined/conflict/overdefined state colors.
- [x] 4.2 Add relationship creation feedback without implicit constraints.
- [ ] 4.3 Add E2E coverage for drawing, constraining, editing, and rollback.

## Phase 5 — extensions

- [x] 5.1a Add circle radius and diameter driving dimensions with explicit circle constraints.
- [ ] 5.1b Add arc radius and diameter driving dimensions after ArcElement persistence and tool integration.
- [ ] 5.2 Add angular, aligned, positional, tangent, parallel, perpendicular, concentric, and equal relations. Tracked in GitHub issue #151.
- [ ] 5.3 Add spline-specific constraints and solver support.
