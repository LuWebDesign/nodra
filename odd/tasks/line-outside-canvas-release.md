# Line release outside the canvas

- Branch: `fix/line-outside-release`, based on integrated `origin/main` at `c412122`.
- Authorization: user reported Chrome drag-to-sidebar release committed a persistent native Line and explicitly requested only a Line cancellation fix plus an E2E regression. No Circle, Arc, Rectangle or other tool behavior changes.
- Acceptance: a Line dragged from canvas and released outside it cancels preview and persists no geometry, including after reload; an in-canvas drag remains a native Line and clicks still create sketch edges.

## Tasks

- [ ] **L1 — Regress and fix the outside-release Line gesture**
  - Add a Playwright case in `tests/e2e/app.smoke.spec.ts` for a real dragged release over the sidebar, checking preview cleanup, unchanged document revision/IDs, and absence after reload.
  - Guard the Line draw finish path in `apps/web/src/App.tsx` so an out-of-canvas pointerup cancels via the editor gesture path without committing the preview; preserve other tools and in-canvas Line behavior.
  - Writer evidence (not independently verified or committed): RED — `corepack pnpm exec playwright test tests/e2e/app.smoke.spec.ts -g "cancels a Line gesture released outside the canvas"` failed on integrated baseline because the native line remained (expected 0, received 1). GREEN — same command passed after the Line-only cancellation change. Triangulation — `corepack pnpm exec playwright test tests/e2e/app.smoke.spec.ts -g "Line gesture|Line clicks create sketch edges while drags create separate native lines|continues a click line"` passed (7 tests, including click-to-sketch, in-canvas native drag, short release, cancellation, tool-switch, and path closure).
  - Independent verification passed root `lint`, `typecheck`, unit tests (762/762), E2E (83 passed, 1 existing skip), `build` and `git diff --check`. Build chunk-size warning is non-blocking; Corepack EPERM did not reproduce here. Work-unit commit identity pending; leave L1 unchecked until committed.

- [ ] **L2 — Separate Corepack EPERM diagnosis from product behavior**
  - User environment reported Node 24.14.0/Corepack 0.34.6 and EPERM on pnpm cache; do read-only diagnosis only and do not mutate cache, install packages, or conflate it with the Line defect.
  - Root gates passed here, but the user's local EPERM remains unresolved. Need the exact failing Corepack command, EPERM path/stack and cache ownership/ACL evidence from that host; no configuration change is authorized. Keep L2 pending until that evidence is available.
