import { createDocument, elementId, layerId, type Element } from "@nodra/domain";
import { renderSvg } from "@nodra/renderer-svg";
import { beginGesture, commitGesture, createEditor, moveElements, previewGestureFromBase } from "./index.js";

const warmups = 20;
const samples = 100;
const nearestRank = (values: readonly number[], percentile: number): number => [...values].sort((a, b) => a - b)[Math.ceil(percentile * values.length) - 1]!;
const measure = (api: string, scale: number, run: () => void, diagnostics: Record<string, unknown>): void => {
  for (let index = 0; index < warmups; index++) run();
  const durations: number[] = [];
  for (let index = 0; index < samples; index++) {
    const start = performance.now();
    run();
    durations.push(performance.now() - start);
  }
  console.log(JSON.stringify({ type: "custom-sample", api, scale, warmups, samples, unit: "ms", p50: nearestRank(durations, 0.50), p95: nearestRank(durations, 0.95), p99: nearestRank(durations, 0.99), diagnostics }));
};

for (const count of [10, 50, 100]) {
  const layer = layerId("layer-1");
  const elements: Element[] = Array.from({ length: count }, (_, index) => ({ type: "line", id: elementId(`line-${index}`), layerId: layer, start: { x: index, y: 0 }, end: { x: index + 10, y: 5 }, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } }));
  const document = { ...createDocument(`gesture-${count}`, [{ id: layer, name: "Layer", visible: true, order: 0 }]), elements };
  const ids = elements.map((element) => element.id);
  const rendered = renderSvg(document, { zoom: 1, panMm: { x: 0, y: 0 } });
  if (!rendered.success || rendered.renderedElementIds.length !== count) throw new Error("Unexpected SVG result");
  const svgBytes = new TextEncoder().encode(rendered.svg).byteLength;
  const state = beginGesture(createEditor(document));
  const preview = previewGestureFromBase(state, moveElements(ids, { x: 2, y: 3 }));
  if (!preview.gesture) throw new Error("Gesture preview absent");
  const committed = commitGesture(preview);
  if (!committed.undo.length) throw new Error("Gesture did not commit");
  measure("renderSvg generation", count, () => { renderSvg(document, { zoom: 1, panMm: { x: 0, y: 0 } }); }, { svgUtf8Bytes: svgBytes, renderedElementCount: rendered.renderedElementIds.length });
  measure("editor preview flow (createEditor → beginGesture → moveElements → previewGestureFromBase)", count, () => { previewGestureFromBase(beginGesture(createEditor(document)), moveElements(ids, { x: 2, y: 3 })); }, { selectedElementCount: ids.length });
  measure("editor commit flow (createEditor → beginGesture → moveElements → previewGestureFromBase → commitGesture)", count, () => {
    const current = previewGestureFromBase(beginGesture(createEditor(document)), moveElements(ids, { x: 2, y: 3 }));
    commitGesture(current);
  }, { selectedElementCount: ids.length, includesPreview: true });
}
