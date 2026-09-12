---
name: nodra-sketch-kernel
description: "Trigger: Nodra Sketch Kernel, sketch operations, topology, constraints, stable references, preview, commit, rollback, undo, redo."
license: Apache-2.0
metadata:
  author: "nodra-maintainers"
  version: "1.0"
---

## Activation Contract
Load for sketch-kernel or geometric-command contract work. Read `packages/editor-core/src/sketchKernel.ts`, `index.ts`, and focused tests first.

## Hard Rules
- Sketch geometry changes enter through editor-core commands and the Sketch Kernel; tools never mutate document geometry directly.
- Preview is immutable and provisional. Commit owns one revision/history entry; cancel restores the base; undo/redo belong to editor-core.
- Validate input and solve constraints after topology edits. Failures roll back atomically.
- Preserve stable node, edge, and topology references through explicit mappings; do not infer identity from array position.
- Closed profiles are reported as topology metadata for future extrusion, not implemented as extrusion here.
- Load, recovery, and metadata-only paths may bypass recomputation only when they do not mutate geometry; document such paths in tests.

## Decision Gates
| Need | Action |
|---|---|
| New geometric tool | Add an editor-core command; do not add a parallel tool abstraction. |
| Preview/commit/cancel | Use gesture APIs and kernel recomputation. |
| Topology change | Return reference mappings and diagnostics. |
| Constraint change | Validate references, solve, then validate the resulting snapshot. |

## Execution Steps
1. Build a candidate from the immutable snapshot.
2. Recompute topology and constraints; reject invalid candidates.
3. Test preview immutability, atomic rollback, stable references, constraints, and history.

## Output Contract
Report kernel ownership, topology/reference behavior, validation, history semantics, tests, and any intentional bypass.

## References
- `packages/editor-core/src/sketchKernel.ts`
- `packages/editor-core/src/index.ts`
