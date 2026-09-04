# Nodra agent guidance

## Setup and entrypoints

- This is a pnpm workspace over `apps/*` and `packages/*`. Requirements are Node.js `>=24.0.0` and pnpm `>=10.15.1 <11`; the pinned package manager is pnpm `10.15.1`.
- Install from the repository root with `corepack pnpm install --frozen-lockfile`. On Windows, use `corepack pnpm` when bare `pnpm` is unavailable.
- Start the browser composition at `apps/web/src/main.tsx`; run it with `corepack pnpm dev` or `corepack pnpm --filter @nodra/web dev`.
- `apps/desktop` is a separate Vite/Tauri host. The root `build` script type-checks the workspace and builds only `@nodra/web`; use the desktop package scripts for desktop work.

## Boundaries and conventions

- Public workspace packages are `@nodra/domain`, `@nodra/geometry`, `@nodra/constraints`, `@nodra/validation`, `@nodra/editor-core`, `@nodra/renderer-svg`, `@nodra/persistence`, and `@nodra/ui`; each exports `src/index.ts`.
- Dependency direction is one-way: `domain` has no dependencies; `geometry` and `validation` depend on `domain`; `constraints` depends on domain/geometry; `editor-core` depends on domain/geometry/validation; `renderer-svg` depends on domain/geometry/constraints/validation; `persistence` depends on domain/validation; web composes the runtime packages. `ui` is standalone and is not currently a web dependency.
- Import package APIs through `@nodra/*` workspace names, not package internals. Preserve the existing Spanish UI copy when changing UI artifacts.

## Verification

- Run the repository quality gates from the root in this order: `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm test:e2e`, `corepack pnpm build`. This is also the order in `.github/workflows/ci.yml` (Ubuntu 24.04, Node 24, pnpm 10.15.1).
- `lint` uses type-aware ESLint and treats warnings as failures (`--max-warnings=0`). `typecheck` is strict and no-emit. Unit tests use Vitest with forked workers and discover `packages/*/src/**/*.test.ts[x]` and `apps/*/src/**/*.test.ts[x]`.
- Focus a package with `corepack pnpm --filter @nodra/domain test`; run one file with `corepack pnpm exec vitest run packages/domain/src/index.test.ts`.
- `test:e2e` installs Chromium, then runs Playwright tests in `tests/e2e`. The config is Chromium-only and starts `@nodra/web` at `http://127.0.0.1:4173`; outside CI it reuses an existing server. This suite is browser coverage, not a complete product test suite.
- For a focused browser test, use Playwright directly, for example: `corepack pnpm exec playwright test tests/e2e/app.smoke.spec.ts -g "loads the editor workspace"`.

## Strictness and generated output

- TypeScript enables strict mode plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `isolatedModules`, and `verbatimModuleSyntax`; preserve these constraints.
- `corepack pnpm build` writes TypeScript output to `.build`, then Vite/PWA output to `apps/web/dist` (including service-worker/app-shell artifacts). Do not edit generated output; these paths are ignored by ESLint and Git.
- `tsconfig.json` includes `tests/**/*.ts` for type-checking; the build config intentionally excludes tests.

## Project-specific skills

- Before changing a subsystem, load the smallest matching skill: architecture (`skills/nodra-architecture/SKILL.md`), editor workflow (`skills/nodra-editor-workflow/SKILL.md`), domain/geometry (`skills/nodra-domain-geometry/SKILL.md`), persistence (`skills/nodra-persistence/SKILL.md`), rendering (`skills/nodra-rendering-performance/SKILL.md`), or verification (`skills/nodra-verification/SKILL.md`).
- For editor tool gestures or runtime contracts, also load `skills/nodra-editor-tools-contract/SKILL.md`.
