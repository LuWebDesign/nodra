import { describe, expect, it } from "vitest";
import { createDocument, createProject } from "@nodra/domain";
import { decodeProjectFile, encodeProjectFile } from "./projectFileCodec.js";

describe("Kond Design project files", () => {
  const project = createProject(createDocument("codec-test"));

  it("round-trips a validated project", () => {
    expect(decodeProjectFile(encodeProjectFile(project))).toEqual(project);
  });

  it("rejects malformed JSON", () => {
    expect(() => decodeProjectFile("not-json")).toThrow("JSON válido");
  });

  it("rejects an invalid project shape", () => {
    expect(() => decodeProjectFile("{}"))
      .toThrow("Proyecto inválido");
  });
});
