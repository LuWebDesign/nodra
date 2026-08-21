# Persistence contract

The concrete adapter is Dexie 4.2.1 over IndexedDB; `fake-indexeddb` 6.0.1 supports tests. Records carry recordVersion 1, projectId, revision, savedAt, and an unknown document payload. `MigrationRegistry` upgrades records before Zod validation. Identity and revision mismatches are corrupt. `getProject` scans revisions, skips invalid rows, returns the newest valid revision, and reports recovery. `saveProject` validates, writes project metadata and revision in one transaction, and refuses older revisions. `DebouncedAutosave` coalesces revisions, debounces, retries bounded failures, and exposes pending/saved/failed status.

| Requirement | Current solution | Candidate | Use when | Do not use when |
|---|---|---|---|---|
| Browser storage | Dexie/IndexedDB | another store | platform/product constraints change | to bypass repository |
| Durable history | revision rows | compaction policy | measured storage growth | before evidence |
| Migration | registry + Zod | new migration layer | record version changes | for ordinary feature fields |

Deletion and close are repository responsibilities. Autosave is not a substitute for explicit validation or conflict policy.
