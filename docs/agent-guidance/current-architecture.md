# Current Nodra Architecture

This audit records the implemented system, not planned architecture. Use source and manifests as authority; no `.github/workflows` directory is present, so CI behavior is not verified here.

## Current Nodra Architecture

Nodra is a pnpm workspace over `apps/*` and `packages/*`. `apps/web/src/main.tsx` is the React composition root. `App.tsx` currently composes editor-core commands and history, domain/project state, geometry and hit testing, one-way SVG rendering, Dexie persistence/autosave, and Zustand UI/session stores.

## Modules and dependency graph

```text
web -> domain, geometry, editor-core, persistence, renderer-svg
editor-core -> domain, geometry, validation
renderer-svg -> domain, geometry, constraints, validation
constraints -> domain, geometry
persistence -> domain, validation, Dexie
geometry -> domain
validation -> domain, Zod
domain -> no dependencies
ui -> no dependencies; standalone boundary, not declared by apps/web
```

Packages are `domain`, `geometry`, `constraints`, `validation`, `editor-core`, `renderer-svg`, `persistence`, and `ui`; each exports from `src/index.ts`. `constraints` centralizes parametric capabilities and derived entity state, initially through adapters for sketches and circles. `ui` is stateless contracts, not React components, and no package manifest currently declares it as a dependency.

## Technologies actually installed

Node >=24; pnpm 10.15.1; TypeScript 5.9.2; React 19.1.1; Vite 7.1.3; Vitest 3.2.4; Playwright 1.55.0; ESLint 9 with typescript-eslint 8; vite-plugin-pwa; Zod 4.1.5; Dexie 4.2.1; fake-indexeddb 6.0.1; Zustand 5.0.8.

## Strengths

- Explicit package boundaries and source exports.
- Domain schemaVersion 6, branded IDs, mm/top-left coordinates, pages/layers, revisions, typed elements, and stable sketch-edge dimension references.
- Zod validation/migrations, command-driven editing, gesture transaction semantics, escaped non-mutating SVG, and revision-aware local recovery.

## Risks and gaps

### Critical
- E2E coverage is limited to one real Chromium smoke test: `tests/e2e/app.smoke.spec.ts` verifies editor workspace load, title `Nodra Editor`, properties region `Barra de propiedades`, and `Seleccion` button. It is not comprehensive product coverage.
- No defined import/export boundary or user-facing SVG/DXF/PDF flow.

### Important
- `App.tsx` is a large composition hotspot.
- Schema migrations and renderer support classification must remain aligned as the document model evolves.
- `packages/ui` contains contracts only.
- This audit is the current architecture documentation; ADRs and prior developer architecture documentation are still missing.

### Later
- `playwright.config.ts` starts `corepack pnpm --filter @nodra/web dev --host 127.0.0.1 --port 4173`, waits for `http://127.0.0.1:4173`, uses it as `baseURL`, reuses an existing server outside CI, and remains Chromium-only.
- `tsconfig.json` includes `tests/**/*.ts` for type-aware lint/typecheck.
- OpenSpec configuration records the current smoke-test E2E layer, but it does not imply comprehensive E2E coverage.
- No product Web Workers or spatial index; neither is evidence of a defect.

These are findings, not fixes in this audit. Preserve existing Spanish UI copy.

## Explicitly deferred decisions

Paper.js, Clipper2, Maker.js, RBush, Canvas/WebGL, Web Workers, DXF/PDF parsers, and alternate storage are not installed or selected. Evaluate only after a concrete requirement and measurement, using browser/TypeScript compatibility, license, maintenance, precision, bundle impact, performance, worker suitability, and API fit.
