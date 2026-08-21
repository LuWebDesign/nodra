# Testing matrix

| Layer | Current evidence/technology | Verify |
|---|---|---|
| Domain/validation | Vitest 3.2.4, Zod 4.1.5 | current schema constant, branded IDs, migrations, invalid data |
| Geometry | Vitest package tests | mm/top-left transforms, bounds, rotation, hit tolerance, handles |
| Editor-core | Vitest package tests | commands, selection, gesture preview/commit/cancel, one history entry, undo/redo |
| Renderer | Vitest package tests | escaping, visible layers, schema classification (`invalid` for malformed supported-schema documents; `unsupported` for unsupported versions/features), no mutation; regress both branches |
| Persistence | Vitest + fake-indexeddb 6.0.1 | migration, corruption recovery, stale writes, retries, delete |
| Web | typecheck/lint/build | composition and Spanish UI contract |
| E2E | Playwright 1.55.0, Chromium-only | `tests/e2e/app.smoke.spec.ts` is one real smoke test covering editor workspace load, title `Nodra Editor`, properties region `Barra de propiedades`, and `Seleccion` button. `playwright.config.ts` starts `corepack pnpm --filter @nodra/web dev --host 127.0.0.1 --port 4173`, waits for `http://127.0.0.1:4173`, uses it as `baseURL`, and reuses an existing server outside CI. This is not comprehensive product coverage. |

Nodra may run from Windows PowerShell or Ubuntu/WSL; treat them as distinct execution environments. Do not assume PATH, filesystem paths, shell syntax, Node, pnpm, or browser availability are shared. Before diagnosing tooling failure, record the OS, shell, `node --version`, and `pnpm --version` (or Corepack availability). If bare `pnpm` is unavailable on Windows, `corepack pnpm <command>` is an environment-specific equivalent; report it as such rather than as a code failure. Do not mix WSL and Windows paths without stating the boundary.

Root scripts are `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, and `pnpm build`; this is the repository's recommended validation order. Validation reports must include the environment and distinguish code/test failures from environment/tooling failures. Record each exact command and result. A filtered package build can support package evidence but does not prove the root build. No `.github/workflows` directory is present, so CI execution of these commands is not verified. `test:e2e` now has one real smoke test, but it is not comprehensive product coverage. `tsconfig.json` includes `tests/**/*.ts` for type-aware lint/typecheck. Lightweight documentation work should use file existence, link, frontmatter, and section-order checks only.
