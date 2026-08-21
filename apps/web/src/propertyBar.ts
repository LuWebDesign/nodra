import type { Element } from "@nodra/domain";
import { degreesToRadians, radiansToDegrees } from "@nodra/geometry";

export type GeometryField = "x" | "y" | "width" | "height";
export type PropertyElement = Extract<Element, { type: "rectangle" | "ellipse" }>;

export const formatMm = (value: number) => Number.isFinite(value) ? value.toFixed(3).replace(/\.?0+$/, "") : "";

export function geometryValue(element: PropertyElement, field: GeometryField): number {
  return field === "x" ? element.position.x : field === "y" ? element.position.y : field === "width" ? element.size.width : element.size.height;
}

export function geometryPatch(element: PropertyElement, field: GeometryField, value: number): Pick<PropertyElement, "position" | "size"> {
  return field === "x" ? { position: { ...element.position, x: value }, size: element.size } : field === "y" ? { position: { ...element.position, y: value }, size: element.size } : field === "width" ? { position: element.position, size: { ...element.size, width: value } } : { position: element.position, size: { ...element.size, height: value } };
}

export function cornerRadiusValue(element: Extract<Element, { type: "rectangle" }>): number {
  return element.cornerRadius;
}

export function cornerRadiusPatch(value: number): { cornerRadius: number } | undefined {
  return Number.isFinite(value) && value >= 0 ? { cornerRadius: value } : undefined;
}

export const rotationDegreesValue = (element: Element): number => radiansToDegrees(element.rotation);

export function rotationPatch(raw: string, currentRotation: number): { rotation: number } | undefined {
  if (!raw.trim()) return undefined;
  const degrees = Number(raw.trim());
  if (!Number.isFinite(degrees)) return undefined;
  const rotation = degreesToRadians(degrees);
  const difference = Math.atan2(Math.sin(rotation - currentRotation), Math.cos(rotation - currentRotation));
  return Math.abs(difference) <= 1e-10 ? undefined : { rotation };
}
