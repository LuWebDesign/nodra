# Apply Progress: Nodra Foundation Editor

## Execution

- Change: `nodra-foundation-editor`
- Mode: Standard Mode (`strict_tdd: false`; no test runner existed at initialization)
- Delivery: stacked-to-main chained PR slice
- Current work unit: 6 / task 4.2
- Runtime attempt token: `sha256:6ea81a4f04d9c344263f6495de728a8a573944ee19cdf8fcd653cc01bc9f0638`

## Completed Tasks

- [x] 1.1 Create the reproducible workspace foundation and quality-gate configuration.
- [x] 1.2 Create domain contracts.
- [x] 1.3 Create validation contracts.
- [x] 1.4 Create geometry contracts.
- [x] 2.1 Create the SVG renderer boundary.
- [x] 2.2 Create editor-core commands and history.
- [x] 2.3 Create UI components.
- [x] 3.1 Create persistence and recovery.
- [x] 3.2 Create the web shell.
- [x] 4.1 Create planning documentation and ADRs.
- [x] 4.2 Add Playwright product smoke coverage.

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test/quality command and exact result | Work units 1–4 evidence remains above. Work unit 5 evidence remains above. Work unit 6: `npm exec --yes pnpm@10.15.1 -- exec playwright test tests/e2e/app.smoke.spec.ts` — exit 0; 6 Chromium smoke tests passed. |
| Runtime harness command/scenario and exact result | `npm exec --yes pnpm@10.15.1 -- exec playwright test tests/e2e/app.smoke.spec.ts` — exit 0; Vite dev server exercised create/transform/undo, SVG rendering, IndexedDB reload recovery, offline status, and Prepare refusal. |
| Rollback boundary | Revert the five smoke scenarios in `tests/e2e/app.smoke.spec.ts`, the recovery lifecycle/status fix in `apps/web/src/App.tsx`, and the task/progress checkbox updates without touching unrelated dirty files. |

## Notes

- The root `packageManager` field pins pnpm `10.15.1`; CI uses `pnpm/action-setup@v4` with the same version before running frozen-lockfile gates.
- Work unit 2 keeps domain contracts immutable-shaped and versioned, validates all native records with bounded safe results, and centralizes canonical mm/top-left geometry without browser dependencies.
- Work unit 3 exposes a pure `renderSvg` boundary that validates incoming snapshots, converts mm coordinates through the viewport, respects layer visibility/order, renders rectangle/ellipse/line elements, and returns bounded invalid/unsupported results without mutating input.
- Work unit 4 exposes immutable command dispatch and transaction history, transient gesture previews with one committed history entry, selection/layer operations, redo invalidation, and typed stateless UI view contracts including an explicit inert Prepare placeholder.
- Work unit 1 evidence remains cumulative above.
- Work unit 5 provides a browser-independent Dexie repository, explicit record migration registry, validated newest-revision recovery, stale-write protection, debounced retry-safe autosave status, and non-blocking storage persistence capability detection.
- Work unit 6 provides the first Vite/React shell with separate Zustand UI/document/selection/viewport/persistence stores, renderer-svg canvas composition, Design tools and property editing, keyboard move/delete/undo/redo, layer visibility, Dexie recovery/autosave status, honest Prepare placeholder, and generated PWA app-shell caching. Planning documentation and ADRs are now recorded.
- Task 4.2 adds six focused Chromium smoke tests. The app keeps the Dexie repository open across React Strict Mode effect cleanup and preserves the local recovery notice through the first autosave effect, allowing reload recovery to be observed by the product test.
