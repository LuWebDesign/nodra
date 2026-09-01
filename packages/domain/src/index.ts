export const CURRENT_SCHEMA_VERSION = 7 as const;

export type SchemaVersion = typeof CURRENT_SCHEMA_VERSION;
export type DocumentId = string & { readonly __brand: "DocumentId" };
export type LayerId = string & { readonly __brand: "LayerId" };
export type ElementId = string & { readonly __brand: "ElementId" };
export type PageId = string & { readonly __brand: "PageId" };
export type Revision = number & { readonly __brand: "Revision" };

export interface PointMm { readonly x: number; readonly y: number }
export interface SizeMm { readonly width: number; readonly height: number }
export interface Transform {
  readonly position: PointMm;
  readonly rotation: number;
  readonly flipX?: boolean;
  readonly flipY?: boolean;
  readonly scale: PointMm;
}
export interface VisualStyle {
  readonly stroke: string;
  readonly fill?: string;
  readonly strokeWidth: number;
}
export type OperationClass = "cut" | "engrave" | "score";
export interface OperationMetadata {
  readonly operation: OperationClass;
  readonly order: number;
  readonly power?: number;
  readonly speed?: number;
}
export interface Layer {
  readonly id: LayerId;
  readonly name: string;
  readonly visible: boolean;
  readonly order: number;
}
export interface CornerRadii { readonly topLeft: number; readonly topRight: number; readonly bottomRight: number; readonly bottomLeft: number }
export interface RectangleElement {
  readonly type: "rectangle";
  readonly id: ElementId;
  readonly layerId: LayerId;
  readonly position: PointMm;
  readonly size: SizeMm;
  /** Legacy uniform radius in millimetres. */
  readonly cornerRadius: number;
  /** Optional independent radii, in clockwise order from the top-left corner. */
  readonly cornerRadii?: CornerRadii;
  readonly rotation: number;
  readonly flipX?: boolean;
  readonly flipY?: boolean;
  readonly style: VisualStyle;
  readonly operation?: OperationMetadata;
}
export type CircleConstraintKind = "center-horizontal" | "center-vertical" | "radius" | "diameter";
export interface CircleConstraint { readonly id: string; readonly kind: CircleConstraintKind; readonly value?: number; readonly driving?: boolean }
export interface EllipseElement {
  readonly type: "ellipse";
  readonly id: ElementId;
  readonly layerId: LayerId;
  readonly position: PointMm;
  readonly size: SizeMm;
  readonly rotation: number;
  readonly flipX?: boolean;
  readonly flipY?: boolean;
  readonly style: VisualStyle;
  readonly operation?: OperationMetadata;
  /** Optional parametric constraints; valid only for circular ellipses (equal width and height). */
  readonly circleConstraints?: readonly CircleConstraint[];
}
export interface LineElement {
  readonly type: "line";
  readonly id: ElementId;
  readonly layerId: LayerId;
  readonly start: PointMm;
  readonly end: PointMm;
  readonly rotation: number;
  readonly flipX?: boolean;
  readonly flipY?: boolean;
  readonly style: VisualStyle;
  readonly operation?: OperationMetadata;
}
export interface SketchNode { readonly id: string; readonly point: PointMm }
export interface SketchEdge { readonly id: string; readonly startNodeId: string; readonly endNodeId: string }
export type SketchConstraintKind = "horizontal" | "vertical" | "coincident" | "parallel" | "perpendicular" | "equal" | "distance-horizontal" | "distance-vertical" | "distance" | "angle" | "fixed";
export interface SketchPointReference { readonly elementId: ElementId; readonly nodeId: string }
export interface SketchConstraint { readonly id: string; readonly kind: SketchConstraintKind; readonly references: readonly [SketchPointReference, ...SketchPointReference[]]; readonly value?: number }
export interface SketchElement { readonly type: "sketch"; readonly id: ElementId; readonly layerId: LayerId; readonly nodes: readonly SketchNode[]; readonly edges: readonly SketchEdge[]; readonly constraints?: readonly SketchConstraint[]; readonly style: VisualStyle; readonly operation?: OperationMetadata }
export type DimensionKind = "aligned" | "horizontal" | "vertical" | "angular" | "radius" | "diameter";
export type DimensionReference =
  | { readonly kind: "node"; readonly elementId: ElementId; readonly nodeIndex: number; readonly nodeId?: string }
  | { readonly kind: "line"; readonly elementId: ElementId; readonly edgeId?: string; readonly edgeIndex?: number }
  /** Legacy node references are accepted at the boundary and normalized by validation. */
  | { readonly elementId: ElementId; readonly nodeIndex: number; readonly nodeId?: string };
export interface DimensionElement {
  readonly type: "dimension";
  readonly id: ElementId;
  readonly layerId: LayerId;
  readonly kind: DimensionKind;
  readonly references: readonly [DimensionReference, DimensionReference];
  readonly offset: PointMm;
  readonly precision: number;
  readonly units: "mm";
  readonly rotation: 0;
  readonly style: VisualStyle;
  /** Marks a dimension as driving only when paired with an explicit sketch constraint. */
  readonly driving?: boolean;
  readonly constraintId?: string;
}
export interface Contour {
  readonly points: readonly PointMm[];
}
export interface ContourElement {
  readonly type: "contour";
  readonly id: ElementId;
  readonly layerId: LayerId;
  readonly position: PointMm;
  readonly size: SizeMm;
  readonly contours: readonly Contour[];
  readonly fillRule: "evenodd";
  readonly rotation: number;
  readonly flipX?: boolean;
  readonly flipY?: boolean;
  readonly style: VisualStyle;
  readonly operation?: OperationMetadata;
}
export type PathJoin = "corner" | "smooth" | "symmetric";
export interface PathNode {
  readonly id: string;
  readonly anchor: PointMm;
  readonly join: PathJoin;
}
export interface PathLineSegment {
  readonly id: string;
  readonly type: "line";
  readonly startNodeId: string;
  readonly endNodeId: string;
}
export interface PathCubicSegment {
  readonly id: string;
  readonly type: "cubicBezier";
  readonly startNodeId: string;
  readonly endNodeId: string;
  readonly control1: PointMm;
  readonly control2: PointMm;
}
export type PathSegment = PathLineSegment | PathCubicSegment;
export interface PathElement {
  readonly type: "path";
  readonly id: ElementId;
  readonly layerId: LayerId;
  readonly nodes: readonly PathNode[];
  readonly segments: readonly PathSegment[];
  readonly closed: boolean;
  /** Legacy transform fields retained for annotation-dimensions records. */
  readonly rotation?: number;
  readonly flipX?: boolean;
  readonly flipY?: boolean;
  readonly style: VisualStyle;
  readonly operation?: OperationMetadata;
}
export type SplineContinuity = PathJoin;
export interface HandleOffset { readonly dx: number; readonly dy: number }
/** Shared document-space Bézier node primitive for future native editors. */
export interface BezierNode { readonly id: string; readonly anchor: PointMm; readonly inHandle?: HandleOffset; readonly outHandle?: HandleOffset }
export interface SplineNode extends BezierNode { readonly continuity: SplineContinuity }
export interface SplineElement { readonly type: "spline"; readonly id: ElementId; readonly layerId: LayerId; readonly nodes: readonly SplineNode[]; readonly closed: boolean; readonly style: VisualStyle; readonly operation?: OperationMetadata }
export interface TextElement { readonly type: "text"; readonly id: ElementId; readonly layerId: LayerId; readonly position: PointMm; readonly size: SizeMm; readonly text: string; readonly fontFamily: string; readonly fontSize: number; readonly fontWeight: "normal" | "bold"; readonly fontStyle: "normal" | "italic"; readonly textAlign: "left" | "center" | "right"; readonly lineHeight: number; readonly scaleX?: number; readonly scaleY?: number; readonly rotation: number; readonly style: VisualStyle; readonly operation?: OperationMetadata }
/** A single closed outline compound. Coordinates are document-space millimetres. */
export interface GlyphContour { readonly nodes: readonly PathNode[]; readonly segments: readonly PathSegment[] }
/** Editable outline for one laid-out font glyph; multiple contours preserve holes. */
export interface GlyphElement { readonly type: "glyph"; readonly id: ElementId; readonly layerId: LayerId; readonly position: PointMm; readonly size: SizeMm; readonly glyph: string; readonly contours: readonly GlyphContour[]; readonly fillRule: "evenodd"; readonly rotation: number; readonly flipX?: boolean; readonly flipY?: boolean; readonly style: VisualStyle; readonly operation?: OperationMetadata }
export type Element = RectangleElement | EllipseElement | LineElement | SketchElement | DimensionElement | ContourElement | PathElement | SplineElement | TextElement | GlyphElement;
export type ConnectableNodeAddress =
  | { readonly kind: "named"; readonly name: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "center" }
  | { readonly kind: "line"; readonly name: "start" | "end" | "center" }
  | { readonly kind: "path" | "spline" | "sketch"; readonly nodeId: string; readonly handle?: "in" | "out" };
export interface ConnectableNodeReference { readonly elementId: ElementId; readonly node: ConnectableNodeAddress }
export interface ExplicitConnection { readonly id: string; readonly first: ConnectableNodeReference; readonly second: ConnectableNodeReference }
export interface DocumentCapabilities { readonly spline?: 1 }
/** Elements that expose a document-space rotation, independent of their geometry representation. */
    export type RotatableElement = Extract<Element, { readonly rotation: number }>;
    export const hasRotation = (element: Element): element is RotatableElement => "rotation" in element && typeof element.rotation === "number";

    export const isLineElement = (element: Element): element is LineElement => element.type === "line";

/** Elements that expose an axis-aligned document-space bounding box. */
    export type BoundedElement = Extract<Element, { readonly position: PointMm; readonly size: SizeMm }>;
    export const hasBounds = (element: Element): element is BoundedElement => "position" in element && "size" in element;

    export interface DocumentSnapshot {
  readonly schemaVersion: SchemaVersion;
  readonly id: DocumentId;
  readonly revision: Revision;
  readonly origin: "top-left";
  readonly units: "mm";
  readonly capabilities?: DocumentCapabilities;
  readonly page: SizeMm;
  readonly layers: readonly Layer[];
  readonly elements: readonly Element[];
  readonly connections?: readonly ExplicitConnection[];
}

export interface PageSnapshot {
  readonly id: PageId;
  readonly page: SizeMm;
  readonly layers: readonly Layer[];
  readonly elements: readonly Element[];
  readonly connections?: readonly ExplicitConnection[];
}

export interface ProjectPreferences {
  readonly lineGuidesEnabled: boolean;
  readonly lineGuideAngle: 45;
}

export interface ProjectSnapshot {
  readonly schemaVersion: SchemaVersion;
  readonly id: DocumentId;
  readonly revision: Revision;
  readonly origin: "top-left";
  readonly units: "mm";
  readonly capabilities?: DocumentCapabilities;
  readonly preferences: ProjectPreferences;
  readonly pages: readonly PageSnapshot[];
  readonly activePageId: PageId;
}

export const documentId = (value: string): DocumentId => value as DocumentId;
export const layerId = (value: string): LayerId => value as LayerId;
export const elementId = (value: string): ElementId => value as ElementId;
export const pageId = (value: string): PageId => value as PageId;
export const revision = (value: number): Revision => value as Revision;

export function createDocument(id: string, layers: readonly Layer[] = []): DocumentSnapshot {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, id: documentId(id), revision: revision(0), origin: "top-left", units: "mm", page: { width: 1200, height: 900 }, layers: [...layers], elements: [], connections: [] };
}

export function createProject(document: DocumentSnapshot): ProjectSnapshot {
  const page = { id: pageId("page-1"), page: document.page, layers: document.layers, elements: document.elements, connections: document.connections ?? [] };
  return { schemaVersion: CURRENT_SCHEMA_VERSION, id: document.id, revision: document.revision, origin: document.origin, units: document.units, preferences: { lineGuidesEnabled: true, lineGuideAngle: 45 }, pages: [page], activePageId: page.id };
}

export function projectPage(project: ProjectSnapshot, pageIdValue = project.activePageId): PageSnapshot {
  return project.pages.find((page) => page.id === pageIdValue) ?? project.pages[0]!;
}

export function documentFromProject(project: ProjectSnapshot, pageIdValue = project.activePageId): DocumentSnapshot {
  const page = projectPage(project, pageIdValue);
  return { schemaVersion: project.schemaVersion, id: project.id, revision: project.revision, origin: project.origin, units: project.units, page: page.page, layers: page.layers, elements: page.elements, connections: page.connections ?? [] };
}

export function projectFromDocument(project: ProjectSnapshot, document: DocumentSnapshot): ProjectSnapshot {
  return { ...project, revision: document.revision, pages: project.pages.map((page) => page.id === project.activePageId ? { ...page, page: document.page, layers: document.layers, elements: document.elements, connections: document.connections ?? [] } : page) };
}

export function nextRevision(value: Revision): Revision {
  return revision(value + 1);
}

export function withElements(document: DocumentSnapshot, elements: readonly Element[]): DocumentSnapshot {
  return { ...document, revision: nextRevision(document.revision), elements: [...elements] };
}
