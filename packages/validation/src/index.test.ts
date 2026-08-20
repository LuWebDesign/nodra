import { describe, expect, it } from "vitest";
import { createDocument, layerId } from "@nodra/domain";
import { migrateDocument, parseDocument, serializeDocument, validateDocument } from "./index.js";

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
    expect(migrateDocument(oldDocument)).toMatchObject({ schemaVersion: 2, page: { width: 1200, height: 900 } });
  });
  it("rejects non-finite and non-positive page dimensions", () => {
    const result = validateDocument({ ...createDocument("doc-1"), page: { width: 0, height: Number.NaN } });
    expect(result.success).toBe(false);
  });
});
