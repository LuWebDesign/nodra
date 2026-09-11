# Persistence contract

The package adapter is Dexie 4.2.1 over IndexedDB; `fake-indexeddb` 6.0.1 supports repository tests. Records carry recordVersion 1, projectId, revision, savedAt, and an unknown document payload. `MigrationRegistry` upgrades records before Zod validation. Identity and revision mismatches are corrupt. `getProject` scans revisions, skips invalid rows, returns the newest valid revision, and reports recovery. `saveProject` validates, writes project metadata and revision in one transaction, and refuses older revisions. `DebouncedAutosave` coalesces revisions, debounces, retries bounded failures, and exposes pending/saved/failed status.

Web recovery is separate from package durable persistence. `apps/web/src/appPersistence.ts` stores best-effort localStorage state and format-2 `ProjectMirror` records: loaders reject invalid formats, invalid timestamps, invalid projects, and project-ID mismatches, while storage failures are tolerated. `apps/web/src/appRecovery.ts` gives the pure precedence rule: a mirror wins only for a higher project revision, or an equal revision with a newer mirror `savedAt` than the official `revision.savedAt`; otherwise the app removes stale mirror data. `App.tsx` performs loading, selection, cleanup, and UI recovery wiring. LocalStorage is not durable history.

| Requirement | Current solution | Candidate | Use when | Do not use when |
|---|---|---|---|---|
| Browser storage | Dexie/IndexedDB | another store | platform/product constraints change | to bypass repository |
| Durable history | revision rows | compaction policy | measured storage growth | before evidence |
| Migration | registry + Zod | new migration layer | record version changes | for ordinary feature fields |

Deletion and close are repository responsibilities. Autosave is not a substitute for explicit validation or conflict policy. Focused mirror tests belong alongside fake-indexeddb repository tests and should cover validation/format rejection, identity, best-effort failures, precedence, and stale cleanup.
