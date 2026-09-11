import { describe, expect, it } from "vitest";
import { createDocument, createProject, revision, type ProjectSnapshot } from "@nodra/domain";
import type { ProjectMirror } from "./appPersistence.js";
import { selectRecoveredProject } from "./appRecovery.js";

const baseProject = createProject(createDocument("recovery-project"));
const projectAt = (value: number): ProjectSnapshot => ({ ...baseProject, revision: revision(value) });
const mirrorAt = (project: ProjectSnapshot, savedAt: number): ProjectMirror => ({ format: 2, project, savedAt });

describe("selectRecoveredProject", () => {
  it("uses the official project when no mirror exists", () => {
    const official = projectAt(2);
    expect(selectRecoveredProject(official, 100, undefined)).toEqual({ project: official, mirrorWins: false });
  });

  it("uses a mirror with a higher revision", () => {
    const official = projectAt(2);
    const mirror = projectAt(3);
    expect(selectRecoveredProject(official, 100, mirrorAt(mirror, 1))).toEqual({ project: mirror, mirrorWins: true });
  });

  it("uses a newer mirror timestamp when revisions are equal", () => {
    const official = projectAt(2);
    const mirror = projectAt(2);
    expect(selectRecoveredProject(official, 100, mirrorAt(mirror, 101))).toEqual({ project: mirror, mirrorWins: true });
  });

  it.each([
    [100, "equal"],
    [99, "older"],
  ])("prefers the official project when the mirror timestamp is %s", (mirrorSavedAt) => {
    const official = projectAt(2);
    const mirror = projectAt(2);
    expect(selectRecoveredProject(official, 100, mirrorAt(mirror, mirrorSavedAt))).toEqual({ project: official, mirrorWins: false });
  });
});
