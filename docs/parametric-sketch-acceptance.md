# Parametric sketch Phase 0 acceptance

## Status

**Phase 0 evidence collection is ready for human acceptance.** It is not self-approved and does not authorize Phase 1 or SDD initialization. This document records text-only PDF evidence, the current Nodra baseline, and an approved policy boundary; it does not claim future behavior is implemented or tested.

## Evidence handling

The PDFs were extracted as text only with `pdftotext`. Physical PDF pages are authoritative where numbering is ambiguous. Diagrams and screenshots were not visually inspected; nearby extracted captions/text are not diagram evidence. The originals were not copied into the repository.

| Filename / title | Physical pages | Printed pages (when reliable) | Use |
|---|---:|---:|---|
| `Manual-de-buenas-practicas-SOLIDWORKS.pdf` — Spanish Easyworks manual | 40 | 4–24 for `1. CROQUIZADO`; aligned in the extracted 2D chapter | Geometry, relations, dimensions, states, trim/extend, sketch practice |
| `TP_Sketching_ESP.pdf` — `Guía de implementación: Creación de croquis con SOLIDWORKS` | 9 | Numbering differs from physical pages; use physical-page citations below | Inference, construction, driving/reference, invalid and redundant logic |

Onshape and SlideShare were not verified and are deliberately deferred; neither is a prerequisite for this Phase 0 record.

## Current capability and gap baseline

| Area | Current Nodra evidence | Gap / implication |
|---|---|---|
| Sketch graph and stable topology | `packages/domain/src/index.ts:99-110`; `packages/editor-core/src/topology.ts:3-22` | No explicit sketch session; topology maps are ephemeral. |
| Constraints and diagnostics | `packages/constraints/src/index.ts:239-377,399-565`; `packages/domain/src/index.ts:105` | Deterministic projection solver and derived diagnostics exist; tangent, midpoint, collinear, symmetry, and concentric kinds are absent. |
| Preview and history | `packages/editor-core/src/index.ts:2788-2851`; `apps/web/src/App.tsx:1433-1459` | Gesture preview/cancel and one-entry commit exist; whole-session cancellation is not modeled. |
| Inference and persistence | `apps/web/src/interaction.ts:324-419`; `apps/web/src/App.tsx:89-100`; `packages/persistence/src/index.ts:133-180` | Visual guidance is distinct from confirmed persisted connections; no session persistence. |
| Dimensions | `packages/domain/src/index.ts:113-131`; `packages/editor-core/src/index.ts:2446-2515` | Kinds and partial driving support exist; no general expression policy or full inference semantics. |
| Operations and rendering | `packages/editor-core/src/index.ts:374-488`; `packages/renderer-svg/src/index.ts:193-234` | Cut exists; trim/extend and detailed diagnostic/DOF UI remain gaps. |
| Fixture completion | `packages/constraints/src/test-fixtures.ts`; `packages/constraints/src/test-fixtures.test.ts`; `packages/constraints/src/index.test.ts` | Deterministic schema-9 sketch/constraint helpers and migrated coverage are complete in the current worktree. |

Historical quality baseline (reported, not rerun for this documentation change): `corepack pnpm lint` passed; `corepack pnpm typecheck` passed; `corepack pnpm build` passed; `corepack pnpm test` passed with 561 unit tests; direct Playwright passed 57 with 1 skipped (wrapper-install deviation). No command is claimed as rerun here.

## Acceptance scenarios

These are manageable Phase 0 scenarios for later implementation review. Manual-backed motivation is labeled **source**; the approved Nodra behavior is labeled **policy**. None asserts current or future implementation.

| ID | Roadmap phase | Given / When / Then | Traceability |
|---|---|---|---|
| PS-01 | Phase 1 | **Given** a pending line/circle/arc gesture; **When** Escape is pressed; **Then** only the operation/preview is canceled and the base document remains. | Source: Manual physical/printed 7–10; policy; `editor-core` gesture contract. |
| PS-02 | Phase 1 | **Given** completed gestures in an active sketch; **When** the sketch is accepted; **Then** exit retains changes and each completed gesture remains an individual undo entry. | Policy; source boundary only, Manual physical/printed 7. |
| PS-03 | Phase 1 | **Given** completed work in a sketch; **When** explicit session cancellation would lose it and confirmation is accepted; **Then** the entry document is restored. | Policy; PDFs do not establish whole-session undo semantics. |
| PS-04 | Phase 2 | **Given** a candidate endpoint/midpoint relation; **When** the pointer shows inference but no confirming click occurs; **Then** guidance remains snap-only and no relation is persisted. | Source: Manual physical/printed 14; TP physical 4–5 / printed 3–4; current `App.tsx` policy. |
| PS-05 | Phase 2 | **Given** a confirmed snap click; **When** the gesture commits; **Then** only the explicitly confirmed relation is persisted, never hover alone. | Source: same pages; current `App.tsx:89-100`. |
| PS-06 | Phase 3 | **Given** geometry with constraint intent; **When** constraints are applied or dragged; **Then** underdefined, fully defined, overdefined, conflict, and invalid states are reported without corrupting committed geometry. | Source: Manual physical/printed 14; TP physical 6–7 / printed 5–6; `constraints` diagnostics. |
| PS-07 | Phase 4 | **Given** selected geometry; **When** a dimension is placed and edited; **Then** its type/orientation previews, and a driving value changes intended geometry while a reference value does not drive it. | Source: Manual physical/printed 15–17; TP physical 7 / printed 6; current domain model. |
| PS-08 | Phase 2 / 5 | **Given** sketch entities; **When** construction mode is selected; **Then** the entity is marked construction and remains available as a reference without silently becoming profile geometry. | Source: TP physical 9 / printed 7. |
| PS-09 | Phase 5 | **Given** intersecting or extendable sketch entities; **When** trim or extend is committed; **Then** the atomic operation removes/lengthens the intended portion and preserves, remaps, or diagnoses dependent references. | Source: Manual physical/printed 19–21; TP physical 6 / printed 5; current cut/topology evidence. |
| PS-10 | Phase 1 | **Given** an entry document and an active sketch session; **When** enter, edit, accept, cancel, and exit transitions occur; **Then** unrelated design elements remain unchanged and persistence occurs only at the committed document boundary. | Source: Manual physical/printed 7; policy; persistence/editor-core contracts. |

## Explicit unresolved design questions

Before Phase 1, decide and test: undo/redo stack behavior after full session cancellation; revision and persistence implications; and cross-sketch effects. Cancellation scope is already approved: Escape cancels only the pending operation, whereas confirmed explicit session cancellation restores the entry document. The PDFs do not establish whole-session undo behavior; the remaining implementation semantics are not decided here.

## Recommended next design-only unit

Specify one sketch-session state machine: entry snapshot, pending operation preview, completed-gesture history, accept, and confirmed full-session cancel. Include transition invariants and the unresolved questions above; do not implement it in Phase 0.

## Review checklist

- [ ] Human accepts the evidence boundary and policy distinction.
- [ ] Human resolves the session-cancellation questions before Phase 1.
- [ ] Reviewer verifies the source pages and repository references.
- [ ] No Phase 1 implementation or SDD initialization is inferred from this record.
