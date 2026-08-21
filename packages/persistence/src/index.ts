import { Dexie, type Table } from "dexie";
import type { DocumentSnapshot, ProjectSnapshot } from "@nodra/domain";
import { validateDocument, validateProject } from "@nodra/validation";

export const CURRENT_RECORD_VERSION = 1 as const;

export interface ProjectMetadata {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: number;
}

export interface NativeDocumentRecord {
  readonly recordVersion: typeof CURRENT_RECORD_VERSION;
  readonly projectId: string;
  readonly revision: number;
  readonly savedAt: number;
  readonly document: unknown;
}

export interface StoredRevision {
  readonly metadata: ProjectMetadata;
  readonly document: DocumentSnapshot | ProjectSnapshot;
  readonly revision: number;
  readonly savedAt: number;
}

export type RepositoryFailure = "invalid" | "unsupported" | "corrupt" | "write-failed";
export type RecoveryResult =
  | { readonly ok: true; readonly revision: StoredRevision; readonly recovered: boolean; readonly skipped: number }
  | { readonly ok: false; readonly reason: "not-found" | RepositoryFailure; readonly skipped: number; readonly error: string };

export interface ProjectRepository {
  listProjects(): Promise<readonly ProjectMetadata[]>;
  getProject(projectId: string): Promise<RecoveryResult>;
  saveProject(metadata: ProjectMetadata, document: DocumentSnapshot | ProjectSnapshot): Promise<SaveResult>;
  deleteProject(projectId: string): Promise<void>;
}

export interface SaveResult {
  readonly ok: boolean;
  readonly status: "saved" | "failed";
  readonly revision: number;
  readonly error?: string;
}

interface ProjectRow extends ProjectMetadata { id: string }
interface RevisionRow extends NativeDocumentRecord { key: string }

export interface MigrationContext {
  readonly projectId: string;
  readonly revision: number;
}
export type RecordMigration = (record: Record<string, unknown>, context: MigrationContext) => unknown;

export class MigrationRegistry {
  private readonly migrations = new Map<number, RecordMigration>();

  constructor(private readonly targetVersion: number = CURRENT_RECORD_VERSION) {}

  register(fromVersion: number, migration: RecordMigration): this {
    if (!Number.isInteger(fromVersion) || fromVersion < 1 || fromVersion >= this.targetVersion) throw new Error("Invalid migration version");
    if (this.migrations.has(fromVersion)) throw new Error(`Migration ${fromVersion} is already registered`);
    this.migrations.set(fromVersion, migration);
    return this;
  }

  migrate(input: unknown, context: MigrationContext): unknown {
    if (!isRecord(input) || !Number.isInteger(input.recordVersion)) throw new Error("Corrupt persistence record");
    let version = input.recordVersion as number;
    let current: unknown = input;
    while (version < this.targetVersion) {
      const migration = this.migrations.get(version);
      if (!migration) throw new Error(`Unsupported persistence record version ${version}`);
      current = migration(isRecord(current) ? current : (() => { throw new Error("Corrupt persistence record"); })(), context);
      version += 1;
    }
    if (version !== this.targetVersion) throw new Error(`Unsupported persistence record version ${version}`);
    return current;
  }
}

export const migrations = new MigrationRegistry();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateRecord(input: unknown, projectId: string): NativeDocumentRecord & { readonly document: DocumentSnapshot | ProjectSnapshot } {
  const migrated = migrations.migrate(input, { projectId, revision: 0 });
  if (!isRecord(migrated) || migrated.recordVersion !== CURRENT_RECORD_VERSION || migrated.projectId !== projectId || typeof migrated.revision !== "number" || !Number.isInteger(migrated.revision) || migrated.revision < 0 || typeof migrated.savedAt !== "number") throw new Error("Corrupt persistence record");
   const document = isProjectInput(migrated.document) ? validateProject(migrated.document) : validateDocument(migrated.document);
  if (!document.success) throw new Error(document.error);
   if (document.data.id !== projectId || document.data.revision !== migrated.revision) throw new Error("Record identity or revision mismatch");
  return { recordVersion: CURRENT_RECORD_VERSION, projectId, revision: migrated.revision, savedAt: migrated.savedAt, document: document.data };
}

class PersistenceDatabase extends Dexie {
  projects!: Table<ProjectRow, string>;
  revisions!: Table<RevisionRow, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ projects: "id, updatedAt", revisions: "key, projectId, revision, savedAt" });
  }
}

export class DexieProjectRepository implements ProjectRepository {
  private readonly db: PersistenceDatabase;

  constructor(databaseName = "nodra-persistence") {
    this.db = new PersistenceDatabase(databaseName);
  }

  async listProjects(): Promise<readonly ProjectMetadata[]> {
    return this.db.projects.orderBy("updatedAt").reverse().toArray();
  }

  async getProject(projectId: string): Promise<RecoveryResult> {
    const rows = await this.db.revisions.where("projectId").equals(projectId).toArray();
    const metadata = await this.db.projects.get(projectId);
    if (!metadata || rows.length === 0) return { ok: false, reason: "not-found", skipped: 0, error: "No local project found" };
    let skipped = 0;
    const valid: StoredRevision[] = [];
    for (const row of rows) {
      try {
        const record = validateRecord(row, projectId);
        valid.push({ metadata, document: record.document, revision: record.revision, savedAt: record.savedAt });
      } catch { skipped += 1; }
    }
    valid.sort((a, b) => b.revision - a.revision || b.savedAt - a.savedAt);
    const newest = valid[0];
    if (!newest) return { ok: false, reason: "corrupt", skipped, error: "No valid local revision found" };
    return { ok: true, revision: newest, recovered: skipped > 0 || valid.length > 1, skipped };
  }

  async saveProject(metadata: ProjectMetadata, document: DocumentSnapshot | ProjectSnapshot): Promise<SaveResult> {
    const checked = isProjectInput(document) ? validateProject(document) : validateDocument(document);
    if (!checked.success) return { ok: false, status: "failed", revision: document.revision, error: checked.error };
    try {
      const record: RevisionRow = { key: `${metadata.id}:${document.revision}`, recordVersion: CURRENT_RECORD_VERSION, projectId: metadata.id, revision: document.revision, savedAt: Date.now(), document: checked.data };
      await this.db.transaction("rw", this.db.projects, this.db.revisions, async () => {
        const latest = await this.db.revisions.where("projectId").equals(metadata.id).sortBy("revision");
        if (latest.at(-1) && (latest.at(-1)?.revision ?? -1) > document.revision) return;
        await this.db.revisions.put(record);
        await this.db.projects.put({ ...metadata, id: metadata.id, updatedAt: record.savedAt });
      });
      return { ok: true, status: "saved", revision: document.revision };
    } catch (error) { return { ok: false, status: "failed", revision: document.revision, error: error instanceof Error ? error.message : "Local write failed" }; }
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.db.transaction("rw", this.db.projects, this.db.revisions, async () => {
      await this.db.projects.delete(projectId);
      await this.db.revisions.where("projectId").equals(projectId).delete();
    });
  }

  async close(): Promise<void> { this.db.close(); }
}

export interface AutosaveOptions { readonly debounceMs?: number; readonly retryMs?: number; readonly maxRetries?: number }
export class DebouncedAutosave {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private latestRevision = -1;
  private pending: { metadata: ProjectMetadata; document: DocumentSnapshot | ProjectSnapshot } | undefined;
  private attempts = 0;
  readonly status: { state: "saved" | "pending" | "failed"; revision: number; error: string | undefined } = { state: "saved", revision: -1, error: undefined };

  constructor(private readonly repository: ProjectRepository, private readonly options: AutosaveOptions = {}) {}

  schedule(metadata: ProjectMetadata, document: DocumentSnapshot | ProjectSnapshot): void {
    if (document.revision < this.latestRevision) return;
    this.latestRevision = document.revision;
    this.pending = { metadata, document };
    this.attempts = 0;
    this.status.state = "pending";
    this.status.revision = document.revision;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, this.options.debounceMs ?? 100);
  }

  async flush(): Promise<SaveResult | undefined> {
    if (!this.pending) return undefined;
    const pending = this.pending;
    if (pending.document.revision < this.latestRevision) return undefined;
    this.pending = undefined;
    const result = await this.repository.saveProject(pending.metadata, pending.document);
    if (result.ok) { this.status.state = "saved"; return result; }
    this.status.state = "failed";
    this.status.error = result.error;
    if (this.attempts < (this.options.maxRetries ?? 2)) {
      this.attempts += 1;
      this.pending = pending;
      this.timer = setTimeout(() => { void this.flush(); }, this.options.retryMs ?? 250);
    }
    return result;
  }

  cancel(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.pending = undefined; }
}

export async function requestStoragePersistence(): Promise<{ readonly supported: boolean; readonly persisted: boolean }> {
  try {
    const candidate = (globalThis as { navigator?: { storage?: { persist?: () => Promise<boolean> } } }).navigator;
    if (!candidate?.storage?.persist) return { supported: false, persisted: false };
    return { supported: true, persisted: await candidate.storage.persist() };
  } catch { return { supported: true, persisted: false }; }
}

function isProjectInput(input: unknown): input is ProjectSnapshot { return typeof input === "object" && input !== null && "pages" in input; }
