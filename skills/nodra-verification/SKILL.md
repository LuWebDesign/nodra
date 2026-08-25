---
name: nodra-verification
description: "Trigger: Nodra verification, tests, lint, typecheck, E2E, build, evidence. Verify documentation and code claims against authoritative repository evidence."
license: Apache-2.0
metadata:
  author: "nodra-maintainers"
  version: "1.0"
---

## Activation Contract
Load for test planning, CI evidence, docs audits, or release checks. Read root scripts/configuration and `references/testing-matrix.md` first.

## Hard Rules
- Treat manifests, source, configs, and CI as authoritative; stale OpenSpec metadata is not evidence.
- Use the CI order: lint, typecheck, test, test:e2e, build.
- Do not edit generated `.build` or `apps/web/dist`.
- E2E `--pass-with-no-tests` is not product coverage; the repository currently has a Chromium smoke test at `tests/e2e/app.smoke.spec.ts`, but it is not comprehensive product coverage.
- Test persisted committed state, not transient preview; preserve Spanish UI copy in UI assertions.
- Record exact commands and their results separately from environment/tooling failures. A filtered package build is not evidence that the root build succeeded.
- For renderer classification, test both invalid documents with supported schema versions and unsupported schema versions/features; use the repository's schema constant rather than hardcoding the current number.

## Decision Gates
| Change | Minimum evidence |
|---|---|
| Pure docs | links, frontmatter, file existence |
| Package logic | focused Vitest + typecheck/lint |
| UI behavior | unit tests plus the real Chromium smoke E2E when the change affects covered workspace load or controls |
| persistence | fake-indexeddb recovery/revision tests |

## Execution Steps
1. Select the smallest honest matrix.
2. Run only permitted checks and record exact commands/results.
3. Separate command results from environment failures, report gaps instead of converting no-tests into pass claims, and never promote filtered-check results to root-script claims.

## Output Contract
Return commands, results, coverage limits, and unresolved concerns.

## References
- [Testing matrix](references/testing-matrix.md)
