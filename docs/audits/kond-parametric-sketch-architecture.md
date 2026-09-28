# Technical audit: KOND parametric sketch architecture

**Issue:** #230
**Branch:** `audit/codebase-review`
**Scope:** repository evidence as of this audit; documentation only.

> **Audit-first rule.** This document records architecture, evidence, gaps, and a migration direction before implementation. The audit itself approves no implementation, schema change, service, or fix. Any change requires a separately reviewed proposal, acceptance criteria, and implementation decision.

## Executive summary

Nodra has a real first-slice parametric kernel for `SketchElement` line graphs. Creation, sketch mutation, constraint solving, validation, topology derivation, rollback, history, and rendering are recognizable layers. The strongest path is the line/sketch path: `createSketchLine` creates stable node/edge IDs and automatic axis relations; sketch mutations enter `replaceSketchElements`; `recomputeSketchKernel` validates, solves, derives topology, and rolls back failed candidates ([`packages/editor-core/src/index.ts:451-459`](../../packages/editor-core/src/index.ts#L451-L459), [`packages/editor-core/src/index.ts:245-247`](../../packages/editor-core/src/index.ts#L245-L247), [`packages/editor-core/src/sketchKernel.ts:142-205`](../../packages/editor-core/src/sketchKernel.ts#L142-L205)).

The architecture is not yet a uniform parametric sketch system. The UI owns substantial interaction policy and chooses between native elements and sketches ([`apps/web/src/App.tsx:60-68`](../../apps/web/src/App.tsx#L60-L68), [`apps/web/src/App.tsx:1254-1333`](../../apps/web/src/App.tsx#L1254-L1333)). Rectangles, circles, arcs, splines, trim, and move have different mutation paths. Constraints are represented at sketch and document scope, while positional coincidences and legacy explicit connections are separate records with different semantics ([`packages/domain/src/index.ts:55-126`](../../packages/domain/src/index.ts#L55-L126)). Solver and DOF logic is duplicated between geometry's local solver and constraints' component solver ([`packages/geometry/src/index.ts:183-208`](../../packages/geometry/src/index.ts#L183-L208), [`packages/constraints/src/index.ts:308-385`](../../packages/constraints/src/index.ts#L308-L385)). Construction geometry has no explicit domain role in the current model; this is an observed absence, not a proposal that it should be added immediately.

Recommendation: **KEEP** the current sketch-kernel boundary and stable topology references; **REFACTOR** interaction and mutation routing behind explicit tool/geometry services; **REPLACE** duplicated solver ownership with one canonical constraint engine only after behavioral parity is proven; **CREATE** a versioned construction-geometry concept and unified relation taxonomy only through a separate approved design; **REMOVE** no legacy representation until migration telemetry and compatibility tests demonstrate safety.

## Current architecture diagram

```text
Pointer / keyboard events
        |
        v
apps/web App.tsx  ------------------------------+
  tool policy, drafts, picking, guides           |
  chooses native element or SketchElement        |
        |                                        |
        v                                        v
apps/web/interaction.ts                    editor-core commands
  snap/inference/guides/picking              create/update/move/trim/history
        |                                        |
        +--------------------+-------------------+
                             v
                    DocumentSnapshot (domain)
        native elements | sketches | dimensions | constraints
        connections | positionalCoincidences | featureTree?
                             |
                  sketch-aware replace boundary
                             v
                     sketchKernel recompute
       validation -> constraints solve -> topology/profile derivation
              rollback or solved candidate (derived state not persisted)
                             |
            +----------------+----------------+
            v                                 v
   renderer-svg (projection)          persistence (durable records,
   geometry + constraint state         validation/migration/recovery)
```

The renderer consumes document geometry and derived constraint state; it does not own geometry truth ([`packages/renderer-svg/src/index.ts:1-5`](../../packages/renderer-svg/src/index.ts#L1-L5), [`packages/renderer-svg/src/index.ts:100-111`](../../packages/renderer-svg/src/index.ts#L100-L111)). Persistence validates records and revisions before writing them ([`packages/persistence/src/index.ts:107-113`](../../packages/persistence/src/index.ts#L107-L113), [`packages/persistence/src/index.ts:162-180`](../../packages/persistence/src/index.ts#L162-L180)).

## End-to-end traces

### Line

1. Pointer handling computes raw point, `snapCreationPoint`, directional guidance, and node alignment ([`apps/web/src/App.tsx:1254-1274`](../../apps/web/src/App.tsx#L1254-L1274)).
2. The first line click creates a `SketchElement` through `createSketchLine`, not a native `LineElement`; confirmed snaps become connection metadata through `creationConnections` ([`apps/web/src/App.tsx:65-68`](../../apps/web/src/App.tsx#L65-L68), [`apps/web/src/App.tsx:1329-1333`](../../apps/web/src/App.tsx#L1329-L1333)).
3. Continuing a line calls `appendSketchEdge`; it may reuse a target node and adds horizontal/vertical and perpendicular automatic relations ([`packages/editor-core/src/index.ts:488-516`](../../packages/editor-core/src/index.ts#L488-L516)).
4. `createElement` routes sketches through `replaceSketchElements`; the kernel validates/solves before the editor revision/history boundary ([`packages/editor-core/src/index.ts:350-368`](../../packages/editor-core/src/index.ts#L350-L368), [`packages/editor-core/src/index.ts:245-247`](../../packages/editor-core/src/index.ts#L245-L247)).
5. SVG renders sketch edges from node coordinates and derives fill from the sketch profile ([`packages/renderer-svg/src/index.ts:100-111`](../../packages/renderer-svg/src/index.ts#L100-L111)).

**Assessment:** sketch-native and constraint-aware, but creation policy remains UI-owned and automatic relation heuristics are embedded in editor commands.

### Rectangle

1. The UI's `newElement` creates a native `RectangleElement` with position, size, radius, and style ([`apps/web/src/App.tsx:60-64`](../../apps/web/src/App.tsx#L60-L64)).
2. Rectangle creation applies a confirmed snap as explicit connection metadata, then dispatches generic `createElement` ([`apps/web/src/App.tsx:1275-1286`](../../apps/web/src/App.tsx#L1275-L1286)).
3. Resize/move use native element mutation; the rectangle has no sketch nodes or sketch constraints in the domain type ([`packages/domain/src/index.ts:24-43`](../../packages/domain/src/index.ts#L24-L43), [`packages/editor-core/src/index.ts:833-856`](../../packages/editor-core/src/index.ts#L833-L856)).
4. Rendering projects rectangle geometry directly ([`packages/renderer-svg/src/index.ts:74-98`](../../packages/renderer-svg/src/index.ts#L74-L98)).

**Assessment:** a useful native primitive, but not equivalent to a constrained four-edge sketch. The audit found no evidence that rectangle dimensions participate in the sketch DOF model.

### Endpoint snap

1. `snapCreationPoint` searches visible real geometry nodes and returns a transient target; `creationGuides` returns visual-only guides ([`apps/web/src/interaction.ts:360-385`](../../apps/web/src/interaction.ts#L360-L385)).
2. On confirmed creation, `creationConnections` converts a snap with a node into `ExplicitConnection` metadata ([`apps/web/src/App.tsx:65-77`](../../apps/web/src/App.tsx#L65-L77)).
3. Sketch line continuation can instead reuse an existing sketch node by passing `toNodeId` to `appendSketchEdge` ([`apps/web/src/App.tsx:1324-1343`](../../apps/web/src/App.tsx#L1324-L1343), [`packages/editor-core/src/index.ts:488-503`](../../packages/editor-core/src/index.ts#L488-L503)).
4. Positional coincidences are a separate opt-in command path and are enforced during sketch replacement ([`apps/web/src/App.tsx:1964-1980`](../../apps/web/src/App.tsx#L1964-L1980), [`packages/editor-core/src/index.ts:245-247`](../../packages/editor-core/src/index.ts#L245-L247)).

**Assessment:** transient snap, persistent connection metadata, node reuse, and enforced positional coincidence are distinct behaviors. A click that looks coincident is not uniformly a persistent parametric relation.

### Dimensions

1. Dimension target picking prioritizes nodes, then native line/sketch-edge bodies ([`apps/web/src/interaction.ts:465-468`](../../apps/web/src/interaction.ts#L465-L468)).
2. The UI creates dimension records and decides whether a dimension should create a driving sketch constraint or drive a circle ([`apps/web/src/App.tsx:52-59`](../../apps/web/src/App.tsx#L52-L59)).
3. `dimensionGeometry` derives displayed geometry from references; the renderer only projects that result ([`packages/geometry/src/index.ts:413-416`](../../packages/geometry/src/index.ts#L413-L416), [`packages/renderer-svg/src/index.ts:239-254`](../../packages/renderer-svg/src/index.ts#L239-L254)).
4. `updateDimensionValue` has entity-specific branches: cross-object movement, arc radius, driving circle constraints, native line angle, sketch constraints, and native rectangle dimensions ([`packages/editor-core/src/index.ts:2378-2460`](../../packages/editor-core/src/index.ts#L2378-L2460), [`packages/editor-core/src/index.ts:2561-2590`](../../packages/editor-core/src/index.ts#L2561-L2590)).

**Assessment:** dimensions are both annotation records and mutation commands. Driving semantics are explicit for some cases, absent or prohibited for others; this is coupled policy rather than one uniform dimensional constraint model.

### Move

1. During a move gesture, the UI computes raw screen delta, calls `snapMoveDelta`, draws alignment guides, and previews `moveElements` from the gesture base ([`apps/web/src/App.tsx:1358-1370`](../../apps/web/src/App.tsx#L1358-L1370)).
2. `snapMoveDelta` returns a deterministic corrected delta; alignment guides are explicitly visual-only ([`apps/web/src/interaction.ts:253-300`](../../apps/web/src/interaction.ts#L253-L300)).
3. `moveElements` translates each element type. A selection containing a sketch enters `replaceSketchElements`, while native-only selections use generic replacement ([`packages/editor-core/src/index.ts:833-856`](../../packages/editor-core/src/index.ts#L833-L856)).
4. Gesture commit/rollback is owned by editor-core, with preview recomputed from the base to avoid accumulating pointer corrections ([`packages/editor-core/src/index.ts:3176-3196`](../../packages/editor-core/src/index.ts#L3176-L3196)).

**Assessment:** move is transactionally sound for sketch candidates, but snap correction and element-specific translation are split across UI and editor-core; native and parametric movement do not share one explicit solver-facing intent contract.

## Responsibility map

Legend: each cell is `coverage / quality`, where coverage is **YES**, **PARTIAL**, or **NO**, and quality is **GOOD**, **COUPLED**, **DUPLICATED**, **LEAKING**, or **MISSING**.

| Responsibility | Owner/evidence | Assessment |
| --- | --- | --- |
| Persisted geometry schema | `domain` element types and `DocumentSnapshot` ([`packages/domain/src/index.ts:24-126`](../../packages/domain/src/index.ts#L24-L126)) | YES / COUPLED |
| Pointer policy and tool state | `App.tsx` ([`apps/web/src/App.tsx:1254-1333`](../../apps/web/src/App.tsx#L1254-L1333)) | YES / LEAKING |
| Picking and snap candidates | `interaction.ts` ([`apps/web/src/interaction.ts:253-468`](../../apps/web/src/interaction.ts#L253-L468)) | YES / COUPLED |
| Sketch command boundary | `editor-core` + `sketchKernel` | YES / GOOD |
| Native geometry mutation | `editor-core` commands | YES / COUPLED |
| Constraint solving | geometry local solver + constraints component solver | YES / DUPLICATED |
| DOF/rank/status | `constraints` ([`packages/constraints/src/index.ts:376-385`](../../packages/constraints/src/index.ts#L376-L385)) | YES / DUPLICATED |
| Topology/profile derivation | geometry and sketch kernel | YES / COUPLED |
| Dimension display geometry | geometry + renderer | YES / GOOD |
| Dimension mutation semantics | editor-core command branches | YES / COUPLED |
| Persistent relation taxonomy | domain connections/coincidences/constraints | PARTIAL / DUPLICATED |
| Construction geometry | no domain role observed | NO / MISSING |
| Rendering ownership of truth | renderer consumes document/derived data | YES / GOOD |
| Validation and migration | validation package | YES / GOOD |
| Durable persistence/recovery | persistence package | YES / GOOD |
| End-to-end parametric regression | E2E has sketches, dimensions, snaps; no complete construction workflow observed | PARTIAL / MISSING |

## Tool coupling matrix

`GOOD` means the tool enters an appropriate command/validation path; `COUPLED` means policy is split or entity-specific; `DUPLICATED` means multiple implementations; `LEAKING` means UI/domain concerns cross the boundary; `MISSING` means no evidence of the capability.

| Tool | Geometry representation | Creation/mutation route | Relations/solver | Coupling assessment |
| --- | --- | --- | --- | --- |
| Line | SketchElement by UI choice | `createSketchLine`, `appendSketchEdge` | local + component constraints | GOOD, with UI LEAKING |
| Rectangle | Native RectangleElement | generic create/move/resize | connections only; no sketch DOF evidence | COUPLED / MISSING parametric parity |
| Circle | Native CircleElement | generic create; circle-specific dimension branch | circle constraints + component adapter | COUPLED |
| Arc | Native ArcElement | generic create; arc radial mutation | no general sketch-arc constraint evidence | PARTIAL / COUPLED |
| Spline | Native SplineElement | spline commands and node/handle updates | no sketch constraint integration evidence | PARTIAL / COUPLED |
| Trim | native/path/sketch-specific dispatch | `trimSegment` and sketch cut paths | topology/profile validation for sketches | COUPLED |
| Move | per-element translation | `moveElements`, sketch replacement when present | positional enforcement for sketch path | COUPLED |
| Dimension | DimensionElement annotation | `updateDimensionValue` branches by target | explicit sketch/circle constraints in selected cases | COUPLED / DUPLICATED |

The matrix is intentionally conservative: “no evidence” is not “unsupported.” The audit does not infer behavior from names alone.

## Snap vs inference vs persistent relation

| Concept | Current meaning | Lifetime | Evidence |
| --- | --- | --- | --- |
| Snap | nearest visible node/center correction to a pointer or move delta | transient unless consumed | [`apps/web/src/interaction.ts:253-385`](../../apps/web/src/interaction.ts#L253-L385) |
| Inference | directional/axis/alignment guide or inferred point used by UI policy | transient | [`apps/web/src/App.tsx:1254-1274`](../../apps/web/src/App.tsx#L1254-L1274), [`apps/web/src/interaction.ts:381-462`](../../apps/web/src/interaction.ts#L381-L462) |
| Explicit connection | legacy/annotation-style node metadata | persisted; not shown as solver constraint | [`packages/domain/src/index.ts:103-108`](../../packages/domain/src/index.ts#L103-L108) |
| Positional coincidence | opt-in relation enforced by editor commands | persisted and enforced | [`packages/domain/src/index.ts:106-108`](../../packages/domain/src/index.ts#L106-L108), [`packages/editor-core/src/index.ts:245-247`](../../packages/editor-core/src/index.ts#L245-L247) |
| Sketch constraint | geometric equation/relation in local or document scope | persisted and solved | [`packages/domain/src/index.ts:75-83`](../../packages/domain/src/index.ts#L75-L83), [`packages/constraints/src/index.ts:418-480`](../../packages/constraints/src/index.ts#L418-L480) |

The principal architectural risk is semantic overload: the UI can visually communicate alignment while the document stores either no relation, a legacy connection, a positional coincidence, or a solver constraint. These must remain distinguishable in UX and APIs.

## Automatic relations

- `createSketchLine` adds horizontal or vertical when the segment is within a 10% axis tolerance ([`packages/editor-core/src/index.ts:451-459`](../../packages/editor-core/src/index.ts#L451-L459)).
- `appendSketchEdge` repeats that heuristic and can add perpendicular to the preceding edge ([`packages/editor-core/src/index.ts:504-516`](../../packages/editor-core/src/index.ts#L504-L516)).
- A continued line can reuse an existing sketch node, which is topological identity rather than merely coincident coordinates ([`packages/editor-core/src/index.ts:495-503`](../../packages/editor-core/src/index.ts#L495-L503)).
- Confirmed snaps can create `ExplicitConnection` records in the UI ([`apps/web/src/App.tsx:65-77`](../../apps/web/src/App.tsx#L65-L77)).

Unknown from the current evidence: whether every automatic relation is surfaced consistently for editing/removal, whether automatic relations are deduplicated after topology edits, and whether native-element snap metadata is consumed by all mutation commands.

## Construction geometry assessment

No `construction`, `isConstruction`, or equivalent role is present in the inspected domain element contracts; `SketchElement` contains nodes, edges, constraints, style, and operation metadata but no construction role ([`packages/domain/src/index.ts:75-83`](../../packages/domain/src/index.ts#L75-L83)). Renderer logic treats sketch edges as drawable sketch geometry and does not show a construction-specific projection branch ([`packages/renderer-svg/src/index.ts:100-111`](../../packages/renderer-svg/src/index.ts#L100-L111)). Therefore construction geometry is **MISSING as an explicit persisted concept**.

This does not establish that construction-like visual behavior is impossible; it establishes that the audit found no explicit domain contract or end-to-end lifecycle for construction geometry. Required unknowns before design: intended export/cut semantics, whether construction entities may carry constraints and dimensions, visibility/style rules, conversion to/from regular geometry, and persistence compatibility requirements.

## DOF and sketch state

The domain persists sketch geometry and constraints, but not derived DOF. The constraints package builds component inputs, computes Jacobian rank, and reports `degreesOfFreedom = coordinateCount - rank` and a state ([`packages/constraints/src/index.ts:358-385`](../../packages/constraints/src/index.ts#L358-L385)). It then projects global constraints and solves eligible local components ([`packages/constraints/src/index.ts:418-480`](../../packages/constraints/src/index.ts#L418-L480)). Geometry independently solves local sketch constraints and reports statuses ([`packages/geometry/src/index.ts:183-208`](../../packages/geometry/src/index.ts#L183-L208)).

Renderer colorizes sketch state in editor mode from constraint component state ([`packages/renderer-svg/src/index.ts:219-235`](../../packages/renderer-svg/src/index.ts#L219-L235)). The project migration also derives an underdefined piece state when sketches exist ([`packages/validation/src/index.ts:620-628`](../../packages/validation/src/index.ts#L620-L628)). These are different layers of state: component solver state, visual sketch state, and project/piece workflow state. A canonical state contract is not yet demonstrated.

## Single sources of truth

| Data/decision | Current source of truth | Audit result |
| --- | --- | --- |
| Persisted coordinates/topology | `DocumentSnapshot` / `SketchElement` nodes and edges | GOOD for sketches |
| Derived solved coordinates | kernel result, not persisted separately | GOOD boundary |
| Constraint definitions | domain `constraints` and sketch `constraints` | COUPLED by scope/normalization |
| Constraint rank/DOF | constraints package computation | DUPLICATED with geometry status logic |
| Display dimension geometry | geometry `dimensionGeometry` | GOOD |
| Pointer snap/inference | UI interaction functions | LEAKING; not a document truth |
| Legacy node association | `connections` | DUPLICATED with positional coincidences |
| Enforced coincidence | `positionalCoincidences` + command enforcement | COUPLED |
| Rendered geometry | renderer projection of domain/geometry | GOOD |
| Durable revision | persistence record/document revision | GOOD |
| Construction role | none observed | MISSING |

## KEEP / REFACTOR / REPLACE / REMOVE / CREATE

- **KEEP:** immutable `DocumentSnapshot`; stable node/edge IDs; topology reference remapping; editor gesture base/preview/commit; kernel validate/solve/rollback; renderer as projection; validation before persistence.
- **REFACTOR:** move tool policy out of `App.tsx`; define a typed interaction intent; centralize relation classification and creation; make native/sketch mutation routing explicit; expose one diagnostic/state view to UI and renderer.
- **REPLACE:** duplicated solver/status implementation with one canonical solver service only after characterization tests and parity; do not replace by assumption.
- **REMOVE:** no immediate removal. Legacy `connections`, native rectangle paths, or entity-specific dimension branches require migration evidence and compatibility policy first.
- **CREATE:** only through an approved design: construction role, unified relation taxonomy, geometry adapters, tool capability registry, and versioned migration contracts.

## Target architecture and conceptual service contracts

The target is a conceptual boundary, not an implementation approval:

```text
Tool input -> InteractionIntent -> Geometry/Relation adapters
                         -> Sketch transaction service
                         -> Canonical constraint solver
                         -> Topology/profile derivation
                         -> Document candidate + diagnostics
                         -> history commit / renderer / persistence
```

Suggested contracts (names are illustrative and require approval):

```ts
interface InteractionIntent {
  kind: "create" | "move" | "resize" | "trim" | "dimension";
  pointer: PointMm;
  selection: readonly ElementId[];
  modifiers: Readonly<Record<string, boolean>>;
}
interface RelationCandidate {
  kind: "snap" | "inference" | "coincidence" | "constraint";
  source: ConnectableNodeReference;
  target?: ConnectableNodeReference;
  confidence: "explicit" | "inferred";
}
interface SketchTransactionService {
  preview(document: DocumentSnapshot, intent: InteractionIntent): TransactionPreview;
  commit(document: DocumentSnapshot, intent: InteractionIntent): TransactionResult;
  rollback(preview: TransactionPreview): DocumentSnapshot;
}
interface ConstraintSolveService {
  solve(document: DocumentSnapshot): SolveResult;
  analyze(document: DocumentSnapshot): readonly ConstraintComponentState[];
}
```

The contract must preserve: no persistence of derived solver output, atomic rollback on invalid/conflicting candidates, stable references through topology edits, and explicit distinction between transient candidates and persisted relations.

## Dependency-ordered migration work units

These are audit work units, not approved implementation tasks.

### WU-1 — Characterize current behavior

- **Objective:** freeze observable semantics before refactoring.
- **Scope:** tests and fixtures for line, rectangle, circle/arc dimensions, endpoint snap, move, automatic relations, rollback, and persistence round trips.
- **Out of scope:** production behavior changes; construction geometry.
- **Dependencies:** none.
- **Coexistence:** additive tests against current APIs.
- **Tests:** package unit tests, editor-core command tests, focused Playwright workflows.
- **Acceptance:** each trace above has deterministic assertions for document records, solver diagnostics, and rendered output.
- **Rollback:** delete/revert only the test work unit; no data migration.

### WU-2 — Define relation and geometry capability vocabulary

- **Objective:** agree on snap, inference, connection, coincidence, constraint, construction, and driving-dimension semantics.
- **Scope:** design/specification and compatibility matrix.
- **Out of scope:** schema migration and UI redesign.
- **Dependencies:** WU-1 evidence.
- **Coexistence:** vocabulary maps to existing records without changing them.
- **Tests:** contract examples and negative cases.
- **Acceptance:** every current record has one documented meaning and unknowns are resolved or explicitly deferred.
- **Rollback:** discard the proposal; no runtime impact.

### WU-3 — Introduce a single transaction/intent seam

- **Objective:** route UI gestures through a typed seam while preserving current commands.
- **Scope:** adapter around existing editor-core commands; no solver replacement.
- **Out of scope:** changing geometry representations or persistence schema.
- **Dependencies:** WU-1 and WU-2.
- **Coexistence:** legacy commands remain callable behind adapters.
- **Tests:** intent-to-command contract, preview/commit/cancel parity.
- **Acceptance:** line, move, trim, and dimension traces retain document and UX behavior.
- **Rollback:** disable adapter routing and use existing dispatch path.

### WU-4 — Establish canonical solve/analyze service

- **Objective:** remove duplicated ownership of solve status and DOF incrementally.
- **Scope:** characterize geometry and constraints outputs, define parity, then delegate through one service.
- **Out of scope:** new constraint kinds and construction geometry.
- **Dependencies:** WU-1 through WU-3.
- **Coexistence:** compatibility facade for existing exports.
- **Tests:** solver golden cases, rank/DOF, conflict/overdefined/non-converged cases, topology rollback.
- **Acceptance:** no behavior regression and one documented source for each derived status.
- **Rollback:** restore facade to prior implementations; retain characterization tests.

### WU-5 — Add construction geometry as a versioned capability

- **Objective:** implement only after semantics and export policy are approved.
- **Scope:** domain, validation/migration, editor commands, renderer, persistence, and tests as specified by a separate design.
- **Out of scope:** unrelated tool unification.
- **Dependencies:** WU-2 and canonical solver decision.
- **Coexistence:** old snapshots load unchanged; construction records require explicit schema capability.
- **Tests:** round trip, visibility, selection, constraints, trim/export exclusion, recovery.
- **Acceptance:** explicit invariants and backward-compatible migration are demonstrated.
- **Rollback:** feature flag/reader compatibility path; never silently reinterpret regular geometry.

### WU-6 — Migrate tools by capability, not by type switch

- **Objective:** converge Line/Rectangle/Circle/Arc/Spline/Trim/Move/Dimension on shared intents and adapters.
- **Scope:** one tool at a time, starting with line and dimension, then native geometry.
- **Out of scope:** broad UI redesign and unbounded solver features.
- **Dependencies:** WU-3, WU-4, and (where applicable) WU-5.
- **Coexistence:** per-tool routing flags and legacy data readers.
- **Tests:** matrix coverage, property tests for invariants, E2E workflows.
- **Acceptance:** each tool has an owner, representation, relation semantics, and rollback contract.
- **Rollback:** disable the migrated tool route independently.

## Layered testing strategy

1. **Domain/schema:** valid/invalid element shapes, relation references, construction capability/version migration.
2. **Geometry:** real nodes, dimension geometry, topology, intersections, profile closure, degeneracy.
3. **Constraints:** supported/unsupported relations, residuals, rank/DOF, underdefined/fully-defined/overdefined/conflict, deterministic solve.
4. **Editor-core:** command atomicity, stable IDs, topology reference remapping, gesture preview/commit/cancel, native/sketch routing.
5. **Interaction:** snap tolerance/order, inference non-persistence, guide-only behavior, deterministic move correction.
6. **Renderer:** sketch state projection, dimensions, construction visibility/exclusion once specified, no renderer-owned geometry mutation.
7. **Persistence:** schema migration, revision identity, corrupt revision recovery, round trips.
8. **E2E:** current evidence includes smoke coverage for rectangle dimensions ([`tests/e2e/app.smoke.spec.ts:529-572`](../../tests/e2e/app.smoke.spec.ts#L529-L572)), persisted confirmed node snap ([`tests/e2e/app.smoke.spec.ts:573-598`](../../tests/e2e/app.smoke.spec.ts#L573-L598)), sketch relationship preview/edit ([`tests/e2e/app.smoke.spec.ts:740-785`](../../tests/e2e/app.smoke.spec.ts#L740-L785)), cross-sketch relations ([`tests/e2e/app.smoke.spec.ts:786-938`](../../tests/e2e/app.smoke.spec.ts#L786-L938)), sketch closure ([`tests/e2e/app.smoke.spec.ts:1007-1031`](../../tests/e2e/app.smoke.spec.ts#L1007-L1031)), and dimensions/rendering ([`tests/e2e/app.smoke.spec.ts:1293-1424`](../../tests/e2e/app.smoke.spec.ts#L1293-L1424)). Add full cross-tool parametric and construction workflows only after their contracts exist.

## Invariants

- Persisted geometry is finite, schema-valid, and uses document-space millimetres.
- Derived solve/profile state is not persisted as authoritative geometry.
- Failed validation, conflict, unsupported relation, or invalid topology leaves the input document unchanged; kernel results explicitly report rollback ([`packages/editor-core/src/sketchKernel.ts:142-205`](../../packages/editor-core/src/sketchKernel.ts#L142-L205)).
- Node and edge identity, not floating-point proximity alone, governs stable topology references.
- A transient snap or guide must not become a persisted relation without an explicit creation/confirmation rule.
- A persisted relation must identify its scope, references, enforcement semantics, and deletion behavior.
- Preview is recomputed from gesture base; pointer deltas do not accumulate.
- Renderer and persistence consume domain/derived outputs; neither becomes geometry truth.
- Dimension display value and driving mutation semantics must be distinguishable.
- Unknown or unsupported geometry/relation behavior must produce diagnostics, not silent reinterpretation.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Changing native rectangles into sketches breaks saved documents or UX | characterization tests, adapter coexistence, explicit migration decision |
| Duplicate solvers diverge on edge cases | golden corpus and parity gate before consolidation |
| Snap UI implies a relation that is not persisted | explicit UX labels and relation-candidate contract |
| Topology edits invalidate dimensions/constraints | stable IDs, reference maps, deletion diagnostics, rollback tests |
| Construction geometry leaks into manufacturing output | explicit render/export policy and negative tests |
| Large cross-tool migration exceeds review capacity | dependency-ordered work units and one tool slice per change |
| Solver cost grows with cross-object relations | component scoping, measured budgets, deterministic incremental invalidation |
| Persistence migration corrupts recovery | versioned readers, dual-read tests, revision identity checks |
| Unknown current behavior is mistaken for a defect | label unknowns; resolve through tests/design, not speculation |

## Performance and UX considerations

- Snap and guide queries are currently pointer-frequency operations; preserve deterministic ordering and avoid repeated full-document scans as documents grow ([`apps/web/src/interaction.ts:253-385`](../../apps/web/src/interaction.ts#L253-L385)). A spatial index is a future option, not an audit-approved change.
- Preview solve must remain bounded and cancellable enough for pointer interaction; commit can perform stricter validation/topology checks.
- Keep stable node IDs so topology and dimensions do not visibly jump after edits.
- Explain the difference between “aligned preview,” “connected,” “coincident,” and “driving” in UI copy; do not imply persistence from a visual guide.
- Preserve gesture cancel and rollback as first-class UX, including conflict diagnostics.
- Large documents need scoped constraint recomputation and memoized derived geometry, but benchmarks are not present in this audit and thresholds are unknown.

## Final evidence-based recommendation

Proceed with an audit-first sequence: first characterize the current behavior and relation semantics, then approve a narrow transaction/intent seam, then establish one canonical solve/analyze contract with parity evidence. Keep the current sketch kernel, stable topology identifiers, validation boundary, gesture transaction model, renderer projection, and persistence validation. Do not convert rectangles or other native tools to sketches merely for architectural symmetry; the repository currently provides no evidence that such a conversion is safe or required. Treat construction geometry as a missing product/domain contract whose semantics must be decided before schema work. No implementation is approved by this audit itself.
