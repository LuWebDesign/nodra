import { expect, test } from "./editor.fixture.js";

test.use({ storageState: "test-results/e2e-editor-state.json" });

type Point = { x: number; y: number };
type Endpoint = "start" | "end";
type StoredRevision = {
  projectId: string;
  revision: number;
  savedAt: number;
  document: {
    id: string;
    constraints?: Constraint[];
    elements?: Sketch[];
    pages?: Array<{ constraints?: Constraint[]; elements?: Sketch[] }>;
  };
};
type Constraint = { kind: string; references: Array<{ elementId: string; nodeId?: string }> };
type Sketch = { id: string; nodes?: Array<{ id: string }>; edges?: Array<{ id: string; startNodeId: string; endNodeId: string }> };
type Page = import("@playwright/test").Page;
type Locator = import("@playwright/test").Locator;

async function readEdge(edge: Locator) {
  return edge.evaluate((element) => {
    const line = element as SVGLineElement;
    const matrix = line.getScreenCTM();
    if (!matrix) throw new Error("Sketch edge has no screen transform");
    const read = (x: "x1" | "x2") => {
      const y = x === "x1" ? "y1" : "y2";
      const p = new DOMPoint(Number(line.getAttribute(x)), Number(line.getAttribute(y))).matrixTransform(matrix);
      return { x: p.x, y: p.y };
    };
    const start = read("x1");
    const end = read("x2");
    return { start, end, midpoint: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } };
  });
}

async function indexedDocument(page: Page): Promise<StoredRevision> {
  return page.evaluate(() => new Promise<StoredRevision>((resolve, reject) => {
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
        if (!row) reject(new Error("No persisted project revision"));
        else resolve(row);
      };
    };
  }));
}

async function sketch(page: Page, index: number) {
  const group = page.locator('.page-svg svg g[data-sketch-element="true"]').nth(index);
  const edge = group.locator("line[data-sketch-edge]").first();
  await expect(edge).toBeVisible();
  return { group, edge, elementId: (await group.getAttribute("data-element-id"))! };
}

async function draw(page: Page, start: Point, end: Point) {
  await page.getByRole("button", { name: "Línea", exact: true }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
}

async function canvasPoint(page: Page, dx: number, dy: number) {
  const bounds = await page.locator(".page").boundingBox();
  expect(bounds).not.toBeNull();
  return { x: bounds!.x + dx, y: bounds!.y + dy };
}

async function expectEndpointAt(edge: Locator, endpoint: Endpoint, target: Point, label: string) {
  await expect.poll(async () => {
    const actual = (await readEdge(edge))[endpoint];
    return Math.hypot(actual.x - target.x, actual.y - target.y);
  }, { message: label, timeout: 5_000 }).toBeLessThanOrEqual(1);
}

async function expectExactCoincidence(page: Page, firstElementId: string, firstEdgeId: string, firstEndpoint: Endpoint, secondElementId: string, secondEdgeId: string, secondEndpoint: Endpoint) {
  await expect.poll(async () => {
    const saved = await indexedDocument(page);
    const elements = [...(saved.document.elements ?? []), ...(saved.document.pages ?? []).flatMap((item) => item.elements ?? [])];
    const first = elements.find((element) => element.id === firstElementId)?.edges?.find((edge) => edge.id === firstEdgeId);
    const second = elements.find((element) => element.id === secondElementId)?.edges?.find((edge) => edge.id === secondEdgeId);
    if (!first || !second) return false;
    const firstNodeId = firstEndpoint === "start" ? first.startNodeId : first.endNodeId;
    const secondNodeId = secondEndpoint === "start" ? second.startNodeId : second.endNodeId;
    const constraints = [...(saved.document.constraints ?? []), ...(saved.document.pages ?? []).flatMap((item) => item.constraints ?? [])];
    return constraints.some((constraint) => constraint.kind === "coincident" && constraint.references.length === 2
      && constraint.references.some((reference) => reference.elementId === firstElementId && reference.nodeId === firstNodeId)
      && constraint.references.some((reference) => reference.elementId === secondElementId && reference.nodeId === secondNodeId));
  }, { message: `expected persisted coincident constraint between ${firstElementId}/${firstEdgeId}:${firstEndpoint} and ${secondElementId}/${secondEdgeId}:${secondEndpoint}` }).toBe(true);
}

async function dragEndpointTo(page: Page, edge: Locator, target: Point) {
  const points = await readEdge(edge);
  const endpoint: Endpoint = Math.hypot(points.start.x - target.x, points.start.y - target.y) < Math.hypot(points.end.x - target.x, points.end.y - target.y) ? "start" : "end";
  const point = points[endpoint];
  await page.getByRole("button", { name: "Forma", exact: true }).click();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(target.x + 5, target.y, { steps: 8 });
  await page.mouse.up();
  return endpoint;
}

test("Línea confirms a new independent Sketch edge snapped to an existing Sketch endpoint", async ({ page }) => {
  const sourceStart = await canvasPoint(page, 100, 100);
  await draw(page, sourceStart, { x: sourceStart.x + 100, y: sourceStart.y + 30 });
  const source = await sketch(page, 0);
  const sourceEdgeId = (await source.edge.getAttribute("data-sketch-edge"))!;
  const target = (await readEdge(source.edge)).end;
  await page.getByRole("button", { name: "Seleccion", exact: true }).click();
  await draw(page, { x: target.x + 150, y: target.y + 80 }, { x: target.x + 5, y: target.y });
  const dependent = await sketch(page, 1);
  const dependentEdgeId = (await dependent.edge.getAttribute("data-sketch-edge"))!;
  await expectEndpointAt(dependent.edge, "end", target, "new edge second-click endpoint must land on the source endpoint");
  await expectExactCoincidence(page, source.elementId, sourceEdgeId, "end", dependent.elementId, dependentEdgeId, "end");
});

test("Línea appends an edge in the active Sketch snapped to a different Sketch endpoint", async ({ page }) => {
  const sourceStart = await canvasPoint(page, 100, 100);
  await draw(page, sourceStart, { x: sourceStart.x + 100, y: sourceStart.y + 30 });
  const source = await sketch(page, 0);
  const sourceEdgeId = (await source.edge.getAttribute("data-sketch-edge"))!;
  const target = (await readEdge(source.edge)).end;
  await page.getByRole("button", { name: "Seleccion", exact: true }).click();
  await draw(page, { x: sourceStart.x + 220, y: sourceStart.y + 110 }, { x: sourceStart.x + 300, y: sourceStart.y + 150 });
  const active = await sketch(page, 1);
  const activeEnd = (await readEdge(active.edge)).end;
  await page.getByRole("button", { name: "Línea", exact: true }).click();
  await page.mouse.click(activeEnd.x, activeEnd.y);
  await page.mouse.click(target.x + 5, target.y);
  const appended = active.group.locator("line[data-sketch-edge]").nth(1);
  await expect(appended).toBeVisible();
  const appendedEdgeId = (await appended.getAttribute("data-sketch-edge"))!;
  await expectEndpointAt(appended, "end", target, "appended edge final-click endpoint must land on the source endpoint");
  await expectExactCoincidence(page, source.elementId, sourceEdgeId, "end", active.elementId, appendedEdgeId, "end");
});

test("Forma endpoint movement commits a durable Sketch endpoint coincidence", async ({ page }) => {
  const sourceStart = await canvasPoint(page, 100, 100);
  await draw(page, sourceStart, { x: sourceStart.x + 100, y: sourceStart.y + 30 });
  const source = await sketch(page, 0);
  const sourceEdgeId = (await source.edge.getAttribute("data-sketch-edge"))!;
  const target = (await readEdge(source.edge)).end;
  await page.getByRole("button", { name: "Seleccion", exact: true }).click();
  await draw(page, { x: sourceStart.x + 250, y: sourceStart.y + 130 }, { x: sourceStart.x + 340, y: sourceStart.y + 160 });
  const dependent = await sketch(page, 1);
  const dependentEdgeId = (await dependent.edge.getAttribute("data-sketch-edge"))!;
  const endpoint = await dragEndpointTo(page, dependent.edge, target);
  await expectEndpointAt(dependent.edge, endpoint, target, "Forma-moved endpoint must land on the source endpoint");
  await expectExactCoincidence(page, source.elementId, sourceEdgeId, "end", dependent.elementId, dependentEdgeId, endpoint);
});

test("Selección single-edge Sketch body drag commits a durable endpoint coincidence", async ({ page }) => {
  const sourceStart = await canvasPoint(page, 100, 100);
  await draw(page, sourceStart, { x: sourceStart.x + 100, y: sourceStart.y + 30 });
  const source = await sketch(page, 0);
  const sourceEdgeId = (await source.edge.getAttribute("data-sketch-edge"))!;
  const target = (await readEdge(source.edge)).end;
  await page.getByRole("button", { name: "Seleccion", exact: true }).click();
  await draw(page, { x: sourceStart.x + 250, y: sourceStart.y + 130 }, { x: sourceStart.x + 340, y: sourceStart.y + 160 });
  const dependent = await sketch(page, 1);
  const dependentEdgeId = (await dependent.edge.getAttribute("data-sketch-edge"))!;
  const before = await readEdge(dependent.edge);
  const endpoint: Endpoint = Math.hypot(before.start.x - target.x, before.start.y - target.y) < Math.hypot(before.end.x - target.x, before.end.y - target.y) ? "start" : "end";
  const nearest = before[endpoint];
  const midpoint = before.midpoint;
  const destination = { x: midpoint.x + target.x - nearest.x + 5, y: midpoint.y + target.y - nearest.y };
  await page.getByRole("button", { name: "Seleccion", exact: true }).click();
  await page.mouse.move(midpoint.x, midpoint.y);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 8 });
  await page.mouse.up();
  await expectEndpointAt(dependent.edge, endpoint, target, "Selección-dragged endpoint must land on the source endpoint");
  await expectExactCoincidence(page, source.elementId, sourceEdgeId, "end", dependent.elementId, dependentEdgeId, endpoint);
});
