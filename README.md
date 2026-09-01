# Kond Design

Kond Design is an offline-first, browser-based 2D vector editor built with React and TypeScript. It provides a typed document model, command-driven editing, SVG rendering, geometry-aware interactions, and local project persistence.

## Status

Kond Design is under active development. The current editor includes:

- Rectangles, ellipses, lines, contours, and cubic paths.
- Selection, move, resize, rotation, mirroring, snapping, and undo/redo.
- Forma node editing for supported geometry.
- Versioned documents with pages, layers, revisions, validation, and migration support.
- Deterministic SVG rendering.
- Offline persistence and recovery through IndexedDB.

## Requirements

- Node.js `>=24.0.0`
- pnpm `>=10.15.1 <11`

If pnpm is not available on Windows, use `corepack pnpm`.

## Quick start

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Open the local Vite URL shown in the terminal.

## Commands

Run these checks from the repository root:

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:e2e
corepack pnpm build
```

Run the web app directly:

```bash
corepack pnpm --filter @nodra/web dev
```

## Workspace structure

| Path | Responsibility |
| --- | --- |
| `apps/web` | React/Vite/PWA composition root |
| `packages/domain` | Versioned document, project, page, layer, and element models |
| `packages/geometry` | Bounds, hit testing, geometry nodes, and transformations |
| `packages/constraints` | Parametric capabilities and derived constraint state |
| `packages/validation` | Runtime schemas, validation, and migrations |
| `packages/editor-core` | Immutable commands, gestures, selection, and history |
| `packages/renderer-svg` | SVG projection and rendering |
| `packages/persistence` | IndexedDB storage, autosave, and recovery |
| `packages/ui` | Framework-independent UI contracts |

## Architecture

The dependency direction is intentionally one-way:

```text
web -> domain, geometry, editor-core, persistence, renderer-svg
editor-core -> domain, geometry, validation
renderer-svg -> domain, geometry, constraints, validation
constraints -> domain, geometry
persistence -> domain, validation
geometry -> domain
validation -> domain
domain -> no dependencies
```

Each package exports its public API from `src/index.ts`. The web app composes those APIs rather than reaching into package internals.

## Documentation

- `docs/agent-guidance/current-architecture.md` — current architecture and boundaries.
- `docs/adr/` — architecture decisions.
- `skills/` — subsystem guidance and verification conventions.

## License

No license has been declared yet.
