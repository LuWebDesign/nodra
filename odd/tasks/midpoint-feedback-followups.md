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
- [x] F1: Hover now hit-tests screen-pixel distance from the calculated half-arc-length midpoint, not the source body. The square matches node-hover feedback (`3mm`, `#f59e0b`, `1px #111827` border). Unit and browser tests reject endpoint/body hover away from midpoint and verify appearance, pointer transparency, zoom and document nonmutation. Evidence: focused unit 76 passed, focused Playwright 2 passed, typecheck/lint/diff-check passed. Initial unit attempt had 75 pass/1 fail because its new cubic pointer coordinate did not match the fixture midpoint; corrected fixture point and reran successfully. Work-unit commit recorded after this transition.
- [ ] F2: Trace and correct native/sketch line hover color without overwriting blue underdefined or dark fully-defined state. Add the smallest appropriate renderer/web regression.
- [ ] F3: Offset H/V glyphs beside horizontal/vertical line bodies while retaining center-along-line placement; cover both orientations and short-edge collision/visibility behavior.
- [ ] F4: Reproduce and classify independent-native-Line snap report and deleted-line-after-refresh report. Existing source snap coverage is not proof of the user's exact gesture; no speculative persistence edits. Ask for exact creation/deletion flow if repository tests cannot isolate it.
- [ ] F5: Independently verify changed slices and run applicable root gates in CI order.

## Scope and delivery
- Worktree: `C:/dev/nodra-midpoint-feedback`; branch `fix/midpoint-hover-and-constraint-glyphs`, based on fully merged `main` `c10d56a`.
- Keep each coherent behavior with its regression tests in separate reviewable work-unit commits; do not touch `C:/dev/nodra` or prior PR worktrees.
- No issue/PR/push/merge authorized yet. Request an approved follow-up issue before publishing if repository policy requires issue-first linkage.
- Baseline review forecast: approximately 250 changed lines for F1–F3; persistence/snap follow-up is unestimated pending reproduction. Do not code-golf or drop tests to meet a line target.
- TDD is not configured in the existing ledger; use ordinary regression-first tests and report exact outcomes.
