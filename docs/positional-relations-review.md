# Positional relations: implementation review and acceptance criteria

## Status

The current native circular positional action is **not a general CAD constraint solver**. `ExplicitConnection` stores node addresses. Persisting those addresses does not ensure that future moves, radius edits, and topology edits enforce coincidence.

Do not treat a passing smoke suite as evidence that a unified positional workflow or mixed closed piece is implemented.

## Correct product contract

- One Relations workflow for compatible nodes, independent of their creation tool.
- Common selection, preview, confirmation, cancellation, applied-relations list, removal, and conflict diagnostics.
- Coincidence, horizontal/vertical alignment, and distance constraints are persistent geometric requirements, not one-time moves.
- A change is solved against all affected constraints before committing. An unsupported or inconsistent solution leaves the original document and history unchanged.
- Geometry adapters expose independent parameters: sketch node coordinates, path anchors with associated handles, circle center/radius, arc center/radius/angles. Do not solve an arc's endpoints as independent points without restoring circularity.
- Radius edits through inspector and dimension annotation have identical geometric semantics.
- Two fixed arc endpoints permit radius changes only for geometrically feasible radii. Preserve stable start/end identities, direction and the selected arc branch. Do not move the first anchor to satisfy the second.
- Connecting nodes does not by itself merge objects or establish a closed face. Closure must be a separate exact topology result.

## Verified problems and bounded fixes

- Reverse attachment order swapped arc endpoint identities: corrected.
- Endpoint fitting returned negative angles rejected by canonical validation: corrected.
- Radius arithmetic squared large finite values: replaced with ratio-based height evaluation.
- Arc inspector and radial annotations followed different update paths: routed through one radius helper.
- Positional selection silently chose one source/target from ambiguous selections: require exactly two valid anchors and preserve click order.
- Position/radius edits could break additional already-coincident connections: these paths now reject unsupported changes atomically.

These guards do not implement propagation when a different connected object moves. Existing legacy connection metadata is not automatically reinterpreted as an enforced constraint.

## Remaining implementation stages

1. **Common persistent relation contract**: select the canonical constraint representation and migration policy, reusing stable node addresses. Review existing SketchConstraint references, page-level constraints, explicit snap connections, and driving dimensions. Do not silently change the meaning of existing saved connections.
2. **Shared transactional solver entrypoint**: geometry adapters resolve all affected components for creation, move, node edit, dimension edit, inspector edit and relation removal. Detect infeasible and unsupported systems without partial commits. Keep geometry algorithms out of App.tsx.
3. **Unified Relations interface**: wire all supported node types into the existing preview/confirm/list/error workflow. Capability checks derive from supported geometry and relation pairs, not toolbar identity.
4. **Exact mixed boundaries**: represent ordered line/arc/Bézier edges and stable shared vertices; derive valid closed faces, fill and selection. Preserve dimensions during joins and Trim. Do not persist flattened curves or silently consume cutters.
5. **Pen/Trim regression coverage**: test every closure path, default versus explicit fill, and each supported target/cutter orientation. Unsupported intersection pairs remain conservative no-ops.

## Mandatory acceptance examples

- Attach arc start to a line node, then end to another node, in either order; neither line moves.
- Change radius via inspector and radial dimension; both endpoints stay attached. Impossible radius returns a visible error and no history entry.
- Move the reference node afterwards; the connected component resolves or the entire edit fails visibly.
- Repeat common positional relations across sketch, line, path, circle and arc anchors; no separate tool-specific relation panel.
- Save/reload, undo/redo and remove each relation while preserving IDs and valid dependencies.
- Replace an open square's missing edge with an exact arc: a valid mixed boundary becomes a selectable filled closed piece, while all remaining dimensions stay editable.
- Closed Pen paths receive default fill without replacing explicit fill; exact supported curved Trim works in both target orientations.

## Merge gate

General positional constraints and mixed closed topology remain incomplete. Do not describe the circular alignment action as a complete persistent constraint system or merge on that assumption.
