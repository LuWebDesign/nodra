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

## B.4 Current sources of truth

| State | Canonical current owner | Lifecycle | Writers and readers | Overlap or limitation |
|---|---|---|---|---|
| Persisted geometry | Domain `Element` records inside `DocumentSnapshot` / `ProjectSnapshot` | Persisted | editor-core commands write; geometry, constraints, renderer, validation, and persistence read | Active editor documents and project pages are synchronized through `documentFromProject` / `projectFromDocument`. |
| Sketch topology intent | `SketchElement.nodes` and `.edges` | Persisted | editor-core topology commands write; solver, profiles, dimensions, renderer, and web read | Derived curve/profile/mixed-topology graphs coexist but are not persisted truth. |
| Local constraints | `SketchElement.constraints` | Persisted intent | editor-core relation commands write; geometry/constraints/kernel read | Solved coordinates are derived and can later be committed into snapshots. |
| Document constraints | `DocumentSnapshot.constraints` | Persisted intent | editor-core and web global-constraint wrappers write; constraints/kernel/renderer read | Uses the same domain constraint shape as local constraints; normalization reconstructs scope. |
| Explicit connections | `DocumentSnapshot.connections` | Persisted metadata | confirmed creation commits write; editor-core preservation, validation, and persistence read | Separate from positional coincidences and solver `coincident` constraints. |
| Positional coincidences | `DocumentSnapshot.positionalCoincidences` | Persisted enforced relation | positional commands write; editor-core replacement/transform paths enforce | Geometric meaning overlaps with explicit connections and solver coincidence. |
| Dimensions | `DimensionElement` | Persisted annotation and optional driving metadata | web creates; editor-core updates; geometry, renderer, hit testing, and inspector read | Display geometry is derived; references retain stable IDs plus legacy index compatibility. |
| Driving values | Constraint values and dimension/circle driving fields | Persisted values/flags | constraint and dimension commands write; solvers and inspector read | No standalone parameter registry; contracts differ by sketch, circle, and dimension path. |
| Solved geometry | Solver output; committed node coordinates after accepted commands | Derived, then sometimes committed | geometry/constraints/kernel derive; editor-core replacement paths commit accepted coordinates | Persisted coordinates represent the latest accepted result while constraints retain design intent. |
| Residuals, diagnostics, DOF | constraints functions and kernel recomputation results | Derived/transient | solver functions produce; renderer, web, and commands consume | Geometry status, component state, and piece lifecycle state are separate systems. |
| Selection | `EditorState.selection` for editor commands | Transient | editor-core selection commands and web handlers write; tools/inspector/rendering read | `useSelectionStore` also carries narrower UI selection context. |
| Tool and gesture state | `App.tsx`, `interaction.ts`, Zustand stores, editor gesture state | Transient | pointer/keyboard handlers write; preview, overlays, and commands read | State is split across React state, refs, Zustand, and editor-core gestures. |
| Preview state | `EditorState.gesture` plus tool-specific drafts/guides | Transient | gesture APIs and React setters write; App overlays/render input read | Several preview channels coexist; cancel must restore the gesture base. |
| Undo/redo | `EditorState.undo` / `.redo`, plus sketch-session checkpoints | Transient runtime history | `dispatch`, gesture commit, and sketch-session reducer write; UI commands read | Sketch sessions establish a second bounded history/checkpoint boundary. |
| Validation | `@nodra/validation` schemas and reference checks | Boundary computation | editor-core, persistence, renderer, and recovery invoke | Kernel, geometry, and constraints add narrower admissibility and rollback rules. |
| Rendering | renderer-svg projection functions | Derived output | no model writer; web supplies snapshots and consumes SVG | Constraint state and profile geometry are recomputed rather than read from a persisted solved-state cache. |
| Durable persistence | `DexieProjectRepository` revision records | Durable | web save queue/repository writes; startup/dashboard read | Stores project revisions, not editor undo stacks. |
| Recovery mirrors | `ProjectMirror` in localStorage | Best-effort recovery copy | web effects write; startup arbitration reads | Duplicates project snapshots but is explicitly not durable history. |
| Project/piece status | `PieceSnapshot.state` | Persisted lifecycle metadata | dashboard/sketch-association flows write; web/persistence read | Coexists with derived constraint states and has no verified synchronization contract with component DOF. |

## B.5 Current call and data flows

### Runtime composition

```text
Pointer / keyboard
  → App.tsx transient state and handlers
    → interaction.ts picking, snapping, and visual guides
    → editor-core command / gesture
      → command.apply()
      → sketch-kernel recomputation only on sketch-specific paths
        → solveConstraintComponents()
        → solveSketchConstraints()
        → residuals / component state / rank / DOF / diagnostics
        → profile and mixed-topology derivation
      → final command-result document validation
      → accepted EditorState document + selection + history

Conditional App consumers of accepted state
  ├→ projectFromDocument() when project synchronization is required
  ├→ recovery mirror and durable-save scheduling only for eligible committed state
  └→ renderSvg() / profile overlays from current document or explicit preview input
```

### Sketch mutation and topology

```text
Sketch-specific creation/replacement path
  → createSketchLine / appendSketchEdge / sketch replacement
    → enforce positional coincidences where applicable
    → remove dangling document constraints where applicable
    → recompute sketch kernel
      → validate candidate
      → solve local/document constraints
      → derive profiles/topology
      → return rollback result on invalid/conflicting state
    → editor-core rejects rollback or commits accepted elements/revision
  → dispatch()
    → transaction(before, after, selection) only for an accepted change

Generic topology command
  → replaceTopology()
    → reference remap / cleanup / validation
    → accepted document or no-op/error
  (no automatic sketch-kernel recomputation unless routed through a sketch-specific path)
```

### Project/document synchronization

```text
ProjectSnapshot pages + piece ownership
  → documentFromProject()
  → active editor DocumentSnapshot
  → editor-core commands
  → projectFromDocument()
  → updated ProjectSnapshot
    → unrelated pages remain outside the active-document replacement
    → piece-owned element association is recalculated for the active scope
    → feature references are preserved only when their ownership/reference conditions remain valid
```

### Persistence and recovery

```text
Committed ProjectSnapshot
  ├→ saveProjectMirror() → localStorage best-effort copy
  └→ DexieProjectRepository.saveProject()
       → validate project/document
       → identity + revision checks
       → durable revision transaction

Startup
  → load newest valid Dexie revision
  → load and validate ProjectMirror
  → selectRecoveredProject() by revision and savedAt
  → documentFromProject() → editor state
```

### Rendering

```text
Validated DocumentSnapshot
  → renderSvg()
    → visible-layer filtering
    → constraint component states
    → dimension geometry
    → escaped SVG projection

Explicit piece/selection profile scope
  → sketchProfileResult()
  → renderSketchProfileSvg()
```

## B.6 Required end-to-end flow evidence

### A. Create a line

Current behavior has two gesture-dependent representations.

#### A1. Click sequence: parametric sketch line

```text
pointer click
  → page-space point and snap candidate
  → CreationDraft
  → confirmation click
    ├→ ordinary start: createSketchLine()
    │    → createElement(SketchElement, creationConnections)
    └→ start anchored to an existing sketch node: appendSketchEdge() on that sketch
  → dispatch()
  → validated sketch replacement / solve where applicable
  → EditorState transaction
  → project synchronization, rendering, and eligible persistence
```

Verified ownership:

| Step | Owner and symbols | Behavior |
|---|---|---|
| Pointer and draft | `App.tsx` pointer handlers, `CreationDraft` | Web owns the multi-click interaction and transient feedback. |
| Candidate and feedback | `snapCreationPoint`, creation/alignment/directional guides | Interaction code returns candidates/guides; no hover result is persisted. |
| Initial model creation | `createSketchLine`, or `appendSketchEdge` when the initial snap anchors to an existing sketch node | Creates a new stable sketch graph for an ordinary start, or extends the existing sketch topology for the anchored branch. |
| Automatic relations | `createSketchLine` | Adds `auto:*` horizontal or vertical relation when the angular threshold is met. |
| First confirmed snap relation | `creationConnections` + `createElement` | May persist explicit connection metadata for confirmed creation snaps. |
| Continuation | `appendSketchEdge` | Adds stable topology, can reuse a same-sketch target node, and can add H/V or perpendicular automatic relations. |
| Mutation/history | `dispatch` and command-result validation | Each accepted dispatched creation command can create a transaction. |
| Solve/rollback | sketch replacement/kernel paths | Supported sketch constraints are solved; rejected/no-op results do not create a transaction. |
| Render/persist | `renderSvg`, `setEditorState`, project conversion and persistence effects | Committed state is rendered and may be mirrored/autosaved when eligibility gates pass. |

Escape clears the active creation draft but does not undo sketch segments already dispatched by prior clicks. Existing tests do not establish that the complete multi-segment gesture is intended to be one transaction.

#### A2. Drag sequence: native line

```text
pointer down + drag
  → beginGesture()
  → pointer move
  → newElement("line")
  → gesture preview
  → pointer up
  → commitGesture() or cancelGesture()
```

This path creates a native `LineElement`, not a sketch. It does not receive sketch topology, automatic H/V/perpendicular relations, or sketch solver semantics. The verified drag path also bypasses creation-snap connection persistence.

**Verified representation split:** the same visible line tool can produce different domain entities and parametric behavior depending on gesture path. Severity and intended compatibility status remain for T5.

### B. Create a rectangle

```text
first click
  → snap candidate + CreationDraft
  → pointer movement / normalized transient preview
  → confirmation click
  → newElement("rectangle")
  → createElement(RectangleElement, optional creation connections)
  → validation/history/render/persistence
```

A rectangle is one native `RectangleElement` with position, size, corner radius, and rotation. It is not four sketch edges and creation does not produce horizontal, vertical, or coincident sketch constraints.

Consequences verified in current code:

- later edits use rectangle resize/shape commands, not vertex constraint solving;
- named anchors can participate in explicit connection metadata;
- an unrotated rectangle dimension can resize the native shape through `updateDimensionValue`;
- this is direct native-shape geometry behavior, not the idealized four-edge parametric rectangle from issue #230.

`tests/e2e/app.smoke.spec.ts` covers native rectangle creation through the two-click pointer sequence. No browser-level test proves four-edge parametric rectangle behavior, because that behavior is not implemented by the creation path.

### C. Endpoint-to-endpoint snap

#### Candidate and feedback

`snapCreationPoint` searches visible real geometry nodes using zoom-scaled tolerance and returns the nearest point/address. Creation guides and hover state display feedback without mutating the document.

#### Coordinate effect

On confirmation, web orchestration chooses the snapped point before directional/alignment fallbacks. Move snapping is different: `snapMoveDelta` returns a corrected delta and guide; it does not write the document.

#### Persistence semantics by path

| Context | Persistent result |
|---|---|
| First confirmed native/sketch creation using `creationConnections` | May append `ExplicitConnection` metadata. |
| Same-sketch continuation snapped to an existing sketch node | Reuses the stable node in topology; no separate connection is required. |
| Continuation snapped to an external endpoint | No equivalent confirmed persistent-connection path was found in the continuation command. |
| Move snap | Alters the requested movement delta only; it does not create a relation. |
| Hover/guide | Never creates a relation. |

Three relationship forms therefore coexist:

1. explicit `connections` metadata;
2. enforced `positionalCoincidences`;
3. solver `coincident` constraints.

Positional coincidence propagation is implemented by both applicable generic `replaceElements` paths and sketch replacement paths, so supported native moves can propagate explicitly persisted positional coincidences. This remains command/path dependent rather than an automatic property of every coordinate edit. Legacy explicit connections remain metadata rather than general solver constraints.

Unit tests strongly cover candidate priority, visibility, named addresses, zoom tolerance, and selected positional-coincidence behavior. No complete browser test covers pointer feedback through persisted relation and undo.

### D. Create and edit a dimension

```text
hover / click
  → pickDimensionTarget()
  → first-reference draft
  → second reference
  → placement preview
  → DimensionElement creation
  → optional setDimensionDriving()
  → value edit through updateDimensionValue()
  → supported geometry/constraint update
  → render/history/persistence
```

Verified ownership and behavior:

- `pickDimensionTarget` owns reference picking and prioritizes real nodes, circular center/rim targets, and supported native line bodies.
- `newDimension`, `newCircleDimension`, and `newAngularDimension` in web orchestration build persisted dimension elements.
- placement geometry comes from geometry helpers.
- preview is synthesized for rendering as a temporary dimension input; it is not persisted.
- supported circle and same-sketch dimensions can be switched to driving mode by associating a constraint.
- `updateDimensionValue` contains entity-specific branches for cross-object references, arcs/circles, native lines, paths, sketches, angular behavior, and unrotated rectangles.
- driving sketch branches update constraints and solve; native branches can change coordinates directly through editor-core commands.
- accepted updates use normal history/no-op semantics and render as document elements.

There is no standalone parameter model. Strong helper/command tests exist, but no browser-level test spans target picking, placement, driving edit, persistence, rendering, and undo.

### E. Move geometry

```text
pointer down on selection/node
  → beginGesture()
  → pointer move from gesture base
    → screen delta to mm
    → snapMoveDelta()
    → alignmentGuides()
    → previewGestureFromBase(move/update command)
  → pointer up
  → commitGesture() or cancelGesture()
  → render and eligible project persistence
  → undo/redo
```

`previewGestureFromBase` avoids cumulative pointer drift. `moveElements` constructs translated coordinates for each supported native representation inside editor-core; this is a direct coordinate update behind the command/validation boundary.

Behavior differs by representation:

- sketch-specific node/replacement paths invoke sketch solving and can reject conflict/overdefined results;
- supported positional coincidences propagate through applicable generic `replaceElements` and sketch replacement paths, including supported native moves;
- native legacy elements do not acquire sketch constraints merely because they moved;
- legacy explicit connections are metadata and are not universally enforced as solver relations;
- cancel restores the gesture base;
- an accepted commit creates one transaction, while rejected/no-op results do not advance history or revision;
- active previews are excluded from official persistence, while accepted committed state can update mirrors/autosave under normal gates.

Unit tests cover snap-delta selection, command/history semantics, solver behavior, and selected positional propagation. Missing integration coverage includes a full pointer drag with snap + solve + commit/cancel + undo and repeated constrained preview moves.

## B.7 Cross-flow verified discrepancies

1. **Gesture-dependent line model** — click creates a sketch; drag creates a native line.
2. **Different preview channels** — gesture snapshots, render-only dimension elements, and separate creation overlays coexist.
3. **Different commit boundaries** — click continuation dispatches accepted segments while its draft remains active; drag gestures commit at pointer-up.
4. **Snap does not imply one relation type** — a snap may produce metadata, shared topology, only a corrected coordinate/delta, or no persistent relation.
5. **Direct coordinate updates remain representation-specific** — editor-core contains native geometry writes while sketch paths add solver/replacement semantics.
6. **Escape semantics differ from rollback** — clearing a web draft does not reverse already accepted editor transactions.

### T3 hypotheses still requiring later classification

- The line representation split may be intentional legacy compatibility or an accidental architectural divergence.
- External endpoint snap during sketch continuation may be intentionally non-persistent or a missing relation path.
- Multi-segment click creation may intentionally create multiple undo entries or violate the expected one-gesture transaction rule.
- Generic transforms beyond the traced move paths may bypass solver guarantees.
- Current package tests may be sufficient for units but insufficient for user-visible flow compatibility.

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

## C.4 Confirmed ownership overlaps

The following overlaps are verified architectural facts; their severity and behavioral consequences remain pending T3–T5.

1. **Constraint representation** — local constraints live on sketches; document constraints live on the document; both use compatible domain shapes and are merged by normalization. Web global-constraint wrappers add solve-and-apply orchestration.
2. **Coincidence and connection semantics** — explicit connections, positional coincidences, and solver `coincident` constraints are persisted under separate contracts with partially overlapping geometric meaning.
3. **Solved geometry and intent** — constraints persist design intent; solver output is derived; accepted editor-core paths can commit solved coordinates into the next document snapshot.
4. **Topology representations** — persisted sketch nodes/edges, curve adapters/pieces, profile loops/regions, and kernel mixed topology coexist at different projection stages.
5. **Definition status** — constraint components expose parametric state and DOF, while pieces persist a separate lifecycle state; no synchronization contract is currently verified.
6. **Interaction state** — editor-core owns transactional gesture semantics, while React state, refs, and Zustand own tool-specific drafts, hover, guides, modes, viewport, and persistence status.
7. **Validation layers** — validation owns schema/reference validity; command paths own cleanup; `recomputeSketchKernel` determines rollback and editor-core rejects that result without recording a transaction; geometry, constraints, and renderer impose narrower admissibility rules.
8. **Persistence representations** — Dexie revisions are durable; localStorage mirrors are best-effort recovery copies governed by web arbitration.
9. **Dimensions and parameters** — dimension driving metadata, circle constraint values, and sketch constraint values exist without one general parameter source.

### Unresolved T2 hypotheses

- Persisted solved coordinates may diverge from persisted constraint intent on mutation paths not yet traced.
- Piece lifecycle state may be deliberately coarse or may become stale relative to component DOF.
- The three coincidence/connection representations may be intentional product semantics or accidental duplication.
- Multiple topology projections may be valid boundaries or may produce inconsistent edits.
- App-level interaction state may exceed composition responsibility, but file size or state count alone does not prove a defect.
- Dimension-driving coverage may be intentionally bounded rather than architecturally inconsistent.
- Preview solving may affect pointer performance; no performance measurement has yet been taken.
- Project/document conversion preservation requires dedicated cross-page and cross-piece evidence.

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

## H.1 Current persisted model

The current parametric model stores geometry and intent together in validated snapshots:

- sketch geometry is a stable node/edge graph;
- local constraints are owned by each sketch;
- document constraints connect references at document scope;
- explicit connections and positional coincidences are separate persisted relationship records;
- dimensions are elements with stable references and optional driving metadata;
- constraint values are embedded in constraints rather than a general parameter registry;
- accepted solved coordinates can become the next persisted geometry snapshot;
- project pieces persist a coarse lifecycle state independently of solver component state.

## H.2 Current derived model

The following are recomputed and are not independent persisted truth:

- solved previews;
- residuals and diagnostics;
- connected constraint components;
- Jacobian rank and degrees of freedom;
- component definition/conflict state;
- curve topology, mixed topology, contours, loops, and profile regions;
- dimension display geometry;
- SVG output.

## H.3 Current transient model

Selection, gesture bases, pointer interaction, drafts, hover, guides, viewport, sketch-session checkpoints, and undo/redo stacks remain runtime state. They do not belong to domain snapshots or durable project history.

## H.4 Missing or unresolved current contracts

- No construction-geometry role exists.
- No unified parameter entity exists.
- No verified synchronization exists between DOF/component state and `PieceSnapshot.state`.
- Coincidence meaning is distributed across three persisted relation forms.
- Stable reference migration is supported, but topology-changing flow evidence remains for T3.
- The target model and compatibility strategy remain deferred to T6 and T7.

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
| T2 — Architecture and sources of truth | Complete | Sections B.4, B.5, C.4, and H; independently verified; committed as `4204f59` |
| T3 — Required end-to-end flows | Evidence complete; independently verified; awaiting human review and commit authorization | Sections B.6 and B.7; no blocking factual inaccuracies |
| T4 — Responsibility/tool matrices | Pending | — |
| T5 — Findings and disposition | Pending | — |
| T6 — Target architecture/contracts | Pending | — |
| T7 — Migration/testing/performance/UX/rollback | Pending | — |
| T8 — Review and approval gate | Pending | — |
