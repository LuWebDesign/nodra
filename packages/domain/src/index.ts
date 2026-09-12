export const CURRENT_SCHEMA_VERSION = 9 as const;

export type SchemaVersion = typeof CURRENT_SCHEMA_VERSION;
export type DocumentId = string & { readonly __brand: "DocumentId" };
export type LayerId = string & { readonly __brand: "LayerId" };
export type ElementId = string & { readonly __brand: "ElementId" };
export type FeatureId = string & { readonly __brand: "FeatureId" };
export type PageId = string & { readonly __brand: "PageId" };
export type PieceId = string & { readonly __brand: "PieceId" };
export type Revision = number & { readonly __brand: "Revision" };

export interface PointMm { readonly x: number; readonly y: number }
export interface ElementBase { readonly pieceId?: PieceId }
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
export interface CircleElement {
  readonly type: "circle";
  readonly id: ElementId;
  readonly layerId: LayerId;
  readonly center: PointMm;
  readonly radius: number;
  readonly style: VisualStyle;
  readonly operation?: OperationMetadata;
  readonly circleConstraints?: readonly CircleConstraint[];
}
export type ArcDirection = "clockwise" | "counterclockwise";
export interface ArcElement {
  readonly type: "arc";
  readonly id: ElementId;
  readonly layerId: LayerId;
  readonly center: PointMm;
  readonly radius: number;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly direction: ArcDirection;
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
export interface SketchNode { readonly id: string; readonly point: PointMm }
export interface SketchEdge { readonly id: string; readonly startNodeId: string; readonly endNodeId: string }
export type SketchConstraintKind = "horizontal" | "vertical" | "coincident" | "parallel" | "perpendicular" | "equal" | "distance-horizontal" | "distance-vertical" | "distance" | "angle" | "fixed";
export interface SketchPointReference { readonly elementId: ElementId; readonly nodeId: string }
export interface SketchEdgeReference { readonly elementId: ElementId; readonly edgeId: string }
export type SketchConstraintReference = SketchPointReference | SketchEdgeReference;
export interface SketchConstraint { readonly id: string; readonly kind: SketchConstraintKind; readonly references: readonly [SketchConstraintReference, ...SketchConstraintReference[]]; readonly value?: number }
export interface SketchElement { readonly type: "sketch"; readonly id: ElementId; readonly layerId: LayerId; readonly nodes: readonly SketchNode[]; readonly edges: readonly SketchEdge[]; readonly constraints?: readonly SketchConstraint[]; readonly style: VisualStyle; readonly operation?: OperationMetadata }
/** Page-level parametric constraint; references may span multiple sketch elements. */
export type DocumentConstraint = SketchConstraint;
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
export type Element = (RectangleElement | CircleElement | ArcElement | EllipseElement | LineElement | SketchElement | DimensionElement | ContourElement | PathElement | SplineElement | TextElement | GlyphElement) & ElementBase;
export interface ParametricFeature {
  readonly id: FeatureId;
  readonly operation: "weld" | "subtract" | "outline" | "intersect";
  readonly sources: readonly { readonly elementId: ElementId }[];
  readonly outputs: readonly { readonly elementId: ElementId }[];
  readonly status: "up-to-date" | "needs-rebuild" | "error";
  readonly error?: string;
}
export interface ParametricFeatureTree {
  readonly version: 1;
  readonly features: readonly ParametricFeature[];
}
export type ConnectableNodeAddress =
  | { readonly kind: "named"; readonly name: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "center" | "start" | "end" }
  | { readonly kind: "line"; readonly name: "start" | "end" | "center" }
  | { readonly kind: "path" | "spline" | "sketch"; readonly nodeId: string; readonly handle?: "in" | "out" };
export interface ConnectableNodeReference { readonly elementId: ElementId; readonly node: ConnectableNodeAddress }
export interface ExplicitConnection { readonly id: string; readonly first: ConnectableNodeReference; readonly second: ConnectableNodeReference }
/** Opt-in persistent geometric coincidence. Unlike ExplicitConnection, this is enforced by editor commands. */
export interface PositionalCoincidence { readonly id: string; readonly first: ConnectableNodeReference; readonly second: ConnectableNodeReference }
export interface DocumentCapabilities { readonly spline?: 1 }
/** Elements that expose a document-space rotation, independent of their geometry representation. */
    export type RotatableElement = Extract<Element, { readonly rotation: number }>;
    export const hasRotation = (element: Element): element is RotatableElement => "rotation" in element && typeof element.rotation === "number";

    export const isLineElement = (element: Element): element is LineElement => element.type === "line";
    export const isCircleElement = (element: Element): element is CircleElement => element.type === "circle";

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
  readonly featureTree?: ParametricFeatureTree;
  readonly constraints?: readonly DocumentConstraint[];
  readonly connections?: readonly ExplicitConnection[];
  readonly positionalCoincidences?: readonly PositionalCoincidence[];
}

export interface PageSnapshot {
  readonly id: PageId;
  readonly name: string;
  readonly page: SizeMm;
  readonly layers: readonly Layer[];
  readonly elements: readonly Element[];
  readonly featureTree?: ParametricFeatureTree;
  readonly constraints?: readonly DocumentConstraint[];
  readonly connections?: readonly ExplicitConnection[];
  readonly positionalCoincidences?: readonly PositionalCoincidence[];
}

export interface ProjectPreferences {
  readonly lineGuidesEnabled: boolean;
  readonly lineGuideAngle: 45;
}

export type PieceProcess = "cut";
export type PieceState = "design" | "underdefined" | "defined" | "validated" | "ready";
export interface PieceSketchReference {
  readonly pageId: PageId;
  readonly sketchId: ElementId;
}
export interface PieceSnapshot {
  readonly id: PieceId;
  readonly name: string;
  readonly material?: string;
  readonly thicknessMm?: number;
  readonly process: PieceProcess;
  readonly state: PieceState;
  /** Persisted page membership; absent on legacy projects and resolved from sketch references/fallback. */
  readonly pageId?: PageId;
  readonly sketches: readonly PieceSketchReference[];
}

export interface ProjectSnapshot {
  readonly schemaVersion: SchemaVersion;
  readonly id: DocumentId;
  readonly revision: Revision;
  readonly origin: "top-left";
  readonly units: "mm";
  readonly capabilities?: DocumentCapabilities;
  readonly preferences: ProjectPreferences;
  readonly pieces: readonly PieceSnapshot[];
  readonly pages: readonly PageSnapshot[];
  readonly activePageId: PageId;
  /** Active piece context for projecting shared-page geometry; absent in legacy records. */
  readonly activePieceId?: PieceId;
}

export const documentId = (value: string): DocumentId => value as DocumentId;
export const layerId = (value: string): LayerId => value as LayerId;
export const elementId = (value: string): ElementId => value as ElementId;
export const featureId = (value: string): FeatureId => value as FeatureId;
export const pageId = (value: string): PageId => value as PageId;
export const pieceId = (value: string): PieceId => value as PieceId;
export const revision = (value: number): Revision => value as Revision;
export const defaultPieceId = (projectId: DocumentId | string): PieceId => pieceId(`${projectId}:piece-1`);
export const createDefaultPiece = (projectId: DocumentId | string): PieceSnapshot => ({ id: defaultPieceId(projectId), name: "Pieza 1", process: "cut", state: "design", pageId: pageId("page-1"), sketches: [] });

export function createDocument(id: string, layers: readonly Layer[] = []): DocumentSnapshot {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, id: documentId(id), revision: revision(0), origin: "top-left", units: "mm", page: { width: 1200, height: 900 }, layers: [...layers], elements: [], connections: [] };
}

const projectPageFromDocument = (document: DocumentSnapshot): PageSnapshot => ({ id: pageId("page-1"), name: "Página 1", page: document.page, layers: document.layers, elements: document.elements, ...(document.featureTree ? { featureTree: document.featureTree } : {}), ...(document.constraints ? { constraints: document.constraints } : {}), connections: document.connections ?? [], ...(document.positionalCoincidences ? { positionalCoincidences: document.positionalCoincidences } : {}) });

/** Creates a project with the historical default piece for document-to-project compatibility. */
export function createProject(document: DocumentSnapshot): ProjectSnapshot {
  const page = projectPageFromDocument(document);
  return { schemaVersion: CURRENT_SCHEMA_VERSION, id: document.id, revision: document.revision, origin: document.origin, units: document.units, ...(document.capabilities ? { capabilities: document.capabilities } : {}), preferences: { lineGuidesEnabled: true, lineGuideAngle: 45 }, pieces: [{ ...createDefaultPiece(document.id), pageId: page.id }], pages: [page], activePageId: page.id, activePieceId: defaultPieceId(document.id) };
}

/** Creates the initial persisted project: one empty page and no pieces. */
export function createEmptyProject(document: DocumentSnapshot): ProjectSnapshot {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, id: document.id, revision: document.revision, origin: document.origin, units: document.units, ...(document.capabilities ? { capabilities: document.capabilities } : {}), preferences: { lineGuidesEnabled: true, lineGuideAngle: 45 }, pieces: [], pages: [projectPageFromDocument(document)], activePageId: pageId("page-1") };
}

export function projectPage(project: ProjectSnapshot, pageIdValue = project.activePageId): PageSnapshot {
  return project.pages.find((page) => page.id === pageIdValue) ?? project.pages[0]!;
}

const pieceForPage = (project: ProjectSnapshot, page: PageSnapshot, pieceIdValue?: PieceId): PieceSnapshot | undefined => project.pieces.find((piece) => piece.id === pieceIdValue && (piece.pageId === page.id || !piece.pageId)) ?? project.pieces.find((piece) => piece.pageId === page.id) ?? project.pieces[0];

/** Resolves legacy unowned geometry once: sketches use their existing piece reference, remaining elements use the first piece. */
export function elementsForPiece(project: ProjectSnapshot, page: PageSnapshot, pieceIdValue?: PieceId): readonly Element[] {
  const piece = pieceForPage(project, page, pieceIdValue);
  if (!piece) return page.elements;
  const first = piece.id;
  const sketchOwners = new Map<ElementId, PieceId>();
  for (const piece of project.pieces) for (const reference of piece.sketches) if (reference.pageId === page.id) sketchOwners.set(reference.sketchId, piece.id);
  return page.elements.filter((element) => element.pieceId === pieceIdValue || (element.pieceId === undefined && (element.type === "sketch" ? (sketchOwners.get(element.id) ?? first) : first) === pieceIdValue));
}

export function documentFromProject(project: ProjectSnapshot, pageIdValue = project.activePageId): DocumentSnapshot {
  const page = projectPage(project, pageIdValue);
  const piece = pieceForPage(project, page, project.activePieceId);
  const elements = piece ? elementsForPiece(project, page, piece.id) : page.elements;
  const ids = new Set(elements.map((element) => element.id));
  const constraints = page.constraints?.filter((constraint) => constraint.references.every((reference) => ids.has(reference.elementId)));
  const connections = (page.connections ?? []).filter((connection) => ids.has(connection.first.elementId) && ids.has(connection.second.elementId));
  const positionalCoincidences = page.positionalCoincidences?.filter((relation) => ids.has(relation.first.elementId) && ids.has(relation.second.elementId));
  const featureTree = page.featureTree === undefined ? undefined : { ...page.featureTree, features: page.featureTree.features.filter((feature) => [...feature.sources, ...feature.outputs].every((reference) => ids.has(reference.elementId))) };
  return { schemaVersion: project.schemaVersion, id: project.id, revision: project.revision, origin: project.origin, units: project.units, ...(project.capabilities ? { capabilities: project.capabilities } : {}), page: page.page, layers: page.layers, elements, ...(featureTree ? { featureTree } : {}), ...(constraints ? { constraints } : {}), connections, ...(positionalCoincidences ? { positionalCoincidences } : {}) };
}

export function projectFromDocument(project: ProjectSnapshot, document: DocumentSnapshot): ProjectSnapshot {
  const page = projectPage(project);
  const activePiece = project.pieces.length > 0 ? pieceForPage(project, page, project.activePieceId) : undefined;
  const currentIds = new Set(document.elements.map((element) => element.id));
  const preserved = activePiece ? page.elements.filter((element) => element.pieceId !== undefined && element.pieceId !== activePiece.id && currentIds.has(element.id) === false) : [];
  const preservedIds = new Set(preserved.map((element) => element.id));
  const incomingFeatureIds = new Set(document.featureTree?.features.map((feature) => feature.id) ?? []);
  const preservedFeatures = page.featureTree?.features.filter((feature) => !incomingFeatureIds.has(feature.id) && [...feature.sources, ...feature.outputs].every((reference) => preservedIds.has(reference.elementId))) ?? [];
  const featureTree = document.featureTree === undefined && preservedFeatures.length === 0 ? undefined : { version: 1 as const, features: [...preservedFeatures, ...(document.featureTree?.features ?? [])] };
  const owned = activePiece ? document.elements.map((element) => element.pieceId === activePiece.id ? element : { ...element, pieceId: activePiece.id }) : document.elements;
  const pieces = project.pieces.map((piece) => {
    const sketches = activePiece && piece.id === activePiece.id ? [...piece.sketches.filter((reference) => reference.pageId !== page.id), ...owned.filter((element) => element.type === "sketch").map((element) => ({ pageId: page.id, sketchId: element.id }))] : piece.sketches;
    return { ...piece, state: sketches.length === 0 && piece.state === "underdefined" ? "design" as const : piece.state, sketches };
  });
  const pages = project.pages.map((candidate): PageSnapshot => {
    if (candidate.id !== page.id) return candidate;
    const updated = { ...candidate, page: document.page, layers: document.layers, elements: [...preserved, ...owned], constraints: [...(candidate.constraints ?? []).filter((constraint) => constraint.references.some((reference) => !currentIds.has(reference.elementId))), ...(document.constraints ?? [])], connections: [...(candidate.connections ?? []).filter((connection) => !currentIds.has(connection.first.elementId) || !currentIds.has(connection.second.elementId)), ...(document.connections ?? [])], positionalCoincidences: document.positionalCoincidences ?? [] };
    if (featureTree) return { ...updated, featureTree };
    delete updated.featureTree;
    return updated;
  });
  return { ...project, revision: document.revision, ...(document.capabilities ? { capabilities: document.capabilities } : {}), pieces, pages };
}

export function nextRevision(value: Revision): Revision {
  return revision(value + 1);
}

export function withElements(document: DocumentSnapshot, elements: readonly Element[]): DocumentSnapshot {
  return { ...document, revision: nextRevision(document.revision), elements: [...elements] };
}
