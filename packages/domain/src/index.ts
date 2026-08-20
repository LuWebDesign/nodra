export const CURRENT_SCHEMA_VERSION = 2 as const;

export type SchemaVersion = typeof CURRENT_SCHEMA_VERSION;
export type DocumentId = string & { readonly __brand: "DocumentId" };
export type LayerId = string & { readonly __brand: "LayerId" };
export type ElementId = string & { readonly __brand: "ElementId" };
export type Revision = number & { readonly __brand: "Revision" };

export interface PointMm { readonly x: number; readonly y: number }
export interface SizeMm { readonly width: number; readonly height: number }
export interface Transform {
  readonly position: PointMm;
  readonly rotation: number;
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
export interface RectangleElement {
  readonly type: "rectangle";
  readonly id: ElementId;
  readonly layerId: LayerId;
  readonly position: PointMm;
  readonly size: SizeMm;
  readonly rotation: number;
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
  readonly style: VisualStyle;
  readonly operation?: OperationMetadata;
}
export type Element = RectangleElement | EllipseElement | LineElement;
export interface DocumentSnapshot {
  readonly schemaVersion: SchemaVersion;
  readonly id: DocumentId;
  readonly revision: Revision;
  readonly origin: "top-left";
  readonly units: "mm";
  readonly page: SizeMm;
  readonly layers: readonly Layer[];
  readonly elements: readonly Element[];
}

export const documentId = (value: string): DocumentId => value as DocumentId;
export const layerId = (value: string): LayerId => value as LayerId;
export const elementId = (value: string): ElementId => value as ElementId;
export const revision = (value: number): Revision => value as Revision;

export function createDocument(id: string, layers: readonly Layer[] = []): DocumentSnapshot {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, id: documentId(id), revision: revision(0), origin: "top-left", units: "mm", page: { width: 1200, height: 900 }, layers: [...layers], elements: [] };
}

export function nextRevision(value: Revision): Revision {
  return revision(value + 1);
}

export function withElements(document: DocumentSnapshot, elements: readonly Element[]): DocumentSnapshot {
  return { ...document, revision: nextRevision(document.revision), elements: [...elements] };
}
