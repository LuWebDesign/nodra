import type { Element } from "@nodra/domain";
import { degreesToRadians, radiansToDegrees } from "@nodra/geometry";

export type GeometryField = "x" | "y" | "width" | "height";
export type PropertyElement = Extract<Element, { type: "rectangle" | "ellipse" }>;
export type RotatableElement = Extract<Element, { readonly rotation: number }>;

export const formatMm = (value: number) => Number.isFinite(value) ? value.toFixed(3).replace(/\.?0+$/, "") : "";

export function geometryValue(element: PropertyElement, field: GeometryField): number {
  return field === "x" ? element.position.x : field === "y" ? element.position.y : field === "width" ? element.size.width : element.size.height;
}

export function geometryPatch(element: PropertyElement, field: GeometryField, value: number): Pick<PropertyElement, "position" | "size"> {
  return field === "x" ? { position: { ...element.position, x: value }, size: element.size } : field === "y" ? { position: { ...element.position, y: value }, size: element.size } : field === "width" ? { position: element.position, size: { ...element.size, width: value } } : { position: element.position, size: { ...element.size, height: value } };
}

export function centeredGeometryPatch(element: PropertyElement, field: GeometryField, value: number, aspectLock: boolean): Pick<PropertyElement, "position" | "size"> {
  const patch = aspectGeometryPatch(element, field, value, aspectLock);
  if (field !== "width" && field !== "height") return patch;
  return {
    position: {
      x: element.position.x + (element.size.width - patch.size.width) / 2,
      y: element.position.y + (element.size.height - patch.size.height) / 2,
    },
    size: patch.size,
  };
}

export function aspectGeometryPatch(element: PropertyElement, field: GeometryField, value: number, aspectLock: boolean): Pick<PropertyElement, "position" | "size"> {
  if (!aspectLock || (field !== "width" && field !== "height")) return geometryPatch(element, field, value);
  return { position: element.position, size: aspectSize(element.size.width, element.size.height, field, value) };
}

export function aspectSize(width: number, height: number, field: "width" | "height", value: number): { width: number; height: number } {
  const ratio = width / height;
  return field === "width" ? { width: value, height: value / ratio } : { width: value * ratio, height: value };
}

export function cornerRadiusValue(element: Extract<Element, { type: "rectangle" }>): number {
  return element.cornerRadius;
}

export function cornerRadiusPatch(value: number): { cornerRadius: number } | undefined {
  return Number.isFinite(value) && value >= 0 ? { cornerRadius: value } : undefined;
}

export const rotationDegreesValue = (element: RotatableElement): number => radiansToDegrees(element.rotation);

export function rotationPatch(raw: string, currentRotation: number): { rotation: number } | undefined {
  if (!raw.trim()) return undefined;
  const degrees = Number(raw.trim());
  if (!Number.isFinite(degrees)) return undefined;
  const rotation = degreesToRadians(degrees);
  const difference = Math.atan2(Math.sin(rotation - currentRotation), Math.cos(rotation - currentRotation));
  return Math.abs(difference) <= 1e-10 ? undefined : { rotation };
}
