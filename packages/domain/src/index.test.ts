import { describe, expect, it } from "vitest";
import { createDocument, createProject, documentFromProject, elementId, layerId, pageId, projectFromDocument, revision, withElements } from "./index.js";

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
  it("switches active pages by stable id without using dimensions as identity", () => {
    const first = createDocument("doc-1");
    const project = createProject(first);
    const secondId = pageId("page-2");
    const next = projectFromDocument({ ...project, pages: [...project.pages, { ...project.pages[0]!, id: secondId, elements: [] }], activePageId: secondId }, { ...first, page: { width: 1200, height: 900 } });
    expect(documentFromProject(next).page).toEqual({ width: 1200, height: 900 });
    expect(next.pages.map((page) => page.id)).toEqual(["page-1", "page-2"]);
  });
  it("represents Bézier paths with ordered anchors and segment-owned controls", () => {
    const layer = layerId("design");
    const path = { type: "path" as const, id: elementId("path-1"), layerId: layer, nodes: [{ id: "a", anchor: { x: 0, y: 0 }, join: "corner" as const }, { id: "b", anchor: { x: 10, y: 0 }, join: "smooth" as const }], segments: [{ type: "cubicBezier" as const, control1: { x: 2, y: 5 }, control2: { x: 8, y: 5 } }], closed: false, style: { stroke: "#000", strokeWidth: 1 } };
    expect(withElements(createDocument("path-doc", [{ id: layer, name: "Design", visible: true, order: 0 }]), [path]).elements[0]).toEqual(path);
  });
});
