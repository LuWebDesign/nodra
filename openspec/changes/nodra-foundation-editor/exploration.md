## Exploration: Nodra foundation and first offline-first editor vertical

### Current State

Nodra is an empty repository after `sdd-init`. The only project files are `.gitignore`, `.atl/skill-registry.md`, `openspec/config.yaml`, and OpenSpec placeholder files. There are no source files, package manifests, workspace configuration, CI files, tests, or established application conventions to preserve. The OpenSpec config confirms that no test runner, linter, formatter, type checker, or coverage tool is currently available.

The environment has Node `v24.14.0` and npm `11.12.1`; `pnpm` is not installed. The directory is not currently a Git repository. These are bootstrap constraints, not product behavior, and should be resolved in the foundation slice rather than guessed around.

The requested change combines two concerns: repository/platform foundation and a functional offline-first SVG editor vertical. It should be treated as a sequence of independently verifiable slices, not one implementation task.

### Affected Areas

- `package.json`, `pnpm-workspace.yaml`, lockfile, and root TypeScript/tooling config — establish the pnpm monorepo, strict TypeScript, scripts, and reproducible quality gates.
- `apps/editor` (proposed) — Vite/React shell, PWA registration, editor layout, honest Design and Prepare placeholder states, and UI composition.
- `packages/domain` (proposed) — document, layer, element, transform, operation metadata, and command contracts; no SVG or browser dependencies.
- `packages/editor-core` (proposed) — editor use cases, selection, transforms, transactions, and history policy, expressed through ports.
- `packages/geometry` (proposed) — millimetre canonical geometry, top-left coordinate conventions, bounds, hit testing, and transform math.
- `packages/persistence` (proposed) — repository ports, Zod persistence schemas, Dexie IndexedDB adapter, autosave, startup recovery, and schema/version handling.
- `packages/import-export` (proposed) — the supported initial document interchange boundary; do not imply full PDF, DXF, Bezier, boolean, or parametric support.
- `packages/validation` (proposed) — Zod-backed document validation and safe load/recovery errors.
- `packages/ui` (proposed) — reusable presentation components with state and domain behavior kept outside the component layer.
- `apps/editor` renderer boundary — SVG rendering should consume validated domain snapshots and remain separate from domain/editor-core logic.
- `tests`/package-local tests and CI workflow (proposed) — unit tests for pure packages, persistence integration tests, renderer/UI smoke coverage, and install/typecheck/lint/test/build checks.

### Smallest Coherent Implementation Slices

1. **Repository foundation and quality gate** — install/pin pnpm, create workspace and package boundaries, configure React 19.2/Vite 8/strict TypeScript, formatter/linter/test runner, and CI. Prove a minimal app and package can install, typecheck, test, and build.
2. **Canonical document model and geometry** — define IDs, layers, rectangle/ellipse/line elements, mm/top-left geometry, transforms, validation schemas, and deterministic pure tests. This is the stable contract for every later slice.
3. **SVG renderer and read-only canvas** — map domain snapshots to SVG, establish viewport-to-document coordinate conversion, and render sample elements. Keep renderer one-way and free of persistence/state ownership.
4. **Editor interaction vertical** — select, rectangle, ellipse, line, and pan tools; selection and transforms; layer ordering/visibility; commit a drag as one command/transaction and provide undo/redo. This is the first user-functional vertical.
5. **Offline persistence and recovery** — add Dexie through a repository adapter, versioned Zod-validated records, debounced autosave, dirty-state semantics, startup recovery, and failure-safe fallback. Test reload, interrupted save, invalid data, and schema migration behavior.
6. **PWA and product shell** — service worker/app-shell caching, offline indicator/recovery UX, and honest Design/Prepare placeholders. No laser hardware integration is implied; laser operation metadata remains document data only.
7. **Import/export boundary and delivery hardening** — implement only the explicitly supported initial format (likely the native document format plus SVG if selected during proposal), document exclusions, and complete CI/e2e smoke checks.

Slices 2–5 are the smallest coherent product path. Slice 1 must precede them; slices 6–7 can follow the first functional editor while preserving the same contracts.

### Approaches

1. **Ports-and-adapters monorepo with pure core** — keep domain, geometry, validation, and editor-core browser-agnostic; inject persistence and rendering boundaries; use Zustand only in the UI/application adapter.
   - Pros: testable geometry/history, explicit dependency direction, safe offline recovery, renderer replaceability, and a clear path to later export formats.
   - Cons: more package and port boilerplate at bootstrap; requires disciplined ownership of state and transactions.
   - Effort: High

2. **Feature-first application package** — build the editor in one Vite package and extract shared packages only when duplication appears.
   - Pros: fastest first screen and lower initial workspace overhead.
   - Cons: encourages SVG, Zustand, persistence, and domain coupling; makes canonical units, recovery, and drag history harder to test and extract safely.
   - Effort: Medium initially, High total risk

3. **State-library-centered architecture** — model the document and commands primarily as Zustand state, with packages acting as helpers.
   - Pros: direct UI wiring and quick interaction prototyping.
   - Cons: domain invariants become store-dependent, persistence semantics leak into UI state, and one-drag/one-undo guarantees become fragile.
   - Effort: Medium initially, High maintenance risk

### Recommendation

Use approach 1. Define the document and geometry contracts before renderer or persistence code, and make the first acceptance path a native document opened offline, edited with the five requested tools, rendered as SVG, autosaved to IndexedDB, recovered after reload, and undone in one step per drag. Keep Zustand as an adapter-facing interaction/session store rather than the source of truth for domain invariants. Make laser operation metadata explicit but inert: it describes intended operations and must not claim hardware execution.

Before proposal, resolve these architectural decisions:

- Exact workspace layout and package naming, including whether `apps/editor` is the only app.
- The initial native document format/version and whether SVG import/export is in the first release boundary.
- ID generation, document revision, autosave debounce, crash-recovery marker, and migration policy.
- Transform representation and resize/rotation semantics for the initial tools.
- Layer model and whether ordering, visibility, and locking are in the first interaction slice.
- Renderer coordinate/viewport contract, hit-test ownership, and selection affordance behavior.
- Test stack and CI runtime, including browser/PWA validation strategy; `pnpm` must be installed or pinned before these can be executed.
- Delivery order under the 400-line review budget. The scope is likely multiple reviewable slices, but the current `ask-on-risk` strategy requires asking when the task forecast confirms oversized work.

### Risks

- The requested stack cannot be verified against the repository yet because pnpm is absent and there is no package manifest; bootstrap tooling is a prerequisite.
- The repository is not a Git repository, so CI and review-budget measurements cannot be established until repository setup is explicitly handled outside product implementation.
- A broad first change can exceed the 400-line review budget; combining foundation, editor interactions, persistence, PWA, and CI in one slice would reduce reviewability.
- SVG coordinates and screen coordinates can drift unless mm-to-viewport conversion, top-left origin, viewBox policy, and device-pixel behavior are specified once in geometry/renderer contracts.
- Autosave can overwrite newer edits or hide failed writes unless revisions, serialized transactions, debounce cancellation, and recovery state are defined before implementation.
- Zod runtime validation must protect both IndexedDB reads and imported documents; TypeScript types alone cannot protect corrupted or older persisted records.
- Zustand subscriptions can accidentally become the domain model; enforce one-way conversion between application session state and immutable/transactional document state.
- Rotation, resizing, selection, and hit testing have ambiguous edge cases for ellipses and lines; the initial transform scope must be deliberately bounded.
- PWA service-worker caching can serve stale application assets or create confusing recovery behavior; offline acceptance needs explicit cache/version tests.
- “Design” and “Prepare” must remain honest placeholders so the UI does not imply design completion or laser readiness.
- Full PDF/DXF/Bezier/boolean/parametric support, cloud/auth, and hardware control must remain explicit non-goals to prevent scope expansion.

### Ready for Proposal

Yes. The repository evidence is sufficient to write a proposal for a staged foundation-plus-editor change. The proposal should preserve the recommended package boundaries, state the native document and import/export boundary explicitly, and split delivery into reviewable slices. It should ask the user only if the unresolved format/transform decisions materially change scope; otherwise record conservative defaults in the proposal and defer detailed contracts to spec/design.
