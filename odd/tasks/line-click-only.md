# Line click-only creation

Objective: Remove drag-based Line creation; retain click-based continuous sketch edges and allow out-of-area geometry under design validation.

Branch: fix/line-outside-release. Scope: Line pointer routing, interaction regression tests, tool contract. Non-goals: change other tools, clip geometry, alter validation policy.

TDD: not configured/unknown; use ordinary focused regression checks. Delivery: ask-on-risk. Forecast: ~180 authored diff lines; reassess before commit.

- [x] LC1: Remove drag creation for Line while preserving click continuation and other tools. Route: delegated writer (multi-file write). Writer lint/typecheck passed; focused E2E 18 passed, 1 skipped with one worker. Parent readback caught a missing pointer-up guard, corrected and rechecked. Commit evidence: recorded in Git commit closing this task.
- [x] LC2: Independently verify changed behavior and document manual acceptance caveat. Route: delegated verifier (native assessment unavailable, treated as high). Initial independent lint/typecheck passed; focused E2E had a worker crash (17 passed, 1 skipped, 1 failed); reruns with one worker passed (18 passed, 1 skipped), including the crashed test. Post-correction independent focused E2E passed: 18 passed, 1 skipped. Commit evidence: same coherent work-unit commit as LC1.

- [x] LC3: Investigate fast missed clicks. Five pointer pairs in a rapid burst yielded four edges, so speed alone did not reproduce the loss; real 8.6 px pressed-pointer motion was discarded by the former 3 px drag classifier. User confirmed slight pressed motion should count as click. Commit evidence: same coherent work-unit commit as LC4.
- [x] LC4: Line-specific 12 px pressed-motion threshold; longer drag remains inert and other tools retain 3 px. Delegated writer lint/typecheck/focused Playwright passed; independent verifier reran all three successfully (19 passed, 1 skipped). Native assessment unavailable, so independent verification used. Commit evidence: recorded in Git commit closing this work unit.

Next: Manual real-device validation after optional user-authorized push. Full suite and build not run; no push or PR authorized. Unrelated untracked root NUL file preserved, not included in commit.
