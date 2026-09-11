---
name: nodra-persistence
description: "Trigger: Nodra persistence, Dexie, IndexedDB, autosave, recovery, revision, migration. Preserve durable repository and stale-write guarantees."
license: Apache-2.0
metadata:
  author: "nodra-maintainers"
  version: "1.0"
---

## Activation Contract
Load for local storage, save/recovery, migrations, autosave, revisions, or persistence errors. Read `packages/persistence/src/index.ts` and the contract reference first.

## Hard Rules
- Persist validated `DocumentSnapshot` or `ProjectSnapshot`, never transient gesture preview.
- Use the repository boundary; editor tools do not call IndexedDB.
- Preserve schema/record migrations, identity checks, revisions, stale-write protection, and package recovery behavior.
- Treat web localStorage mirrors as best-effort app recovery, not durable history; preserve mirror validation, format rejection, project identity, and cleanup semantics.
- Treat write failure as observable state; do not silently claim saved.

## Decision Gates
| Need | Action |
|---|---|
| Save/load/delete | `ProjectRepository` |
| IndexedDB implementation | concrete `DexieProjectRepository` |
| Delayed save | `DebouncedAutosave` |
| Schema evolution | registered migration then validation |
| Web recovery mirror | `appPersistence.ts` + `appRecovery.ts`; keep outside package persistence |

## Execution Steps
1. Validate before writing and after migration.
2. Preserve newest valid revision and count skipped corrupt rows.
3. Check debounce/retry performance and edge cases; test fake-indexeddb repository behavior plus mirror validation, rejected formats, project identity, best-effort failures, revision/timestamp precedence, stale cleanup, cancellation, and missing/corrupt data.

## Output Contract
Return contract changes, revision/recovery semantics, failure behavior, and focused evidence.

## References
- [Persistence contract](references/persistence-contract.md)
