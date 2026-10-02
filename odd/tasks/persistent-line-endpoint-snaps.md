# Persist endpoint snaps for Line-tool Sketch edges

## Goal
Make confirmed endpoint-to-endpoint snaps durable like existing endpoint-to-midpoint snaps for the user's two-click Línea Sketch workflow. Cover creating new edges and attaching/moving existing independent edges in Forma and Selección. Preserve preview-only behavior until gesture confirmation, then keep the relation through edits, reload, and history.

## Scope and constraints
- User confirmed the desired scope includes both possibilities: a newly created line and an already-created independent line.
- Continue the established workflow: two-click Línea creates Sketch edges; Forma drags an endpoint; Selección drags the Sketch edge body.
- Use stable Sketch node references and the existing solver-backed document `coincident` constraint, matching the midpoint relation's persistence/undo contract. Use same-Sketch shared node topology where the Line tool already reuses a node.
- Do not change endpoint snap tolerance/priority, center/midpoint inference, other drawing tools, or the distinct deliberate-drag native-Line gesture unless evidence shows a necessary shared path.
- Preserve Sketch Kernel/editor-core ownership, one transaction per gesture, Escape cancellation, existing constraints, and project persistence. No schema or persistence-layer changes expected.
- Work in `C:/dev/nodra-midpoint-feedback`, branch `fix/existing-line-midpoint-snap`. The previous midpoint work is already pushed as `f1b0c47` + `7746b6f`. User authorized commit and push for this follow-up; no PR or merge is authorized.

## Tasks
- [x] E1: Added four browser regressions with exact source/dependent Sketch edge node references and endpoint geometry checks before durable relation checks. RED observed: all four routes—new Sketch edge, appended edge, Forma endpoint drag, and Selección body drag—landed within 1 px of the source endpoint, then failed only because no persisted `coincident` DocumentConstraint existed. Setup fixture passed.
- [x] E2: Captured stable visible Sketch-node identities without changing snap priority, and atomically committed `coincident` constraints with geometry for new independent edges, appended edges, Forma endpoint moves, and Selección body moves. Existing same-Sketch shared-node topology remains intact. Root cause for initial new-edge failure: the resolver and atomic command produced the relation, but `commitNewSketch`'s existing-piece path updated the element without synchronizing document constraints into the project. Fixed project synchronization/state restoration in `apps/web/src/App.tsx`. GREEN: 89 interaction tests, all four endpoint E2E cases, and typecheck passed.
- [x] E3: Updated `skills/nodra-editor-tools-contract/references/tool-behavior-matrix.md` and reviewed the complete candidate diff. Root gates: `corepack pnpm lint` passed; `corepack pnpm typecheck` passed; `corepack pnpm test` passed (878 tests); `CI=true corepack pnpm test:e2e` passed (112 passed, 1 skipped—the 90-degree angular Cota case; one worker, no retries); `corepack pnpm build` passed with a non-blocking 1,115.82 kB chunk-size warning. Focused endpoint suite passed all four behavior cases plus setup, interaction suite passed 89 tests. Default-parallel E2E attempts produced different timing-sensitive legacy failures; the CI-configured root gate passed.
- [x] E4: Triage found no reproducible endpoint-change regression in the existing `line-linked-delete-reload.spec.ts` case: its isolated rerun passed; original full-run trace was unavailable, so the transient cause remains unknown. Reconciled node/midpoint overlap with existing interaction tests and implementation: distinct midpoint target is suppressed by real-node priority, exact-coordinate overlap may preserve both relations; behavior matrix documents this.

## Delivery
Implementation committed as `f5986cf` (`feat(sketch): persist endpoint snap relations`). User authorized pushing this branch; no PR or merge is authorized.