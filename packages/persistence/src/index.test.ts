import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, createDocument, createProject, elementId, featureId, layerId, revision } from "@nodra/domain";
import { DebouncedAutosave, DexieProjectRepository, MigrationRegistry, type ProjectRepository } from "./index.js";
import { validateProject } from "@nodra/validation";

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

  it("persists a metadata rename without changing the document revision", async () => {
    db = await repository();
    const source = createProject(document());
    await db.saveProject(metadata, source);
    const renamed = { ...metadata, name: "Renamed project", updatedAt: 5 };
    expect((await db.saveProject(renamed, source)).ok).toBe(true);
    expect(await db.listProjects()).toContainEqual(expect.objectContaining({ id: renamed.id, name: renamed.name }));
    const recovered = await db.getProject(metadata.id);
    expect(recovered.ok && recovered.revision.metadata).toEqual(expect.objectContaining({ id: renamed.id, name: renamed.name }));
    expect(recovered.ok && recovered.revision.revision).toBe(source.revision);
  });

  it("round-trips page-scoped intersect features through the repository", async () => {
    db = await repository();
    const base = document();
    const source = { type: "rectangle" as const, id: elementId("source"), layerId: layerId("layer-1"), position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const second = { ...source, id: elementId("second"), position: { x: 5, y: 0 } };
    const output = { type: "contour" as const, id: elementId("feature-1:output"), layerId: source.layerId, position: { x: 5, y: 0 }, size: { width: 5, height: 10 }, contours: [{ points: [{ x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 5, y: 10 }, { x: 5, y: 0 }] }], fillRule: "evenodd" as const, rotation: 0, style: source.style };
    const featureTree = { version: 1 as const, features: [{ id: featureId("feature-1"), operation: "intersect" as const, sources: [{ elementId: source.id }, { elementId: second.id }], outputs: [{ elementId: output.id }], status: "up-to-date" as const }] };
    const saved = { ...base, elements: [source, second, output], featureTree, revision: revision(1) };

    expect((await db.saveProject(metadata, saved)).ok).toBe(true);
    const recovered = await db.getProject(metadata.id);
    expect(recovered.ok && recovered.revision.document).toMatchObject({ featureTree });
  });

  it("round-trips explicit connections through the repository", async () => {
    db = await repository();
    const base = document();
    const first = { type: "rectangle" as const, id: elementId("first"), layerId: layerId("layer-1"), position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const second = { ...first, id: elementId("second"), position: { x: 10, y: 0 } };
    const connection = { id: "join", first: { elementId: first.id, node: { kind: "named" as const, name: "e" as const } }, second: { elementId: second.id, node: { kind: "named" as const, name: "w" as const } } };
    const firstCircle = { type: "circle" as const, id: elementId("first-circle"), layerId: layerId("layer-1"), center: { x: 20, y: 20 }, radius: 2, style: { stroke: "#000", strokeWidth: 1 } };
    const secondCircle = { ...firstCircle, id: elementId("second-circle") };
    const coincidence = { id: "coincidence", first: { elementId: firstCircle.id, node: { kind: "named" as const, name: "center" as const } }, second: { elementId: secondCircle.id, node: { kind: "named" as const, name: "center" as const } } };
    const saved = { ...base, elements: [first, second, firstCircle, secondCircle], connections: [connection], positionalCoincidences: [coincidence], revision: revision(1) };
    expect((await db.saveProject(metadata, saved)).ok).toBe(true);
    const recovered = await db.getProject(metadata.id);
    expect(recovered.ok && recovered.revision.document).toMatchObject({ connections: [connection], positionalCoincidences: [coincidence] });
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

  it("migrates legacy path segment identities while recovering a revision", async () => {
    db = await repository();
    const base = document();
    await db.saveProject(metadata, base);
    const legacyPath = { type: "path", id: "legacy-path", layerId: "layer-1", nodes: [{ id: "a", anchor: { x: 0, y: 0 }, join: "corner" }, { id: "b", anchor: { x: 10, y: 0 }, join: "corner" }], segments: [{ type: "line", startNodeId: "a", endNodeId: "b" }], closed: false, style: { stroke: "#000", strokeWidth: 1 } };
    const legacyCircle = { type: "ellipse", id: "legacy-circle", layerId: "layer-1", position: { x: 10, y: 20 }, size: { width: 20, height: 20 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const rawDb = (db as unknown as { db: { revisions: { put: (value: unknown) => Promise<void> } } }).db;
    await rawDb.revisions.put({ key: `${metadata.id}:2`, recordVersion: 1, projectId: metadata.id, revision: 2, savedAt: 2, document: { ...base, schemaVersion: 6, revision: 2, elements: [legacyPath, legacyCircle] } });

    const recovered = await db.getProject(metadata.id);
    expect(recovered.ok && recovered.revision.document).toMatchObject({ schemaVersion: CURRENT_SCHEMA_VERSION, elements: [{ type: "path", segments: [{ id: "legacy-path:segment:0" }] }, { type: "circle", center: { x: 20, y: 30 }, radius: 10 }] });
  });

  it("deletes project metadata and all revisions", async () => {
    db = await repository();
    await db.saveProject(metadata, document());
    await db.deleteProject(metadata.id);
    expect((await db.getProject(metadata.id)).ok).toBe(false);
  });

  it("persists, lists, deletes, and ignores corrupt font records", async () => {
    db = await repository();
    const font = { id: `${metadata.id}:Demo`, projectId: metadata.id, family: "Demo", name: "demo.woff2", format: "font/woff2", blob: new Blob([new Uint8Array([1, 2, 3])], { type: "font/woff2" }), savedAt: 10 };
    await db.saveFont(font);
    expect((await db.listFonts(metadata.id)).map((item) => item.family)).toEqual(["Demo"]);
    const rawDb = (db as unknown as { db: { fonts: { put: (value: unknown) => Promise<void> } } }).db;
    await rawDb.fonts.put({ id: "bad", projectId: metadata.id, family: "Broken", blob: "not-a-blob", savedAt: 11 });
    expect((await db.listFonts(metadata.id)).map((item) => item.family)).toEqual(["Demo"]);
    await db.deleteFont(metadata.id, font.id);
    expect(await db.listFonts(metadata.id)).toEqual([]);
  });

  it("deletes project fonts with the project", async () => {
    db = await repository();
    await db.saveFont({ id: `${metadata.id}:Demo`, projectId: metadata.id, family: "Demo", blob: new Blob(["font"]), savedAt: 1 });
    await db.deleteProject(metadata.id);
    expect(await db.listFonts(metadata.id)).toEqual([]);
  });

  it("recovers schema-9 project payloads that predate persisted pieces", async () => {
    db = await repository();
    const base = createProject(document());
    const legacy = { ...base } as Record<string, unknown>;
    delete legacy.pieces;
    const rawDb = (db as unknown as { db: { projects: { put: (value: unknown) => Promise<void> }; revisions: { put: (value: unknown) => Promise<void> } } }).db;
    await rawDb.projects.put(metadata);
    await rawDb.revisions.put({ key: `${metadata.id}:0`, recordVersion: 1, projectId: metadata.id, revision: 0, savedAt: 1, document: legacy });

    const recovered = await db.getProject(metadata.id);
    expect(recovered.ok && recovered.revision.document).toMatchObject({ pieces: [{ id: `${metadata.id}:piece-1`, name: "Pieza 1", state: "design", sketches: [] }] });
  });

  it("persists and recovers a multi-page project", async () => {
    db = await repository();
    const base = createProject(document());
    const project = { ...base, pages: [...base.pages, { ...base.pages[0]!, id: "page-2" as never }] };
    expect((await db.saveProject(metadata, project)).ok).toBe(true);
    const recovered = await db.getProject(metadata.id);
    expect(recovered.ok && recovered.revision.document).toMatchObject({ pages: [{ id: "page-1" }, { id: "page-2" }] });
  });

  it("migrates schema 1 through 8 projects with sketches spread across pages", async () => {
        const sketch = (id: string) => ({ type: "sketch" as const, id: elementId(id), layerId: layerId("layer-1"), nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 1, y: 0 } }], edges: [{ id: `${id}-edge`, startNodeId: "a", endNodeId: "b" }], constraints: [], style: { stroke: "#000", strokeWidth: 1 } });
        for (const version of [1, 2, 3, 4, 5, 6, 7, 8]) {
          db = await repository();
          const base = createProject(document());
          const first = sketch(`legacy-${version}-first`);
          const second = sketch(`legacy-${version}-second`);
          const projectId = `${metadata.id}-${version}`;
          const legacy = { ...base, id: projectId, schemaVersion: version, pages: [{ ...base.pages[0]!, elements: [first] }, { ...base.pages[0]!, id: `page-${version}-2` as never, elements: [second] }] } as Record<string, unknown>;
          delete legacy.pieces;
          const checked = validateProject(legacy);
          expect(checked.success, checked.success ? undefined : `schema ${version}: ${checked.error}`).toBe(true);
          const rawDb = (db as unknown as { db: { projects: { put: (value: unknown) => Promise<void> }; revisions: { put: (value: unknown) => Promise<void> } } }).db;
          await rawDb.projects.put({ ...metadata, id: projectId });
          await rawDb.revisions.put({ key: `${projectId}:0`, recordVersion: 1, projectId, revision: 0, savedAt: 1, document: legacy });
          const recovered = await db.getProject(projectId);
          expect(recovered.ok, `schema ${version}: ${recovered.ok ? "" : recovered.error}`).toBe(true);
          if (recovered.ok) expect(recovered.revision.document).toMatchObject({ schemaVersion: CURRENT_SCHEMA_VERSION, pieces: [{ state: "underdefined", sketches: [{ pageId: "page-1", sketchId: `legacy-${version}-first` }, { pageId: `page-${version}-2`, sketchId: `legacy-${version}-second` }] }] });
          await db.close();
          db = undefined;
        }
      });

      it("round-trips native arc elements through project persistence", async () => {
    db = await repository();
    const source = { ...document(), elements: [{ type: "arc" as const, id: elementId("arc-1"), layerId: layerId("layer-1"), center: { x: 20, y: 20 }, radius: 10, startAngle: 0, endAngle: Math.PI / 2, direction: "clockwise" as const, style: { stroke: "#000", strokeWidth: 1 } }] };
    expect((await db.saveProject(metadata, source)).ok).toBe(true);
    const recovered = await db.getProject(metadata.id);
    expect(recovered.ok && recovered.revision.document).toMatchObject({ elements: [{ type: "arc", center: { x: 20, y: 20 }, radius: 10, direction: "clockwise" }] });
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
