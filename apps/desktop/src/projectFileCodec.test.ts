import { describe, expect, it } from "vitest";
import { createDocument, createProject } from "@nodra/domain";
import { decodeProjectFile, encodeProjectFile } from "./projectFileCodec.js";

describe("Kond Design project files", () => {
  const project = createProject(createDocument("codec-test"));

  it("round-trips a validated project", () => {
    expect(decodeProjectFile(encodeProjectFile(project))).toEqual(project);
  });

  it("backfills pieces when opening an older compatible schema-9 file", () => {
    const legacy = { ...project } as Record<string, unknown>;
    delete legacy.pieces;
    expect(decodeProjectFile(JSON.stringify(legacy))).toMatchObject({ pieces: [{ id: "codec-test:piece-1", state: "design", sketches: [] }] });
  });

  it("rejects malformed JSON", () => {
    expect(() => decodeProjectFile("not-json")).toThrow("JSON válido");
  });

  it("rejects an invalid project shape", () => {
    expect(() => decodeProjectFile("{}"))
      .toThrow("Proyecto inválido");
  });
});
