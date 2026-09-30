# Midpoint feedback follow-ups

## Goal
Refine the merged open-edge midpoint experience from user feedback while preserving the driving constraint contract and unrelated geometry/tool behavior.

## User-reported outcomes
1. Show the orange midpoint square only when the cursor is near the calculated midpoint, using the same orange as orange node circles and a black outline like those circles.
2. Keep line default color blue, line hover orange, and fully defined constrained lines black.
3. Confirm independent native Line midpoint snapping remains available (report says center-source works but independent Line does not); inspect/reproduce before changing because the merged code already advertises native Line support.
4. Diagnose deleted created lines reappearing after refresh; reproduce the exact creation/deletion/save flow before changing persistence.
5. Move Horizontal/Vertical glyphs to the side of the segment while keeping them centered along its length.

## Confirmed source map
- `apps/web/src/interaction.ts`: `pickOpenEdgeMidpointHover` currently selects by proximity to the edge body, then returns the half-arc-length point.
- `apps/web/src/App.tsx`: midpoint overlay currently uses `#f97316`, size 8x8, no stroke; native/sketch line tool behavior is composed here.
- `packages/renderer-svg/src/index.ts`: sketch line visual colors derive from constraint state; fully-defined is dark, underdefined blue; constraint glyph anchor/layout is rendered here.
- `packages/editor-core/src/index.ts`, `apps/web/src/App.tsx`, persistence package, and app recovery/mirror modules own mutation/save/load behavior. Existing E2E tests cover some line deletion/reload flows.
- `resolveLineInference` and browser E2E already contain native Line first-click midpoint coverage; do not modify this behavior without a reproduction of the user's independent-line failure.

## Tasks
- [x] F1: Hover now hit-tests screen-pixel distance from the calculated half-arc-length midpoint, not the source body. The square matches node-hover feedback (`3mm`, `#f59e0b`, `1px #111827` border). Unit and browser tests reject endpoint/body hover away from midpoint and verify appearance, pointer transparency, zoom and document nonmutation. Evidence: focused unit 76 passed, focused Playwright 2 passed, typecheck/lint/diff-check passed. Initial unit attempt had 75 pass/1 fail because its new cubic pointer coordinate did not match the fixture midpoint; corrected fixture point and reran successfully. Work-unit commit: `f0996b0` (`fix(web): show midpoint marker only on midpoint proximity`).
- [x] F2: Sketch edges inherit blue/black constraint-state colors; underdefined edges turn orange on pointer hover with any tool, and revert on hover-out. Fully-defined stays black; conflict/invalid remain red and overdefined remains orange. Native `line` elements keep independent document styling. Hover is transient and does not mutate document/history. User clarified the all-tool scope. Evidence: App/renderer tests 38 passed, focused E2E 2 passed, typecheck/lint/diff-check passed; additional renderer guard tests 37 passed, typecheck/lint/diff-check passed. Work-unit commit: `e82d8fa` (`feat(editor): show hover feedback for underdefined sketch edges`).
- [x] F3: H/V glyphs are centered along the referenced edge and offset by a deterministic 14 screen-pixel perpendicular clearance. Covers horizontal, vertical, sloped, reversed references, and a short segment while preserving line visibility. Presentation only; constraint data and solver coordinates are unchanged. Evidence: renderer 38 tests, typecheck, lint, and diff-check passed. Work-unit commit: `21a5ec4` (`fix(renderer): offset horizontal and vertical constraint glyphs`).
- [x] F4a: Under default active autosave, independent native Line creation → Selección → Supr → immediate `page.reload()` did not reproduce reappearance. The focused E2E passed eight repeats (9 incl. setup), typecheck/lint passed. Existing deletion E2E now explicitly checks active autosave and immediate reload rather than duplicating it; no save wait between deletion and reload. This verifies same-browser-context IndexedDB only, not a separate session or user's specific project configuration. No persistence code changes without a failing repro.
- [ ] F4b: Extend the midpoint relation model to support a moved independent native-Line endpoint as a dependent point, with stable endpoint identity, validation/migration/solver/editor lifecycle and fail-closed source invalidation. Current `DocumentConstraint` dependent type is a sketch point only; a web-only snap is insufficient for a persistent driving native-Line relation.
- [ ] F4c: Compose drag-node and drag-whole-independent-Line moves plus midpoint relation atomically, with preview and one undo/redo history entry. User selected persistent driving relation; whole-line drag binds the uniquely nearest endpoint in tolerance (no relation on tie). Preserve source identity and existing node-snap precedence. Cover both gestures, cancellation and reload in browser tests.
- [ ] F4d: Independently verify F4a–F4c and rerun all root gates once implemented. Do not assert completion until the user-reported flows reproduce and pass.
- [x] F5: Independent full-root verification in CI order passed: lint, typecheck, 841 unit tests (40 files), 93 Playwright E2E passed with 1 skipped, and build. The first full E2E run exposed one stale assertion in `tests/e2e/open-edge-midpoint-confirm.spec.ts` expecting body-hover marker visibility; corrected it to assert absence on far body and visibility at calculated midpoint, preserving confirmed-snap assertions. Focused spec 3 passed; all root gates passed on rerun. Build warned about a >500 kB minified chunk; no gate failure. Work-unit commit recorded below.

## Scope and delivery
- Worktree: `C:/dev/nodra-midpoint-feedback`; branch `fix/midpoint-hover-and-constraint-glyphs`, based on fully merged `main` `c10d56a`.
- Keep each coherent behavior with its regression tests in separate reviewable work-unit commits; do not touch `C:/dev/nodra` or prior PR worktrees.
- No issue/PR/push/merge authorized yet. Request an approved follow-up issue before publishing if repository policy requires issue-first linkage.
- F1–F3 shipped as four local work-unit commits (including a stale E2E expectation correction). F4b/F4c are a substantial cross-package extension, not a small web-only fix; slice it by executable behavior and independently verify each slice. Do not code-golf or drop tests to meet a line target.
- TDD is not configured in the existing ledger; use ordinary regression-first tests and report exact outcomes.
