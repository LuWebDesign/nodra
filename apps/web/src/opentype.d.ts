declare module "opentype.js" {
  export interface PathCommand { readonly type: "M" | "L" | "C" | "Q" | "Z"; readonly x: number; readonly y: number; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
  export interface Glyph { readonly name?: string; readonly advanceWidth: number; getPath(x: number, y: number, fontSize: number): { readonly commands: readonly PathCommand[] } }
  export interface Font { readonly unitsPerEm: number; readonly ascender: number; stringToGlyphs(text: string): readonly Glyph[]; getKerningValue(left: Glyph, right: Glyph): number }
  const opentype: { parse(buffer: ArrayBuffer): Font };
  export default opentype;
}
