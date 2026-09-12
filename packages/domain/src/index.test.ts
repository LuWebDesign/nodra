import { describe, expect, it } from "vitest";
import { createDocument, createEmptyProject, createProject, defaultPieceId, documentFromProject, elementId, featureId, hasBounds, hasRotation, layerId, pageId, pieceId, projectFromDocument, revision, withElements } from "./index.js";

describe("domain contracts", () => {
  it("creates immutable-shaped versioned documents and increments revisions", () => {
    const layer = { id: layerId("design"), name: "Design", visible: true, order: 0 } as const;
    const document = createDocument("doc-1", [layer]);
    const element = { type: "line" as const, id: elementId("line-1"), layerId: layer.id, start: { x: 0, y: 0 }, end: { x: 10, y: 4 }, rotation: 0, style: { stroke: "#000", strokeWidth: 0.2 } };
    const next = withElements(document, [element]);
    expect(document.revision).toBe(revision(0));
    expect(next.revision).toBe(revision(1));
    expect(next.elements).toEqual([element]);
  });
  it("classifies bounded elements without assuming every element has position and size", () => {
    const layer = { id: layerId("design"), name: "Design", visible: true, order: 0 } as const;
    const ellipse = { type: "ellipse" as const, id: elementId("ellipse-1"), layerId: layer.id, position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, rotation: 0, style: { stroke: "#000", strokeWidth: 0.2 } };
    const line = { type: "line" as const, id: elementId("line-1"), layerId: layer.id, start: { x: 0, y: 0 }, end: { x: 10, y: 4 }, rotation: 0, style: { stroke: "#000", strokeWidth: 0.2 } };
    expect(hasBounds(ellipse)).toBe(true);
    expect(hasBounds(line)).toBe(false);
  });
  it("classifies rotation independently from bounding boxes", () => {
    const line = { type: "line" as const, id: elementId("line-rotation"), layerId: layerId("design"), start: { x: 0, y: 0 }, end: { x: 10, y: 4 }, rotation: 0, style: { stroke: "#000", strokeWidth: 0.2 } };
    expect(hasRotation(line)).toBe(true);
  });
  it("accepts canonical arc elements with stable center/start/end nodes", () => {
    const arc = { type: "arc" as const, id: elementId("arc-1"), layerId: layerId("design"), center: { x: 10, y: 10 }, radius: 5, startAngle: 0, endAngle: Math.PI, direction: "counterclockwise" as const, style: { stroke: "#000", strokeWidth: 0.2 } };
    expect(withElements(createDocument("doc-1", [{ id: layerId("design"), name: "Design", visible: true, order: 0 }]), [arc]).elements).toEqual([arc]);
  });
  it("accepts spline elements as native document elements", () => {
    const layer = { id: layerId("design"), name: "Design", visible: true, order: 0 } as const;
    const spline = { type: "spline" as const, id: elementId("spline-1"), layerId: layer.id, nodes: [{ id: "a", anchor: { x: 0, y: 0 }, continuity: "smooth" as const }, { id: "b", anchor: { x: 10, y: 0 }, continuity: "smooth" as const }], closed: false, style: { stroke: "#000", strokeWidth: 0.2 } };
    expect(withElements(createDocument("doc-1", [layer]), [spline]).elements).toEqual([spline]);
  });
  it("preserves page-scoped feature trees across document and project conversions", () => {
    const layer = { id: layerId("design"), name: "Design", visible: true, order: 0 } as const;
    const source = { type: "line" as const, id: elementId("source"), layerId: layer.id, start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style: { stroke: "#000", strokeWidth: 0.2 } };
    const output = { ...source, id: elementId("output"), start: { x: 0, y: 2 }, end: { x: 10, y: 2 } };
    const featureTree = { version: 1 as const, features: [{ id: featureId("feature-1"), operation: "outline" as const, sources: [{ elementId: source.id }], outputs: [{ elementId: output.id }], status: "up-to-date" as const }] };
    const document = { ...createDocument("feature-project", [layer]), elements: [source, output], featureTree };

    const project = createProject(document);
    expect(project.pages[0]?.featureTree).toEqual(featureTree);
    expect(documentFromProject(project).featureTree).toEqual(featureTree);
    expect(projectFromDocument(project, document).pages[0]?.featureTree).toEqual(featureTree);
    expect(projectFromDocument(project, { ...createDocument("feature-project", [layer]), elements: [source, output] }).pages[0]).not.toHaveProperty("featureTree");
    expect(createProject(createDocument("legacy-project")).pages[0]).not.toHaveProperty("featureTree");
  });

  it("creates an empty project with a page and no active piece", () => {
    const project = createEmptyProject(createDocument("empty-project"));
    expect(project.pieces).toEqual([]);
    expect(project.activePieceId).toBeUndefined();
    expect(documentFromProject(project).elements).toEqual([]);
    expect(projectFromDocument(project, createDocument("empty-project")).pieces).toEqual([]);
  });

  it("creates one deterministic persisted design piece and retains it across document bridges", () => {
    const source = createDocument("piece-project");
    const project = createProject(source);

    expect(project.pieces).toEqual([{ pageId: "page-1",
      id: defaultPieceId(source.id),
      name: "Pieza 1",
      process: "cut",
      state: "design",
      sketches: [],
    }]);
    expect(createProject(source).pieces[0]?.id).toBe(project.pieces[0]?.id);
    expect(projectFromDocument(project, documentFromProject(project)).pieces).toEqual(project.pieces);
  });

  it("prunes removed active-page sketch references without disturbing other pieces or pages", () => {
    const source = createDocument("piece-pruning");
    const firstSketch = { type: "sketch" as const, id: elementId("first"), layerId: layerId("design"), nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 1, y: 0 } }], edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }], style: { stroke: "#000", strokeWidth: 1 } };
    const secondSketch = { ...firstSketch, id: elementId("second") };
    const project = createProject(source);
    const withReferences = {
      ...project,
      pieces: [
        { ...project.pieces[0]!, state: "underdefined" as const, sketches: [{ pageId: pageId("page-1"), sketchId: firstSketch.id }] },
        { ...project.pieces[0]!, id: "piece-2" as never, name: "Pieza 2", state: "underdefined" as const, sketches: [{ pageId: pageId("page-2"), sketchId: secondSketch.id }] },
      ],
      pages: [
        { ...project.pages[0]!, elements: [firstSketch] },
        { ...project.pages[0]!, id: pageId("page-2"), elements: [secondSketch] },
      ],
    };

    const synced = projectFromDocument(withReferences, { ...source, elements: [], revision: revision(1) });

    expect(synced.pieces[0]).toMatchObject({ state: "design", sketches: [] });
    expect(synced.pieces[1]?.sketches).toEqual([{ pageId: pageId("page-2"), sketchId: secondSketch.id }]);
  });

  it("does not resurrect an unowned element deleted from the active piece document", () => {
        const source = createDocument("deleted-unowned");
        const deleted = { type: "line" as const, id: elementId("deleted"), layerId: layerId("design"), start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style: { stroke: "#000", strokeWidth: 0.2 } };
        const project = createProject({ ...source, elements: [deleted] });

        const synced = projectFromDocument(project, source);

        expect(synced.pages[0]?.elements).toEqual([]);
      });

      it("does not preserve page elements when there is no active piece", () => {
        const source = createDocument("deleted-without-piece");
        const deleted = { type: "line" as const, id: elementId("deleted"), layerId: layerId("design"), start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style: { stroke: "#000", strokeWidth: 0.2 } };
        const project = createEmptyProject({ ...source, elements: [deleted] });

        const synced = projectFromDocument(project, source);

        expect(synced.pages[0]?.elements).toEqual([]);
      });

      it("preserves elements explicitly owned by other pieces", () => {
        const source = createDocument("preserve-other-piece");
        const otherPieceElement = { type: "line" as const, id: elementId("other-piece-line"), layerId: layerId("design"), start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, pieceId: pieceId("piece-2"), style: { stroke: "#000", strokeWidth: 0.2 } };
        const project = createProject({ ...source, elements: [otherPieceElement] });
        const withOtherPiece = {
          ...project,
          pieces: [...project.pieces, { ...project.pieces[0]!, id: pieceId("piece-2"), name: "Pieza 2" }],
        };

        const synced = projectFromDocument(withOtherPiece, source);

        expect(synced.pages[0]?.elements).toEqual([otherPieceElement]);
      });

      it("clears positional coincidences when importing a document that omits them", () => {
    const layer = { id: layerId("design"), name: "Design", visible: true, order: 0 } as const;
    const source = createDocument("doc-1", [layer]);
    const project = createProject({ ...source, positionalCoincidences: [{ id: "old", first: { elementId: elementId("a"), node: { kind: "line", name: "start" } }, second: { elementId: elementId("b"), node: { kind: "line", name: "start" } } }] });
    const imported = projectFromDocument(project, source);
    expect(imported.pages[0]?.positionalCoincidences).toEqual([]);
  });

  it("switches active pages by stable id without using dimensions as identity", () => {
    const first = createDocument("doc-1");
    const project = createProject(first);
    const secondId = pageId("page-2");
    const next = projectFromDocument({ ...project, pages: [...project.pages, { ...project.pages[0]!, id: secondId, elements: [] }], activePageId: secondId }, { ...first, page: { width: 1200, height: 900 } });
    expect(documentFromProject(next).page).toEqual({ width: 1200, height: 900 });
    expect(next.pages.map((page) => page.id)).toEqual(["page-1", "page-2"]);
  });
});
