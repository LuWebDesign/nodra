# Line click-only creation

Objective: Preserve fast click-based continuous sketches and reintroduce deliberate long Line drags creating native lines, while tolerating slight pressed-pointer motion. Out-of-area geometry remains permitted under design validation.

Branch: fix/line-outside-release. Scope: Line pointer routing, interaction regression tests, tool contract. Non-goals: change other tools, clip geometry, alter validation policy. Earlier click-only behavior was accepted provisionally; user subsequently explicitly selected deliberate native-Line drag restoration.

TDD: not configured/unknown; use ordinary focused regression checks. Delivery: ask-on-risk. Forecast: ~180 authored diff lines; reassess before commit.

- [x] LC1: Remove drag creation for Line while preserving click continuation and other tools. Route: delegated writer (multi-file write). Writer lint/typecheck passed; focused E2E 18 passed, 1 skipped with one worker. Parent readback caught a missing pointer-up guard, corrected and rechecked. Commit evidence: recorded in Git commit closing this task.
- [x] LC2: Independently verify changed behavior and document manual acceptance caveat. Route: delegated verifier (native assessment unavailable, treated as high). Initial independent lint/typecheck passed; focused E2E had a worker crash (17 passed, 1 skipped, 1 failed); reruns with one worker passed (18 passed, 1 skipped), including the crashed test. Post-correction independent focused E2E passed: 18 passed, 1 skipped. Commit evidence: same coherent work-unit commit as LC1.

- [x] LC3: Investigate fast missed clicks. Five pointer pairs in a rapid burst yielded four edges, so speed alone did not reproduce the loss; real 8.6 px pressed-pointer motion was discarded by the former 3 px drag classifier. User confirmed slight pressed motion should count as click. Commit evidence: same coherent work-unit commit as LC4.
- [x] LC4: Line-specific 12 px pressed-motion threshold; longer drag remains inert and other tools retain 3 px. Delegated writer lint/typecheck/focused Playwright passed; independent verifier reran all three successfully (19 passed, 1 skipped). Native assessment unavailable, so independent verification used. Commit evidence: recorded in Git commit closing this work unit.

- [x] LC5: Restored native-Line drag only when movement exceeds 20 screen pixels AND press lasts at least 150 ms; under-12 px movement remains click, intermediate/fast drag inert. Returning a deliberate drag near its start cannot replay a click. Route: delegated writer; regressions cover the gesture variants, outside release and native inspector. Commit evidence: same coherent work-unit commit as LC6.
- [x] LC6: Independent verification after final correction: lint passed, typecheck passed, 762 unit passed, full E2E 86 passed/1 skipped, build passed (non-failing Vite large-chunk warning). Native-Line inspector/history/reload passed. Commit evidence: recorded in Git commit closing this work unit.

- [x] LC7: Added native dragged Line deletion/reload E2E for default /modelo and a named project/piece. In the latter, body-select/Delete/reload and enclosing-marquee/Delete/reload keep removed IDs absent. User retested protected preview and now reports deletion works. The originally observed resurrection was not reproduced. Commit evidence: same test-only work-unit commit as LC8.
- [x] LC8: No persistence code change: user and automated tests now observe correct deletion, so a speculative fix was rejected. Independent full gates: lint/typecheck/762 unit/88 E2E passed (1 skipped)/build passed with a non-failing Vite large-chunk warning. A second native Line sometimes failed to create in the same session; this remains a separate unconfirmed creation issue and is not concealed by deletion coverage. Commit evidence: recorded in Git commit closing this work unit.

Next: Reproduce irregular sketch closure on initial node separately. Joining separate sketches into one filled profile is a distinct product feature. No push or PR authorized. Unrelated untracked root NUL file preserved.
