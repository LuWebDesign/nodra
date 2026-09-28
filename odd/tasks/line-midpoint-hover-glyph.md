# Transient midpoint inference glyph

Objective: Show a visible midpoint snap glyph during Line inference while retaining the existing parametric same-sketch midpoint relation and preserving source-edge topology.

Problem: The existing Line candidate resolver derives edge midpoints, and confirmed clicks persist a dependent-node-to-edge midpoint constraint, but hover currently renders only a guide line. The target midpoint has no distinct transient marker.

Scope: The Line editor overlay and a browser regression test. Non-goals: generating an editable source-edge midpoint node, splitting edges, changing the solver or validation contract, cross-sketch midpoint relations, and the separate cross-node alignment-guide gap.

Branch: `feat/line-midpoint-hover-glyph`, isolated worktree `C:/dev/nodra-midpoint-hover`, based on `origin/main` `b2d325c4f02092299dd7044cbb0df372e3232e5d`. PR #252 is open and contains the earlier browser integration test; do not rewrite that PR. Preserve unrelated changes in the original worktree.

Acceptance: While a Line midpoint candidate is active, the target has a temporary, pointer-transparent midpoint glyph. Leaving the target removes it; hover does not change document revision or element IDs. A confirmed click continues to use the existing driving midpoint relation, with no extra source node or topology change. Existing browser behavior remains valid.

TDD mode: unknown/not configured in existing ODD ledger; use ordinary regression-first tests. Runner: `corepack pnpm exec playwright test <focused-file>` for focused browser evidence. Full gates: `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm test:e2e`, `corepack pnpm build` in order. Delivery strategy: one PR-sized work unit (<400 authored changed lines forecast), no push or PR requested.

- [x] MH1: Added a temporary zoom-stable, pointer-transparent midpoint hover glyph and a browser regression for appearance, disappearance, stable size and unchanged document identity; retained the existing click/constraint path and source topology. Route: delegated `gentle-ai-worker` (multiple non-trivial files). Allowed paths: `apps/web/src/App.tsx`, `apps/web/src/styles.css`, `tests/e2e/line-midpoint-hover.spec.ts`. Checks: focused Playwright 2 passed; independent full gates in order: lint and typecheck passed, 779 unit tests passed, 89 E2E passed/1 skipped, build passed with non-blocking large-chunk warning. Native assessment was unavailable (`schema-incompatible`); the required independent verifier ran the full gates. Work-unit commit: `4b11c37f77c6bc1251301be07169e72f7db1d020` (`feat(line): show transient midpoint snap glyph`).

Next: Changes remain local in the isolated feature branch. PR #252 is open and untouched. Do not push or open another PR without a separate request; the cross-node alignment gap remains a separate task.
