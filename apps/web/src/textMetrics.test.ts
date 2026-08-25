import { describe, expect, it } from "vitest";
import { textSizeFor } from "./textMetrics.js";

describe("textSizeFor", () => {
  it("measures every actual line with the selected font settings", () => {
    const fonts: string[] = [];
    const size = textSizeFor("short\nlonger", 10, "Test Family", "bold", "italic", 1.2, () => ({
      font: "",
      measureText(value) {
        fonts.push(this.font);
        return { width: value.length * 3, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 3 } as TextMetrics;
      },
    }));

    expect(fonts).toEqual(["italic bold 10px \"Test Family\"", "italic bold 10px \"Test Family\""]);
    expect(size).toEqual({ width: 18, height: 24 });
  });

  it("handles CRLF and remains usable without a browser canvas", () => {
    expect(textSizeFor("a\r\nb", 10, "Arial", "normal", "normal", 1.2, () => null)).toEqual({ width: 9.8, height: 24 });
  });
});
