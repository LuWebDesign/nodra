import type { Element } from "@nodra/domain";

export type GeometryField = "x" | "y" | "width" | "height";
export type PropertyElement = Extract<Element, { type: "rectangle" | "ellipse" }>;

export const formatMm = (value: number) => Number.isFinite(value) ? value.toFixed(3).replace(/\.?0+$/, "") : "";

export function geometryValue(element: PropertyElement, field: GeometryField): number {
  return field === "x" ? element.position.x : field === "y" ? element.position.y : field === "width" ? element.size.width : element.size.height;
}

export function geometryPatch(element: PropertyElement, field: GeometryField, value: number): Pick<PropertyElement, "position" | "size"> {
  return field === "x" ? { position: { ...element.position, x: value }, size: element.size } : field === "y" ? { position: { ...element.position, y: value }, size: element.size } : field === "width" ? { position: element.position, size: { ...element.size, width: value } } : { position: element.position, size: { ...element.size, height: value } };
}
