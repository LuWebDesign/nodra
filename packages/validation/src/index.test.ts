import { describe, expect, it } from "vitest";
import { createDocument, layerId } from "@nodra/domain";
import { migrateDocument, parseDocument, serializeDocument, validateDocument, validateProject } from "./index.js";

describe("native document validation", () => {
  it("round-trips valid records", () => {
    const document = createDocument("doc-1", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]);
    const result = parseDocument(serializeDocument(document));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(document);
  });
  it("rejects unknown versions, invalid dimensions, and unknown layer references", () => {
    const result = validateDocument({ schemaVersion: 99, id: "doc", revision: 0, origin: "top-left", units: "mm", layers: [], elements: [{ type: "rectangle", id: "r", layerId: "missing", position: { x: 0, y: 0 }, size: { width: 0, height: 2 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } }] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Invalid input");
  });
  it("rejects malformed JSON safely", () => expect(parseDocument("{").success).toBe(false));
  it("migrates schema version 1 documents with the default page", () => {
    const oldDocument = { ...createDocument("doc-1", []), schemaVersion: 1 };
    const result = validateDocument(oldDocument);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.page).toEqual({ width: 1200, height: 900 });
    expect(migrateDocument(oldDocument)).toMatchObject({ schemaVersion: 3, page: { width: 1200, height: 900 } });
  });
  it("validates a project with stable page ids, including duplicate sizes", () => {
    const document = createDocument("doc-1", []);
    const project = { ...({ schemaVersion: 3, id: document.id, revision: document.revision, origin: document.origin, units: document.units } as const), pages: [{ id: "page-a", page: document.page, layers: [], elements: [] }, { id: "page-b", page: document.page, layers: [], elements: [] }], activePageId: "page-b" };
    expect(validateProject(project).success).toBe(true);
  });
  it("rejects non-finite and non-positive page dimensions", () => {
    const result = validateDocument({ ...createDocument("doc-1"), page: { width: 0, height: Number.NaN } });
    expect(result.success).toBe(false);
  });
  it("defaults legacy rectangle radii and rejects negative radii", () => {
    const legacy = { ...createDocument("doc-1", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]), elements: [{ type: "rectangle", id: "r", layerId: "layer-1", position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } }] };
    const defaulted = validateDocument(legacy);
    expect(defaulted.success).toBe(true);
    if (defaulted.success) expect(defaulted.data.elements[0]).toMatchObject({ cornerRadius: 0 });
    expect(validateDocument({ ...legacy, elements: [{ ...legacy.elements[0], cornerRadius: -1 }] }).success).toBe(false);
  });
  it("accepts closed contour paths and rejects open rings", () => {
    const base = createDocument("doc-1", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]);
    const contour = { type: "contour", id: "path", layerId: "layer-1", position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, contours: [{ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 0 }] }], fillRule: "evenodd", rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    expect(validateDocument({ ...base, elements: [contour] }).success).toBe(true);
    expect(validateDocument({ ...base, elements: [{ ...contour, contours: [{ points: contour.contours[0]!.points.slice(0, 3) }] }] }).success).toBe(false);
  });
});
