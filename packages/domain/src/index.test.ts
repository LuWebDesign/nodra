import { describe, expect, it } from "vitest";
import { createDocument, createProject, documentFromProject, elementId, hasBounds, hasRotation, layerId, pageId, projectFromDocument, revision, withElements } from "./index.js";

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
  it("accepts spline elements as native document elements", () => {
    const layer = { id: layerId("design"), name: "Design", visible: true, order: 0 } as const;
    const spline = { type: "spline" as const, id: elementId("spline-1"), layerId: layer.id, nodes: [{ id: "a", anchor: { x: 0, y: 0 }, continuity: "smooth" as const }, { id: "b", anchor: { x: 10, y: 0 }, continuity: "smooth" as const }], closed: false, style: { stroke: "#000", strokeWidth: 0.2 } };
    expect(withElements(createDocument("doc-1", [layer]), [spline]).elements).toEqual([spline]);
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
