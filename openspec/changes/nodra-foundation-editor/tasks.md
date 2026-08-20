# Tasks: Nodra Foundation Editor

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 1,200–2,000 authored lines across workspace, tests, CI, and docs |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Foundation → core contracts → renderer → interaction/history → persistence → shell/docs |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal; focused test command; runtime harness; rollback boundary |
|---|---|
| 1 | Workspace/CI; `pnpm install --frozen-lockfile && pnpm typecheck`; N/A (tooling-only); revert root manifests and CI. |
| 2 | Domain/geometry/validation; `pnpm test --filter @nodra/domain --filter @nodra/geometry --filter @nodra/validation`; N/A (pure packages); revert those package trees. |
| 3 | SVG boundary; `pnpm test --filter @nodra/renderer-svg`; N/A (adapter contract only); revert `packages/renderer-svg`. |
| 4 | Commands, UI, history; `pnpm test --filter @nodra/editor-core --filter @nodra/ui`; Playwright create/transform/undo scenario; revert core/UI and shell wiring. |
| 5 | Dexie persistence/recovery; `pnpm test --filter @nodra/persistence`; Playwright reload/offline recovery scenario; revert persistence adapter and status wiring. |
| 6 | PWA shell, docs, hardening; `pnpm lint && pnpm test && pnpm build`; Playwright Prepare-refusal/offline-status smoke; revert `apps/web`, CI/docs only. |

## Phase 1: Foundation and Contracts

- [x] 1.1 Create `package.json`, `pnpm-workspace.yaml`, lockfile, strict TypeScript/Vitest/Playwright configs, and CI quality gates.
- [x] 1.2 Create `packages/domain/src` immutable document, layer, primitive, transform, metadata, ID, and revision contracts.
- [x] 1.3 Create `packages/validation/src` Zod schemas/results for versions, finite geometry, references, metadata, and unsupported payloads.
- [x] 1.4 Create `packages/geometry/src` mm/top-left bounds, transforms, hit testing, and viewport conversion; test degenerate rejection.

## Phase 2: Rendering and Editing

- [x] 2.1 Create `packages/renderer-svg/src` snapshot/viewport renderer with bounded unsupported/invalid results and immutability tests.
- [x] 2.2 Create `packages/editor-core/src` commands, transactions, selection, layers, gesture preview/commit, undo/redo, and redo invalidation tests.
- [x] 2.3 Create `packages/ui/src` stateless toolbar, properties, layers, viewport, persistence status, and inert Prepare components.

## Phase 3: Persistence and Shell

- [x] 3.1 Create `packages/persistence/src` repository port, Dexie adapter, revision-safe debounce/retry, recovery, and migration registry; test corrupt/obsolete records.
- [ ] 3.2 Create `apps/web` composition root, Design canvas, Zustand adapter stores, PWA/offline shell, recovery indication, and hardware-execution refusal.

## Phase 4: Documentation and Verification

- [ ] 4.1 Create `docs/initial-plan.md` and ADRs `0001-vite-react-spa`, `0002-custom-domain-model`, `0003-svg-renderer`, `0004-millimetre-top-left-units`, `0005-offline-indexeddb`, `0006-command-history`.
- [ ] 4.2 Add Playwright smoke coverage for create-transform-undo, SVG rendering, reload recovery, offline status, and Prepare refusal; run all CI gates.
