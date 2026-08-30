# Proposal: Constraint-driven dimensioning

Replace measurement-only dimensions with a safe, incremental constraint system so users can define design intent without introducing unstable geometry changes.

## Quick path

1. Draw approximate geometry.
2. Add geometric relations.
3. Add dimensions for size and position.
4. Anchor sketches to the document origin when needed.
5. Double-click a dimension to edit its millimeter value.

## Scope

### In scope

- Associative dimensions for lines, circles, arcs, rectangles, polygons, and splines.
- Geometric relations: horizontal, vertical, coincident, tangent, parallel, perpendicular, concentric, and equal.
- Linear, angular, radial, diametric, and positional dimensions.
- A pure, deterministic solver with explicit supported-constraint limits.
- Underdefined, fully defined, conflict, and overdefined status.
- Blue/black/red-yellow visual state feedback.
- Origin anchoring for sketches.
- Safe double-click dimension editing with millimeter input, validation, undo, and redo.

### Out of scope for the first slice

- A general-purpose unconstrained nonlinear solver.
- Manufacturing/GD&T tolerances, dual units, 3D constraints, or hardware execution.
- Silent automatic constraint insertion.
- Force-locking a sketch by adding redundant constraints.

## Product rules

- Geometric relations control relationships and permitted motion.
- Dimensions control size and position.
- A dimension is driving only when its target and constraint combination is supported and solvable.
- Unsupported or conflicting edits MUST fail without mutating the document.
- Existing annotation-only dimensions MUST remain readable and backward compatible during migration.
- The origin MUST be an explicit reference; geometry MUST NOT be implicitly translated to hide an underdefined state.
- Redundant constraints MUST be reported, not silently accepted.

## First implementation slice

The first slice will cover sketch segments and rectangle-compatible dimensions:

- horizontal and vertical relations;
- coincident endpoints;
- horizontal/vertical distance dimensions;
- origin anchoring;
- deterministic status calculation;
- direct rectangle value editing only where the references and orientation are unambiguous.

Later slices add aligned and angular constraints, circles/arcs and radial/diametric dimensions, splines, and richer relation solving.

## Architecture boundaries

| Responsibility | Package |
|---|---|
| Constraint and dimension data model/migration | `@nodra/domain` |
| Constraint validation and conflict rules | `@nodra/validation` |
| Degrees of freedom, solving, status, and geometry math | `@nodra/geometry` |
| Create/update/delete constraint commands and history | `@nodra/editor-core` |
| Constraint and dimension SVG feedback | `@nodra/renderer-svg` |
| Gestures, double-click editor, and Spanish UI | `apps/web` |
| Persistence and recovery | `@nodra/persistence` |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Solver moves geometry unexpectedly | Deterministic supported subset; reject unsolved/conflicting changes; immutable previews. |
| Redundant dimensions create overdefinition | Validate independence before commit and expose conflict state. |
| Existing documents lose dimensions | Versioned migration; retain legacy node-index references while introducing stable IDs. |
| Scope exceeds 400 review lines | Deliver chained slices by model, solver, UI, and geometry type. |
| Visual status disagrees with solver | Derive all status colors from one solver result, never from UI heuristics. |

## Rollback plan

Each slice is independently revertible. Preserve schema migrations and read-only rendering of existing dimensions; disable driving edits at the UI boundary if solver validation fails. Never delete user geometry or persisted documents during rollback.

## Acceptance criteria

- [ ] A sketch can be marked horizontal/vertical and coincident without changing unrelated nodes.
- [ ] A supported dimension can be edited in millimeters with double-click, Enter, or cancel with Escape.
- [ ] Invalid, conflicting, or redundant edits leave the document unchanged and report a visible state.
- [ ] A fully defined sketch is black; an underdefined sketch is blue.
- [ ] Moving referenced geometry updates associative dimension values.
- [ ] Undo/redo treats each confirmed constraint or dimension edit as one transaction.
- [ ] Existing documents continue to load and render.
- [ ] Unit, integration, and E2E tests cover model, solver, rendering, history, persistence, and the first user flow.

## Next phase

Create the detailed domain and solver design, including stable reference identity, degrees-of-freedom representation, conflict detection, and the exact first-slice command contracts.
