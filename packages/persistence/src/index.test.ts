import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { createDocument, createProject, elementId, layerId, revision } from "@nodra/domain";
import { DebouncedAutosave, DexieProjectRepository, MigrationRegistry, type ProjectRepository } from "./index.js";

const metadata = { id: "project-1", name: "Offline project", updatedAt: 0 };
const document = () => createDocument(metadata.id, [{ id: layerId("layer-1"), name: "Layer", visible: true, order: 0 }]);

async function repository(): Promise<DexieProjectRepository> {
  const result = new DexieProjectRepository(`test-${crypto.randomUUID()}`);
  return result;
}

describe("DexieProjectRepository", () => {
  let db: DexieProjectRepository | undefined;
  afterEach(async () => { await db?.close(); });

  it("saves, lists, and recovers the newest valid revision offline", async () => {
    db = await repository();
    const first = document();
    expect((await db.saveProject(metadata, first)).ok).toBe(true);
    const second = { ...first, revision: revision(2) };
    expect((await db.saveProject(metadata, second)).ok).toBe(true);
    const recovered = await db.getProject(metadata.id);
    expect(recovered.ok && recovered.revision.revision).toBe(2);
    expect((await db.listProjects()).map((project) => project.id)).toEqual([metadata.id]);
  });

  it("does not let a stale write replace a newer revision", async () => {
    db = await repository();
    const first = document();
    await db.saveProject(metadata, { ...first, revision: revision(3) });
    const stale = await db.saveProject(metadata, { ...first, revision: revision(1) });
    expect(stale.ok).toBe(true);
    expect(stale.revision).toBe(3);
    const recovered = await db.getProject(metadata.id);
    expect(recovered.ok && recovered.revision.revision).toBe(3);
  });

  it("rejects metadata and document identity mismatches before writing", async () => {
    db = await repository();
    const mismatched = await db.saveProject(metadata, { ...document(), id: "other-project" as never });
    expect(mismatched).toMatchObject({ ok: false, status: "failed" });
    expect((await db.getProject(metadata.id)).ok).toBe(false);
  });

  it("skips corrupt and unknown-version records during recovery", async () => {
    db = await repository();
    const valid = document();
    await db.saveProject(metadata, valid);
    const rawDb = (db as unknown as { db: { revisions: { put: (value: unknown) => Promise<void> } } }).db;
    await rawDb.revisions.put({ key: `${metadata.id}:4`, recordVersion: 99, projectId: metadata.id, revision: 4, savedAt: 4, document: valid });
    const recovered = await db.getProject(metadata.id);
    expect(recovered.ok).toBe(true);
    expect(recovered.ok && recovered.skipped).toBe(1);
  });

  it("deletes project metadata and all revisions", async () => {
    db = await repository();
    await db.saveProject(metadata, document());
    await db.deleteProject(metadata.id);
    expect((await db.getProject(metadata.id)).ok).toBe(false);
  });

  it("persists and recovers a multi-page project", async () => {
    db = await repository();
    const base = createProject(document());
    const project = { ...base, pages: [...base.pages, { ...base.pages[0]!, id: "page-2" as never }] };
    expect((await db.saveProject(metadata, project)).ok).toBe(true);
    const recovered = await db.getProject(metadata.id);
    expect(recovered.ok && recovered.revision.document).toMatchObject({ pages: [{ id: "page-1" }, { id: "page-2" }] });
  });

  it("round-trips native spline elements through project persistence", async () => {
    db = await repository();
    const source = { ...document(), elements: [{ type: "spline" as const, id: elementId("spline-1"), layerId: layerId("layer-1"), nodes: [{ id: "a", anchor: { x: 0, y: 0 }, continuity: "smooth" as const }, { id: "b", anchor: { x: 10, y: 0 }, continuity: "smooth" as const }], closed: true, style: { stroke: "#000", fill: "#fff", strokeWidth: 1 } }] };
    expect((await db.saveProject(metadata, source)).ok).toBe(true);
    const recovered = await db.getProject(metadata.id);
    expect(recovered.ok && recovered.revision.document).toMatchObject({ elements: [{ type: "spline", closed: true }] });
  });
});

describe("DebouncedAutosave", () => {
  it("debounces and retries a failed write without losing the newest revision", async () => {
    const calls: number[] = [];
    let failures = 0;
    const fake: ProjectRepository = {
      listProjects: async () => [],
      getProject: async () => ({ ok: false, reason: "not-found", skipped: 0, error: "none" }),
      deleteProject: async () => undefined,
      saveProject: async (_, value) => { calls.push(value.revision); if (failures++ === 0) return { ok: false, status: "failed", revision: value.revision, error: "temporary" }; return { ok: true, status: "saved", revision: value.revision }; },
    };
    const autosave = new DebouncedAutosave(fake, { debounceMs: 0, retryMs: 0, maxRetries: 1 });
    autosave.schedule(metadata, { ...document(), revision: revision(1) });
    autosave.schedule(metadata, { ...document(), revision: revision(2) });
    await autosave.flush();
    await autosave.flush();
    expect(calls).toEqual([2, 2]);
    expect(autosave.status.state).toBe("saved");
  });
});

describe("MigrationRegistry", () => {
  it("applies explicit migrations and rejects unknown versions", () => {
    const registry = new MigrationRegistry(2);
    registry.register(1, (record) => ({ ...record, recordVersion: 2, migrated: true }));
    expect(registry.migrate({ recordVersion: 1 }, { projectId: "p", revision: 1 })).toEqual({ recordVersion: 2, migrated: true });
    expect(() => registry.migrate({ recordVersion: 9 }, { projectId: "p", revision: 1 })).toThrow("Unsupported");
  });
});
