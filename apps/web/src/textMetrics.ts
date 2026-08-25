export interface TextSize {
  readonly width: number;
  readonly height: number;
}

interface TextMeasurementContext {
  font: string;
  measureText(text: string): TextMetrics;
}

type TextMeasurementContextFactory = () => TextMeasurementContext | null;

const fallbackTextSize = (lines: readonly string[], fontSize: number, lineHeight: number): TextSize => ({
  width: Math.max(...lines.map((line) => line.length), 1) * fontSize * 0.98,
  height: Math.max(lines.length, 1) * fontSize * lineHeight,
});

const browserContext: TextMeasurementContextFactory = () => {
  if (typeof document !== "undefined") return document.createElement("canvas").getContext("2d");
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(1, 1).getContext("2d");
  return null;
};

export const textSizeFor = (
  value: string,
  fontSize: number,
  fontFamily: string,
  fontWeight: "normal" | "bold",
  fontStyle: "normal" | "italic",
  lineHeight: number,
  createContext: TextMeasurementContextFactory = browserContext,
): TextSize => {
  const lines = value.split(/\r\n|\r|\n/);
  const context = createContext();
  if (!context) return fallbackTextSize(lines, fontSize, lineHeight);

  context.font = `${fontStyle} ${fontWeight} ${fontSize}px "${fontFamily.replaceAll('"', "\\\"")}"`;
  const metrics = lines.map((line) => context.measureText(line));
  const width = Math.max(...metrics.map((metric) => metric.width), 0);
  const measuredLineHeight = Math.max(...metrics.map((metric) => (metric.actualBoundingBoxAscent ?? 0) + (metric.actualBoundingBoxDescent ?? 0)), 0);
  const lineBoxHeight = Math.max(fontSize * lineHeight, measuredLineHeight);
  return { width, height: lines.length * lineBoxHeight };
};
