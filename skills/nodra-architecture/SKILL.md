---
name: nodra-architecture
description: "Trigger: Nodra architecture, package boundary, dependency graph, composition root. Preserve and verify Nodra's current module boundaries."
license: Apache-2.0
metadata:
  author: "nodra-maintainers"
  version: "1.0"
---

## Activation Contract
Load for architecture reviews, cross-package changes, composition-root work, or deciding where new behavior belongs. Read `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, and the dependency map first.

## Hard Rules
- Keep domain, geometry, validation, editor-core, renderer-svg, and persistence independent of web.
- Treat `App.tsx` as the web composition/orchestration boundary, not proof that application code belongs in a package.
- Keep web recovery wiring in `apps/web`: `appPersistence.ts` owns best-effort localStorage mirrors and `appRecovery.ts` owns pure arbitration; neither is package durable persistence.
- Keep domain != renderer/UI; preserve Spanish UI copy.
- Do not edit `.build` or `apps/web/dist`.

## Decision Gates
| Need | Place it |
|---|---|
| Invariant/model/migration | domain or validation |
| Coordinates/hit testing | geometry |
| User operation/history | editor-core |
| SVG projection | renderer-svg |
| IndexedDB/package durable persistence | persistence |
| Web localStorage recovery wiring/arbitration | web (`appPersistence.ts`, `appRecovery.ts`) |
| Wiring/UI/session | web or stateless ui contracts |

## Execution Steps
1. Map imports and identify the owning boundary.
2. Verify the change against current source and manifests, not stale OpenSpec metadata; distinguish package durable persistence from web recovery wiring.
3. Check edge cases, performance impact, and focused tests; reject new abstraction layers unless evidence requires them.

## Output Contract
Return affected boundary, dependency evidence, risks, and verification performed.

## References
- [Dependency map](references/dependency-map.md)
