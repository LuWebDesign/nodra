import type { ProjectSnapshot } from "@nodra/domain";
import type { ProjectMirror } from "./appPersistence.js";

export const selectRecoveredProject = (
  official: ProjectSnapshot,
  officialSavedAt: number,
  mirror: ProjectMirror | undefined,
): { project: ProjectSnapshot; mirrorWins: boolean } => {
  const mirrorWins = mirror !== undefined && Number.isFinite(officialSavedAt) && (
    mirror.project.revision > official.revision ||
    (mirror.project.revision === official.revision && mirror.savedAt > officialSavedAt)
  );
  return { project: mirrorWins ? mirror.project : official, mirrorWins };
};
