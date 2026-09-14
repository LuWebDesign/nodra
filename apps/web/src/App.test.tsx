import { describe, expect, it } from "vitest";
import { createDocument, createProject, elementId, layerId, projectFromDocument, projectPage, withElements, type SketchElement } from "@nodra/domain";
import { createEditor, redo, undo } from "@nodra/editor-core";
import { sketchProfileResult } from "@nodra/geometry";
import { commitLineSketchPoint, profileOverlaysForPiece, profilePreviewForSelection } from "./App.js";

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

describe("Line Tool sketch consolidation wiring", () => {
  const style = { stroke: "#000", strokeWidth: 1.5 };

  it("consolidates a committed endpoint against another sketch and preserves selection, ownership, undo, and redo", () => {
    const layer = { id: layerId("layer-1"), name: "Layer", visible: true, order: 0 };
    const target: SketchElement = {
      type: "sketch",
      id: elementId("a-target-sketch"),
      layerId: layer.id,
      nodes: [
        { id: "target-start", point: { x: 0, y: 0 } },
        { id: "target-corner", point: { x: 10, y: 0 } },
        { id: "target-end", point: { x: 10, y: 10 } },
      ],
      edges: [
        { id: "target-top", startNodeId: "target-start", endNodeId: "target-corner" },
        { id: "target-right", startNodeId: "target-corner", endNodeId: "target-end" },
      ],
      style,
    };
    const draft: SketchElement = {
      type: "sketch",
      id: elementId("z-draft-sketch"),
      layerId: layer.id,
      nodes: [
        { id: "draft-start", point: { x: 0, y: 0 } },
        { id: "draft-corner", point: { x: 0, y: 10 } },
      ],
      edges: [{ id: "draft-left", startNodeId: "draft-start", endNodeId: "draft-corner" }],
      style,
    };
    const document = { ...createDocument("line-consolidation", [layer]), elements: [target, draft] };
    const project = createProject(document);
    const pieceId = project.pieces[0]!.id;
    const ownedDocument = {
      ...document,
      elements: document.elements.map((element) => ({ ...element, pieceId })),
    };
    const initial = createEditor(ownedDocument);

    const committed = commitLineSketchPoint(initial, {
      elementId: draft.id,
      currentNodeId: "draft-corner",
      point: target.nodes[2]!.point,
      snappedSketchNode: { elementId: target.id, nodeId: "target-end" },
    });
    const sketches = committed.editor.document.elements.filter((element): element is SketchElement => element.type === "sketch");
    const syncedProject = projectFromDocument(project, committed.editor.document);

    expect(committed.consolidated).toBe(true);
    expect(committed.elementId).toBe(target.id);
    expect(committed.currentNodeId).toBe("target-end");
    expect(sketches).toHaveLength(1);
    expect(sketches[0]?.id).toBe(target.id);
    expect(sketches[0]).toMatchObject({ pieceId });
    expect(sketchProfileResult(sketches[0]!).status).toBe("valid-closed");
    expect(committed.editor.selection).toEqual([target.id]);
    expect(syncedProject.activePieceId).toBe(project.activePieceId);
    expect(syncedProject.pieces[0]?.sketches).toEqual([{ pageId: project.activePageId, sketchId: target.id }]);

    const geometricallyCommitted = commitLineSketchPoint(createEditor(ownedDocument), {
      elementId: draft.id,
      currentNodeId: "draft-corner",
      point: target.nodes[2]!.point,
    });
    expect(geometricallyCommitted.consolidated).toBe(true);
    expect(geometricallyCommitted.elementId).toBe(target.id);
    expect(geometricallyCommitted.editor.document.elements.filter((element) => element.type === "sketch")).toHaveLength(1);

    const unconsolidated = undo(committed.editor);
    expect(unconsolidated.document.elements.filter((element) => element.type === "sketch")).toHaveLength(2);
    expect(redo(unconsolidated).document).toEqual(committed.editor.document);
  });

  it("keeps appending inside one draft sketch without running consolidation", () => {
    const layer = { id: layerId("single-layer"), name: "Layer", visible: true, order: 0 };
    const draft: SketchElement = {
      type: "sketch",
      id: elementId("single-draft"),
      layerId: layer.id,
      nodes: [{ id: "start", point: { x: 0, y: 0 } }, { id: "middle", point: { x: 10, y: 0 } }, { id: "current", point: { x: 10, y: 10 } }],
      edges: [{ id: "first", startNodeId: "start", endNodeId: "middle" }, { id: "second", startNodeId: "middle", endNodeId: "current" }],
      style,
    };
    const initial = createEditor({ ...createDocument("single-draft", [layer]), elements: [draft] });

    const committed = commitLineSketchPoint(initial, {
      elementId: draft.id,
      currentNodeId: "current",
      point: { x: 0, y: 0 },
      snappedSketchNode: { elementId: draft.id, nodeId: "start" },
    });

    expect(committed.consolidated).toBe(false);
    expect(committed.editor.document.elements).toHaveLength(1);
    expect(committed.editor.undo).toHaveLength(1);
    expect(committed.editor.selection).toEqual([draft.id]);
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
