---
name: nodra-editor-workflow
description: "Trigger: Nodra editor workflow, tool, gesture, command, undo, redo, history. Change interactions without breaking preview and transaction semantics."
license: Apache-2.0
metadata:
  author: "nodra-maintainers"
  version: "1.0"
---

## Activation Contract
Load for tools, pointer gestures, selection, commands, undo/redo, or editor state. Read `packages/editor-core/src/index.ts`, `apps/web/src/App.tsx`, and the tool/history reference first.

## Hard Rules
- Route document mutations through editor-core commands and validation.
- Preview != persistent document: gesture preview is provisional until commit.
- Commit one history entry per completed gesture; cancel restores its base.
- A successful no-op command must not advance revision, schedule persistence, or add undo/redo history; the command/dispatch layer owns this invariant.
- Tools do not call IndexedDB; web orchestration schedules persistence.
- Preserve Spanish UI copy and keep selection/tool state separate from domain data.
- The Texto tool uses click-to-place editing; commit with Enter, Escape, blur, or outside click. After commit, select the text object so its black resize handles are available.
- Text resizing is a geometry gesture: resize the text bounds and scale `fontSize` together; font family changes on the selected text are discrete editor commands.

## Decision Gates
| Situation | Action |
|---|---|
| Continuous pointer movement | `beginGesture` + preview from base; do not persist preview |
| Completed change | `commitGesture` |
| Escape/cancel/invalid gesture | `cancelGesture` |
| Discrete mutation | `dispatch(command)` |

## Execution Steps
1. Define or reuse a typed command.
2. Validate each resulting snapshot.
3. Test selection, preview, commit, cancel, undo, redo, and no-op paths.

## Output Contract
Report tool/state ownership, history behavior, persistence boundary, and focused tests.

## References
- [Tool and history contract](references/tool-and-history.md)
