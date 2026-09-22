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

Classification:

- `NONE` — no verified responsibility;
- `DELEGATED` — the tool calls an owning package/helper;
- `EMBEDDED` — the responsibility is implemented inside the tool/orchestration path;
- `DUPLICATED` — materially equivalent implementation exists in multiple paths;
- `LEAKING` — persistent model semantics or representation mathematics cross their expected boundary.

Transient visual inference and persistent automatic relations are intentionally classified separately.

| Tool/path | Pointer handling | Geometry creation | Snap | Inference | Persistent relations | Solving | Dimension logic | Renderer logic | DOF/state |
|---|---|---|---|---|---|---|---|---|---|
| Line — click sketch | `EMBEDDED` — App multi-click draft | `DELEGATED` — `createSketchLine` / `appendSketchEdge` | `DELEGATED` — interaction candidates | `EMBEDDED` — transient direction/alignment guides | `LEAKING` — App creates explicit connection metadata; editor-core creates `auto:*` constraints | `DELEGATED` — sketch replacement/kernel | `DELEGATED` — geometry/editor-core dimension paths | `DELEGATED` — renderer sketch edges | `DELEGATED` — constraints/kernel |
| Line — drag native | `EMBEDDED` — App gesture | `EMBEDDED` — App `newElement("line")`, then editor command | `NONE` — no verified creation-snap persistence | `NONE` | `NONE` | `NONE` — generic validation only | `DELEGATED` — native-line branches | `DELEGATED` | `NONE` |
| Rectangle | `EMBEDDED` — App two-click/gesture paths | `LEAKING` — App constructs persisted native shape | `DELEGATED` — interaction candidate | `NONE` — normalized drag is construction, not geometric inference | `LEAKING` — App maps confirmed snap into connection metadata | `NONE` — no sketch solve | `DELEGATED` — native resize branch | `DELEGATED` | `NONE` |
| Circle | `EMBEDDED` — App draft/gesture | `LEAKING` — App constructs native circle using geometry helper | `DELEGATED` | `NONE` | `LEAKING` — App may create explicit connection metadata | `DELEGATED` — layered geometry, constraints adapter, and editor-core circle solve | `DELEGATED` — circular dimension paths | `DELEGATED` | `DELEGATED` — circle-specific constraint state, not general sketch DOF |
| Arc | `EMBEDDED` — App three-point draft | `LEAKING` — App constructs native arc via `arcThroughThreePoints` | `DELEGATED` | `NONE` — three-point construction is not inference | `LEAKING` — confirmed start/end snaps may create connections; through-point does not | `NONE` — no general native-arc solver | `DELEGATED` — radial measurement/edit support is bounded | `DELEGATED` for commit; App owns direct preview path | `NONE` |
| Spline / Bezier | `EMBEDDED` — App plus spline editor gestures | `DELEGATED` — editor-core spline commands | `DELEGATED` — transient generic/node policies; no persistent spline snap relation verified | `NONE` | `NONE` | `NONE` — no spline solver | `DELEGATED` — measurable nodes, no general driving path | `DUPLICATED` — App preview plus editor-core/renderer spline-to-path conversion | `NONE` — editor state is not parametric DOF |
| Trim | `EMBEDDED` — App cut picking/preview | `DELEGATED` — editor-core trim candidate/application | `NONE` — hit tolerance is picking | `NONE` — intersections/topology are geometric derivation | `DELEGATED` — remaps/preserves existing references rather than creating a new relation | `DELEGATED` — kernel/profile validation where applicable | `DELEGATED` — reference remapping | `EMBEDDED` preview overlay / `DELEGATED` committed render | `NONE` |
| Move / Edit | `EMBEDDED` — App move/resize/rotate/node gestures | `DELEGATED` — editor-core transform commands | `DELEGATED` — move/node snap helpers | `EMBEDDED` — transient alignment feedback | `DELEGATED` — path-dependent positional propagation/preservation | `DELEGATED` on sketch paths; `NONE` for many native paths | `DELEGATED` — entity-specific command behavior | `DELEGATED` commit / `EMBEDDED` overlays | `DELEGATED` for sketches; `NONE` for native entities |
| Dimension | `EMBEDDED` — App picking/draft/editor | `LEAKING` — App directly constructs persisted dimension records | `NONE` — target picking is not snap | `EMBEDDED` — placement-kind interpretation | `LEAKING` — App decides driving eligibility; editor-core creates/removes supported constraints | `DELEGATED` — sketch/circle paths | `LEAKING` — semantics distributed across App creation, geometry derivation, and entity-specific editor-core mutation | `DELEGATED` | `DELEGATED` through associated constraints; no independent dimension DOF |

## D.1 Verified duplicated mathematics and mechanics

1. **Spline cubic conversion** — App preview, `packages/editor-core/src/spline.ts`, and renderer-svg independently resolve relative handles and cubic spans.
2. **Arc SVG projection** — App preview and renderer/profile projection repeat endpoint, sweep, large-arc, and SVG path construction. Arc construction itself remains centralized in `arcThroughThreePoints`.
3. **Snap candidate mechanics** — creation, move, and Forma-node snap policies separately scan/exclude candidates and apply zoom-scaled tolerances. Their gesture policies differ, so only the shared mechanics are duplicated.
4. **Connection source-node selection** — `creationConnections` reselects the nearest source node and maps it to an address after interaction already selected a snap target.

Dimension display derivation and dimension mutation are intentionally different responsibilities and are not classified as one duplicated algorithm.

## D.2 Verified boundary leaks or cross-layer ownership

1. **Persistent relations in web** — `creationConnections` constructs domain `ExplicitConnection` records from pointer results.
2. **Persistent dimension semantics in web** — App creates `DimensionElement` records and decides initial driving eligibility.
3. **Trim scope coordination** — App builds the piece/selection scope and `TrimTarget`; editor-core rebinds and validates it before mutation. Ownership is shared rather than exclusively assigned to either layer.
4. **Transient geometric SVG in web** — spline, arc, dimension, trim, and profile previews use App-owned paths in addition to renderer projection. These previews are not persistent model truth.
5. **Spline projection boundary** — editor-core and renderer each convert native splines to path-like cubic representations.

## D.3 Intentional specialization

The following distinctions are verified and are not automatically defects:

- native line/rectangle/circle/arc behavior versus bounded `SketchElement` solving;
- transient visual inference versus persistent automatic relations;
- circle-specific constraints versus sketch constraints;
- native spline relative handles versus path absolute cubic controls;
- trim preview versus commit, with editor-core candidate rebinding/validation;
- native rectangle projection to boundary curves for topology consumers versus creation as one rectangle element;
- renderer constraint coloring as presentation behavior;
- sketch-session checkpoints versus generic editor history;
- entity-specific dimension driving where solver support differs.

## D.4 Test evidence and limits

Interaction, editor-core, geometry, constraints, renderer, and E2E tests cover substantial line/sketch, native shape, spline/path, trim, movement, and dimension behavior. The browser suite is not comprehensive evidence for every matrix cell: solver/DOF internals, every move/edit variant, complete preview-to-persistence chains, and every snap-to-relation path remain package-level or uncovered.

## D.5 Unresolved T4 hypotheses

- Whether click-sketch versus drag-native Line is intentional compatibility behavior.
- Whether three persistent relationship forms encode distinct product semantics.
- Whether App-owned dimension and relation construction causes observable inconsistency.
- Whether repeated spline/arc projection logic can diverge.
- Whether native transform paths preserve every relevant relation.
- Whether absent spline/arc DOF is deliberate product scope.
- Whether App-built trim scope can become stale outside covered rebinding cases.
- Whether repeated snap scans create measurable pointer-move cost.

---

# E. Findings

## E.1 Severity method

- `CRITICAL` — proven data loss/corruption, unrecoverable invalid state, security boundary failure, or systemic failure of a supported core workflow.
- `HIGH` — proven major user-visible failure or architectural defect that reliably prevents a supported workflow.
- `MEDIUM` — verified behavioral inconsistency, material capability gap, or cross-layer ownership that increases product risk but has no proven catastrophic outcome.
- `LOW` — bounded maintainability, contract clarity, duplication, or evidence/coverage risk without a proven material failure.

**No `CRITICAL` or `HIGH` finding is proven by the current repository evidence.** The audit does not inflate severity merely because issue #230 is strategically important.

## E.2 Medium findings

### F-01 — Gesture-dependent Line representation

- **Severity:** MEDIUM
- **Type:** verified architectural inconsistency
- **Evidence:** `apps/web/src/App.tsx` click flow (`CreationDraft`, `createSketchLine`, `appendSketchEdge`) versus drag flow (`newElement("line")`, gesture preview/commit); editor-core sketch commands.
- **Verified consequence:** the visible Line tool creates or extends a solver-backed `SketchElement` through clicks but creates a native `LineElement` through dragging. Topology, automatic relations, snapping persistence, dimensions, solving, and later edits therefore depend on gesture choice.
- **Not proven:** whether this is an accidental defect or intentional legacy compatibility.

### F-02 — Relationship semantics are path-dependent

- **Severity:** MEDIUM
- **Type:** architectural gap
- **Evidence:** `DocumentSnapshot.connections`, `positionalCoincidences`, solver `coincident` constraints; `creationConnections`; `enforcePositionalCoincidences`; `replaceElements`, `replaceSketchElements`, and `replaceSketchTopology`.
- **Verified consequence:** visually coincident creation/movement can result in legacy metadata, enforced positional propagation, shared sketch topology, a solver constraint, or no persistent relation, depending on the exact gesture and representation.
- **Not proven:** that the three persisted forms are intended to have identical product semantics.

### F-03 — Automatic relation lifecycle is distributed

- **Severity:** MEDIUM
- **Type:** architectural gap
- **Evidence:** `createSketchLine` and `appendSketchEdge` create `auto:*` constraints; App/interaction functions create transient direction and alignment feedback; dimension edits remove selected automatic relations in editor-core.
- **Verified consequence:** feedback, relation creation, conflict/rollback handling, and later removal are implemented by separate paths without one explicit candidate → validate → redundancy/conflict check → commit lifecycle.
- **Not proven:** that duplicate or conflicting automatic relations currently escape kernel rollback.

### F-04 — Dimension eligibility and mutation contracts differ by representation

- **Severity:** MEDIUM
- **Type:** verified contract inconsistency
- **Evidence:** App `shouldCreateSketchDrivingConstraint`; editor-core `setDimensionDriving`, sketch constraint derivation, and `updateDimensionValue` entity branches.
- **Verified consequence:** App can classify a same-native-line angular dimension as eligible for driving, while editor-core rejects the follow-up driving command because the target is not a sketch. The already-created dimension remains non-driving. Native-line angular value edits can still update geometry directly.
- **Not proven:** a geometry-edit failure; the inconsistency is in driving eligibility/state semantics.

### F-05 — Construction geometry is absent

- **Severity:** MEDIUM
- **Type:** capability gap
- **Evidence:** no construction role/flag, validation, migration, rendering style, conversion command, solver behavior, export filtering, or focused test exists across domain, validation, editor-core, geometry, renderer, and persistence.
- **Verified consequence:** KOND cannot currently persist or distinguish construction geometry under a shared entity/kernel contract.
- **Not proven:** an active regression in an existing supported workflow.

### F-06 — Web orchestration owns persistent relation and dimension semantics

- **Severity:** MEDIUM
- **Type:** architectural gap
- **Evidence:** App `creationConnections`, `newDimension`, `newCircleDimension`, `newAngularDimension`, and driving-eligibility helpers; editor-core validation/mutation commands.
- **Verified consequence:** the composition layer constructs persisted domain records and decides initial parametric intent while editor-core independently validates and applies that intent. F-04 demonstrates one concrete eligibility mismatch across this boundary.

### F-07 — Rectangle is a native shape rather than a parametric four-edge sketch

- **Severity:** MEDIUM
- **Type:** deliberate limitation
- **Evidence:** App `newElement("rectangle")`, domain `RectangleElement`, editor-core native resize/dimension branches, native rectangle E2E coverage.
- **Verified consequence:** rectangle creation does not produce four sketch edges or H/V/coincident constraints; later edits use native resize semantics.
- **Not proven:** that the native rectangle representation should be removed or replaced.

### F-08 — Solver behavior is bounded and representation-specific

- **Severity:** MEDIUM
- **Type:** deliberate limitation
- **Evidence:** geometry sketch/circle solvers; constraints adapters/components/residuals/DOF; sketch kernel rollback; generic versus sketch-specific editor replacement paths.
- **Verified consequence:** sketches and circles receive bounded parametric solving, while native lines, rectangles, arcs, splines, and many transforms use entity-specific direct geometry behavior.
- **Not proven:** solver corruption or a need to replace the current solver.

## E.3 Low findings

### F-09 — Solved coordinates and design intent use separate lifecycle layers

- **Severity:** LOW
- **Type:** architectural observation
- **Evidence:** persisted sketch coordinates and constraints in domain; derived solve output/diagnostics in constraints/kernel; accepted solved coordinates committed by editor-core replacement paths.
- **Verified consequence:** coordinates store the accepted geometric result while constraints store intent and diagnostics remain derived.
- **Not proven:** divergence, reload corruption, or an invalid source of truth.

### F-10 — Parametric component state and piece lifecycle state are separate

- **Severity:** LOW
- **Type:** contract/evidence gap
- **Evidence:** constraints `ConstraintState`, component state and DOF versus domain `PieceSnapshot.state`; project/document conversion preserves piece metadata.
- **Verified consequence:** no synchronization contract between these state systems was found.
- **Not proven:** stale or incorrect user-visible piece state.

### F-11 — Selected preview/projection mathematics are duplicated

- **Severity:** LOW
- **Type:** maintainability gap
- **Evidence:** App spline/arc preview paths, editor-core spline conversion, renderer spline/arc/profile projection.
- **Verified consequence:** spline cubic conversion and arc SVG projection are repeated at transient and committed projection boundaries.
- **Not proven:** current preview/commit visual divergence.

### F-12 — Multi-segment click-line cancellation is not a transaction rollback

- **Severity:** LOW
- **Type:** contract ambiguity
- **Evidence:** App dispatches each confirmed segment immediately; Escape clears the creation draft and cancels only an active gesture.
- **Verified consequence:** Escape leaves already accepted click-created segments in the document and history.
- **Not proven:** that product UX defines the whole multi-segment session as one cancellable transaction.

### F-13 — Cross-flow integration evidence is incomplete

- **Severity:** LOW
- **Type:** test/evidence gap
- **Evidence:** strong package/helper coverage and substantial smoke/workflow E2E tests, but no complete proof for every pointer → preview → relation/solve → commit/cancel → persistence → undo chain.
- **Verified consequence:** architectural invariants are often proven in separate layers rather than one integrated flow.
- **Not proven:** a failing persistence/history invariant; previews are currently gated out of official persistence.

## E.4 Explicitly unproven hypotheses

The following must not be reported as confirmed defects:

- solver corruption or a need for solver replacement;
- persisted solved coordinates diverging from constraint intent;
- stale `PieceSnapshot.state` relative to component DOF;
- preview/commit visual mismatch;
- snap/inference performance failure;
- automatic relations silently leaving a conflicting sketch committed;
- data loss in undo/redo, IndexedDB revisions, or recovery mirrors.

---

# F. KEEP / REFACTOR / REPLACE / REMOVE / CREATE

| Component or responsibility | Disposition | Evidence-based rationale |
|---|---|---|
| Domain snapshots, schema v9, stable IDs and references | KEEP | Established persisted foundation with validation, migration, consumers, and tests. |
| Sketch node/edge topology | KEEP | Stable topology is used by constraints, dimensions, profiles, editing, and persistence. |
| Geometry helpers, curves, intersections, profiles and topology derivation | KEEP | Shared mathematical foundation with broad consumers and tests. |
| Constraint normalization, components, residuals, rank and DOF | KEEP | Real bounded parametric capability; no replacement evidence. |
| Sketch/circle solving | KEEP | Operational and tested; bounded scope is explicit. Do not rebuild the solver. |
| Sketch kernel and session boundary | KEEP | Provides recomputation, rollback, diagnostics, scoped sessions, and validation integration. |
| Editor-core command, validation, no-op, gesture and history mechanisms | KEEP | Enforces mutation and transaction invariants across tools. |
| Native Line/Rectangle/Circle/Arc/Spline representations | KEEP | Existing consumers, rendering, dimensions, compatibility, and tests prohibit removal without a migration decision. |
| Renderer SVG boundary | KEEP | Verified one-way projection without geometric ownership. |
| Dexie repository and web recovery mirror distinction | KEEP | Durable revisions and best-effort recovery have separate tested responsibilities. |
| Transient inference guides | KEEP | Correctly remain feedback rather than persistent model truth. |
| Explicit connection metadata | KEEP | Existing compatibility and consumers are verified; semantics must be clarified before any migration. |
| Positional coincidences | KEEP | Enforced by generic and sketch replacement paths with focused tests. |
| Solver coincident constraints | KEEP | Required for persistent parametric sketch intent. |
| Click-line versus drag-line tool contract | REFACTOR | Preserve supported representations, but make gesture-dependent semantics explicit and coherent. |
| Snap candidate and persistent-result coordination | REFACTOR | Candidate policies are useful; mapping from feedback to topology/metadata/constraint is distributed. |
| Automatic relation creation lifecycle | REFACTOR | Preserve existing automatic relations while consolidating candidate, validation, conflict, and commit semantics. |
| Dimension creation and driving eligibility in App | REFACTOR | Persistent construction and capability decisions cross the web/editor boundary and already exhibit one mismatch. |
| Entity-specific dimension mutation in editor-core | KEEP | Broad supported behavior and tests exist; it should not be discarded merely because orchestration is distributed. |
| App-owned spline/arc preview projection | REFACTOR | Preserve previews while reducing repeated projection mathematics and parity risk. |
| App/editor trim scope coordination | KEEP | Preview scope and commit rebinding/validation are intentionally split; no defect is proven. |
| Constraint-to-piece-state synchronization policy | CREATE | The current systems coexist without a verified contract; T6 must decide whether synchronization is required. |
| Construction geometry role and lifecycle | CREATE | No current cross-layer model exists; creation is conditional on approved target semantics. |
| Explicit snap/inference/relation lifecycle contract | CREATE | Existing implementations need a documented ownership contract; this does not imply a new package or class. |
| Additional cross-flow integration scenarios | CREATE | Package coverage is strong, but selected critical interaction/history/persistence chains need integrated evidence. |

## F.1 Rejected dispositions

- **REPLACE:** no current component has evidence sufficient to justify replacement.
- **REMOVE:** no current component has evidence sufficient to justify removal; every implemented foundation has consumers, tests, compatibility value, or unresolved product semantics.
- `CREATE` means a missing responsibility/contract must be defined in T6; it does not pre-authorize a service, package, schema change, or implementation.

---

# G. Target Architecture

## G.1 Design objective

The target is a bounded refactoring of ownership and lifecycle contracts, not a new CAD platform. It keeps the current package graph, native entities, stable sketch topology, solver, sketch kernel, commands/history, renderer, and persistence.

```text
Pointer / keyboard
        ↓
apps/web transient interaction
  tool mode, selection, hover, viewport, drafts, feedback
        ├── pure geometry queries
        │     picking, snap candidates, inference, layout preview
        ↓
editor-core command / gesture boundary
  preview → capability validation → relation validation → solve → commit/cancel
        ├── domain snapshot
        │     geometry, stable topology, constraints, dimensions,
        │     NORMAL/CONSTRUCTION roles and legacy relationship records
        ├── constraints
        │     bounded capabilities, components, residuals, conflict,
        │     redundancy, rank and DOF
        └── geometry
              coordinates, curves, references, topology/profile derivation,
              measurement and display geometry
        ↓
Accepted validated DocumentSnapshot
        ├── derived definition state / profiles / diagnostics
        ├── renderer-svg projection
        ├── web project conversion and recovery scheduling
        └── persistence validated durable revisions
```

Core rule:

```text
Transient interaction never becomes model truth without confirmation.
Solver output remains provisional until editor-core accepts it.
Only one accepted, validated snapshot enters history and persistence.
```

T7 will define migration transaction boundaries. T6 defines only observable ownership and atomicity invariants.

## G.2 Target ownership within existing packages

| Responsibility | Target owner | Adjustment |
|---|---|---|
| Persistent entities, IDs, references and geometry role | `@nodra/domain` | Keep current model; add only approved `NORMAL | CONSTRUCTION` semantics at native-element and sketch-edge granularity. |
| Structural validation and migrations | `@nodra/validation` | Validate role, references, dimension/constraint compatibility, and schema migration. |
| Coordinates, curves, picking, snap mathematics, geometric inference, profiles and dimension geometry | `@nodra/geometry` | Prefer pure functions; no tool state or persistent relation writes. |
| Constraint capabilities, normalization, solve, residuals, redundancy/conflict, rank and DOF | `@nodra/constraints` | Keep bounded solver; expose explicit supported/unsupported diagnostics. |
| Persistent commands, relation/dimension/role mutation, kernel recomputation, rollback and history | `@nodra/editor-core` | Own atomic model decisions currently split with web. |
| Tool mode, selection presentation, hover, drafts, viewport and previews | `apps/web` | Remain transient composition; stop deciding durable relation/dimension capability. |
| SVG projection | `@nodra/renderer-svg` | Consume accepted model plus derived state; never own geometry or fabrication policy. |
| Durable revisions | `@nodra/persistence` | Keep validated project storage. |
| Recovery/autosave orchestration | `apps/web` | Keep mirror and arbitration distinct from durable history. |

No new package or service class is required. “Service” names in issue #230 denote contracts implementable as pure functions and editor-core commands.

## G.3 Target sources of truth

| Concern | Target source of truth |
|---|---|
| Geometry | Persisted domain `Element` records. |
| Sketch topology | Stable `SketchElement.nodes` and `.edges`. |
| Constraints | Persisted local/document constraint intent under current compatibility model. |
| Dimensions | Persisted `DimensionElement` identity, references and layout; a compatible driving constraint owns the driving value. |
| Accepted solved geometry | Coordinates in the latest accepted validated document snapshot. |
| Definition state | Derived constraints component state, residuals, rank and DOF; never a manual renderer flag. |
| Profiles and mixed topology | Derived from stable geometry/topology; not persisted truth. |
| Selection | Transient editor selection plus narrower UI context where needed. |
| Tool interaction | Web drafts/feedback plus editor-core gesture base; never domain data. |
| Piece lifecycle | Existing `PieceSnapshot.state`, kept separate from DOF unless a later explicit product rule is approved. |
| Durable state | Validated persistence revisions; localStorage remains recovery-only. |

The target introduces neither a second solved-geometry cache nor a general parameter registry.

## G.4 Relationship coexistence

During migration, the following remain explicit and non-equivalent:

- `connections`: compatibility metadata created only by confirmed operations;
- `positionalCoincidences`: explicit propagated positional relations;
- local/document solver constraints: parametric design intent;
- shared sketch nodes: topology identity within a sketch.

No form is silently converted into another. Every new command declares which form it creates. Same-sketch node reuse remains valid; unsupported cross-representation relations fail with a diagnostic rather than fusing element identities.

Native Line, Rectangle, Circle, Arc and Spline elements remain valid. No automatic rectangle-to-four-edge conversion or native-to-sketch rewrite is part of T6.

## G.5 Construction geometry decision

Construction role support does **not** exist in the current model. The following is a target decision whose schema migration and rollout belong to T7.

The only persisted role introduced by the target is:

```text
NORMAL | CONSTRUCTION
```

Granularity:

- a native geometric element may carry the role;
- an individual `SketchEdge` may carry the role independently of sibling edges.

Semantics:

- both roles remain selectable, snappable, inferable, constrainable, dimensionable and solver-visible where the entity type is supported;
- construction geometry is visually distinct in editor mode;
- existing geometric profile/topology derivation remains a geometric operation and does not silently become fabrication policy;
- a separate target fabricable-profile/export filter excludes construction geometry unless it was explicitly converted to `NORMAL`;
- the role is model semantics, not merely a renderer style or `operation` value;
- future split children must inherit the source edge role; trim survivors must preserve it; merge/remap commands must report role conflicts instead of guessing;
- these inheritance rules are target invariants, not current behavior, and their schema/transaction migration is deferred to T7;
- conversion changes the role without rebuilding entity identity.

A third `REFERENCE` role is intentionally rejected as unsupported over-modeling.

## G.6 Definition-state decision

For the bounded solver scope:

- `conflict`: supported constraints cannot be satisfied or solving does not converge under kernel policy;
- `overdefined`: the component contains redundant/dependent equations under current rank analysis;
- `fully-defined`: valid component, no conflict/overdefinition, and zero remaining DOF;
- `underdefined`: valid component with remaining DOF;
- `invalid`: unsupported or structurally invalid references/input.

The geometry solver's current `defined` result normalizes to the public `fully-defined` state. Aggregate precedence is `invalid` → `conflict` → `overdefined` → `underdefined` → `fully-defined`; any component in an earlier state determines the aggregate. `invalid` comes from structural validation or unsupported/invalid constraint diagnostics, not from DOF alone.

Closed-profile validity remains a separate geometric/product property. DOF does not automatically mutate `PieceSnapshot.state`.

## G.7 Required invariants

- Snap and inference only return transient candidates/feedback.
- Rejected automatic relations are not persisted; they may remain transient feedback.
- Relation commit performs capability, reference, redundancy, conflict and degeneracy checks within current solver support.
- Geometry, topology, constraints, references and dimensions commit atomically or remain unchanged.
- Failed/no-op commands add no revision or history.
- Preview adds no persistence or undo state; cancel restores the gesture base.
- A supported non-driving dimension may be promoted to driving without changing its `ElementId`; unsupported promotion is rejected before marking it driving.
- Stable IDs and explicit topology reference maps govern split/trim/remap; coordinate proximity is not identity.
- Renderer projects accepted state and derived diagnostics but never establishes alternate constraint truth.
- Editor styling and fabrication/export filtering remain separate concerns.

## G.8 Non-goals and rejected alternatives

- no solver rewrite or new solver package;
- no new orchestration package;
- no native-entity removal;
- no universal sketch entity or immediate rectangle decomposition;
- no big-bang migration;
- no general parameter registry;
- no persisted DOF, residual, profile or solver cache;
- no automatic conversion among connections, positional coincidences and constraints;
- no worker, spatial index or caching layer without measurement;
- no SolidWorks-scale patterns, blocks, 3D or external-reference system.

## G.9 Finding-to-decision traceability

| Finding | Target response |
|---|---|
| F-01 line representation split | Preserve both representations; make gesture/command semantics explicit and non-silent. |
| F-02 relationship semantics | Preserve forms; require relation-kind-specific commands and no implicit conversion. |
| F-03 automatic relations | Use one proposal → capability/redundancy/conflict validation → solve → commit lifecycle. |
| F-04 dimension mismatch | Move driving eligibility/creation behind editor-core and bounded constraints capability checks. |
| F-05 construction absence | Add `NORMAL | CONSTRUCTION` role at native-element and sketch-edge granularity. |
| F-06 App persistent semantics | Keep web transient; route durable relation/dimension decisions through editor-core. |
| F-07 native rectangle | Keep it; do not impose four-edge sketch semantics. |
| F-08 bounded solver | Keep solver/adapters and expose explicit capability diagnostics. |
| F-09 geometry versus intent | Declare accepted coordinates current geometry and constraints design intent; derive solve state. |
| F-10 piece versus DOF state | Keep separate; prohibit implicit synchronization. |
| F-11 projection duplication | Prefer shared pure projection helpers later; no renderer rewrite. |
| F-12 Escape semantics | Preserve current behavior until T7 specifies transaction scope explicitly. |
| F-13 evidence gaps | Use these contracts as T7 acceptance boundaries. |

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

## H.4 Target model additions and preserved absences

- Target decision: add only `NORMAL | CONSTRUCTION` role semantics, supporting native elements and individual `SketchEdge` records; no current model behavior is implied.
- Preserve existing stable IDs and reference unions; do not create a parallel universal `GeometryReference` identity system.
- Dimensions remain `Element`s identified by `ElementId`; do not introduce a separate `DimensionId` identity domain.
- Keep values in compatible constraints/dimension metadata; do not create a general parameter registry.
- Keep solve results, residuals, DOF, profiles and mixed topology derived; do not persist a solved-state cache.
- Keep `PieceSnapshot.state` independent from component DOF until a separate product decision establishes synchronization.
- Keep connections, positional coincidences and solver constraints distinct during coexistence.
- Future topology contract: split children inherit roles, trim survivors retain them, and ambiguous merges fail with diagnostics; T7 owns schema migration and transaction rollout.
- Keep editor geometric profile/topology derivation distinct from a new fabricable-profile/export filter, which excludes construction geometry while retaining editor interaction and supported solving.

---

# I. Service Contracts

These are conceptual TypeScript-like contracts, not implementation authorization. They should reuse or carefully extend existing node, edge, dimension and connectable-address references rather than introduce a parallel persisted reference hierarchy.

## I.1 Snap candidate query

```ts
type SnapTargetAdapter =
  | { readonly kind: "connectable"; readonly reference: ConnectableNodeReference }
  | { readonly kind: "sketch-edge"; readonly reference: SketchEdgeReference }
  | {
      readonly kind: "transient-curve";
      readonly elementId: ElementId;
      readonly parameter: number;
    };

type SnapCandidate = {
  readonly target: SnapTargetAdapter;
  readonly point: PointMm;
  readonly distanceMm: number;
  readonly priority: number;
  readonly source: "node" | "anchor" | "curve";
};

function querySnapCandidates(
  document: DocumentSnapshot,
  input: {
    readonly point: PointMm;
    readonly toleranceMm: number;
    readonly visibleElementIds: readonly ElementId[];
    readonly excludedElementIds?: readonly ElementId[];
  },
): readonly SnapCandidate[];
```

The persisted-capable variants adapt existing `ConnectableNodeReference` and `SketchEdgeReference`; the curve variant is transient and does not create a new persisted reference hierarchy. A candidate never persists a relation.

## I.2 Transient inference

```ts
type InferencePreview = {
  readonly point: PointMm;
  readonly guides: readonly InferenceGuide[];
  readonly suggestedRelations: readonly RelationProposal[];
};

function inferTransientGeometry(context: InferenceContext): InferencePreview;
```

Inference owns feedback and proposals, not document mutation.

## I.3 Relation validation and commit

```ts
type RelationValidation =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        | "unsupported"
        | "invalid-reference"
        | "redundant"
        | "conflict"
        | "degenerate";
      readonly constraintIds: readonly string[];
    };

function validateRelation(
  document: DocumentSnapshot,
  proposal: RelationProposal,
): RelationValidation;
```

Validation is bounded by current solver capabilities. Editor-core owns the command that applies an accepted proposal and invokes kernel solve/rollback.

## I.4 Automatic relations

```ts
function proposeAutomaticRelations(
  before: DocumentSnapshot,
  operation: GeometryOperation,
  inference: InferencePreview,
): readonly RelationProposal[];

function validateAutomaticRelations(
  document: DocumentSnapshot,
  proposals: readonly RelationProposal[],
): readonly RelationValidation[];
```

Lifecycle:

```text
candidate → capability/reference validation → redundancy/conflict check
          → explicit editor command → kernel solve → atomic commit or rollback
```

A rejected proposal is not persisted. Existing `auto:*` behavior remains compatible while policy is consolidated incrementally.

## I.5 Dimensions

```ts
type DimensionDraft = {
  readonly kind: DimensionKind;
  readonly references: readonly DimensionReference[];
  readonly layout: DimensionLayout;
};

function previewDimension(
  document: DocumentSnapshot,
  draft: DimensionDraft,
  cursor: PointMm,
): DimensionPreview;

function validateDimensionDriving(
  document: DocumentSnapshot,
  dimension: DimensionElement,
): RelationValidation;

function createDimension(draft: DimensionDraft): EditorCommand;
function updateDimensionValue(dimensionId: ElementId, value: number): EditorCommand;
```

Web chooses targets and displays placement. Geometry derives measurement/layout. Editor-core validates references, driving eligibility, solving, history and atomic mutation. A non-driving dimension remains an annotation; driving requires an explicit compatible constraint.

## I.6 Construction role

```ts
type GeometryRole = "normal" | "construction";

type GeometryRoleTarget =
  | { readonly kind: "element"; readonly elementId: ElementId }
  | {
      readonly kind: "sketch-edge";
      readonly sketchId: ElementId;
      readonly edgeId: SketchEdgeReference["edgeId"];
    };

function setGeometryRole(
  targets: readonly GeometryRoleTarget[],
  role: GeometryRole,
): EditorCommand;
```

Role changes preserve identity. Future split/trim commands must carry role inheritance through their existing topology mappings; T7 defines migration and transaction rollout.

## I.7 Sketch definition and DOF

```ts
type SketchDefinition = {
  readonly state:
    | "underdefined"
    | "fully-defined"
    | "overdefined"
    | "conflict"
    | "invalid";
  readonly degreesOfFreedom: number;
  readonly rank: number;
  readonly affectedElementIds: readonly ElementId[];
  readonly diagnostics: readonly ConstraintDiagnostic[];
};

function deriveSketchDefinition(
  document: DocumentSnapshot,
  scope?: readonly ElementId[],
): SketchDefinition;
```

This contract projects existing component states, residuals, rank and DOF. It neither mutates piece lifecycle state nor persists definition flags.

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
| T3 — Required end-to-end flows | Complete | Sections B.6 and B.7; independently verified; committed as `676b022` |
| T4 — Responsibility/tool matrices | Complete | Section D; independently verified; committed as `64410c3` |
| T5 — Findings and disposition | Complete | Sections E and F; independently verified; committed as `ecdedc9` |
| T6 — Target architecture/contracts | Complete | Sections G, H.4, and I; independently verified; committed as `0b4816b` |
| T7 — Migration/testing/performance/UX/rollback | In progress | — |
| T8 — Review and approval gate | Pending | — |
