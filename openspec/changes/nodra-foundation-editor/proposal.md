# Proposal: Nodra Foundation Editor

## Intent

Establish Nodra's staged workspace and deliver offline Design mode. Users can create and edit laser-oriented drawings without cloud access while preserving canonical geometry and editable primitives.

## Scope

### In Scope
- pnpm workspace foundation, strict TypeScript, and slices.
- Functional Design mode: rectangle, ellipse, line, selection, move, resize, rotation, properties, undo/redo, layers, zoom, and pan.
- Versioned native `.nodra` JSON with mm units, top-left origin, editable primitives, semantic operation metadata, autosave, and offline recovery.
- SVG rendering boundary and deferred SVG/DXF/PDF interfaces.
- Prepare as an honest placeholder; no hardware control.

### Out of Scope
- Full SVG/DXF/PDF exchange, cloud sync, authentication, collaboration, or hardware execution.
- Bezier, boolean, parametric, or advanced preparation.

## Capabilities

### New Capabilities
- `design-editor`: Create, render, transform, inspect, layer, and history-manage drawings.
- `native-project-format`: Versioned `.nodra` JSON with validated, editable document data.
- `offline-persistence`: Autosave and recovery with discreet status indication.
- `editor-foundation`: Workspace, core packages, renderer boundary, and shell.
- `laser-operation-metadata`: Store semantic operation metadata independently from visual color; never control hardware.

### Modified Capabilities
- None; no existing specs are present.

## Approach

Use staged pnpm packages: browser-agnostic `domain`, `geometry`, `validation`, and `editor-core`; SVG/UI adapters; persistence ports with Dexie; and Zustand only for app/session state. Build foundation, contracts, renderer, interactions, persistence, then PWA shell as verifiable slices. Preserve one transaction per drag and keep document state outside Zustand.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `package.json`, `pnpm-workspace.yaml`, root config | New | Workspace and gates |
| `apps/editor`, `packages/*` | New | Shell, core, renderer, persistence, UI |
| `openspec/specs/`, CI | New | Capability specs and gates |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Scope exceeds 400-line review budget | High | Deliver bounded slices; ask before oversized apply |
| Coordinate or recovery inconsistency | Med | Canonical mm contracts, revisions, validation, focused tests |
| Empty repository and missing pnpm slow bootstrap | High | Pin/install tooling in the foundation slice |

## Rollback Plan

Ship slices independently. Revert the affected slice and retain prior `.nodra` versions; never delete local documents. Disable unsafe adapters at the application boundary.

## Dependencies

- pnpm/CI bootstrap; React/Vite/PWA tooling; Zod; Dexie; Zustand; SVG APIs.

## Success Criteria

- [ ] A user can edit the five primitives/tools in Design mode and undo each drag in one step.
- [ ] A versioned `.nodra` document round-trips through validation, autosaves locally, and recovers after offline reload with a discreet indication.
- [ ] mm/top-left geometry and semantic operation metadata remain intact and visually decoupled.
- [ ] Foundation slices install, typecheck, test, and build through CI.
