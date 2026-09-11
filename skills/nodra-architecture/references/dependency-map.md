# Nodra dependency map

The repository is a pnpm `apps/*` and `packages/*` workspace. `apps/web/src/main.tsx` mounts React; `App.tsx` is the web composition/orchestration boundary for editor-core, domain/project state, geometry and hit testing, renderer-svg, Dexie persistence/autosave, localStorage recovery wiring, and Zustand UI/session stores. `apps/web/src/appPersistence.ts` owns best-effort app-level localStorage state, including format-2 `ProjectMirror` records validated with `validateProject`, project-ID matching, and `savedAt`; this is distinct from package persistence and Dexie IndexedDB.

`apps/web/src/appRecovery.ts` provides pure `selectRecoveredProject(official, officialSavedAt, mirror)` arbitration. The mirror wins only when its project revision is higher, or when revisions are equal and its `savedAt` is newer than the official result's `revision.savedAt`; otherwise `App.tsx` removes the mirror and keeps official data. `App.tsx` loads mirrors, invokes the selector, performs cleanup, and manages UI recovery state. Failed project lookup removes both the last-opened context and the requested mirror. Keep this recovery wiring in web; do not move it into a package or describe localStorage as durable history.

```text
web -> domain, geometry, editor-core, persistence, renderer-svg
editor-core -> domain, geometry, validation
renderer-svg -> domain, geometry, constraints, validation
constraints -> domain, geometry
persistence -> domain, validation, Dexie
geometry -> domain
validation -> domain, Zod
domain -> (none)
ui -> (no dependencies; standalone boundary, not declared by apps/web)
```

Packages export source from `src/index.ts`. `constraints` is the shared boundary for parametric capabilities and derived entity state; its first slice adapts sketches and circles through the existing geometry solvers. Core packages do not import web. `ui` contains stateless contracts, not React components, and no package manifest currently declares it as a dependency. The installed stack includes Node >=24, pnpm 10.15.1, TypeScript 5.9.2, React 19.1.1, Vite 7.1.3, Vitest 3.2.4, Playwright 1.55.0, ESLint 9/typescript-eslint 8, vite-plugin-pwa, Zod 4.1.5, Dexie 4.2.1, fake-indexeddb 6.0.1, and Zustand 5.0.8. Do not infer additional libraries from this map.
