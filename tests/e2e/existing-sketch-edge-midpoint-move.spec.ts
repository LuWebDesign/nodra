import { expect, test } from "./editor.fixture.js";

test.use({ storageState: "test-results/e2e-editor-state.json" });

type Point = { x: number; y: number };
type EdgePoints = { start: Point; end: Point; midpoint: Point };

type StoredRevision = {
  projectId: string;
  revision: number;
  savedAt: number;
  document: {
    id: string;
    constraints?: Array<{ kind: string; references: Array<{ elementId: string; nodeId?: string; edgeId?: string }>; source?: { kind?: string; elementId: string; edgeId?: string } }>;
    elements?: Array<{ id: string }>;
    pages?: Array<{ elements?: Array<{ id: string }>; constraints?: Array<{ kind: string; references: Array<{ elementId: string; nodeId?: string; edgeId?: string }>; source?: { kind?: string; elementId: string; edgeId?: string } }> }>;
  };
};

async function readPoints(edge: ReturnType<import("@playwright/test").Page["locator"]>): Promise<EdgePoints> {
  return edge.evaluate((element) => {
    const line = element as SVGLineElement;
    const matrix = line.getScreenCTM();
    if (!matrix) throw new Error("Sketch edge has no screen transform");
    const point = (x: "x1" | "x2") => {
      const y = x === "x1" ? "y1" : "y2";
      const screen = new DOMPoint(Number(line.getAttribute(x)), Number(line.getAttribute(y))).matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    };
    const start = point("x1");
    const end = point("x2");
    return { start, end, midpoint: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } };
  });
}

async function drawTwoClickSketchEdge(page: import("@playwright/test").Page, start: Point, end: Point) {
  await page.getByRole("button", { name: "Línea", exact: true }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
}

async function createEdges(page: import("@playwright/test").Page) {
  const canvas = page.locator(".page");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const sourceStart = { x: bounds!.x + 110, y: bounds!.y + 110 };
  const sourceEnd = { x: sourceStart.x + 120, y: sourceStart.y };
  const dependentStart = { x: bounds!.x + 340, y: bounds!.y + 190 };
  const dependentEnd = { x: dependentStart.x + 100, y: dependentStart.y + 60 };
  await drawTwoClickSketchEdge(page, sourceStart, sourceEnd);
  await page.getByRole("button", { name: "Seleccion", exact: true }).click();
  await drawTwoClickSketchEdge(page, dependentStart, dependentEnd);
  const sketches = page.locator('.page-svg svg g[data-sketch-element="true"]');
  await expect(sketches).toHaveCount(2);
  const sourceSketch = sketches.nth(0);
  const dependentSketch = sketches.nth(1);
  const source = sourceSketch.locator("line[data-sketch-edge]");
  const dependent = dependentSketch.locator("line[data-sketch-edge]");
  await expect(source).toHaveCount(1);
  await expect(dependent).toHaveCount(1);
  const sourceId = await sourceSketch.getAttribute("data-element-id");
  const dependentId = await dependentSketch.getAttribute("data-element-id");
  const sourceEdgeId = await source.getAttribute("data-sketch-edge");
  const dependentEdgeId = await dependent.getAttribute("data-sketch-edge");
  expect(sourceId).toBeTruthy();
  expect(dependentId).toBeTruthy();
  expect(sourceEdgeId).toBeTruthy();
  expect(dependentEdgeId).toBeTruthy();
  return { canvas, sourceSketch, dependentSketch, source, dependent, sourceId: sourceId!, dependentId: dependentId!, sourceEdgeId: sourceEdgeId!, dependentEdgeId: dependentEdgeId! };
}

async function expectDurableRelation(page: import("@playwright/test").Page, sourceId: string, dependentId: string, sourceEdgeId: string) {
  await expect.poll(() => page.evaluate(({ sourceId, dependentId, sourceEdgeId }) => new Promise<boolean>((resolve, reject) => {
    const request = indexedDB.open("nodra-persistence");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction("revisions", "readonly").objectStore("revisions").getAll();
      read.onerror = () => reject(read.error);
      read.onsuccess = () => {
        const rows = read.result as StoredRevision[];
        const row = rows.filter((candidate) => candidate.projectId === candidate.document.id)
          .sort((a, b) => b.savedAt - a.savedAt || b.revision - a.revision)[0];
        const constraints = row === undefined ? [] : [...(row.document.constraints ?? []), ...(row.document.pages ?? []).flatMap((documentPage) => documentPage.constraints ?? [])];
        const relation = constraints.find((item) => item.kind === "midpoint"
          && item.references[0]?.elementId === dependentId
          && item.references[1]?.elementId === sourceId && item.references[1]?.edgeId === sourceEdgeId);
        db.close();
        resolve(relation !== undefined);
      };
    };
  }), { sourceId, dependentId, sourceEdgeId })).toBe(true);
}

async function dragToSnap(page: import("@playwright/test").Page, mode: "Forma" | "Selección", source: import("@playwright/test").Locator, dependent: import("@playwright/test").Locator) {
  const sourcePoints = await readPoints(source);
  const before = await readPoints(dependent);
  const endpoint: "start" | "end" = Math.hypot(before.start.x - sourcePoints.midpoint.x, before.start.y - sourcePoints.midpoint.y)
    < Math.hypot(before.end.x - sourcePoints.midpoint.x, before.end.y - sourcePoints.midpoint.y) ? "start" : "end";
  const other: "start" | "end" = endpoint === "start" ? "end" : "start";
  const landing = { x: sourcePoints.midpoint.x + 5.5, y: sourcePoints.midpoint.y };
  await page.getByRole("button", { name: mode === "Selección" ? "Seleccion" : mode, exact: true }).click();
  const dragPoint = mode === "Forma" ? before[endpoint] : before.midpoint;
  const delta = { x: landing.x - before[endpoint].x, y: landing.y - before[endpoint].y };
  const destination = mode === "Forma" ? landing : { x: dragPoint.x + delta.x, y: dragPoint.y + delta.y };
  await page.mouse.move(dragPoint.x, dragPoint.y);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 8 });
  const preview = await readPoints(dependent);
  expect(Math.hypot(preview[endpoint].x - sourcePoints.midpoint.x, preview[endpoint].y - sourcePoints.midpoint.y), `${mode}: endpoint midpoint projection must be exact during preview`).toBeLessThanOrEqual(1);
  const otherEndpointMovement = Math.hypot(preview[other].x - before[other].x, preview[other].y - before[other].y);
  if (mode === "Forma") expect(otherEndpointMovement, "Forma moves only the dragged endpoint").toBeLessThanOrEqual(1);
  else expect(otherEndpointMovement, "Selección translates the other endpoint with the Sketch body").toBeGreaterThan(1);
  await page.mouse.up();
  await expect.poll(async () => {
    const committed = await readPoints(dependent);
    return Math.hypot(committed[endpoint].x - sourcePoints.midpoint.x, committed[endpoint].y - sourcePoints.midpoint.y);
  }).toBeLessThanOrEqual(1);
  return { sourcePoints, before, endpoint, other };
}

async function verifyMove(page: import("@playwright/test").Page, mode: "Forma" | "Selección") {
  const setup = await createEdges(page);
  const initial = await dragToSnap(page, mode, setup.source, setup.dependent);
  const midpointRelation = page.getByRole("list", { name: "Relaciones globales" }).getByText(/Punto medio/);
  await expect(midpointRelation).toBeVisible();
  await expectDurableRelation(page, setup.sourceId, setup.dependentId, setup.sourceEdgeId);

  const ids = await setup.canvas.getAttribute("data-document-element-ids");
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(midpointRelation).toHaveCount(0);
  await expect.poll(async () => {
    const undone = await readPoints(setup.dependent);
    return Math.hypot(undone.start.x - initial.before.start.x, undone.start.y - initial.before.start.y)
      + Math.hypot(undone.end.x - initial.before.end.x, undone.end.y - initial.before.end.y);
  }).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Rehacer" }).click();
  await expect(midpointRelation).toBeVisible();
  await expect(setup.canvas).toHaveAttribute("data-document-element-ids", ids!);
  await expectDurableRelation(page, setup.sourceId, setup.dependentId, setup.sourceEdgeId);
  await expect(setup.sourceSketch).toHaveAttribute("data-element-id", setup.sourceId);
  await expect(setup.dependentSketch).toHaveAttribute("data-element-id", setup.dependentId);
  await expect(setup.source).toHaveAttribute("data-sketch-edge", setup.sourceEdgeId);
  await expect(setup.dependent).toHaveAttribute("data-sketch-edge", setup.dependentEdgeId);
  await expect.poll(async () => {
    const current = await readPoints(setup.dependent);
    return Math.hypot(current[initial.endpoint].x - initial.sourcePoints.midpoint.x, current[initial.endpoint].y - initial.sourcePoints.midpoint.y);
  }).toBeLessThanOrEqual(1);

  const sourceBefore = await readPoints(setup.source);
  const hit = { x: sourceBefore.start.x + (sourceBefore.end.x - sourceBefore.start.x) * 0.2, y: sourceBefore.start.y + (sourceBefore.end.y - sourceBefore.start.y) * 0.2 };
  await page.getByRole("button", { name: "Seleccion", exact: true }).click();
  await page.mouse.move(hit.x, hit.y);
  await page.mouse.down();
  await page.mouse.move(hit.x, hit.y + 35, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const [sourceAfter, dependentAfter] = await Promise.all([readPoints(setup.source), readPoints(setup.dependent)]);
    return Math.hypot(dependentAfter[initial.endpoint].x - sourceAfter.midpoint.x, dependentAfter[initial.endpoint].y - sourceAfter.midpoint.y);
  }).toBeLessThanOrEqual(1);
}

test("Forma moves an existing dependent sketch edge endpoint onto a source edge midpoint", async ({ page }) => {
  await verifyMove(page, "Forma");
});

test("Selección body drag cancels midpoint snapping on Escape without persisting a relation", async ({ page }) => {
  const setup = await createEdges(page);
  const canvasRevision = await setup.canvas.getAttribute("data-document-revision");
  const elementIds = await setup.canvas.getAttribute("data-document-element-ids");
  expect(canvasRevision).not.toBeNull();
  expect(elementIds).not.toBeNull();
  const readLatestProjectRow = async (): Promise<StoredRevision | undefined> => page.evaluate(() => new Promise<StoredRevision | undefined>((resolve, reject) => {
    const request = indexedDB.open("nodra-persistence");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction("revisions", "readonly").objectStore("revisions").getAll();
      read.onerror = () => reject(read.error);
      read.onsuccess = () => {
        const rows = read.result as StoredRevision[];
        const row = rows.filter((candidate) => candidate.projectId === candidate.document.id)
          .sort((a, b) => b.savedAt - a.savedAt || b.revision - a.revision)[0];
        db.close();
        resolve(row);
      };
    };
  }));
  const original = await readPoints(setup.dependent);
  const sourcePoints = await readPoints(setup.source);
  const endpoint: "start" | "end" = Math.hypot(original.start.x - sourcePoints.midpoint.x, original.start.y - sourcePoints.midpoint.y)
    < Math.hypot(original.end.x - sourcePoints.midpoint.x, original.end.y - sourcePoints.midpoint.y) ? "start" : "end";
  const dragStart = original.midpoint;
  const landing = { x: sourcePoints.midpoint.x + 5.5, y: sourcePoints.midpoint.y };
  const delta = { x: landing.x - original[endpoint].x, y: landing.y - original[endpoint].y };
  await page.getByRole("button", { name: "Seleccion", exact: true }).click();
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragStart.x + delta.x, dragStart.y + delta.y, { steps: 8 });
  const midpointRelation = page.getByRole("list", { name: "Relaciones globales" }).getByText(/Punto medio/);
  await expect(midpointRelation).toBeVisible();
  const preview = await readPoints(setup.dependent);
  expect(Math.hypot(preview[endpoint].x - sourcePoints.midpoint.x, preview[endpoint].y - sourcePoints.midpoint.y)).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await expect(midpointRelation).toHaveCount(0);
  await expect(setup.canvas).toHaveAttribute("data-document-revision", canvasRevision!);
  await expect(setup.canvas).toHaveAttribute("data-document-element-ids", elementIds!);
  await expect.poll(async () => {
    const restored = await readPoints(setup.dependent);
    return Math.hypot(restored.start.x - original.start.x, restored.start.y - original.start.y)
      + Math.hypot(restored.end.x - original.end.x, restored.end.y - original.end.y);
  }).toBeLessThanOrEqual(1);
  await page.waitForTimeout(800);
  const durable = await readLatestProjectRow();
  expect(durable).toBeDefined();
  const durableConstraints = [...(durable!.document.constraints ?? []), ...(durable!.document.pages ?? []).flatMap((documentPage) => documentPage.constraints ?? [])];
  expect(durableConstraints.some((item) => item.kind === "midpoint" && item.references[0]?.elementId === setup.dependentId
    && item.references[1]?.elementId === setup.sourceId && item.references[1]?.edgeId === setup.sourceEdgeId)).toBe(false);

  const dependentAfterCancel = await readPoints(setup.dependent);
  const sourceBeforeMove = await readPoints(setup.source);
  const sourceDragPoint = { x: sourceBeforeMove.start.x + (sourceBeforeMove.end.x - sourceBeforeMove.start.x) * 0.2, y: sourceBeforeMove.start.y + (sourceBeforeMove.end.y - sourceBeforeMove.start.y) * 0.2 };
  await page.mouse.move(sourceDragPoint.x, sourceDragPoint.y);
  await page.mouse.down();
  await page.mouse.move(sourceDragPoint.x, sourceDragPoint.y + 35, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const sourceMoved = await readPoints(setup.source);
    return Math.hypot(sourceMoved.midpoint.x - sourceBeforeMove.midpoint.x, sourceMoved.midpoint.y - sourceBeforeMove.midpoint.y);
  }).toBeGreaterThan(1);
  const dependentFinal = await readPoints(setup.dependent);
  expect(Math.hypot(dependentFinal.start.x - dependentAfterCancel.start.x, dependentFinal.start.y - dependentAfterCancel.start.y)
    + Math.hypot(dependentFinal.end.x - dependentAfterCancel.end.x, dependentFinal.end.y - dependentAfterCancel.end.y)).toBeLessThanOrEqual(1);
});
