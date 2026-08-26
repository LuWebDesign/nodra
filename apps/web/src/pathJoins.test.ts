import { describe, expect, it } from "vitest";
import { pathJoinGuidance, pathJoinOptions } from "./pathJoins.js";

describe("Pluma path join controls", () => {
  it("exposes accessible Spanish labels and guidance for every join mode", () => {
    expect(pathJoinGuidance).toContain("Seleccione un ancla");
    expect(pathJoinOptions.map((option) => option.value)).toEqual(["corner", "smooth", "symmetric"]);
    expect(pathJoinOptions.map((option) => option.label)).toEqual(["Esquina", "Suave", "Simétrica"]);
    expect(pathJoinOptions.every((option) => option.description.length > 0)).toBe(true);
  });
});
