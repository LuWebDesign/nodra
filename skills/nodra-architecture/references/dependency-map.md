# Nodra dependency map

The repository is a pnpm `apps/*` and `packages/*` workspace. `apps/web/src/main.tsx` mounts React; `App.tsx` composes editor-core, domain/project state, geometry and hit testing, renderer-svg, Dexie persistence/autosave, and Zustand UI/session stores.

```text
web -> domain, geometry, editor-core, persistence, renderer-svg
editor-core -> domain, validation
renderer-svg -> domain, geometry, validation
persistence -> domain, validation, Dexie
geometry -> domain
validation -> domain, Zod
domain -> (none)
ui -> (no dependencies; standalone boundary, not declared by apps/web)
```

Packages export source from `src/index.ts`. Core packages do not import web. `ui` contains stateless contracts, not React components, and no package manifest currently declares it as a dependency. The installed stack includes Node >=24, pnpm 10.15.1, TypeScript 5.9.2, React 19.1.1, Vite 7.1.3, Vitest 3.2.4, Playwright 1.55.0, ESLint 9/typescript-eslint 8, vite-plugin-pwa, Zod 4.1.5, Dexie 4.2.1, fake-indexeddb 6.0.1, and Zustand 5.0.8. Do not infer additional libraries from this map.
