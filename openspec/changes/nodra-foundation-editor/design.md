# Design: Nodra Foundation Editor

## Technical Approach

Bootstrap a strict pnpm workspace with `apps/web` and browser-agnostic packages. A validated, versioned document is the only source of truth; editor-core applies commands as transactions and emits snapshots. UI state is an adapter, while SVG and IndexedDB remain replaceable boundaries. The first vertical is rectangle/ellipse/line creation, selection, move/resize/rotate, layer visibility/order, pan/zoom, undo/redo, local recovery, and an explicitly inert Prepare placeholder.

## Architecture Decisions

| Decision | Choice | Alternatives rejected | Rationale |
|---|---|---|---|
| Workspace | `apps/web`; `packages/domain`, `geometry`, `validation`, `editor-core`, `renderer-svg`, `persistence`, `ui` | One application package; `apps/editor` | Separates requested browser-independent contracts from adapters without empty “future” packages. |
| Domain model | Custom immutable TypeScript model, Zod at every boundary, `schemaVersion`, stable IDs, mm/top-left coordinates | Generic scene graph; pixels; inferred versions | Preserves editable primitives, deterministic validation, and future migrations. |
| Rendering | One-way SVG adapter consuming `DocumentSnapshot` and `Viewport` | Canvas-first; renderer-owned state | SVG is inspectable and sufficient for the first primitives; renderer cannot mutate or persist. |
| History | Commands produce transactions; gesture preview is transient and commit is one transaction | Store-driven mutations; per-pointer-event history | Guarantees one completed drag equals one undo entry and makes redo semantics explicit. |
| Persistence | Repository port backed by Dexie IndexedDB, revision-aware debounced autosave | localStorage; cloud-first | Supports offline recovery and prevents stale pending writes from replacing newer revisions. |
| App state | Separate Zustand stores for UI, document session, selection, viewport, and persistence status | One global store; document in Zustand | UI subscriptions stay ergonomic while domain invariants remain in editor-core. |

Implementation creates ADRs `0001` Vite React SPA, `0002` custom domain model, `0003` SVG renderer, `0004` mm units, `0005` offline IndexedDB, and `0006` command history. The initial plan is foundation/tooling, contracts/geometry, renderer, interaction/history, persistence/recovery, then PWA shell and hardening.

## Data Flow

```text
pointer/tool intent -> editor-core command -> transaction -> DocumentSnapshot
                                      |                         |
                         history (undo/redo)                    +-> Zustand document session
                                                                +-> SVG renderer + viewport
                                                                +-> debounced revision-safe autosave -> Dexie
startup -> Dexie records -> Zod validation/newest revision -> editor-core session
```

## File Changes

| File | Action | Description |
|---|---|---|
| `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` | Create | Workspace scripts, pinned package manager, quality gates. |
| `apps/web/` | Create | Vite React PWA shell, Design canvas, Prepare placeholder, offline indicator, composition root. |
| `packages/domain/src/` | Create | `Document`, `Layer`, rectangle/ellipse/line, transforms, operation metadata, stable ID and revision types. |
| `packages/geometry/src/` | Create | Bounds, transforms, hit testing, mm/top-left rules, viewport conversion interfaces. |
| `packages/validation/src/` | Create | Zod schemas, finite/non-negative constraints, version/error results. |
| `packages/editor-core/src/` | Create | Commands, transactions, selection/layers, gesture commit, history ports. |
| `packages/renderer-svg/src/` | Create | Snapshot-to-SVG adapter and bounded unsupported-render result. |
| `packages/persistence/src/` | Create | Repository port, Dexie adapter, autosave coordinator, recovery and migration registry. |
| `packages/ui/src/` | Create | Stateless toolbar, properties, layers, status, and placeholder components. |
| `.github/workflows/ci.yml`, `vitest.config.ts`, `playwright.config.ts` | Create | Install, typecheck, lint, unit/integration, build, and browser smoke gates. |
| `docs/adr/0001-0006-*.md` | Create | The six implementation ADRs listed above. |

## Interfaces / Contracts

```ts
type DocumentSnapshot = { schemaVersion: 1; id: string; revision: number;
  origin: "top-left"; units: "mm"; layers: Layer[]; elements: Element[] };
interface EditorCommand { apply(d: DocumentSnapshot): Result<Transaction>; }
interface DocumentRepository { list(id: string): Promise<StoredRevision[]>; save(r: StoredRevision): Promise<void>; }
interface SvgRenderer { render(d: DocumentSnapshot, v: Viewport): RenderResult; }
interface Viewport { zoom: number; panMm: PointMm; screenToMm(p: PointPx): PointMm; mmToScreen(p: PointMm): PointPx; }
```
Element IDs survive edits; operation metadata is optional, validated, serialized, and independent of visual color. Autosave captures a revision, cancels superseded timers, and refuses writes whose revision is older than the latest committed revision.

## Testing Strategy

Unit tests cover Zod rejection, round trips, geometry/hit testing, viewport conversion, commands, degenerate transforms, one-drag/one-undo, redo invalidation, and metadata/color independence. Integration tests cover Dexie ordering, failed writes, debounce retry, corrupt/unknown-version recovery, and migration. Playwright smoke tests cover create-transform-undo, reload recovery, offline status, SVG rendering, and Prepare refusal. CI runs pinned `pnpm install --frozen-lockfile`, typecheck, lint, tests, and build; missing gates fail visibly.

## Threat Matrix

N/A — no routing, shell commands, subprocesses, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No existing data migration is required. Ship slices in the listed plan; schema migrations use an explicit version registry and preserve unknown records on failure. Roll back an adapter or slice without deleting local `.nodra` data. Keep delivery reviewable under the 400-line budget; ask before applying a high-risk oversized slice.

## Open Questions

None blocking. SVG exchange, advanced geometry, cloud sync, authentication, and hardware execution remain out of scope.
