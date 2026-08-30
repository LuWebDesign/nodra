import { describe, expect, it } from "vitest";
import { createDocument, layerId } from "@nodra/domain";
import { migrateDocument, parseDocument, serializeDocument, validateDocument, validateProject } from "./index.js";

describe("native document validation", () => {
  it("validates ordered open cubic path topology", () => {
    const document = createDocument("doc-1", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]);
    const path = { type: "path", id: "bezier", layerId: "layer-1", nodes: [{ id: "a", anchor: { x: 0, y: 0 }, join: "corner" }, { id: "b", anchor: { x: 10, y: 0 }, join: "corner" }], segments: [{ type: "cubicBezier", startNodeId: "a", endNodeId: "b", control1: { x: 2, y: 5 }, control2: { x: 8, y: -5 } }], closed: false, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    expect(validateDocument({ ...document, elements: [path] }).success).toBe(true);
    expect(validateDocument({ ...document, elements: [{ ...path, segments: [] }] }).success).toBe(false);
  });
  it("round-trips valid records", () => {
    const document = createDocument("doc-1", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]);
    const result = parseDocument(serializeDocument(document));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(document);
  });
  it("rejects unknown versions, invalid dimensions, and unknown layer references", () => {
    const result = validateDocument({ schemaVersion: 99, id: "doc", revision: 0, origin: "top-left", units: "mm", layers: [], elements: [{ type: "rectangle", id: "r", layerId: "missing", position: { x: 0, y: 0 }, size: { width: 0, height: 2 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } }] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Invalid input");
  });
  it("rejects malformed JSON safely", () => expect(parseDocument("{").success).toBe(false));
  it("migrates schema version 1 documents with the default page", () => {
    const oldDocument = { ...createDocument("doc-1", []), schemaVersion: 1 };
    const result = validateDocument(oldDocument);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.page).toEqual({ width: 1200, height: 900 });
    expect(migrateDocument(oldDocument)).toMatchObject({ schemaVersion: 5, page: { width: 1200, height: 900 }, connections: [] });
  });
  it("migrates legacy sketches with no constraints without changing their geometry", () => {
        const legacy = { ...createDocument("legacy-sketch", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]), schemaVersion: 4 as const, elements: [{ type: "sketch" as const, id: "sketch", layerId: "layer-1", nodes: [{ id: "a", point: { x: 1, y: 2 } }, { id: "b", point: { x: 8, y: 2 } }], edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }], style: { stroke: "#000", strokeWidth: 1 } }] };
        const result = validateDocument(legacy);
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.elements[0]).toMatchObject({ type: "sketch", nodes: legacy.elements[0]!.nodes, constraints: [] });
      });
      it("validates a project with stable page ids, including duplicate sizes", () => {
    const document = createDocument("doc-1", []);
    const project = { ...({ schemaVersion: 5, id: document.id, revision: document.revision, origin: document.origin, units: document.units } as const), pages: [{ id: "page-a", page: document.page, layers: [], elements: [] }, { id: "page-b", page: document.page, layers: [], elements: [] }], activePageId: "page-b" };
    expect(validateProject(project).success).toBe(true);
  });
  it("validates annotation dimensions and rejects broken references", () => {
    const base = createDocument("doc-1", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]);
    const line = { type: "line", id: "line", layerId: "layer-1", start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const dimension = { type: "dimension", id: "dimension", layerId: "layer-1", kind: "aligned", references: [{ elementId: "line", nodeIndex: 0 }, { elementId: "line", nodeIndex: 2 }], offset: { x: 0, y: -8 }, precision: 2, units: "mm", rotation: 0, style: { stroke: "#2563eb", strokeWidth: 0.45 } };
    expect(validateDocument({ ...base, elements: [line, dimension] }).success).toBe(true);
    expect(validateDocument({ ...base, elements: [dimension] }).success).toBe(false);
  });
  it("normalizes legacy node references and validates connected angular lines", () => {
    const base = createDocument("angular-doc", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]);
    const first = { type: "line" as const, id: "first", layerId: "layer-1", start: { x: 20, y: 20 }, end: { x: 60, y: 20 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const second = { type: "line" as const, id: "second", layerId: "layer-1", start: { x: 20, y: 20 }, end: { x: 20, y: 60 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const angular = { type: "dimension", id: "angular", layerId: "layer-1", kind: "angular", references: [{ kind: "line", elementId: "first" }, { kind: "line", elementId: "second" }], offset: { x: 10, y: 10 }, precision: 2, units: "mm", rotation: 0, style: { stroke: "#2563eb", strokeWidth: 0.45 } };
    const checked = validateDocument({ ...base, elements: [first, second, angular] });
    expect(checked.success).toBe(true);
    const legacy = validateDocument({ ...base, elements: [first, { type: "dimension", id: "legacy", layerId: "layer-1", kind: "horizontal", references: [{ elementId: "first", nodeIndex: 0 }, { elementId: "first", nodeIndex: 2 }], offset: { x: 0, y: -8 }, precision: 2, units: "mm", rotation: 0, style: { stroke: "#2563eb", strokeWidth: 0.45 } }] });
    expect(legacy.success).toBe(true);
    if (legacy.success) expect(legacy.data.elements[1]).toMatchObject({ references: [{ kind: "node" }, { kind: "node" }] });
    expect(validateDocument({ ...base, elements: [first, { ...angular, references: [{ kind: "line", elementId: "first" }, { kind: "line", elementId: "missing" }] } as typeof angular] }).success).toBe(false);
  });
  it("validates angular references to connected sketch edges", () => {
    const base = createDocument("sketch-angular-doc", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]);
    const first = { type: "sketch" as const, id: "first-sketch", layerId: "layer-1", nodes: [{ id: "a", point: { x: 20, y: 20 } }, { id: "b", point: { x: 60, y: 20 } }], edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }], style: { stroke: "#000", strokeWidth: 1 } };
    const second = { type: "sketch" as const, id: "second-sketch", layerId: "layer-1", nodes: [{ id: "c", point: { x: 20, y: 20 } }, { id: "d", point: { x: 20, y: 60 } }], edges: [{ id: "cd", startNodeId: "c", endNodeId: "d" }], style: { stroke: "#000", strokeWidth: 1 } };
    const angular = { type: "dimension" as const, id: "sketch-angular", layerId: "layer-1", kind: "angular" as const, references: [{ kind: "line" as const, elementId: first.id, edgeIndex: 0 }, { kind: "line" as const, elementId: second.id, edgeIndex: 0 }] as const, offset: { x: 10, y: 10 }, precision: 2, units: "mm" as const, rotation: 0 as const, style: { stroke: "#2563eb", strokeWidth: 0.45 } };
    expect(validateDocument({ ...base, elements: [first, second, angular] }).success).toBe(true);
  });
  it("rejects non-finite and non-positive page dimensions", () => {
    const result = validateDocument({ ...createDocument("doc-1"), page: { width: 0, height: Number.NaN } });
    expect(result.success).toBe(false);
  });
  it("round-trips explicit connections and rejects dangling or self connections", () => {
    const base = createDocument("connections", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]);
    const first = { type: "rectangle" as const, id: "first", layerId: "layer-1", position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const second = { ...first, id: "second", position: { x: 10, y: 0 } };
    const connection = { id: "join", first: { elementId: "first", node: { kind: "named" as const, name: "e" as const } }, second: { elementId: "second", node: { kind: "named" as const, name: "w" as const } } };
    const valid = validateDocument({ ...base, elements: [first, second], connections: [connection] });
    expect(valid.success).toBe(true);
    if (valid.success) expect(parseDocument(serializeDocument(valid.data)).success).toBe(true);
    expect(validateDocument({ ...base, elements: [first], connections: [connection] }).success).toBe(false);
    expect(validateDocument({ ...base, elements: [first, second], connections: [{ ...connection, second: connection.first }] }).success).toBe(false);
  });
  it("rejects path and spline connection handles that are not present on the referenced node", () => {
    const base = createDocument("handles", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]);
    const path = { type: "path" as const, id: "path", layerId: "layer-1", nodes: [{ id: "a", anchor: { x: 0, y: 0 }, join: "smooth" as const }, { id: "b", anchor: { x: 10, y: 0 }, join: "smooth" as const }], segments: [{ type: "cubicBezier" as const, startNodeId: "a", endNodeId: "b", control1: { x: 3, y: 0 }, control2: { x: 7, y: 0 } }], closed: false, style: { stroke: "#000", strokeWidth: 1 } };
    const spline = { type: "spline" as const, id: "spline", layerId: "layer-1", nodes: [{ id: "a", anchor: { x: 20, y: 0 }, continuity: "smooth" as const, outHandle: { dx: 3, dy: 0 } }, { id: "b", anchor: { x: 30, y: 0 }, continuity: "smooth" as const, inHandle: { dx: -3, dy: 0 } }], closed: false, style: { stroke: "#000", strokeWidth: 1 } };
    const other = { type: "rectangle" as const, id: "other", layerId: "layer-1", position: { x: 40, y: 0 }, size: { width: 10, height: 10 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const connection = (first: { elementId: string; node: { kind: "path" | "spline"; nodeId: string; handle?: "in" | "out" } }) => ({ id: `${first.elementId}-${first.node.nodeId}-${first.node.handle ?? "anchor"}`, first, second: { elementId: "other", node: { kind: "named" as const, name: "w" as const } } });
    expect(validateDocument({ ...base, elements: [path, other], connections: [connection({ elementId: "path", node: { kind: "path", nodeId: "a", handle: "in" } })] }).success).toBe(false);
    expect(validateDocument({ ...base, elements: [path, other], connections: [connection({ elementId: "path", node: { kind: "path", nodeId: "b", handle: "out" } })] }).success).toBe(false);
    expect(validateDocument({ ...base, elements: [spline, other], connections: [connection({ elementId: "spline", node: { kind: "spline", nodeId: "a", handle: "in" } })] }).success).toBe(false);
    expect(validateDocument({ ...base, elements: [spline, other], connections: [connection({ elementId: "spline", node: { kind: "spline", nodeId: "b", handle: "out" } })] }).success).toBe(false);
    expect(validateDocument({ ...base, elements: [path, spline, other], connections: [connection({ elementId: "path", node: { kind: "path", nodeId: "a", handle: "out" } }), connection({ elementId: "spline", node: { kind: "spline", nodeId: "b", handle: "in" } })] }).success).toBe(true);
    expect(validateDocument({ ...base, elements: [path, spline, other], connections: [connection({ elementId: "path", node: { kind: "path", nodeId: "a" } }), connection({ elementId: "spline", node: { kind: "spline", nodeId: "a" } })] }).success).toBe(true);
  });
  it("defaults legacy rectangle radii and rejects negative radii", () => {
    const legacy = { ...createDocument("doc-1", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]), elements: [{ type: "rectangle", id: "r", layerId: "layer-1", position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } }] };
    const defaulted = validateDocument(legacy);
    expect(defaulted.success).toBe(true);
    if (defaulted.success) expect(defaulted.data.elements[0]).toMatchObject({ cornerRadius: 0 });
    expect(validateDocument({ ...legacy, elements: [{ ...legacy.elements[0], cornerRadius: -1 }] }).success).toBe(false);
  });
  it("accepts closed contour paths and rejects open rings", () => {
    const base = createDocument("doc-1", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]);
    const contour = { type: "contour", id: "path", layerId: "layer-1", position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, contours: [{ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 0 }] }], fillRule: "evenodd", rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    expect(validateDocument({ ...base, elements: [contour] }).success).toBe(true);
    expect(validateDocument({ ...base, elements: [{ ...contour, contours: [{ points: contour.contours[0]!.points.slice(0, 3) }] }] }).success).toBe(false);
  });
});
