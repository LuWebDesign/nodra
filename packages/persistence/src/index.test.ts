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

  it("round-trips a valid sketch midpoint constraint through the repository", async () => {
    db = await repository();
    const base = document();
    const sketch = {
      type: "sketch" as const,
      id: elementId("midpoint-sketch"),
      layerId: layerId("layer-1"),
      nodes: [
        { id: "source-start", point: { x: 10, y: 0 } },
        { id: "source-end", point: { x: 10, y: 10 } },
        { id: "midpoint", point: { x: 10, y: 5 } },
      ],
      edges: [{ id: "source", startNodeId: "source-start", endNodeId: "source-end" }],
      constraints: [{ id: "source-midpoint", kind: "midpoint" as const, references: [{ elementId: elementId("midpoint-sketch"), nodeId: "midpoint" }, { elementId: elementId("midpoint-sketch"), edgeId: "source" }] as const }],
      style: { stroke: "#000", strokeWidth: 1 },
    };
    const source = { ...base, elements: [sketch] };

    expect((await db.saveProject(metadata, source)).ok).toBe(true);
    const recovered = await db.getProject(metadata.id);
    expect(recovered.ok && recovered.revision.document).toMatchObject({ elements: [{ nodes: sketch.nodes, constraints: sketch.constraints }] });
  });

  it("round-trips a cross-sketch driving midpoint through the repository", async () => {
    db = await repository();
    const base = document();
    const dependent = { type: "sketch" as const, id: elementId("dependent-sketch"), layerId: layerId("layer-1"), nodes: [{ id: "dependent", point: { x: 15, y: 5 } }, { id: "other", point: { x: 20, y: 5 } }], edges: [{ id: "dependent-edge", startNodeId: "dependent", endNodeId: "other" }], style: { stroke: "#000", strokeWidth: 1 } };
    const source = { type: "sketch" as const, id: elementId("source-sketch"), layerId: layerId("layer-1"), nodes: [{ id: "start", point: { x: 10, y: 0 } }, { id: "end", point: { x: 20, y: 10 } }], edges: [{ id: "source-edge", startNodeId: "start", endNodeId: "end" }], style: { stroke: "#000", strokeWidth: 1 } };
    const constraint = { id: "cross-midpoint", kind: "midpoint" as const, references: [{ elementId: dependent.id, nodeId: "dependent" }, { elementId: source.id, edgeId: "source-edge" }] as const };
    const saved = { ...base, elements: [dependent, source], constraints: [constraint] };
    expect((await db.saveProject(metadata, saved)).ok).toBe(true);
    const recovered = await db.getProject(metadata.id);
    expect(recovered.ok && recovered.revision.document).toMatchObject({ elements: [dependent, source], constraints: [constraint] });
  });

  it("round-trips native-line midpoint references in schema 10", async () => {
    db = await repository();
    const base = document();
    const dependent = { type: "sketch" as const, id: elementId("native-dependent"), layerId: layerId("layer-1"), nodes: [{ id: "mid", point: { x: 5, y: 0 } }, { id: "other", point: { x: 8, y: 2 } }], edges: [{ id: "dependent-edge", startNodeId: "mid", endNodeId: "other" }], style: { stroke: "#000", strokeWidth: 1 } };
    const line = { type: "line" as const, id: elementId("native-line"), layerId: layerId("layer-1"), start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const relation = { id: "native-midpoint", kind: "midpoint" as const, references: [{ elementId: dependent.id, nodeId: "mid" }] as const, source: { kind: "line" as const, elementId: line.id } };
    const saved = { ...base, elements: [dependent, line], constraints: [relation] };

    expect((await db.saveProject(metadata, saved)).ok).toBe(true);
    const recovered = await db.getProject(metadata.id);
    expect(recovered.ok && recovered.revision.document.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(recovered.ok && recovered.revision.document).toMatchObject({ constraints: [relation] });
  });

  it("round-trips Path segment midpoint references and migrates schema-10 native Line", async () => {
    db = await repository();
    const base = document();
    const dependent = { type: "sketch" as const, id: elementId("path-dependent"), layerId: layerId("layer-1"), nodes: [{ id: "mid", point: { x: 5, y: 1 } }, { id: "other", point: { x: 8, y: 2 } }], edges: [{ id: "dependent-edge", startNodeId: "mid", endNodeId: "other" }], style: { stroke: "#000", strokeWidth: 1 } };
    const path = { type: "path" as const, id: elementId("path-source"), layerId: layerId("layer-1"), nodes: [{ id: "a", anchor: { x: 0, y: 0 }, join: "corner" as const }, { id: "b", anchor: { x: 10, y: 0 }, join: "corner" as const }], segments: [{ id: "stable-segment", type: "line" as const, startNodeId: "a", endNodeId: "b" }], closed: false, style: { stroke: "#000", strokeWidth: 1 } };
    const relation = { id: "path-mid", kind: "midpoint" as const, references: [{ elementId: dependent.id, nodeId: "mid" }] as const, source: { kind: "path-segment" as const, elementId: path.id, segmentId: "stable-segment" } };
    expect((await db.saveProject(metadata, { ...base, elements: [dependent, path], constraints: [relation] })).ok).toBe(true);
    const recovered = await db.getProject(metadata.id);
    expect(recovered.ok && recovered.revision.document).toMatchObject({ constraints: [relation], elements: [{ id: dependent.id }, { id: path.id, segments: [{ id: "stable-segment" }] }] });

    const line = { type: "line" as const, id: elementId("legacy-line"), layerId: layerId("layer-1"), start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style: path.style };
    const legacy = { ...base, schemaVersion: 10, elements: [dependent, line], constraints: [{ id: "legacy-mid", kind: "midpoint", references: [{ elementId: dependent.id, nodeId: "mid" }], source: { kind: "line", elementId: line.id } }] };
    const rawDb = (db as unknown as { db: { projects: { put: (value: unknown) => Promise<void> }; revisions: { put: (value: unknown) => Promise<void> } } }).db;
    await rawDb.projects.put(metadata);
    await rawDb.revisions.put({ key: `${metadata.id}:3`, recordVersion: 1, projectId: metadata.id, revision: 3, savedAt: 3, document: { ...legacy, revision: 3 } });
    const migrated = await db.getProject(metadata.id);
    expect(migrated.ok && migrated.revision.document).toMatchObject({ schemaVersion: 13, constraints: [{ source: { kind: "line", elementId: line.id } }] });
  });

  it("round-trips Spline span references and migrates v11 projects preserving Line and Path sources", async () => {
    db = await repository();
    const base = document();
    const dependent = { type: "sketch" as const, id: elementId("spline-dependent"), layerId: layerId("layer-1"), nodes: [{ id: "mid", point: { x: 4, y: 2 } }, { id: "other", point: { x: 8, y: 2 } }], edges: [{ id: "dependent-edge", startNodeId: "mid", endNodeId: "other" }], style: { stroke: "#000", strokeWidth: 1 } };
    const spline = { type: "spline" as const, id: elementId("spline-source"), layerId: layerId("layer-1"), nodes: [{ id: "a", anchor: { x: 0, y: 0 }, continuity: "smooth" as const, outHandle: { dx: 2, dy: 3 } }, { id: "b", anchor: { x: 8, y: 0 }, continuity: "smooth" as const, inHandle: { dx: -2, dy: 3 } }], closed: false, style: { stroke: "#000", strokeWidth: 1 } };
    const splineRelation = { id: "spline-mid", kind: "midpoint" as const, references: [{ elementId: dependent.id, nodeId: "mid" }] as const, source: { kind: "spline-span" as const, elementId: spline.id, startNodeId: "a", endNodeId: "b" } };
    const nativeLine = { type: "line" as const, id: elementId("legacy-line"), layerId: layerId("layer-1"), start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style: spline.style };
    const path = { type: "path" as const, id: elementId("legacy-path"), layerId: layerId("layer-1"), nodes: [{ id: "p0", anchor: { x: 0, y: 0 }, join: "corner" as const }, { id: "p1", anchor: { x: 10, y: 0 }, join: "corner" as const }], segments: [{ id: "path-seg", type: "line" as const, startNodeId: "p0", endNodeId: "p1" }], closed: false, style: spline.style };
    const dependentPath = { ...dependent, id: elementId("spline-dependent-path"), nodes: [{ id: "mid-path", point: { x: 4, y: 2 } }, { id: "other-path", point: { x: 8, y: 2 } }], edges: [{ id: "dependent-edge-path", startNodeId: "mid-path", endNodeId: "other-path" }] };
    const lineRelation = { id: "old-line-mid", kind: "midpoint" as const, references: splineRelation.references, source: { kind: "line" as const, elementId: nativeLine.id } };
    const pathRelation = { id: "old-path-mid", kind: "midpoint" as const, references: [{ elementId: dependentPath.id, nodeId: "mid-path" }] as const, source: { kind: "path-segment" as const, elementId: path.id, segmentId: "path-seg" } };
    expect((await db.saveProject(metadata, { ...base, elements: [dependent, spline], constraints: [splineRelation] })).ok).toBe(true);
    const roundTrip = await db.getProject(metadata.id);
    expect(roundTrip.ok && roundTrip.revision.document).toMatchObject({ schemaVersion: 13, constraints: [splineRelation] });

    const legacyBase = createProject(base);
    const legacy = { ...legacyBase, pieces: legacyBase.pieces.map((piece) => ({ ...piece, sketches: [{ pageId: legacyBase.pages[0]!.id, sketchId: dependent.id }, { pageId: legacyBase.pages[0]!.id, sketchId: dependentPath.id }] })), schemaVersion: 11, pages: [{ ...legacyBase.pages[0]!, elements: [dependent, dependentPath, nativeLine, path], constraints: [lineRelation, pathRelation] }] };
    const rawDb = (db as unknown as { db: { projects: { put: (value: unknown) => Promise<void> }; revisions: { put: (value: unknown) => Promise<void> } } }).db;
    await rawDb.projects.put(metadata);
    await rawDb.revisions.put({ key: `${metadata.id}:4`, recordVersion: 1, projectId: metadata.id, revision: 4, savedAt: 4, document: { ...legacy, revision: 4 } });
    const migrated = await db.getProject(metadata.id);
    expect(migrated.ok && migrated.revision.document).toMatchObject({ schemaVersion: 13, pages: [{ constraints: [lineRelation, pathRelation] }] });
  });

  it("migrates schema-9 documents and rejects invalid native midpoint references", async () => {
    db = await repository();
    const base = document();
    const legacy = { ...base, schemaVersion: 9 as const };
    const rawDb = (db as unknown as { db: { projects: { put: (value: unknown) => Promise<void> }; revisions: { put: (value: unknown) => Promise<void> } } }).db;
    await rawDb.projects.put(metadata);
    await rawDb.revisions.put({ key: `${metadata.id}:0`, recordVersion: 1, projectId: metadata.id, revision: 0, savedAt: 1, document: legacy });
    const migrated = await db.getProject(metadata.id);
    expect(migrated.ok && migrated.revision.document.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

    const dependent = { type: "sketch" as const, id: elementId("invalid-dependent"), layerId: layerId("layer-1"), nodes: [{ id: "mid", point: { x: 5, y: 0 } }, { id: "other", point: { x: 8, y: 2 } }], edges: [{ id: "dependent-edge", startNodeId: "mid", endNodeId: "other" }], style: { stroke: "#000", strokeWidth: 1 } };
    const line = { type: "line" as const, id: elementId("valid-native"), layerId: layerId("layer-1"), start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const invalid = { ...base, elements: [dependent, line], constraints: [{ id: "invalid-native-midpoint", kind: "midpoint", references: [{ elementId: dependent.id, nodeId: "missing" }], source: { kind: "line", elementId: line.id } }] } as unknown as typeof base;
    expect(await db.saveProject(metadata, invalid)).toMatchObject({ ok: false, status: "failed" });
    const afterRejection = await db.getProject(metadata.id);
    expect(afterRejection.ok).toBe(true);
  });

  it("round-trips Arc midpoint references and migrates v12 projects", async () => {
    db = await repository();
    const base = document();
    const style = { stroke: "#000", strokeWidth: 1 };
    const dependent = { type: "sketch" as const, id: elementId("arc-dependent"), layerId: layerId("layer-1"), nodes: [{ id: "mid", point: { x: 1, y: 1 } }, { id: "other", point: { x: 2, y: 2 } }], edges: [{ id: "edge", startNodeId: "mid", endNodeId: "other" }], style };
    const arc = { type: "arc" as const, id: elementId("arc-source"), layerId: layerId("layer-1"), center: { x: 0, y: 0 }, radius: 10, startAngle: 5.5, endAngle: 0.5, direction: "clockwise" as const, style };
    const relation = { id: "arc-mid", kind: "midpoint" as const, references: [{ elementId: dependent.id, nodeId: "mid" }] as const, source: { kind: "arc" as const, elementId: arc.id } };
    expect((await db.saveProject(metadata, { ...base, elements: [dependent, arc], constraints: [relation] })).ok).toBe(true);
    const roundTrip = await db.getProject(metadata.id);
    expect(roundTrip.ok && roundTrip.revision.document).toMatchObject({ schemaVersion: 13, constraints: [relation] });

    const oldProject = createProject(base);
    const legacy = { ...oldProject, pieces: oldProject.pieces.map((piece) => ({ ...piece, sketches: [{ pageId: oldProject.pages[0]!.id, sketchId: dependent.id }] })), schemaVersion: 12, pages: [{ ...oldProject.pages[0]!, elements: [dependent, arc], constraints: [relation] }] };
    const rawDb = (db as unknown as { db: { projects: { put: (value: unknown) => Promise<void> }; revisions: { put: (value: unknown) => Promise<void> } } }).db;
    await rawDb.projects.put(metadata);
    await rawDb.revisions.put({ key: `${metadata.id}:5`, recordVersion: 1, projectId: metadata.id, revision: 5, savedAt: 5, document: { ...legacy, revision: 5 } });
    const migrated = await db.getProject(metadata.id);
    expect(migrated.ok && migrated.revision.document).toMatchObject({ schemaVersion: 13, pages: [{ constraints: [relation] }] });
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

  it("rejects invalid native and sketch-edge roles without replacing the valid revision", async () => {
    db = await repository();
    const base = document();
    const line = { type: "line" as const, id: elementId("construction-line"), layerId: layerId("layer-1"), start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, role: "construction" as const, style: { stroke: "#000", strokeWidth: 1 } };
    const sketch = { type: "sketch" as const, id: elementId("sketch-roles"), layerId: layerId("layer-1"), nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 10, y: 0 } }], edges: [{ id: "edge", startNodeId: "a", endNodeId: "b", role: "construction" as const }], style: { stroke: "#000", strokeWidth: 1 } };
    const valid = { ...base, elements: [line, sketch], revision: revision(1) };
    expect((await db.saveProject(metadata, valid)).ok).toBe(true);

    const invalidNative = { ...valid, revision: revision(2), elements: [{ ...line, role: "invalid" }, sketch] } as unknown as typeof valid;
    const nativeResult = await db.saveProject(metadata, invalidNative);
    expect(nativeResult).toMatchObject({ ok: false, status: "failed", revision: 2 });
    const afterNativeFailure = await db.getProject(metadata.id);
    expect(afterNativeFailure.ok && afterNativeFailure.revision).toMatchObject({ revision: 1, document: valid });

    const invalidEdge = { ...valid, revision: revision(3), elements: [line, { ...sketch, edges: [{ ...sketch.edges[0]!, role: "invalid" }] }] } as unknown as typeof valid;
    const edgeResult = await db.saveProject(metadata, invalidEdge);
    expect(edgeResult).toMatchObject({ ok: false, status: "failed", revision: 3 });
    const afterEdgeFailure = await db.getProject(metadata.id);
    expect(afterEdgeFailure.ok && afterEdgeFailure.revision).toMatchObject({ revision: 1, document: valid });
  });

  it("round-trips mixed native and sketch-edge geometry roles through project persistence", async () => {
    db = await repository();
    const base = document();
    const sketch = { type: "sketch" as const, id: elementId("sketch-roles"), layerId: layerId("layer-1"), nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 10, y: 0 } }, { id: "c", point: { x: 20, y: 0 } }], edges: [{ id: "normal", startNodeId: "a", endNodeId: "b" }, { id: "construction", startNodeId: "b", endNodeId: "c", role: "construction" as const }], style: { stroke: "#000", strokeWidth: 1 } };
    const source = { ...base, elements: [{ type: "line" as const, id: elementId("construction-line"), layerId: layerId("layer-1"), start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, role: "construction" as const, style: { stroke: "#000", strokeWidth: 1 } }, sketch] };
    expect((await db.saveProject(metadata, source)).ok).toBe(true);
    const recovered = await db.getProject(metadata.id);
    expect(recovered.ok && recovered.revision.document).toMatchObject({ elements: [{ role: "construction" }, { role: "normal", edges: [{ role: "normal" }, { role: "construction" }] }] });
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
