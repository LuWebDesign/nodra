# Per-line relation feedback

## Intent and authorization

User passed all five manual reliable-line-relations workflows, then confirmed applied relation symbols should appear beside each line midpoint and both participants of parallel/equal should display the same persisted relation. Definition colors are desired but deferred: current evidence is component/sketch-level, not honest per-edge attribution. This stage changes display only, not inference or persisted constraints.

## Scope and constraints

Editor-only per-edge occurrences, upright normal-offset symbols, per-edge multi-label slots, stable/legacy references, local/cross-sketch participant visibility, export omission, escaping, history/reload. Midpoint point-marker semantics retained. No solver/DOF, all-kind inference, topology policy, persistence mutation, dependencies or product testing APIs. Preserve dirty tests/e2e/app.smoke.spec.ts and existing untracked NUL/install/irregular-closure task files. Branch experiment/sketch-tool-study; baseline 690201d7d78719868d75883a31f4ab640732c0f5. User subsequently explicitly authorized committing and uploading this bounded candidate for remote testing. Ordinary feature-branch push only; no PR, merge, release, deployment, repair or unrelated-file changes authorized.

## Tasks

- [x] F1 — Implement per-participant display and off-geometry placement with unit/browser regressions. Route: gentle-ai-worker; multi-file/preparation triggers. Distinct occurrence and edge attributes preserve logical relation ID. Normal offset is calculated after viewport conversion with finite zero-length fallback. Slots count per display edge, not per sketch. RED observed: missing occurrences; later slot regression translate(5 -35) versus expected translate(5 -17). Final GREEN: 33 renderer tests; direct local lint/typecheck passed. Initial partial worker output was corrected, not accepted as complete.
- [x] F2 — Independently verify normalized candidate and functional gates. Route: gentle-ai-verify; ASSESS unassessable due unrelated untracked declaration, therefore high fallback and independent checks. Final independent focused renderer rerun 33/33, root-equivalent lint/typecheck/unit/browser/build checks passed. Parent inspected parallel-created.png: each participant has its own off-line symbol. Canonical pnpm-script validation remains unavailable as documented below; delivery was held until the user's subsequent explicit commit/push authorization.

## Acceptance evidence

Both local/cross-sketch participants display the same logical parallel/equal relation with distinct occurrence IDs at their own midpoints. Visibility depends on display participant, including hidden first owner; export excludes editor glyphs. Unit assertions cover supported legacy references, duplicate display suppression, degeneracy, stable repeat rendering, per-edge slot isolation, vertical/diagonal placement and viewport conversion. H/V/perpendicular placement and midpoint marker regressions remain covered. Browser tests exercise two participant occurrences, readable clearance, edit/history/reload stable identities. No per-edge color claim.

## Verification and tooling limitation

Corepack pnpm independently fails under Node v24.14.0 with SyntaxError: Unexpected token ';' at pnpm 10.15.1 dist/pnpm.cjs:151732 before launching scripts. No repair/install/config changes performed. Canonical corepack pnpm lint/typecheck/test/test:e2e/build were NOT successfully run on final candidate.

Approved fallback used existing local binaries, in CI-equivalent order:

- node_modules/.bin/vitest run packages/renderer-svg/src/index.test.ts: 33 passed (independent final rerun).
- node_modules/.bin/eslint . --max-warnings=0: passed.
- node_modules/.bin/tsc -p tsconfig.json --noEmit: passed.
- node_modules/.bin/vitest run: 40 files, 785 passed.
- node_modules/.bin/playwright test tests/e2e/line-relations.spec.ts: 3 passed.
- node_modules/.bin/playwright test --pass-with-no-tests: 93 passed, 1 pre-existing angular-Cota skip; nonempty suite, not a no-tests pass.
- node_modules/.bin/tsc -p tsconfig.build.json: passed.
- From apps/web, node ../../node_modules/vite/bin/vite.js build: passed, PWA generated; minified chunk exceeds 500 kB warning.
- git diff --check: passed; LF/CRLF warning only.

Browser fallback used existing local Vite and Playwright's existing non-CI reuseExistingServer behavior; verifier terminated only its own server. Initial unsupported Vite --root launch failed before tests; corrected by launching from app directory, no persisted configuration change. Earlier browser pass before final assertions was not accepted; final spec reran successfully. Generated outputs remain ignored.

## Candidate and delivery

Three source/test paths: packages/renderer-svg/src/index.ts (61 additions/43 deletions), packages/renderer-svg/src/index.test.ts (49/15), tests/e2e/line-relations.spec.ts (22/13): 203 authored changed lines total at final parent Git readback, plus this task document. Strategy ask-on-risk; bounded below forecast 250–400. Native review remains off; no lineage started. Unrelated work preserved. User authorized one bounded Conventional Commit (`fix(sketch): show relation symbols beside each participating line`) and ordinary push to origin/experiment/sketch-tool-study. Stage exactly these three source/test paths plus this task document; preserve all unrelated changes. Exact delivery identity/outcome will be recorded in the Engram delivery receipt.

## Next step

User will test the feature branch remotely after the authorized commit/push; a repository push alone does not guarantee deployment. Canonical pnpm runner repair needs separate authorization. Honest per-edge definition colors require separate evidence/contract, not renderer-only mapping. Topology policy remains deferred.
