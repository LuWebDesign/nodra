# ADR 0001: Document Revisions and Persistence Invariants

## Status

Accepted

## Context

Nodra changes documents through the domain and editor layers, then persists validated snapshots through a repository. Revision numbers, undo/redo history, validation, and recovery must describe the same committed state across those boundaries. Autosave and recovery also encounter retries, stale writes, migrations, and corrupt records.

This ADR records **why** those boundaries and invariants exist. The skills describe **how** contributors should work with them, and the tests provide **proof** of the implemented behavior. This ADR does not authorize a broad refactor or prescribe a particular database or library beyond the current implementation.

## Decision

- The domain document/revision is the source of truth for committed editor state. Editor commands produce validated snapshots; persistence stores those validated snapshots rather than inventing document state.
- A command that produces no document change is a no-op: it must not advance the revision or create undo/redo history. Preview gestures are provisional; only a committed change is a persistence/history boundary.
- Persistence validates a snapshot and rejects metadata/document identity mismatches before writing.
- Persistence owns the repository boundary, migrations, recovery, corruption handling, and durable writes. Tools and the web composition layer do not call IndexedDB directly.
- A successful save result (`ok: true`) means the returned revision is durably represented. For an older/stale incoming revision, persistence returns a successful, non-destructive no-op with the newest durable revision; it does not replace that newer revision.

## Invariants

1. A document or project snapshot carries its revision and identity; domain transformations advance the revision only when the document changes.
2. Failed commands leave editor state unchanged. Successful no-op commands leave the revision, persistence work, and undo/redo stacks unchanged.
3. Each persisted record is validated for schema, identity, and revision consistency before it is accepted for recovery or written.
4. `metadata.id` must equal the validated snapshot identity; a mismatch fails before any project or revision row is written.
5. A stale save cannot overwrite a newer durable revision. It is an idempotent success and reports the newest durable revision.
6. Recovery selects the newest valid durable revision and may skip corrupt or unsupported records.
7. `ok: true` never represents only an attempted write: its returned revision is durably represented, including the stale no-op case.

## Consequences

Positive consequences:

- Revision numbers, history, autosave, and recovery share one explicit contract.
- Retried or out-of-order saves are safe and converge callers on the durable revision.
- Identity errors are reported before they can create records that recovery would reject.
- Persistence concerns remain behind `ProjectRepository`, allowing editor tools to remain independent of IndexedDB.

Costs and limits:

- Persistence retains revision rows and must scan and validate them during recovery; compaction is not assumed without storage-growth evidence.
- Callers must treat the returned save revision as authoritative, especially after stale saves.
- Migration and corruption behavior remains a repository responsibility and requires focused tests when record formats evolve.

Future decisions are triggered by measured storage growth, a record-version change, a new conflict or multi-writer requirement, a platform/product constraint against the current browser store, or evidence that recovery performance requires a different durable-history strategy.

## Rejected alternatives

- Letting tools write IndexedDB directly: rejected because it duplicates repository, migration, validation, and recovery policy across callers.
- Advancing revisions or recording history for no-op commands: rejected because it creates false document changes and unnecessary persistence work.
- Treating stale writes as failures or allowing them to overwrite newer data: rejected because retries and out-of-order autosave would be destructive or would not converge on the durable state.
- Accepting metadata/document identity mismatches and relying on recovery to detect them: rejected because it reports a false save and creates invalid durable records.
- Choosing a new database, library, or broad persistence refactor in this ADR: rejected because the current implementation is the evidence base; such a change requires a separate decision.

## Verification

The current implementation and tests establish this contract:

- `packages/domain/src/index.ts` defines document/project identity and revisions, and `packages/domain/src/index.test.ts` verifies revision creation and increment behavior.
- `packages/editor-core/src/index.ts` validates command results and makes `dispatch` and gesture commit no-ops when the document is unchanged; `packages/editor-core/src/index.test.ts` verifies no-op history behavior, committed gesture history, undo/redo, and rejected commands.
- `packages/persistence/src/index.ts` validates snapshots, rejects identity mismatches before writing, performs transactional repository writes, recovers the newest valid revision, and returns the newest durable revision for stale saves; `packages/persistence/src/index.test.ts` verifies stale-write idempotence, identity rejection without writes, recovery, migration handling, and autosave retry behavior.

## References

- `packages/domain/src/index.ts`
- `packages/domain/src/index.test.ts`
- `packages/editor-core/src/index.ts`
- `packages/editor-core/src/index.test.ts`
- `packages/persistence/src/index.ts`
- `packages/persistence/src/index.test.ts`
- `skills/nodra-editor-workflow/references/tool-and-history.md`
- `skills/nodra-persistence/references/persistence-contract.md`
