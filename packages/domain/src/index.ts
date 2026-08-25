export const CURRENT_SCHEMA_VERSION = 3 as const;

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
  readonly type: "line";
  readonly startNodeId: string;
  readonly endNodeId: string;
}
export interface PathCubicSegment {
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
  readonly style: VisualStyle;
  readonly operation?: OperationMetadata;
}
export type SplineContinuity = PathJoin;
export interface HandleOffset { readonly dx: number; readonly dy: number }
export interface SplineNode { readonly id: string; readonly anchor: PointMm; readonly continuity: SplineContinuity; readonly inHandle?: HandleOffset; readonly outHandle?: HandleOffset }
export interface SplineElement { readonly type: "spline"; readonly id: ElementId; readonly layerId: LayerId; readonly nodes: readonly SplineNode[]; readonly closed: boolean; readonly style: VisualStyle; readonly operation?: OperationMetadata }
export interface TextElement { readonly type: "text"; readonly id: ElementId; readonly layerId: LayerId; readonly position: PointMm; readonly size: SizeMm; readonly text: string; readonly fontFamily: string; readonly fontSize: number; readonly fontWeight: "normal" | "bold"; readonly fontStyle: "normal" | "italic"; readonly textAlign: "left" | "center" | "right"; readonly lineHeight: number; readonly scaleX?: number; readonly scaleY?: number; readonly rotation: number; readonly style: VisualStyle; readonly operation?: OperationMetadata }
/** A single closed outline compound. Coordinates are document-space millimetres. */
export interface GlyphContour { readonly nodes: readonly PathNode[]; readonly segments: readonly PathSegment[] }
/** Editable outline for one laid-out font glyph; multiple contours preserve holes. */
export interface GlyphElement { readonly type: "glyph"; readonly id: ElementId; readonly layerId: LayerId; readonly position: PointMm; readonly size: SizeMm; readonly glyph: string; readonly contours: readonly GlyphContour[]; readonly fillRule: "evenodd"; readonly rotation: number; readonly flipX?: boolean; readonly flipY?: boolean; readonly style: VisualStyle; readonly operation?: OperationMetadata }
export type Element = RectangleElement | EllipseElement | LineElement | ContourElement | PathElement | SplineElement | TextElement | GlyphElement;
export interface DocumentCapabilities { readonly spline?: 1 }
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
}

export interface PageSnapshot {
  readonly id: PageId;
  readonly page: SizeMm;
  readonly layers: readonly Layer[];
  readonly elements: readonly Element[];
}

export interface ProjectSnapshot {
  readonly schemaVersion: SchemaVersion;
  readonly id: DocumentId;
  readonly revision: Revision;
  readonly origin: "top-left";
  readonly units: "mm";
  readonly capabilities?: DocumentCapabilities;
  readonly pages: readonly PageSnapshot[];
  readonly activePageId: PageId;
}

export const documentId = (value: string): DocumentId => value as DocumentId;
export const layerId = (value: string): LayerId => value as LayerId;
export const elementId = (value: string): ElementId => value as ElementId;
export const pageId = (value: string): PageId => value as PageId;
export const revision = (value: number): Revision => value as Revision;

export function createDocument(id: string, layers: readonly Layer[] = []): DocumentSnapshot {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, id: documentId(id), revision: revision(0), origin: "top-left", units: "mm", page: { width: 1200, height: 900 }, layers: [...layers], elements: [] };
}

export function createProject(document: DocumentSnapshot): ProjectSnapshot {
  const page = { id: pageId("page-1"), page: document.page, layers: document.layers, elements: document.elements };
  return { schemaVersion: CURRENT_SCHEMA_VERSION, id: document.id, revision: document.revision, origin: document.origin, units: document.units, pages: [page], activePageId: page.id };
}

export function projectPage(project: ProjectSnapshot, pageIdValue = project.activePageId): PageSnapshot {
  return project.pages.find((page) => page.id === pageIdValue) ?? project.pages[0]!;
}

export function documentFromProject(project: ProjectSnapshot, pageIdValue = project.activePageId): DocumentSnapshot {
  const page = projectPage(project, pageIdValue);
  return { schemaVersion: project.schemaVersion, id: project.id, revision: project.revision, origin: project.origin, units: project.units, page: page.page, layers: page.layers, elements: page.elements };
}

export function projectFromDocument(project: ProjectSnapshot, document: DocumentSnapshot): ProjectSnapshot {
  return { ...project, revision: document.revision, pages: project.pages.map((page) => page.id === project.activePageId ? { ...page, page: document.page, layers: document.layers, elements: document.elements } : page) };
}

export function nextRevision(value: Revision): Revision {
  return revision(value + 1);
}

export function withElements(document: DocumentSnapshot, elements: readonly Element[]): DocumentSnapshot {
  return { ...document, revision: nextRevision(document.revision), elements: [...elements] };
}
