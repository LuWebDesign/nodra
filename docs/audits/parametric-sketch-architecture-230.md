# KOND Parametric Sketch Architecture Audit

Issue: [#230](https://github.com/LuWebDesign/nodra/issues/230)  
Audit branch: `chore/audit-parametric-sketch-architecture-230`  
Baseline commit: `9434cfddfc20ac2103cdf7b412fdfb45684310e6`  
Status: **AUDIT IN PROGRESS — T1 baseline recorded**

## Audit Contract

This document records the current architecture before any corrective implementation. During the audit:

- product code is not modified;
- tools are not removed;
- the solver is not replaced;
- new services and packages are not introduced;
- current source and tests are authoritative;
- historical plans and prior audits are treated only as discovery hints;
- target architecture is not implementation authorization;
- implementation begins only after explicit review and approval.

Required sequence:

```text
AUDIT → FINDINGS → TARGET ARCHITECTURE → MIGRATION PLAN → REVIEW / APPROVAL → IMPLEMENTATION
```

## Method and Evidence Rules

Each architectural claim must identify its current owner, concrete source symbols, consumers, and test surface. The audit separates:

1. **Verified behavior** — directly supported by current source or tests.
2. **Observed architectural condition** — classification supported by multiple verified facts.
3. **Hypothesis** — plausible consequence that still requires an end-to-end trace or test.
4. **Target decision** — a future design choice, never presented as current behavior.

System existence is classified as `YES | PARTIAL | NO`. Architectural condition is classified as `GOOD | COUPLED | DUPLICATED | LEAKING | MISSING`.

---

# A. Executive Summary

> Status: preliminary baseline; final conclusions are deferred until the required flows and coupling matrix are complete.

KOND already has a substantive parametric-sketch foundation. It is not a coordinate-only drawing application and it is not starting from an empty architecture. Current source contains:

- a persisted sketch node/edge graph with stable IDs;
- local and document-level geometric constraints;
- iterative solving, residuals, connected components, rank, and DOF metadata;
- bounded sketch-kernel/session behavior with rollback on invalid solver outcomes;
- persisted associative dimensions with partial driving behavior;
- transient snapping and visual guides;
- automatic relation creation in selected sketch-creation paths;
- validated command/history boundaries;
- one-way SVG projection;
- schema migration and IndexedDB persistence infrastructure.

The baseline also shows material architectural gaps:

- construction geometry has no persistent model role;
- solver support is intentionally bounded rather than general across every element type;
- snap, inference feedback, and relation creation are spread across web interaction and editor-core;
- local constraints, document constraints, positional coincidences, and explicit connections coexist under different contracts;
- automatic relation logic is present but not represented by one explicit lifecycle;
- DOF/component state exists, while persisted piece state is separate and coarser;
- dimension-driving behavior is not general across all geometry.

These facts justify the audit, but they do **not yet prove** that missing responsibility separation is the primary cause of current behavioral defects. That conclusion remains pending the required end-to-end traces.

---

# B. Current Architecture

## B.1 Package dependency direction

Current package manifests and imports establish this direction:

```text
web
 ├─ domain
 ├─ geometry ──────────────→ domain
 ├─ constraints ───────────→ domain, geometry
 ├─ validation ────────────→ domain
 ├─ editor-core ───────────→ domain, geometry, constraints, validation
 ├─ renderer-svg ──────────→ domain, geometry, constraints, validation
 └─ persistence ───────────→ domain, validation, Dexie

ui (standalone; not a current web dependency)
```

Evidence:

- `packages/domain/package.json` — no workspace dependencies.
- `packages/geometry/package.json` — depends on `@nodra/domain`.
- `packages/constraints/package.json` — depends on `@nodra/domain` and `@nodra/geometry`.
- `packages/validation/package.json` — depends on `@nodra/domain` and Zod.
- `packages/editor-core/package.json` — depends on domain, geometry, constraints, and validation.
- `packages/renderer-svg/package.json` — depends on domain, geometry, constraints, and validation.
- `packages/persistence/package.json` — depends on domain, validation, and Dexie.
- `apps/web/package.json` and `apps/web/src/App.tsx` — compose the runtime packages.

## B.2 Current high-level data flow

```text
Pointer / keyboard input
        ↓
apps/web transient interaction state
  App.tsx + interaction.ts + Zustand stores
        ↓
editor-core commands / gesture lifecycle
        ↓
validated DocumentSnapshot / ProjectSnapshot
        ├──────────────→ constraints / geometry solving and derived state
        ├──────────────→ renderer-svg projection
        └──────────────→ web persistence scheduling → persistence package
```

This is a baseline diagram, not yet the detailed call graph required by issue #230.

## B.3 Verified boundary ownership

| Concern | Current owner | Evidence |
|---|---|---|
| Persistent document/project truth | `@nodra/domain` | `DocumentSnapshot`, `ProjectSnapshot`, element and constraint types in `packages/domain/src/index.ts` |
| Schema/reference validation | `@nodra/validation` | schemas, migrations, topology/reference checks in `packages/validation/src/index.ts` |
| Coordinate and geometric derivation | `@nodra/geometry` | geometry, hit-testing, dimensions, profiles, curve/topology functions |
| Parametric component state | `@nodra/constraints` | normalization, residuals, components, solving, rank and DOF |
| Mutations, history and sketch transactions | `@nodra/editor-core` | commands, `dispatch`, gestures, sketch kernel/session |
| Tool drafts, pointer routing, viewport and feedback | `apps/web` | `App.tsx`, `interaction.ts`, Zustand stores |
| SVG projection | `@nodra/renderer-svg` | validated snapshot-to-SVG functions |
| Durable browser repository | `@nodra/persistence` | Dexie-backed repository |
| Recovery/autosave orchestration | `apps/web` | `appPersistence.ts`, `appRecovery.ts`, `App.tsx` |

---

# C. Responsibility Map

## C.1 Model and schema invariants

| Invariant | Verified current state | Evidence |
|---|---|---|
| Schema version | Version 9 | `packages/domain/src/index.ts` (`CURRENT_SCHEMA_VERSION`) |
| Units | Millimetres | document/project model and dimension validation |
| Coordinate origin | Top-left | page/document model in `packages/domain/src/index.ts` |
| Identity | Branded document, page, piece, layer, element, feature, and revision IDs | `packages/domain/src/index.ts` |
| Sketch topology | Stable node/edge graph | `SketchNode`, `SketchEdge`, `SketchElement` |
| Constraint identity | Stable constraint IDs and validated references | domain constraint types and validation uniqueness/reference checks |
| Dimensions | Persisted elements with node/edge references | `DimensionElement` and validation schemas |
| Construction role | Absent | no verified `NORMAL | CONSTRUCTION` field or equivalent persistent role |
| History | Editor snapshots and gestures | editor-core command/gesture APIs |
| Persistence | Validated project revisions | persistence repository and web scheduling/recovery |

## C.2 Current solver scope

The current system has real solving behavior, but it is bounded.

Verified local sketch relations include:

- horizontal;
- vertical;
- coincident;
- parallel;
- perpendicular;
- equal;
- horizontal distance;
- vertical distance;
- distance;
- angle;
- fixed.

The shared constraint boundary additionally exposes normalized constraints, connected components, residuals, component state, rank, and DOF. Circle support is narrower and uses circle-specific capabilities such as center-horizontal, center-vertical, radius, and diameter.

The sketch kernel explicitly describes its current slice as 2D line-segment sketch graphs, local/document constraints, and existing profile behavior. Offset, Mirror, Fillet, Projection/Use, Patterns, and 3D are outside that slice.

Key evidence:

- `packages/geometry/src/index.ts` — bounded sketch solver and relation behavior.
- `packages/constraints/src/index.ts` — adapters, normalization, components, residuals, rank/DOF, and solving.
- `packages/editor-core/src/sketchKernel.ts` — kernel scope, orchestration, diagnostics, rollback, and non-persisted derived output.

## C.3 Baseline capability inventory

| System requested by #230 | Exists | Condition | Current ownership | Concrete evidence, consumers, tests, and limitation |
|---|---:|---|---|---|
| 1. Sketch Model / Geometry | PARTIAL | COUPLED | domain, geometry, constraints, editor-core | `SketchNode`, `SketchEdge`, and `SketchElement` persist the graph; geometry provides curves/profiles and `solveSketchConstraints`; `SketchKernel` coordinates derived state. Consumers include editor-core, constraints, renderer, and web. Tests: domain, geometry profile/topology, constraints, and `sketchKernel.test.ts`. The responsibility is implemented but crosses four boundaries. |
| 2. Tool / Interaction System | YES | COUPLED | web + editor-core | `App`, `ActiveInteraction`, `CreationDraft`, `pointerDownIntent`, and editor-core `beginGesture`/preview/commit APIs implement the runtime. Consumers are pointer handlers and Zustand session stores. Tests: `interaction.test.ts`, `App.test.tsx`, editor-core command/session tests. Pointer routing, drafts, guides, snapping, and command orchestration remain concentrated in web. |
| 3. Snap Service | YES | COUPLED | web interaction | `snapCreationPoint`, `snapMoveDelta`, and `snapFormaNodePoint` implement three snap paths; `App` consumes their results and `creationConnections` can derive persisted connections after confirmed creation. Tests: `apps/web/src/interaction.test.ts`. No unified snap contract exists. |
| 4. Inference Service | YES | COUPLED | web interaction + editor-core | `directionalGuide`, `nodeAlignmentGuides`, `alignmentGuides`, and `creationGuides` produce temporary feedback; `createSketchLine` and `appendSketchEdge` create persisted inferred relations. Consumers are `App` drawing flows. Tests: web interaction and editor-core command tests. Feedback and persistence ownership are split. |
| 5. Relation / Constraint Service | YES | COUPLED | domain, constraints, editor-core, web | `SketchConstraint`, document constraints, explicit connections, normalized constraint functions, `addSketchConstraint`, and web global-constraint commands implement distinct relation paths. Consumers include kernel, inspector/tool flows, renderer, and validation. Tests: constraints, editor-core, and `globalConstraintCommands.test.ts`. Their lifecycle is not unified. |
| 6. Automatic Relations | YES | DUPLICATED | editor-core | `createSketchLine` and `appendSketchEdge` independently create persisted `auto:*` horizontal/vertical relations; `appendSketchEdge` also infers perpendicular relations. Web `directionalGuide` and `nodeAlignmentGuides` provide feedback but do not create relations. Consumers are sketch-creation flows in `App`; coverage resides in editor-core command tests. Candidate/validation/conflict/commit is not one explicit lifecycle. |
| 7. Construction Geometry | NO | MISSING | none | No domain role/flag, validation rule, renderer style, solver behavior, persistence behavior, export filtering, or conversion command was found. Therefore there are no current consumers or direct tests. |
| 8. Dimension Service | PARTIAL | COUPLED | domain, geometry, editor-core, web, renderer | `DimensionElement` persists references and driving metadata; `dimensionGeometry` derives display geometry; `updateDimensionValue` implements supported edits; `newDimension`/`newCircleDimension` build dimensions in `App`; renderer-svg projects them. Tests span domain/validation, geometry, editor-core, interaction, and renderer. Driving behavior is not general across all entity types. |
| 9. Solver | YES | COUPLED | geometry + constraints + editor-core | Geometry exposes `solveSketchConstraints` and circle solving; constraints exposes `solveConstraintComponents`; editor-core exposes `solveSketch`/`solveCircle`; `SketchKernel` applies rollback policy. Consumers include commands, kernel, constraint diagnostics, renderer, and web. Tests exist in geometry, constraints, editor-core, and kernel suites. Multiple solver/orchestration layers coexist. |
| 10. DOF / Sketch Definition State | PARTIAL | COUPLED | constraints + domain + renderer/web consumers | `constraintDofMetadataForDocument`, `constraintComponentStatesForDocument`, residuals, and `ConstraintState` provide derived component state; domain separately persists coarse piece statuses. Renderer and web consume derived state. Tests: constraints and renderer suites. No synchronization contract between component state and piece state is yet verified. |
| 11. Renderer | YES | GOOD | renderer-svg | `renderSvg` and `renderSketchProfileSvg` consume validated domain/derived state and project SVG; web consumes their output. Tests: `packages/renderer-svg/src/index.test.ts` and `glyph.test.ts`. No evidence shows renderer mutating or owning geometric truth. |

### Classification caution

`COUPLED` in this table is an audit observation, not automatically a defect. Some cross-package orchestration is expected. T2–T5 must determine whether each coupling is intentional, stable, duplicated, or behaviorally harmful.

---

# D. Tool Coupling Matrix

> Pending T3 and T4. No matrix cell will be inferred from tool labels alone.

Required tools:

- Line
- Rectangle
- Circle
- Arc
- Spline/Bezier
- Trim
- Move/Edit
- Dimension

Required responsibility columns:

- pointer handling;
- geometry creation;
- snap;
- inference;
- constraint creation;
- solving;
- dimension logic;
- renderer logic;
- DOF state.

---

# E. Findings

> Pending evidence synthesis in T5.

Preliminary architectural observations are intentionally not assigned final severity until the required flows identify concrete consequences.

---

# F. KEEP / REFACTOR / REPLACE / REMOVE / CREATE

> Pending T5.

No component will be marked `REMOVE` without verified consumers, tests, responsibility, and replacement behavior.

---

# G. Target Architecture

> Pending T6. The audit will evaluate the issue's proposed layering against current repository boundaries rather than imposing new classes or packages.

---

# H. Data Model

> Pending T2, T3, and T6.

The target section must address:

- geometry entities and stable references;
- local and document constraints;
- dimensions and parameters;
- construction role semantics;
- solved geometry versus persisted intent;
- DOF and sketch state;
- schema migration and compatibility.

---

# I. Service Contracts

> Pending T6.

Contracts to evaluate:

- Snap;
- Inference;
- Relations/constraints;
- Automatic relations;
- Dimensions;
- Sketch state/DOF.

Names such as `SnapService` are conceptual until evidence justifies a concrete repository abstraction.

---

# J. Migration Plan

> Pending T7. No big-bang rewrite will be proposed.

Each migration unit must define objective, scope, exclusions, dependencies, coexistence, tests, acceptance criteria, and rollback.

---

# K. Testing Strategy

## K.1 Current test surfaces

| Layer | Current evidence surface |
|---|---|
| Domain | `packages/domain/src/index.test.ts` |
| Validation/migrations | `packages/validation/src/index.test.ts`, `glyph.test.ts` |
| Geometry and solver | `packages/geometry/src/*.test.ts` including solver, curves, intersections, topology, profiles, and dimensions |
| Constraint boundary | `packages/constraints/src/index.test.ts`, `test-fixtures.test.ts` |
| Editor commands/history | `packages/editor-core/src/index.test.ts` |
| Sketch kernel/session | `sketchKernel.test.ts`, `sketchSession.test.ts`, `profileScope.test.ts`, `trim.test.ts` |
| Web interaction/snap | `apps/web/src/interaction.test.ts` |
| Global constraints | `apps/web/src/globalConstraintCommands.test.ts` |
| Rendering | `packages/renderer-svg/src/index.test.ts`, `glyph.test.ts` |
| Persistence/recovery | persistence package tests plus `appPersistence.test.ts` and `appRecovery.test.ts` |
| E2E | `tests/e2e/app.smoke.spec.ts`, `project-workflow.spec.ts` |

Current E2E coverage is workflow/smoke evidence, not a replacement for mathematical or solver-level tests.

## K.2 Target strategy

> Pending T7 after current behavior and gaps are fully traced.

---

# L. Risks

## Baseline risks to investigate

These are investigation targets, not confirmed failures:

- divergence between persisted geometry and solved/derived geometry;
- ambiguity between explicit connections, positional coincidences, and solver constraints;
- duplicate automatic relations or over-definition;
- preview/commit disagreement;
- topology edits invalidating stable dimension/constraint references;
- incomplete migration of future construction roles;
- mismatch between component DOF and persisted piece state;
- inconsistent dimension-driving semantics across entity types;
- pointer-move cost from repeated snap, inference, solve, and React rendering;
- export and profile behavior if construction geometry is introduced.

---

# M. Recommendation

> Final answer deferred until T5–T8.

Question required by issue #230:

> Are KOND's current problems caused partially or primarily by missing separation of these responsibilities?

Preliminary answer: **the repository contains several split and overlapping responsibility paths that plausibly contribute to inconsistency, but the baseline alone cannot establish whether they are the primary cause.** The required end-to-end traces and severity-ranked findings must establish causality before the final recommendation.

---

# Audit Progress

| Task | Status | Evidence |
|---|---|---|
| T1 — Baseline and capability inventory | Complete | Baseline `9434cfdd`; independently verified; committed as `0af8d7a` |
| T2 — Architecture and sources of truth | In progress | — |
| T3 — Required end-to-end flows | Pending | — |
| T4 — Responsibility/tool matrices | Pending | — |
| T5 — Findings and disposition | Pending | — |
| T6 — Target architecture/contracts | Pending | — |
| T7 — Migration/testing/performance/UX/rollback | Pending | — |
| T8 — Review and approval gate | Pending | — |
