import { describe, expect, it } from "vitest";
import { createDocument, createProject, elementId, layerId, projectPage, withElements } from "@nodra/domain";
import { profileOverlaysForPiece, profilePreviewForSelection } from "./App.js";

const square = () => [
  { type: "line" as const, id: elementId("top"), layerId: layerId("layer-1"), start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } },
  { type: "line" as const, id: elementId("right"), layerId: layerId("layer-1"), start: { x: 10, y: 0 }, end: { x: 10, y: 10 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } },
  { type: "line" as const, id: elementId("bottom"), layerId: layerId("layer-1"), start: { x: 10, y: 10 }, end: { x: 0, y: 10 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } },
  { type: "line" as const, id: elementId("left"), layerId: layerId("layer-1"), start: { x: 0, y: 10 }, end: { x: 0, y: 0 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } },
];

describe("piece profile overlay wiring", () => {
  it("derives a transient fill from separate editable elements that collectively close", () => {
    const project = createProject(withElements(createDocument("piece-profile", [{ id: layerId("layer-1"), name: "Layer", visible: true, order: 0 }]), square()));
    const before = structuredClone(project);
    const page = projectPage(project);
    const overlays = profileOverlaysForPiece(project, page, project.pieces[0]!.id, [], page.page);

    expect(overlays.fill).toContain('data-profile="true"');
    expect(overlays.fill).toContain('fill-rule="evenodd"');
    expect(overlays.fill).toContain('M0 0 L10 0');
    expect(project).toEqual(before);
    expect(page.elements.map((element) => element.id)).toEqual(square().map((element) => element.id));
  });

  it("renders the derived fill only for a valid closed profile on visible layers", () => {
    const visibleLayer = { id: layerId("layer-1"), name: "Visible", visible: true, order: 0 };
    const hiddenLayer = { id: layerId("hidden"), name: "Hidden", visible: false, order: 1 };
    const openProject = createProject(withElements(createDocument("open-profile", [visibleLayer]), square().slice(0, 3)));
    const hiddenProject = createProject(withElements(createDocument("hidden-profile", [visibleLayer, hiddenLayer]), square().map((element) => ({ ...element, layerId: hiddenLayer.id }))));

    expect(profileOverlaysForPiece(openProject, projectPage(openProject), openProject.pieces[0]!.id, []).fill).toBeUndefined();
    expect(profileOverlaysForPiece(hiddenProject, projectPage(hiddenProject), hiddenProject.pieces[0]!.id, []).fill).toBeUndefined();
  });

  it("preserves holes with even-odd fill and does not duplicate an explicit selection overlay", () => {
    const circles = [
      { type: "circle" as const, id: elementId("outer"), layerId: layerId("layer-1"), center: { x: 20, y: 20 }, radius: 10, style: { stroke: "#000", strokeWidth: 1 } },
      { type: "circle" as const, id: elementId("hole"), layerId: layerId("layer-1"), center: { x: 20, y: 20 }, radius: 4, style: { stroke: "#000", strokeWidth: 1 } },
    ];
    const project = createProject(withElements(createDocument("profile-hole", [{ id: layerId("layer-1"), name: "Layer", visible: true, order: 0 }]), circles));
    const page = projectPage(project);
    const overlays = profileOverlaysForPiece(project, page, project.pieces[0]!.id, circles.map((circle) => circle.id), page.page);

    expect(overlays.selection).toContain('fill="none"');
    expect(overlays.selection).toContain('fill-rule="evenodd"');
    expect(overlays.fill).toBeUndefined();
  });
});

describe("selection profile preview wiring", () => {
  it("derives and renders only an explicitly selected closed scope", () => {
    const project = createProject(withElements(createDocument("profile-preview", [{ id: layerId("layer-1"), name: "Layer", visible: true, order: 0 }]), square()));
    const page = projectPage(project);
    const pieceId = project.pieces[0]!.id;
    const preview = profilePreviewForSelection(project, page, pieceId, square().map((element) => element.id), page.page);

    expect(preview).toContain('data-profile="true"');
    expect(preview).toContain(`width="${page.page.width}" height="${page.page.height}" viewBox="0 0 ${page.page.width} ${page.page.height}"`);
    expect(preview).toContain('M0 0 L10 0');
    expect(profilePreviewForSelection(project, page, pieceId, [])).toBeUndefined();
  });
});
