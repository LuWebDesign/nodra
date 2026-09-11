import { beforeEach, describe, expect, it } from "vitest";
import { createDocument, createProject } from "@nodra/domain";
import {
  collapsedPagesKey,
  loadCollapsedPages,
  loadLastOpenedProject,
  loadProjectMirror,
  projectMirrorKey,
  removeLastOpenedProject,
  removeProjectMirror,
  saveCollapsedPages,
  saveLastAppLocation,
  saveLastOpenedProject,
  saveProjectMirror,
} from "./appPersistence.js";

const storage = new Map<string, string>();
const localStorageMock: Storage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => { storage.set(key, value); },
  removeItem: (key) => { storage.delete(key); },
  clear: () => { storage.clear(); },
  key: (index) => [...storage.keys()][index] ?? null,
  get length() { return storage.size; },
};

const project = createProject(createDocument("project-1"));

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorageMock });
});

describe("app persistence", () => {
  it("round trips collapsed pages and project mirrors", () => {
    saveLastAppLocation({ view: "editor", mode: "prepare" });
    expect(JSON.parse(storage.get("nodra:last-app-location") ?? "null")).toEqual({ view: "editor", mode: "prepare" });
    saveCollapsedPages(project.id, new Set(["page-1", "page-2"]));
    expect(loadCollapsedPages(project.id)).toEqual(new Set(["page-1", "page-2"]));
    saveProjectMirror(project);
    expect(loadProjectMirror(project.id)).toMatchObject({ format: 2, project });
  });

  it("ignores malformed JSON and invalid collapsed-page values", () => {
    storage.set(collapsedPagesKey(project.id), "not-json");
    expect(loadCollapsedPages(project.id)).toEqual(new Set());
    storage.set(collapsedPagesKey(project.id), JSON.stringify(["ok", 1, null, { id: "no" }]));
    expect(loadCollapsedPages(project.id)).toEqual(new Set(["ok"]));
    storage.set(projectMirrorKey(project.id), "not-json");
    expect(loadProjectMirror(project.id)).toBeUndefined();
  });

  it("rejects wrong mirror format, invalid projects, and project ID mismatches", () => {
    storage.set(projectMirrorKey(project.id), JSON.stringify({ format: 1, project, savedAt: 1 }));
    expect(loadProjectMirror(project.id)).toBeUndefined();
    storage.set(projectMirrorKey(project.id), JSON.stringify({ format: 2, project: {}, savedAt: 1 }));
    expect(loadProjectMirror(project.id)).toBeUndefined();
    storage.set(projectMirrorKey(project.id), JSON.stringify({ format: 2, project: { ...project, id: "other" }, savedAt: 1 }));
    expect(loadProjectMirror(project.id)).toBeUndefined();
  });

  it("round trips optional context fields and filters invalid values", () => {
    saveLastOpenedProject({ projectId: project.id });
    expect(loadLastOpenedProject()).toEqual({ projectId: project.id });
    saveLastOpenedProject({ projectId: project.id, pieceId: "piece-1", pageId: "page-1", view: "editor", mode: "prepare" });
    expect(loadLastOpenedProject()).toEqual({ projectId: project.id, pieceId: "piece-1", pageId: "page-1", view: "editor", mode: "prepare" });
    storage.set("nodra:last-opened-project", JSON.stringify({ projectId: "", pieceId: 1, view: "invalid", mode: "invalid" }));
    expect(loadLastOpenedProject()).toBeUndefined();
  });

  it("removes saved context and mirrors", () => {
    saveLastOpenedProject({ projectId: project.id });
    saveProjectMirror(project);
    removeLastOpenedProject();
    removeProjectMirror(project.id);
    expect(loadLastOpenedProject()).toBeUndefined();
    expect(loadProjectMirror(project.id)).toBeUndefined();
  });
});
