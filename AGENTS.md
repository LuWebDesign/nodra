# Nodra agent guidance

## Workspace

- This is a pnpm workspace over `apps/*` and `packages/*`; install with `pnpm install --frozen-lockfile`.
- Requirements: Node `>=24.0.0`; pnpm `>=10.15.1 <11`. The root package manifest declares pnpm 10.15.1 and Node `>=24.0.0`.
- `apps/web` is the React/Vite/PWA composition root; start composition changes at `apps/web/src/main.tsx`.
- Package boundaries are `@nodra/domain`, `@nodra/geometry`, `@nodra/validation`, `@nodra/renderer-svg`, `@nodra/editor-core`, `@nodra/ui`, and `@nodra/persistence`; each exports source from `src/index.ts`.
- Keep domain, geometry, validation, editor-core, renderer-svg, and persistence independent of the web composition layer; use workspace package imports rather than reaching across package internals.
- Existing UI copy is Spanish; preserve it when changing UI artifacts.

## Execution environments

- Nodra may be executed from Windows PowerShell or Ubuntu/WSL. These are distinct environments; do not assume PATH, filesystem paths, shell syntax, Node, pnpm, or browser availability are shared.
- Before diagnosing a tooling failure, report and verify the OS, shell, `node --version`, and `pnpm --version` (or Corepack availability).
- If bare `pnpm` is unavailable on Windows, `corepack pnpm <command>` may be used and reported as an environment-specific equivalent; do not silently label this a code failure.
- Do not mix WSL and Windows paths without explicitly stating the boundary.

## Verification

- Use the repository's recommended root-script validation order: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm build`. No `.github/workflows` directory is present, so this is not verified CI behavior.
- Validation reports must identify the OS/shell context and distinguish code/test failures from environment/tooling failures.
- `pnpm lint` fails on any warning. `pnpm typecheck` is strict and no-emit. `pnpm test` runs Vitest; `pnpm test:e2e` runs one real Playwright smoke test and is not comprehensive product coverage.
- Focus package tests with, for example, `pnpm --filter @nodra/domain test`; valid package filters are the seven `@nodra/*` packages above.
- Run one test file with `pnpm exec vitest run packages/domain/src/index.test.ts`.
- Vitest discovers `packages/*/src/**/*.test.ts[x]` and `apps/*/src/**/*.test.ts[x]`, uses forked workers, excludes generated/output directories, and permits no tests.
- Playwright reads `tests/e2e`; `tests/e2e/app.smoke.spec.ts` covers editor workspace load, title `Nodra Editor`, properties region `Barra de propiedades`, and `Seleccion` button. `playwright.config.ts` starts `corepack pnpm --filter @nodra/web dev --host 127.0.0.1 --port 4173`, waits for `http://127.0.0.1:4173`, uses that URL as `baseURL`, reuses an existing server outside CI, and remains Chromium-only. No workflow evidence verifies CI E2E scheduling.

## TypeScript and generated output

- Respect strict checks including `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, and `verbatimModuleSyntax`.
- TypeScript build output goes to `.build`; Vite/PWA output goes to `apps/web/dist` and may create service-worker/app-shell artifacts. Do not edit generated output.
- ESLint is type-aware and ignores generated, build, and test-output directories. `tsconfig.json` includes `tests/**/*.ts` for type-aware lint/typecheck coverage.

## Repository workflow

- `.atl/skill-registry.md` is generated; refresh it only with `gentle-ai skill-registry refresh --force`.
- `openspec/config.yaml` is stale for tooling; current package manifests are authoritative. No `.github/workflows` directory is present, so do not infer CI behavior from repository scripts. Treat OpenSpec task status as planning context, not proof that code exists; verify implementation in the repository.

## Agent skills

Use the smallest matching project skill before changing a subsystem; read its local references only when the task needs the detail.

- Architecture and boundaries: `skills/nodra-architecture/SKILL.md`
- Editor commands, gestures, tools, and history: `skills/nodra-editor-workflow/SKILL.md`
- Exact editor tool runtime contract and interaction matrix: `skills/nodra-editor-tools-contract/SKILL.md` (trigger: Nodra editor tool contract, tool gesture, connection, or any of select, forma, pen, spline, text, rectangle, ellipse, line, dimension, pan)
- Domain and geometry: `skills/nodra-domain-geometry/SKILL.md`
- Persistence and autosave: `skills/nodra-persistence/SKILL.md`
- SVG rendering and performance: `skills/nodra-rendering-performance/SKILL.md`
- Verification and test evidence: `skills/nodra-verification/SKILL.md`

Skills guide but do not replace technical analysis. Examples are guidance, not mandatory implementations.
