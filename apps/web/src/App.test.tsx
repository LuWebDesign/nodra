import { describe, expect, it } from "vitest";
import { createDocument, createProject, elementId, layerId, projectPage, withElements } from "@nodra/domain";
import { profilePreviewForSelection } from "./App.js";

const square = () => [
  { type: "line" as const, id: elementId("top"), layerId: layerId("layer-1"), start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } },
  { type: "line" as const, id: elementId("right"), layerId: layerId("layer-1"), start: { x: 10, y: 0 }, end: { x: 10, y: 10 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } },
  { type: "line" as const, id: elementId("bottom"), layerId: layerId("layer-1"), start: { x: 10, y: 10 }, end: { x: 0, y: 10 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } },
  { type: "line" as const, id: elementId("left"), layerId: layerId("layer-1"), start: { x: 0, y: 10 }, end: { x: 0, y: 0 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } },
];

describe("selection profile preview wiring", () => {
  it("derives and renders only an explicitly selected closed scope", () => {
    const project = createProject(withElements(createDocument("profile-preview", [{ id: layerId("layer-1"), name: "Layer", visible: true, order: 0 }]), square()));
    const page = projectPage(project);
    const pieceId = project.pieces[0]!.id;
    const preview = profilePreviewForSelection(project, page, pieceId, square().map((element) => element.id));

    expect(preview).toContain('data-profile="true"');
    expect(profilePreviewForSelection(project, page, pieceId, [])).toBeUndefined();
  });
});
