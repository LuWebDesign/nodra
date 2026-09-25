import { createDocument, elementId, layerId } from "@nodra/domain";
import { solveConstraintComponents } from "./index.js";

const warmups = 20;
const samples = 100;
const nearestRank = (values: readonly number[], percentile: number): number => [...values].sort((a, b) => a - b)[Math.ceil(percentile * values.length) - 1]!;

for (const scale of [10, 50, 100]) {
  const elements = Array.from({ length: scale }, (_, index) => {
    const a = `a-${index}`;
    const b = `b-${index}`;
    const id = elementId(`sketch-${scale}-${index}`);
    return { type: "sketch" as const, id, layerId: layerId("layer-1"), nodes: [{ id: a, point: { x: index * 20, y: 0 } }, { id: b, point: { x: index * 20 + 10, y: 3 } }], edges: [{ id: `edge-${index}`, startNodeId: a, endNodeId: b }], constraints: [{ id: `horizontal-${index}`, kind: "horizontal" as const, references: [{ elementId: id, nodeId: a }, { elementId: id, nodeId: b }] as const }], style: { stroke: "#000", strokeWidth: 1 } };
  });
  const document = { ...createDocument(`solver-${scale}`, [{ id: layerId("layer-1"), name: "Layer", visible: true, order: 0 }]), elements };
  const run = (): void => { solveConstraintComponents(document); };
  for (let index = 0; index < warmups; index++) run();
  const durations: number[] = [];
  for (let index = 0; index < samples; index++) {
    const start = performance.now();
    run();
    durations.push(performance.now() - start);
  }
  const result = solveConstraintComponents(document);
  console.log(JSON.stringify({ type: "custom-sample", api: "solveConstraintComponents", scale, warmups, samples, unit: "ms", p50: nearestRank(durations, 0.50), p95: nearestRank(durations, 0.95), p99: nearestRank(durations, 0.99), diagnostics: { converged: result.converged, iterations: result.iterations, componentCount: result.states.length, diagnosticCount: result.diagnostics.length, nonConvergedComponentCount: result.nonConvergedComponents.length } }));
}
