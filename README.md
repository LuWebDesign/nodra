# Nodra / Kond Design

<p align="center">
  <strong>A precise, offline-first 2D vector editor for parametric design.</strong><br />
  Draw geometry, edit real nodes, add constraints, and keep every change reversible.
</p>

<p align="center">
  <a href="https://github.com/LuWebDesign/nodra/actions/workflows/ci.yml"><img src="https://github.com/LuWebDesign/nodra/actions/workflows/ci.yml/badge.svg" alt="Quality gates" /></a>
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A524-brightgreen" alt="Node.js 24 or newer" />
  <img src="https://img.shields.io/badge/pnpm-10.15.1-orange" alt="pnpm 10.15.1" />
  <img src="https://img.shields.io/badge/license-not%20declared-lightgrey" alt="License not declared" />
</p>

Nodra is the repository and workspace behind **Kond Design**, a browser-based 2D editor. It combines a typed document model, immutable editor commands, geometry-aware interaction, parametric sketches, deterministic SVG rendering, and local-first persistence in one modular TypeScript application.

> **Status:** active development. The editor is usable for exploratory vector and parametric geometry workflows, but it is not yet a production CAD or manufacturing tool.

## Highlights

- **Vector geometry:** rectangles, ellipses, native lines, sketches, contours, open paths, cubic paths, and splines.
- **Parametric sketches:** horizontal, vertical, coincident, distance, angle, parallel, perpendicular, equal-length, and local fixed constraints.
- **Cross-sketch relationships:** connect independent sketches without merging their geometry.
- **Real node editing:** use **Forma** to move anchors, edit path nodes, and work with Bézier controls.
- **Topology-aware cutting:** cut open or closed geometry, split intersecting sketch segments, create resulting nodes, and open contours when necessary.
- **Precision interactions:** millimetre coordinates, snapping, alignment feedback, rotation, mirroring, and geometry-aware hit testing.
- **Safe editing:** immutable commands, validation, atomic transactions, undo/redo, and topology reference cleanup.
- **Offline-first workflow:** autosave and recovery through IndexedDB, with a PWA-ready web build.
- **Deterministic output:** validated document snapshots are rendered to escaped SVG in separate editor and export modes.
- **Spanish interface:** the current product UI is intentionally Spanish-first.

## Quick start

### Requirements

- Node.js `>=24.0.0`
- pnpm `>=10.15.1 <11`

The repository pins pnpm through Corepack. On Windows, use `corepack pnpm` instead of a globally installed pnpm when necessary.

### Run the web editor

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Open the Vite URL shown in the terminal.

To start only the web workspace:

```bash
corepack pnpm --filter @nodra/web dev
```

## Editor workflow

The main toolbar is Spanish-first:

| Tool | Purpose |
| --- | --- |
| `Seleccion` | Select, move, resize, rotate, and transform objects |
| `Forma` | Edit geometry through its nodes and handles |
| `Pluma` | Create open or closed paths, including cubic segments |
| `Spline` | Create and edit smooth spline geometry |
| `Línea` | Create connected sketch segments with inferred axis relations |
| `Cortar segmentos` | Remove a selected segment and split intersecting geometry with resulting nodes |
| `Cota` / `Radio` | Create associative linear, angular, radius, and diameter dimensions |

Cortes are atomic: one completed cut produces one history entry. Closed sketches may become open, and affected contour rings are represented as editable open paths so they can be extended or closed again with new geometry.

## Architecture

Nodra is a pnpm workspace with intentionally one-way package dependencies:

```mermaid
graph LR
  WEB[apps/web] --> DOMAIN[@nodra/domain]
  WEB --> GEOMETRY[@nodra/geometry]
  WEB --> CORE[@nodra/editor-core]
  WEB --> RENDER[@nodra/renderer-svg]
  WEB --> PERSIST[@nodra/persistence]
  CORE --> DOMAIN
  CORE --> GEOMETRY
  CORE --> VALIDATION[@nodra/validation]
  GEOMETRY --> DOMAIN
  CONSTRAINTS[@nodra/constraints] --> DOMAIN
  CONSTRAINTS --> GEOMETRY
  RENDER --> DOMAIN
  RENDER --> GEOMETRY
  RENDER --> CONSTRAINTS
  RENDER --> VALIDATION
  PERSIST --> DOMAIN
  PERSIST --> VALIDATION
```

### Workspace packages

| Package | Responsibility |
| --- | --- |
| `@nodra/domain` | Versioned document, project, page, layer, element, and reference models |
| `@nodra/geometry` | Bounds, transforms, intersections, hit testing, geometry nodes, and sketch solving helpers |
| `@nodra/constraints` | Parametric capabilities, relations, solver components, residuals, and derived states |
| `@nodra/validation` | Runtime schemas, validation, migrations, and schema compatibility |
| `@nodra/editor-core` | Immutable commands, gestures, selection, topology edits, and history |
| `@nodra/renderer-svg` | Validated document-to-SVG projection for editor and export modes |
| `@nodra/persistence` | IndexedDB repositories, autosave, recovery, and local revisions |
| `@nodra/ui` | Framework-independent UI contracts and shared presentation types |

Each public package exports its API from `src/index.ts`. The web application composes package APIs rather than importing package internals.

## Data and editing model

The editor is built around a few deliberate invariants:

- Document snapshots are immutable and validated before they become persistent state.
- Coordinates are stored in millimetres with a top-left origin.
- Sketches are graphs of stable nodes and stable edge IDs.
- Paths and glyphs use stable segment and node identities for topology-aware edits.
- Global constraints live at document level; local sketch constraints stay with their sketch.
- Preview gestures are provisional; only committed commands enter history and persistence.
- Topology-changing commands expose ephemeral reference maps and remove or remap dependent dimensions, connections, and constraints conservatively.
- Editor diagnostics and solver colours never contaminate exported SVG.

## Development commands

Run commands from the repository root:

```bash
# Static quality
corepack pnpm lint
corepack pnpm typecheck

# Tests
corepack pnpm test
corepack pnpm test:e2e

# Production build
corepack pnpm build
```

The authoritative CI order is:

```text
lint → typecheck → test → test:e2e → build
```

Useful focused commands:

```bash
corepack pnpm --filter @nodra/domain test
corepack pnpm exec vitest run packages/editor-core/src/index.test.ts
corepack pnpm exec playwright test tests/e2e/app.smoke.spec.ts -g "loads the editor workspace"
```

The E2E suite runs Chromium through Playwright. The first run may install the browser binary.

## Repository layout

```text
apps/
  web/                  React + Vite browser composition
  desktop/              Vite/Tauri desktop host
packages/
  domain/               Document model and stable identities
  geometry/             Geometry and interaction primitives
  constraints/          Parametric constraints and solver diagnostics
  validation/           Schemas, validation, and migrations
  editor-core/          Commands, gestures, topology, and history
  renderer-svg/         SVG rendering
  persistence/          IndexedDB persistence and recovery
  ui/                   Standalone UI contracts
tests/e2e/               Chromium smoke and workflow tests
docs/                   Architecture notes and decision records
skills/                 Subsystem guidance for contributors
```

## Current limitations and roadmap

Nodra is deliberately growing from a strong editing core. Planned areas include:

- More complete Bézier and curved-geometry cutting and intersections.
- `DimensionLayout` and richer dimension presentation.
- Broader adapters for every entity type in the parametric solver.
- Profiling, spatial indexing, and bundle-size improvements as real workloads require them.
- Defined import/export boundaries for formats such as DXF and PDF.
- A richer desktop packaging and manufacturing workflow.

The project avoids speculative dependencies and optimisations until a measured product requirement exists.

## Documentation

- [Current architecture](docs/agent-guidance/current-architecture.md)
- [Architecture decision records](docs/adr/)
- [Explicit node connections](docs/explicit-node-connections.md)
- [Bézier and Forma notes](docs/forma-curves.md)
- [Subsystem skills](skills/)

## Contributing

1. Read `AGENTS.md` and the relevant subsystem skill.
2. Keep package boundaries and public APIs intact.
3. Route document mutations through `@nodra/editor-core` commands.
4. Preserve the Spanish UI copy unless a language change is intentional.
5. Add focused tests for behavior and topology changes.
6. Run the complete verification sequence before opening a pull request.

Small, isolated commits are preferred because domain, solver, editor, renderer, and web changes are intentionally coupled through explicit contracts.

## License

A license has not been declared yet. Do not assume the code is available for redistribution until a license is added.
