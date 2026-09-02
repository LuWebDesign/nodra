import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, createDocument, layerId } from "@nodra/domain";
import { migrateDocument, parseDocument, serializeDocument, validateDocument, validateProject } from "./index.js";

describe("native document validation", () => {
  it("validates ordered open cubic path topology", () => {
    const document = createDocument("doc-1", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]);
    const path = { type: "path", id: "bezier", layerId: "layer-1", nodes: [{ id: "a", anchor: { x: 0, y: 0 }, join: "corner" }, { id: "b", anchor: { x: 10, y: 0 }, join: "corner" }], segments: [{ id: "fixture-segment-1", type: "cubicBezier", startNodeId: "a", endNodeId: "b", control1: { x: 2, y: 5 }, control2: { x: 8, y: -5 } }], closed: false, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
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
    expect(migrateDocument(oldDocument)).toMatchObject({ schemaVersion: CURRENT_SCHEMA_VERSION, page: { width: 1200, height: 900 }, connections: [] });
  });
  it("migrates schema 6 path and glyph segments to deterministic stable IDs", () => {
    const base = createDocument("legacy-segments", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]);
    const path = { type: "path", id: "path", layerId: "layer-1", nodes: [{ id: "a", anchor: { x: 0, y: 0 }, join: "corner" }, { id: "b", anchor: { x: 10, y: 0 }, join: "corner" }, { id: "c", anchor: { x: 20, y: 0 }, join: "corner" }], segments: [{ id: "kept-segment", type: "line", startNodeId: "a", endNodeId: "b" }, { type: "line", startNodeId: "b", endNodeId: "c" }], closed: false, style: { stroke: "#000", strokeWidth: 1 } };
    const glyph = { type: "glyph", id: "glyph", layerId: "layer-1", position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, glyph: "A", contours: [{ nodes: [{ id: "ga", anchor: { x: 0, y: 0 }, join: "corner" }, { id: "gb", anchor: { x: 10, y: 0 }, join: "corner" }], segments: [{ type: "line", startNodeId: "ga", endNodeId: "gb" }, { type: "line", startNodeId: "gb", endNodeId: "ga" }] }], fillRule: "evenodd", rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const legacy = { ...base, schemaVersion: 6, elements: [path, glyph] };

    const first = validateDocument(legacy); const second = validateDocument(legacy);
    expect(first.success).toBe(true); expect(second.success).toBe(true);
    if (first.success && second.success) {
      expect(first.data).toEqual(second.data);
      expect(first.data.elements[0]).toMatchObject({ segments: [{ id: "kept-segment" }, { id: "path:segment:1" }] });
      expect(first.data.elements[1]).toMatchObject({ contours: [{ segments: [{ id: "glyph:contour:0:segment:0" }, { id: "glyph:contour:0:segment:1" }] }] });
    }
    const project = validateProject({ schemaVersion: 6, id: base.id, revision: 0, origin: "top-left", units: "mm", preferences: { lineGuidesEnabled: true, lineGuideAngle: 45 }, pages: [{ id: "page-1", page: base.page, layers: base.layers, elements: [path], connections: [] }], activePageId: "page-1" });
    expect(project.success).toBe(true);
    if (project.success) expect(project.data.pages[0]?.elements[0]).toMatchObject({ segments: [{ id: "kept-segment" }, { id: "path:segment:1" }] });
  });
  it("rejects duplicate path segment IDs in current documents", () => {
    const base = createDocument("duplicate-segments", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]);
    const path = { type: "path", id: "path", layerId: "layer-1", nodes: [{ id: "a", anchor: { x: 0, y: 0 }, join: "corner" }, { id: "b", anchor: { x: 10, y: 0 }, join: "corner" }, { id: "c", anchor: { x: 20, y: 0 }, join: "corner" }], segments: [{ id: "same", type: "line", startNodeId: "a", endNodeId: "b" }, { id: "same", type: "line", startNodeId: "b", endNodeId: "c" }], closed: false, style: { stroke: "#000", strokeWidth: 1 } };
    expect(validateDocument({ ...base, elements: [path] }).success).toBe(false);
    expect(validateDocument({ ...base, elements: [{ ...path, segments: [{ type: "line", startNodeId: "a", endNodeId: "b" }, { id: "bc", type: "line", startNodeId: "b", endNodeId: "c" }] }] }).success).toBe(false);
  });
  it("rejects ambiguous element, layer, and page identities", () => {
    const base = createDocument("identity", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]);
    const rectangle = { type: "rectangle", id: "same", layerId: "layer-1", position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    expect(validateDocument({ ...base, elements: [rectangle, { ...rectangle, position: { x: 20, y: 0 } }] }).success).toBe(false);
    expect(validateDocument({ ...base, layers: [...base.layers, { ...base.layers[0] }] }).success).toBe(false);
    const page = { id: "page-1", page: base.page, layers: base.layers, elements: [rectangle], connections: [] };
    const projectBase = { schemaVersion: CURRENT_SCHEMA_VERSION, id: base.id, revision: 0, origin: "top-left", units: "mm", preferences: { lineGuidesEnabled: true, lineGuideAngle: 45 }, pages: [page], activePageId: "page-1" };
    expect(validateProject({ ...projectBase, pages: [page, { ...page }] }).success).toBe(false);
    expect(validateProject({ ...projectBase, pages: [{ ...page, layers: [{ id: "other", name: "Other", visible: true, order: 0 }] }] }).success).toBe(false);
  });
  it("migrates legacy sketches with no constraints without changing their geometry", () => {
        const legacy = { ...createDocument("legacy-sketch", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]), schemaVersion: 4 as const, elements: [{ type: "sketch" as const, id: "sketch", layerId: "layer-1", nodes: [{ id: "a", point: { x: 1, y: 2 } }, { id: "b", point: { x: 8, y: 2 } }], edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }], style: { stroke: "#000", strokeWidth: 1 } }] };
        const result = validateDocument(legacy);
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.elements[0]).toMatchObject({ type: "sketch", nodes: legacy.elements[0]!.nodes, constraints: [] });
      });
      it("accepts explicit radius and diameter dimensions on circle nodes", () => {
        const base = createDocument("radius-doc", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]);
        const ellipse = { type: "ellipse" as const, id: "circle", layerId: "layer-1", position: { x: 10, y: 10 }, size: { width: 20, height: 20 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 }, circleConstraints: [{ id: "cx", kind: "center-horizontal" as const, value: 0 }, { id: "cy", kind: "center-vertical" as const, value: -5 }] };
        const reference = [{ kind: "node" as const, elementId: "circle", nodeIndex: 0, nodeId: "center" }, { kind: "node" as const, elementId: "circle", nodeIndex: 2, nodeId: "e" }] as const;
        const radius = { type: "dimension" as const, id: "radius", layerId: "layer-1", kind: "radius" as const, references: reference, offset: { x: 8, y: 0 }, precision: 2, units: "mm" as const, rotation: 0 as const, style: { stroke: "#2563eb", strokeWidth: 0.45 } };
        const diameter = { ...radius, id: "diameter", kind: "diameter" as const };
        expect(validateDocument({ ...base, elements: [ellipse, radius] }).success).toBe(true);
        expect(validateDocument({ ...base, elements: [ellipse, diameter] }).success).toBe(true);
      });

      it("rejects invalid circular constraints and non-circular diameter targets", () => {
        const base = createDocument("circle-invalid", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]);
        const ellipse = { type: "ellipse" as const, id: "ellipse", layerId: "layer-1", position: { x: 0, y: 0 }, size: { width: 20, height: 10 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 }, circleConstraints: [{ id: "radius", kind: "radius" as const, value: 5 }] };
        const diameter = { type: "dimension" as const, id: "diameter", layerId: "layer-1", kind: "diameter" as const, references: [{ kind: "node" as const, elementId: "ellipse", nodeIndex: 0, nodeId: "center" }, { kind: "node" as const, elementId: "ellipse", nodeIndex: 1, nodeId: "n" }] as const, offset: { x: 0, y: -8 }, precision: 2, units: "mm" as const, rotation: 0 as const, style: { stroke: "#2563eb", strokeWidth: 0.45 } };
        expect(validateDocument({ ...base, elements: [ellipse] }).success).toBe(false);
        expect(validateDocument({ ...base, elements: [{ ...ellipse, size: { width: 20, height: 20 }, circleConstraints: [{ id: "center", kind: "center-horizontal" as const }] }] }).success).toBe(false);
        expect(validateDocument({ ...base, elements: [ellipse, diameter] }).success).toBe(false);
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
  it("accepts explicit radius dimensions on circle nodes", () => {
    const base = createDocument("radius-doc", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]);
    const ellipse = { type: "ellipse" as const, id: "circle", layerId: "layer-1", position: { x: 10, y: 10 }, size: { width: 20, height: 20 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 }, circleConstraints: [{ id: "cx", kind: "center-horizontal" as const, value: 0 }, { id: "cy", kind: "center-vertical" as const, value: -5 }] };
    const radius = { type: "dimension" as const, id: "radius", layerId: "layer-1", kind: "radius" as const, references: [{ kind: "node" as const, elementId: "circle", nodeIndex: 0, nodeId: "center" }, { kind: "node" as const, elementId: "circle", nodeIndex: 2, nodeId: "e" }] as const, offset: { x: 8, y: 0 }, precision: 2, units: "mm" as const, rotation: 0 as const, style: { stroke: "#2563eb", strokeWidth: 0.45 } };
    expect(validateDocument({ ...base, elements: [ellipse, radius] }).success).toBe(true);
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
    expect(validateDocument({ ...base, elements: [first, { ...angular, references: [{ kind: "line", elementId: "first" }, { kind: "line", elementId: "first" }] } as typeof angular] }).success).toBe(true);
  });
  it("migrates legacy sketch edge indexes to stable edge IDs", () => {
    const base = createDocument("stable-sketch-edge", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]);
    const sketch = { type: "sketch" as const, id: "sketch", layerId: "layer-1", nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 20, y: 0 } }], edges: [{ id: "edge-ab", startNodeId: "a", endNodeId: "b" }], constraints: [], style: { stroke: "#000", strokeWidth: 1 } };
    const dimension = { type: "dimension" as const, id: "angle", layerId: "layer-1", kind: "angular" as const, references: [{ kind: "line" as const, elementId: "sketch", edgeIndex: 0 }, { kind: "line" as const, elementId: "sketch", edgeIndex: 0 }] as const, offset: { x: 10, y: 10 }, precision: 2, units: "mm" as const, rotation: 0 as const, style: { stroke: "#2563eb", strokeWidth: 0.45 } };
    const result = validateDocument({ ...base, schemaVersion: 5, elements: [sketch, dimension] });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.elements[1]).toMatchObject({ references: [{ edgeId: "edge-ab", edgeIndex: 0 }, { edgeId: "edge-ab", edgeIndex: 0 }] });
  });
  it("uses stable node IDs as the source of truth and repairs legacy indexes", () => {
    const base = createDocument("stable-node-index", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]);
    const path = { type: "path" as const, id: "path", layerId: "layer-1", nodes: [{ id: "a", anchor: { x: 0, y: 0 }, join: "corner" as const }, { id: "b", anchor: { x: 10, y: 0 }, join: "corner" as const }], segments: [{ id: "ab", type: "line" as const, startNodeId: "a", endNodeId: "b" }], closed: false, style: { stroke: "#000", strokeWidth: 1 } };
    const dimension = { type: "dimension" as const, id: "dimension", layerId: "layer-1", kind: "horizontal" as const, references: [{ kind: "node" as const, elementId: "path", nodeIndex: 0, nodeId: "a" }, { kind: "node" as const, elementId: "path", nodeIndex: 0, nodeId: "b" }] as const, offset: { x: 0, y: -5 }, precision: 2, units: "mm" as const, rotation: 0 as const, style: { stroke: "#2563eb", strokeWidth: 0.45 } };
    expect(validateDocument({ ...base, elements: [path, dimension] }).success).toBe(true);
    const migrated = validateDocument({ ...base, schemaVersion: 6, elements: [path, dimension] });
    expect(migrated.success).toBe(true);
    if (migrated.success) expect(migrated.data.elements[1]).toMatchObject({ references: [{ nodeId: "a", nodeIndex: 0 }, { nodeId: "b", nodeIndex: 1 }] });
  });
  it("rejects named connection addresses unsupported by an ellipse", () => {
    const base = createDocument("ellipse-connections", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]);
    const ellipse = { type: "ellipse" as const, id: "ellipse", layerId: "layer-1", position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const rectangle = { type: "rectangle" as const, id: "rectangle", layerId: "layer-1", position: { x: 20, y: 0 }, size: { width: 10, height: 10 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const connection = { id: "invalid", first: { elementId: "ellipse", node: { kind: "named" as const, name: "nw" as const } }, second: { elementId: "rectangle", node: { kind: "named" as const, name: "w" as const } } };
    expect(validateDocument({ ...base, elements: [ellipse, rectangle], connections: [connection] }).success).toBe(false);
  });
  it("validates angular references to connected sketch edges", () => {
    const base = createDocument("sketch-angular-doc", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]);
    const first = { type: "sketch" as const, id: "first-sketch", layerId: "layer-1", nodes: [{ id: "a", point: { x: 20, y: 20 } }, { id: "b", point: { x: 60, y: 20 } }], edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }], style: { stroke: "#000", strokeWidth: 1 } };
    const second = { type: "sketch" as const, id: "second-sketch", layerId: "layer-1", nodes: [{ id: "c", point: { x: 20, y: 20 } }, { id: "d", point: { x: 20, y: 60 } }], edges: [{ id: "cd", startNodeId: "c", endNodeId: "d" }], style: { stroke: "#000", strokeWidth: 1 } };
    const angular = { type: "dimension" as const, id: "sketch-angular", layerId: "layer-1", kind: "angular" as const, references: [{ kind: "line" as const, elementId: first.id, edgeIndex: 0 }, { kind: "line" as const, elementId: second.id, edgeIndex: 0 }] as const, offset: { x: 10, y: 10 }, precision: 2, units: "mm" as const, rotation: 0 as const, style: { stroke: "#2563eb", strokeWidth: 0.45 } };
    expect(validateDocument({ ...base, elements: [first, second, angular] }).success).toBe(true);
    expect(validateDocument({ ...base, elements: [first, second, { ...angular, references: [{ kind: "line", elementId: first.id, edgeId: "missing", edgeIndex: 0 }, angular.references[1]] }] }).success).toBe(false);
  });
  it("rejects duplicate and dangling sketch constraints", () => {
        const base = createDocument("constraint-validation", [{ id: layerId("layer-1"), name: "Design", visible: true, order: 0 }]);
        const sketch = { type: "sketch" as const, id: "sketch", layerId: "layer-1", nodes: [{ id: "a", point: { x: 0, y: 0 } }, { id: "b", point: { x: 10, y: 0 } }], edges: [{ id: "ab", startNodeId: "a", endNodeId: "b" }], constraints: [{ id: "same", kind: "horizontal" as const, references: [{ elementId: "sketch", nodeId: "a" }, { elementId: "sketch", nodeId: "b" }] as const }, { id: "same", kind: "vertical" as const, references: [{ elementId: "sketch", nodeId: "a" }, { elementId: "sketch", nodeId: "b" }] as const }] , style: { stroke: "#000", strokeWidth: 1 } };
        expect(validateDocument({ ...base, elements: [sketch] }).success).toBe(false);
        expect(validateDocument({ ...base, elements: [{ ...sketch, constraints: [{ ...sketch.constraints[0], references: [{ elementId: "sketch", nodeId: "missing" }, { elementId: "sketch", nodeId: "b" }] }] }] }).success).toBe(false);
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
    const path = { type: "path" as const, id: "path", layerId: "layer-1", nodes: [{ id: "a", anchor: { x: 0, y: 0 }, join: "smooth" as const }, { id: "b", anchor: { x: 10, y: 0 }, join: "smooth" as const }], segments: [{ id: "fixture-segment-2", type: "cubicBezier" as const, startNodeId: "a", endNodeId: "b", control1: { x: 3, y: 0 }, control2: { x: 7, y: 0 } }], closed: false, style: { stroke: "#000", strokeWidth: 1 } };
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
