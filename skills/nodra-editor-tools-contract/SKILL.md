---
name: nodra-editor-tools-contract
description: "Trigger: Nodra editor tool contract, tool gesture, connection, select, forma, pen, spline, text, rectangle, ellipse, line, dimension, pan. Preserve exact runtime behavior."
license: Apache-2.0
metadata:
  author: "nodra-maintainers"
  version: "1.1"
---

## Activation Contract
Load before changing any Nodra editor tool, pointer routing, hit testing, or gesture behavior. Treat the local behavior matrix as the runtime contract.

## Hard Rules
- Read the matrix and cited implementation/tests before editing.
- Do not infer behavior from labels or desired UX; preserve only behavior evidenced by code or tests.
- Keep transient drafts, previews, selection, and viewport state outside domain snapshots.
- Route document changes through validated `editor-core` commands. Commit completed gestures once; cancel restores the gesture base.
- Preserve hit-test precedence, visible-layer filtering, tolerance units, and tool-specific exclusions.
- Treat explicit connections as persisted data: create them only from confirmed snap clicks, never hover; do not imply that connection removal or management is supported.
- Preserve schema version 6 migration/defaulting and validation, including stable addresses for rectangle/ellipse/line anchors, sketch edge dimensions, and path/spline nodes and handles.
- Inspector dimension edits keep the object/selection center when no relevant connection exists; connected sides anchor their side, corners anchor both axes, and aspect lock preserves proportions without breaking those anchors.

## Decision Gates
| Change | Gate |
|---|---|
| Pointer routing or hit testing | Update/verify the matrix and interaction tests. |
| Preview, commit, cancel, undo, or persistence | Verify editor-core transaction invariants first. |
| Tool-specific behavior | Change only the named tool unless shared precedence is intentionally updated. |
| Unspecified behavior | Stop and inspect authoritative code/tests; do not invent a contract. |
| Explicit connections or inspector dimensions | Verify persisted addresses, migration/validation, and connected-side anchoring before editing. |

## Execution Steps
1. Read `references/tool-behavior-matrix.md` and its source references.
2. Trace the event path in `App.tsx` and helpers in `interaction.ts`.
3. Confirm domain shape constraints and command validation.
4. Make the smallest change, then test affected routing plus shared gesture paths.
5. Reconcile the matrix if verified behavior changed; record unsupported or pending behavior explicitly rather than implying availability.

## Output Contract
Report the tools and interaction areas inspected, contract entries affected, tests run, and any behavior intentionally left unchanged.

## References
- [Tool behavior matrix](references/tool-behavior-matrix.md)
- `apps/web/src/App.tsx`
- `apps/web/src/interaction.ts`
- `apps/web/src/interaction.test.ts`
- `packages/editor-core/src/index.ts`
- `packages/editor-core/src/index.test.ts`
- `packages/domain/src/index.ts`
- `packages/validation/src/index.ts`
