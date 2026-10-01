import { expect, test, type Locator, type Page } from "@playwright/test";

type ScreenPoint = { x: number; y: number };
type LinePoints = { start: ScreenPoint; end: ScreenPoint; midpoint: ScreenPoint };
type StoredLineRelation = { id?: string; kind: string; references: Array<{ elementId: string }>; source?: { kind?: string; elementId: string; segmentId?: string; startNodeId?: string; endNodeId?: string; edgeId?: string } };
type StoredRevision = {
  projectId: string;
  revision: number;
  savedAt: number;
  document: {
    id: string;
    elements?: Array<{ id: string }>;
    constraints?: StoredLineRelation[];
    pages?: Array<{ elements: Array<{ id: string }>; constraints?: StoredLineRelation[] }>;
  };
};

async function createProjectAndPiece(page: Page, suffix: string) {
  await page.goto("/proyectos");
  await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
  await page.getByLabel("Nombre del proyecto").fill(`Proyecto endpoint midpoint ${suffix}`);
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await page.getByRole("region", { name: "Piezas" }).getByRole("button", { name: "+ Nueva pieza" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva pieza" });
  await dialog.getByLabel("Nombre de la pieza").fill("Pieza de prueba");
  await dialog.getByRole("button", { name: "Crear pieza" }).click();
}

async function drawNativeLine(page: Page, start: ScreenPoint, end: ScreenPoint, selectTool = false) {
  if (selectTool) await page.getByRole("button", { name: "Línea", exact: true }).click();
  const canvas = page.locator(".page");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  expect(start.x).toBeGreaterThanOrEqual(bounds!.x);
  expect(start.x).toBeLessThanOrEqual(bounds!.x + bounds!.width);
  expect(start.y).toBeGreaterThanOrEqual(bounds!.y);
  expect(start.y).toBeLessThanOrEqual(bounds!.y + bounds!.height);
  expect(end.x).toBeGreaterThanOrEqual(bounds!.x);
  expect(end.x).toBeLessThanOrEqual(bounds!.x + bounds!.width);
  expect(end.y).toBeGreaterThanOrEqual(bounds!.y);
  expect(end.y).toBeLessThanOrEqual(bounds!.y + bounds!.height);
  const beforeIds = await canvas.getAttribute("data-document-element-ids");
  const lineCount = await page.locator(".page-svg svg g > line[data-element-id]").count();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.waitForTimeout(180);
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  const lines = page.locator(".page-svg svg g > line[data-element-id]");
  await expect.poll(async () => await lines.count()).toBeGreaterThan(lineCount);
  await expect.poll(async () => await canvas.getAttribute("data-document-element-ids")).not.toBe(beforeIds);
}

async function waitForDurableRelation(page: Page, revision: number, sourceId: string, dependentId: string, sourceKind: "line" | "path-segment" | "spline-span" | "arc" | "sketch-edge" = "line") {
  await expect.poll(async () => page.evaluate(({ revision, sourceId, dependentId, sourceKind }) => new Promise<boolean>((resolve, reject) => {
    const request = indexedDB.open("nodra-persistence");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction("revisions", "readonly").objectStore("revisions").getAll();
      read.onerror = () => reject(read.error);
      read.onsuccess = () => {
        const rows = read.result as StoredRevision[];
        const candidates = rows.flatMap((row) => {
          const elements = [...(row.document.elements ?? []), ...(row.document.pages ?? []).flatMap((documentPage) => documentPage.elements)];
          const constraints = [...(row.document.constraints ?? []), ...(row.document.pages ?? []).flatMap((documentPage) => documentPage.constraints ?? [])];
          const hasBothLines = elements.some((element) => element.id === sourceId) && elements.some((element) => element.id === dependentId);
          const relation = constraints.find((constraint) => constraint.kind === "line-endpoint-midpoint"
            && constraint.references.some((reference) => reference.elementId === dependentId)
            && constraint.source?.elementId === sourceId
            && (sourceKind === "line" ? constraint.source.kind === "line" : sourceKind === "path-segment" ? constraint.source.kind === "path-segment" && typeof constraint.source.segmentId === "string" && constraint.source.segmentId.length > 0 : sourceKind === "spline-span" ? constraint.source.kind === "spline-span" && typeof constraint.source.startNodeId === "string" && typeof constraint.source.endNodeId === "string" : sourceKind === "sketch-edge" ? constraint.source.kind === "sketch-edge" && typeof constraint.source.edgeId === "string" && constraint.source.edgeId.length > 0 : constraint.source.kind === "arc"));
          if (!hasBothLines) return [];
          return [{ row, hasRelation: relation !== undefined, relation: relation ?? null }];
        }).sort((a, b) => b.row.savedAt - a.row.savedAt || b.row.revision - a.row.revision);
        const projectRow = candidates.find(({ row }) => row.projectId === row.document.id);
        const durable = projectRow !== undefined && projectRow.row.revision >= revision && projectRow.hasRelation;
        db.close();
        resolve(durable);
      };
    };
  }), { revision, sourceId, dependentId, sourceKind }), { timeout: 10000 }).toBe(true);
}


async function screenPoints(line: Locator): Promise<LinePoints> {
  return line.evaluate((element) => {
    const svgLine = element as SVGLineElement;
    const matrix = svgLine.getScreenCTM();
    if (!matrix) throw new Error("Native Line has no screen transform");
    const point = (x: string) => new DOMPoint(Number(svgLine.getAttribute(x)), Number(svgLine.getAttribute(x === "x1" ? "y1" : "y2"))).matrixTransform(matrix);
    const start = point("x1");
    const end = point("x2");
    return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y }, midpoint: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } };
  });
}

async function drawSeparatedLines(page: Page, suffix: string) {
  await createProjectAndPiece(page, suffix);
  const canvas = page.locator(".page");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const sourceStart = { x: bounds!.x + 110, y: bounds!.y + 110 };
  const sourceEnd = { x: sourceStart.x + 120, y: sourceStart.y };
  const dependentStart = { x: bounds!.x + 340, y: bounds!.y + 180 };
  const dependentEnd = { x: dependentStart.x + 100, y: dependentStart.y + 60 };
  await drawNativeLine(page, sourceStart, sourceEnd, true);
  await drawNativeLine(page, dependentStart, dependentEnd);
  const lines = page.locator(".page-svg svg g > line[data-element-id]");
  await expect(lines).toHaveCount(2);
  return { canvas, source: lines.nth(0), dependent: lines.nth(1) };
}

test("native independent Lines relate by moving their body, persist through history/reload, and follow the source", async ({ page }) => {
  const { canvas, source, dependent } = await drawSeparatedLines(page, "body move");
  const sourceId = await source.getAttribute("data-element-id");
  const dependentId = await dependent.getAttribute("data-element-id");
  expect(sourceId).not.toBeNull();
  expect(dependentId).not.toBeNull();
  const sourcePoints = await screenPoints(source);
  const initialDependent = await screenPoints(dependent);
  const lineCountBefore = await page.locator(".page-svg svg g > line[data-element-id]").count();

  await page.getByRole("button", { name: "Seleccion", exact: true }).click();
  const bodyPoint = initialDependent.midpoint;
  const delta = { x: sourcePoints.midpoint.x - initialDependent.start.x, y: sourcePoints.midpoint.y - initialDependent.start.y };
  const targetStart = { x: initialDependent.start.x + delta.x, y: initialDependent.start.y + delta.y };
  expect(Math.hypot(targetStart.x - sourcePoints.midpoint.x, targetStart.y - sourcePoints.midpoint.y)).toBeLessThanOrEqual(8);
  await page.mouse.move(bodyPoint.x, bodyPoint.y);
  await page.mouse.down();
  await page.mouse.move(bodyPoint.x + delta.x, bodyPoint.y + delta.y, { steps: 8 });
  await page.mouse.up();

  // Native endpoint relations have no sketch-only inspector/glyph.
  await expect(page.locator(".page-svg svg g > line[data-element-id]")).toHaveCount(lineCountBefore);
  let moved = await screenPoints(dependent);
  expect(Math.hypot(moved.start.x - sourcePoints.midpoint.x, moved.start.y - sourcePoints.midpoint.y)).toBeLessThanOrEqual(8);
  expect(moved.end.x - initialDependent.end.x).toBeCloseTo(delta.x, 0);
  expect(moved.end.y - initialDependent.end.y).toBeCloseTo(delta.y, 0);
  const committedIds = await canvas.getAttribute("data-document-element-ids");
  await page.getByRole("button", { name: "Deshacer" }).click();

  await expect.poll(async () => {
    const undone = await screenPoints(dependent);
    return Math.hypot(undone.start.x - initialDependent.start.x, undone.start.y - initialDependent.start.y);
  }).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Rehacer" }).click();
  await expect(canvas).toHaveAttribute("data-document-element-ids", committedIds!);
  const committedRevision = Number(await canvas.getAttribute("data-document-revision"));
  expect(await source.getAttribute("data-element-id")).toBe(sourceId);
  expect(await dependent.getAttribute("data-element-id")).toBe(dependentId);
  const afterRedo = await Promise.all([screenPoints(source), screenPoints(dependent)]);
  expect(Math.hypot(afterRedo[1].start.x - afterRedo[0].midpoint.x, afterRedo[1].start.y - afterRedo[0].midpoint.y)).toBeLessThanOrEqual(8);
  await waitForDurableRelation(page, committedRevision, sourceId!, dependentId!);
  await page.reload();
  await expect(page.locator(".page")).toHaveAttribute("data-document-element-ids", committedIds!);
  const reloadedSource = page.locator(`.page-svg svg g > line[data-element-id="${sourceId}"]`);
  const reloadedDependent = page.locator(`.page-svg svg g > line[data-element-id="${dependentId}"]`);
  await expect(reloadedSource).toHaveAttribute("data-element-id", sourceId!);
  await expect(reloadedDependent).toHaveAttribute("data-element-id", dependentId!);
  await expect.poll(async () => {
    const [dependentPoints, sourcePoints] = await Promise.all([screenPoints(reloadedDependent), screenPoints(reloadedSource)]);
    return Math.hypot(dependentPoints.start.x - sourcePoints.midpoint.x, dependentPoints.start.y - sourcePoints.midpoint.y);
  }, { timeout: 5000 }).toBeLessThanOrEqual(8);
  moved = await screenPoints(reloadedDependent);
  const reloadedSourcePoints = await screenPoints(reloadedSource);
  expect(Math.hypot(moved.start.x - reloadedSourcePoints.midpoint.x, moved.start.y - reloadedSourcePoints.midpoint.y)).toBeLessThanOrEqual(8);

  const beforeSourceMove = await screenPoints(reloadedSource);
  await page.getByRole("button", { name: "Seleccion", exact: true }).click();
  await page.mouse.move(beforeSourceMove.end.x - 25, beforeSourceMove.end.y);
  await page.mouse.down();
  await page.mouse.move(beforeSourceMove.end.x - 25, beforeSourceMove.end.y + 35, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await screenPoints(reloadedSource)).end.y).not.toBeCloseTo(beforeSourceMove.end.y, 0);
  const afterSourceMove = await screenPoints(reloadedSource);
  const afterDependentMove = await screenPoints(reloadedDependent);
  expect(Math.hypot(afterDependentMove.start.x - afterSourceMove.midpoint.x, afterDependentMove.start.y - afterSourceMove.midpoint.y)).toBeLessThanOrEqual(8);
});

test("whole-Line drag to its source center creates a driving midpoint relation", async ({ page }) => {
  const { canvas, source: initialSource, dependent: initialDependent } = await drawSeparatedLines(page, "whole line midpoint");
  const sourceId = await initialSource.getAttribute("data-element-id");
  const dependentId = await initialDependent.getAttribute("data-element-id");
  expect(sourceId).not.toBeNull();
  expect(dependentId).not.toBeNull();
  const source = page.locator(`.page-svg svg g > line[data-element-id="${sourceId}"]`);
  const dependent = page.locator(`.page-svg svg g > line[data-element-id="${dependentId}"]`);
  const sourcePoints = await screenPoints(source);
  const before = await screenPoints(dependent);
  await page.getByRole("button", { name: "Seleccion", exact: true }).click();
  const bodyPoint = before.midpoint;
  const delta = { x: sourcePoints.midpoint.x - before.start.x, y: sourcePoints.midpoint.y - before.start.y };
  await page.mouse.move(bodyPoint.x, bodyPoint.y);
  await page.mouse.down();
  await page.mouse.move(bodyPoint.x + delta.x, bodyPoint.y + delta.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const landed = await screenPoints(dependent);
    return Math.hypot(landed.start.x - sourcePoints.midpoint.x, landed.start.y - sourcePoints.midpoint.y);
  }).toBeLessThanOrEqual(8);
  const committedRevision = Number(await canvas.getAttribute("data-document-revision"));
  await waitForDurableRelation(page, committedRevision, sourceId!, dependentId!);

  const sourceBeforeMove = await screenPoints(source);
  await moveSourceWithSelect(page, source);
  await expect.poll(async () => {
    const [movedSource, movedDependent] = await Promise.all([screenPoints(source), screenPoints(dependent)]);
    return Math.hypot(movedDependent.start.x - movedSource.midpoint.x, movedDependent.start.y - movedSource.midpoint.y);
  }).toBeLessThanOrEqual(8);
  const sourceAfterMove = await screenPoints(source);
  expect(Math.hypot(sourceAfterMove.start.x - sourceBeforeMove.start.x, sourceAfterMove.start.y - sourceBeforeMove.start.y)).toBeGreaterThan(1);

  const dependentBeforeMove = await screenPoints(dependent);
  await page.mouse.move(dependentBeforeMove.midpoint.x, dependentBeforeMove.midpoint.y);
  await page.mouse.down();
  await page.mouse.move(dependentBeforeMove.midpoint.x + 25, dependentBeforeMove.midpoint.y + 25, { steps: 6 });
  await page.mouse.up();
  const unchangedDependent = await screenPoints(dependent);
  expect(Math.hypot(unchangedDependent.end.x - dependentBeforeMove.end.x, unchangedDependent.end.y - dependentBeforeMove.end.y)).toBeGreaterThan(1);
  expect(unchangedDependent.start).toEqual(dependentBeforeMove.start);
  const afterMoveRevision = Number(await canvas.getAttribute("data-document-revision"));
  await waitForDurableRelation(page, afterMoveRevision, sourceId!, dependentId!);
});

async function dragEndpointToMidpoint(page: Page, source: Locator, dependent: Locator) {
  const sourcePoints = await screenPoints(source);
  const dependentPoints = await screenPoints(dependent);
  await page.getByRole("button", { name: "Forma", exact: true }).click();
  await page.mouse.move(dependentPoints.start.x, dependentPoints.start.y);
  await page.mouse.down();
  await page.mouse.move(sourcePoints.midpoint.x, sourcePoints.midpoint.y, { steps: 8 });
  await page.mouse.up();
  return { sourcePoints, dependentPoints };
}

async function moveSourceWithSelect(page: Page, source: Locator) {
  const before = await screenPoints(source);
  const hitPoint = {
    x: before.start.x + (before.end.x - before.start.x) * 0.2,
    y: before.start.y + (before.end.y - before.start.y) * 0.2,
  };
  await page.getByRole("button", { name: "Seleccion", exact: true }).click();
  await page.mouse.move(hitPoint.x, hitPoint.y);
  await page.mouse.down();
  await page.mouse.move(hitPoint.x, hitPoint.y + 35, { steps: 8 });
  await page.mouse.up();
  const after = await screenPoints(source);
  expect(Math.hypot(after.start.x - before.start.x, after.start.y - before.start.y), "Source Line should move from a Select-mode body drag").toBeGreaterThan(1);
}

test("Forma endpoint drag creates a persistent driving midpoint relation", async ({ page }) => {
  const { canvas, source: initialSource, dependent: initialDependent } = await drawSeparatedLines(page, "Forma drag");
  const sourceId = await initialSource.getAttribute("data-element-id");
  const dependentId = await initialDependent.getAttribute("data-element-id");
  expect(sourceId).not.toBeNull();
  expect(dependentId).not.toBeNull();
  const source = page.locator(`.page-svg svg g > line[data-element-id="${sourceId}"]`);
  const dependent = page.locator(`.page-svg svg g > line[data-element-id="${dependentId}"]`);
  const { sourcePoints, dependentPoints } = await dragEndpointToMidpoint(page, source, dependent);
  await expect.poll(async () => {
    const landed = await screenPoints(dependent);
    return Math.hypot(landed.start.x - sourcePoints.midpoint.x, landed.start.y - sourcePoints.midpoint.y);
  }).toBeLessThanOrEqual(8);

  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect.poll(async () => {
    const undone = await screenPoints(dependent);
    return Math.hypot(undone.start.x - dependentPoints.start.x, undone.start.y - dependentPoints.start.y);
  }).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Rehacer" }).click();
  await expect.poll(async () => {
    const redone = await screenPoints(dependent);
    return Math.hypot(redone.start.x - sourcePoints.midpoint.x, redone.start.y - sourcePoints.midpoint.y);
  }).toBeLessThanOrEqual(8);
  const committedRevision = Number(await canvas.getAttribute("data-document-revision"));
  await waitForDurableRelation(page, committedRevision, sourceId!, dependentId!);

  const sourceBeforeMove = await screenPoints(source);
  await moveSourceWithSelect(page, source);
  await expect.poll(async () => {
    const sourceAfterMove = await screenPoints(source);
    return Math.abs((sourceAfterMove.end.y - sourceBeforeMove.end.y) - 35);
  }).toBeLessThanOrEqual(1);
  await expect.poll(async () => {
    const [movedSource, movedDependent] = await Promise.all([screenPoints(source), screenPoints(dependent)]);
    return Math.hypot(movedDependent.start.x - movedSource.midpoint.x, movedDependent.start.y - movedSource.midpoint.y);
  }).toBeLessThanOrEqual(8);
});

test("F4b-P Forma endpoint drag attaches an independent Line to a stable open-Path segment midpoint", async ({ page }) => {
  await createProjectAndPiece(page, "F4b-P");
  const bounds = await page.locator(".page").boundingBox();
  expect(bounds).not.toBeNull();
  const pathStart = { x: bounds!.x + 110, y: bounds!.y + 130 };
  const pathEnd = { x: pathStart.x + 150, y: pathStart.y + 20 };
  await page.getByRole("button", { name: "Pluma", exact: true }).click();
  await page.mouse.click(pathStart.x, pathStart.y);
  await page.mouse.click(pathEnd.x, pathEnd.y);
  const pathElement = page.locator(".page-svg svg path[data-element-id]").first();
  await expect(pathElement).toHaveCount(1);
  await expect(pathElement).not.toHaveAttribute("d", /Z/);
  const pathId = await pathElement.getAttribute("data-element-id");
  expect(pathId).toBeTruthy();

  const lineStart = { x: bounds!.x + 350, y: bounds!.y + 220 };
  const lineEnd = { x: lineStart.x + 100, y: lineStart.y + 60 };
  await drawNativeLine(page, lineStart, lineEnd, true);
  const dependent = page.locator(".page-svg svg g > line[data-element-id]").first();
  const dependentId = await dependent.getAttribute("data-element-id");
  expect(dependentId).toBeTruthy();
  const segmentMidpoint = await pathElement.evaluate((element) => {
    const path = element as SVGPathElement;
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error("Path has no screen transform");
    const point = path.getPointAtLength(path.getTotalLength() / 2);
    const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  });
  const dependentPoints = await screenPoints(dependent);
  await page.getByRole("button", { name: "Forma", exact: true }).click();
  await page.mouse.move(dependentPoints.start.x, dependentPoints.start.y);
  await page.mouse.down();
  await page.mouse.move(segmentMidpoint.x, segmentMidpoint.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const landed = await screenPoints(dependent);
    return Math.hypot(landed.start.x - segmentMidpoint.x, landed.start.y - segmentMidpoint.y);
  }).toBeLessThanOrEqual(8);

  const canvas = page.locator(".page");
  const revision = Number(await canvas.getAttribute("data-document-revision"));
  await waitForDurableRelation(page, revision, pathId!, dependentId!, "path-segment");
  const readSegmentId = async () => page.evaluate(({ pathId, dependentId }) => new Promise<string | null>((resolve, reject) => {
    const request = indexedDB.open("nodra-persistence");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction("revisions", "readonly").objectStore("revisions").getAll();
      read.onerror = () => reject(read.error);
      read.onsuccess = () => {
        const rows = read.result as StoredRevision[];
        const relations = rows.flatMap((row) => [...(row.document.constraints ?? []), ...(row.document.pages ?? []).flatMap((documentPage) => documentPage.constraints ?? [])])
          .filter((relation) => relation.kind === "line-endpoint-midpoint" && relation.references.some((reference) => reference.elementId === dependentId) && relation.source?.kind === "path-segment" && relation.source.elementId === pathId);
        db.close();
        resolve(relations.at(-1)?.source?.segmentId ?? null);
      };
    };
  }), { pathId, dependentId });
  const segmentId = await readSegmentId();
  expect(segmentId, "Durable relation must address a stable Path segment").toBeTruthy();

  await page.reload();
  const reloadedPath = page.locator(`.page-svg svg path[data-element-id="${pathId}"]`);
  const reloadedDependent = page.locator(`.page-svg svg g > line[data-element-id="${dependentId}"]`);
  await expect(reloadedPath).toHaveCount(1);
  await expect(reloadedDependent).toHaveCount(1);
  await expect.poll(readSegmentId).toBe(segmentId);
  const pathScreenPoints = async () => reloadedPath.evaluate((element) => {
    const path = element as SVGPathElement;
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error("Path has no screen transform");
    const point = (fraction: number) => {
      const local = path.getPointAtLength(path.getTotalLength() * fraction);
      const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    };
    return { start: point(0), end: point(1), midpoint: point(0.5), body: point(0.35) };
  });
  const beforeMove = await pathScreenPoints();
  const hitPoint = beforeMove.body;
  await page.getByRole("button", { name: "Seleccion", exact: true }).click();
  await page.mouse.move(hitPoint.x, hitPoint.y);
  await page.mouse.down();
  await page.mouse.move(hitPoint.x + 35, hitPoint.y + 30, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const after = await pathScreenPoints();
    return Math.hypot(after.start.x - beforeMove.start.x, after.start.y - beforeMove.start.y);
  }).toBeGreaterThan(1);
  await expect.poll(async () => {
    const [movedPath, movedDependent] = await Promise.all([pathScreenPoints(), screenPoints(reloadedDependent)]);
    return Math.hypot(movedDependent.start.x - movedPath.midpoint.x, movedDependent.start.y - movedPath.midpoint.y);
  }).toBeLessThanOrEqual(8);
});

test("F4b-S Forma endpoint drag persists an ordered Spline span and follows source movement after reload", async ({ page }) => {
  await createProjectAndPiece(page, "F4b-S");
  const bounds = await page.locator(".page").boundingBox();
  expect(bounds).not.toBeNull();
  const splineStart = { x: bounds!.x + 110, y: bounds!.y + 130 };
  const splineEnd = { x: splineStart.x + 150, y: splineStart.y + 20 };
  await page.getByRole("button", { name: "Spline", exact: true }).click();
  await page.mouse.click(splineStart.x, splineStart.y);
  await page.mouse.click(splineEnd.x, splineEnd.y);
  const splineElement = page.locator(".page-svg svg path[data-element-id]").first();
  await expect(splineElement).toHaveCount(1);
  const splineId = await splineElement.getAttribute("data-element-id");
  expect(splineId).toBeTruthy();
  const midpoint = await splineElement.evaluate((element) => {
    const path = element as SVGPathElement;
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error("Spline has no screen transform");
    const point = path.getPointAtLength(path.getTotalLength() / 2);
    const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  });
  const lineStart = { x: bounds!.x + 350, y: bounds!.y + 220 };
  await drawNativeLine(page, lineStart, { x: lineStart.x + 100, y: lineStart.y + 60 }, true);
  const dependent = page.locator(".page-svg svg g > line[data-element-id]").first();
  const dependentId = await dependent.getAttribute("data-element-id");
  expect(dependentId).toBeTruthy();
  const before = await screenPoints(dependent);
  await page.getByRole("button", { name: "Forma", exact: true }).click();
  await page.mouse.move(before.start.x, before.start.y);
  await page.mouse.down();
  await page.mouse.move(midpoint.x, midpoint.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const landed = await screenPoints(dependent);
    return Math.hypot(landed.start.x - midpoint.x, landed.start.y - midpoint.y);
  }).toBeLessThanOrEqual(8);
  const revision = Number(await page.locator(".page").getAttribute("data-document-revision"));
  await waitForDurableRelation(page, revision, splineId!, dependentId!, "spline-span");
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect.poll(async () => {
    const undone = await screenPoints(dependent);
    return Math.hypot(undone.start.x - before.start.x, undone.start.y - before.start.y);
  }).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Rehacer" }).click();
  await expect.poll(async () => {
    const redone = await screenPoints(dependent);
    return Math.hypot(redone.start.x - midpoint.x, redone.start.y - midpoint.y);
  }).toBeLessThanOrEqual(8);
  await page.reload();
  const reloadedSpline = page.locator(`.page-svg svg path[data-element-id="${splineId}"]`);
  const reloadedDependent = page.locator(`.page-svg svg g > line[data-element-id="${dependentId}"]`);
  await expect(reloadedSpline).toHaveCount(1);
  await expect(reloadedDependent).toHaveCount(1);
  const splineMidpoint = async () => reloadedSpline.evaluate((element) => {
    const path = element as SVGPathElement; const matrix = path.getScreenCTM();
    if (!matrix) throw new Error("Spline has no screen transform");
    const point = path.getPointAtLength(path.getTotalLength() / 2); const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  });
  const beforeMove = await splineMidpoint();
  await page.getByRole("button", { name: "Seleccion", exact: true }).click();
  await page.mouse.move(beforeMove.x, beforeMove.y);
  await page.mouse.down();
  await page.mouse.move(beforeMove.x + 30, beforeMove.y + 35, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const nextMidpoint = await splineMidpoint();
    return Math.hypot(nextMidpoint.x - beforeMove.x, nextMidpoint.y - beforeMove.y);
  }, { timeout: 5000 }).toBeGreaterThan(1);
  await expect.poll(async () => {
    const [nextMidpoint, line] = await Promise.all([splineMidpoint(), screenPoints(reloadedDependent)]);
    return Math.hypot(line.start.x - nextMidpoint.x, line.start.y - nextMidpoint.y);
  }, { timeout: 5000 }).toBeLessThanOrEqual(8);
});

test("Escape cancels an uncommitted Forma endpoint drag without creating a relation", async ({ page }) => {
  const { source, dependent } = await drawSeparatedLines(page, "Forma cancel");
  const sourcePoints = await screenPoints(source);
  const dependentBefore = await screenPoints(dependent);
  await page.getByRole("button", { name: "Forma", exact: true }).click();
  await page.mouse.move(dependentBefore.start.x, dependentBefore.start.y);
  await page.mouse.down();
  await page.mouse.move(sourcePoints.midpoint.x, sourcePoints.midpoint.y, { steps: 8 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(async () => {
    const afterCancel = await screenPoints(dependent);
    const startDistance = Math.hypot(afterCancel.start.x - dependentBefore.start.x, afterCancel.start.y - dependentBefore.start.y);
    const endDistance = Math.hypot(afterCancel.end.x - dependentBefore.end.x, afterCancel.end.y - dependentBefore.end.y);
    return startDistance <= 1 && endDistance <= 1;
  }, { timeout: 5000 }).toBe(true);

  await moveSourceWithSelect(page, source);
  const movedSource = await screenPoints(source);
  const unchangedDependent = await screenPoints(dependent);
  expect(Math.hypot(unchangedDependent.start.x - dependentBefore.start.x, unchangedDependent.start.y - dependentBefore.start.y)).toBeLessThanOrEqual(1);
  expect(Math.hypot(unchangedDependent.start.x - movedSource.midpoint.x, unchangedDependent.start.y - movedSource.midpoint.y)).toBeGreaterThan(8);
});

test("F4b-K binds a native Line endpoint to a visible Sketch edge and follows edits after reload", async ({ page }) => {
  await createProjectAndPiece(page, "F4b-K Sketch edge");
  const canvas = page.locator(".page");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const sourceStart = { x: bounds!.x + 120, y: bounds!.y + 120 };
  const sourceEnd = { x: sourceStart.x + 140, y: sourceStart.y + 40 };
  await page.getByRole("button", { name: "Línea", exact: true }).click();
  await page.mouse.click(sourceStart.x, sourceStart.y);
  await page.mouse.click(sourceEnd.x, sourceEnd.y);
  const sketch = page.locator('.page-svg svg g[data-sketch-element="true"]');
  await expect(sketch).toHaveCount(1);
  const edge = sketch.locator('line[data-sketch-edge]');
  await expect(edge).toHaveCount(1);
  const sourceId = await sketch.getAttribute("data-element-id");
  const edgeId = await edge.getAttribute("data-sketch-edge");
  expect(sourceId).toBeTruthy();
  expect(edgeId).toBeTruthy();
  const sourcePoints = await screenPoints(edge);

  const dependentStart = { x: bounds!.x + 350, y: bounds!.y + 220 };
  await drawNativeLine(page, dependentStart, { x: dependentStart.x + 90, y: dependentStart.y + 50 }, true);
  const dependent = page.locator(".page-svg svg g > line[data-element-id]").first();
  const dependentId = await dependent.getAttribute("data-element-id");
  expect(dependentId).toBeTruthy();
  const before = await screenPoints(dependent);
  await page.getByRole("button", { name: "Forma", exact: true }).click();
  await page.mouse.move(before.start.x, before.start.y);
  await page.mouse.down();
  await page.mouse.move(sourcePoints.midpoint.x, sourcePoints.midpoint.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const landed = await screenPoints(dependent);
    return Math.hypot(landed.start.x - sourcePoints.midpoint.x, landed.start.y - sourcePoints.midpoint.y);
  }).toBeLessThanOrEqual(8);
  const revision = Number(await canvas.getAttribute("data-document-revision"));
  await waitForDurableRelation(page, revision, sourceId!, dependentId!, "sketch-edge");
  const readEdgeId = async () => page.evaluate(({ sourceId, dependentId }) => new Promise<string | null>((resolve, reject) => {
    const request = indexedDB.open("nodra-persistence");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction("revisions", "readonly").objectStore("revisions").getAll();
      read.onerror = () => reject(read.error);
      read.onsuccess = () => {
        const rows = read.result as StoredRevision[];
        const relation = rows.flatMap((row) => [...(row.document.constraints ?? []), ...(row.document.pages ?? []).flatMap((documentPage) => documentPage.constraints ?? [])])
          .find((item) => item.kind === "line-endpoint-midpoint" && item.references.some((reference) => reference.elementId === dependentId) && item.source?.kind === "sketch-edge" && item.source.elementId === sourceId);
        db.close();
        resolve(relation?.source?.edgeId ?? null);
      };
    };
  }), { sourceId, dependentId });
  expect(await readEdgeId()).toBe(edgeId);

  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect.poll(async () => {
    const reverted = await screenPoints(dependent);
    return Math.hypot(reverted.start.x - before.start.x, reverted.start.y - before.start.y);
  }).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Rehacer" }).click();
  await page.reload();
  const reloadedSketch = page.locator(`.page-svg svg g[data-element-id="${sourceId}"]`);
  const reloadedDependent = page.locator(`.page-svg svg g > line[data-element-id="${dependentId}"]`);
  await expect(reloadedSketch).toHaveCount(1);
  await expect(reloadedDependent).toHaveCount(1);
  await expect.poll(readEdgeId).toBe(edgeId);
  const reloadedEdge = reloadedSketch.locator(`line[data-sketch-edge="${edgeId}"]`);
  const prior = await screenPoints(reloadedEdge);
  await page.getByRole("button", { name: "Forma", exact: true }).click();
  await page.mouse.move(prior.end.x, prior.end.y);
  await page.mouse.down();
  await page.mouse.move(prior.end.x + 30, prior.end.y + 25, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const [nextEdge, nextDependent] = await Promise.all([screenPoints(reloadedEdge), screenPoints(reloadedDependent)]);
    return Math.hypot(nextDependent.start.x - nextEdge.midpoint.x, nextDependent.start.y - nextEdge.midpoint.y);
  }).toBeLessThanOrEqual(8);
});

test("F4b-A binds a Line endpoint to a persisted native Arc midpoint and follows Arc movement after reload", async ({ page }) => {
  await createProjectAndPiece(page, "F4b-A Arc lifecycle");
  const canvas = page.locator(".page");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const start = { x: bounds!.x + 140, y: bounds!.y + 220 };
  const end = { x: start.x + 140, y: start.y };
  const through = { x: start.x + 70, y: start.y - 70 };
  await page.getByRole("button", { name: "Arco", exact: true }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  await page.mouse.move(through.x, through.y);
  await expect(page.locator(".creation-pending-overlay path")).toBeVisible();
  await page.mouse.click(through.x, through.y);
  const arc = page.locator(".page-svg svg path[data-element-id]").first();
  await expect(arc).toHaveCount(1);
  const arcId = await arc.getAttribute("data-element-id");
  expect(arcId).toBeTruthy();
  const arcPointAt = (fraction: number) => arc.evaluate((element, fraction) => {
    const path = element as SVGPathElement;
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error("Arc has no screen transform");
    const local = path.getPointAtLength(path.getTotalLength() * fraction);
    const point = new DOMPoint(local.x, local.y).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  }, fraction);
  const midpoint = await arcPointAt(0.5);
  const dependentStart = { x: bounds!.x + 150, y: bounds!.y + 160 };
  await drawNativeLine(page, dependentStart, { x: dependentStart.x + 35, y: dependentStart.y + 20 }, true);
  const dependent = page.locator(".page-svg svg g > line[data-element-id]").first();
  const dependentId = await dependent.getAttribute("data-element-id");
  expect(dependentId).toBeTruthy();
  const before = await screenPoints(dependent);
  await page.getByRole("button", { name: "Forma", exact: true }).click();
  await page.mouse.move(before.start.x, before.start.y);
  await page.mouse.down();
  await page.mouse.move(midpoint.x, midpoint.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const endpoint = (await screenPoints(dependent)).start;
    return Math.hypot(endpoint.x - midpoint.x, endpoint.y - midpoint.y);
  }).toBeLessThanOrEqual(8);
  const committedRevision = Number(await canvas.getAttribute("data-document-revision"));
  await waitForDurableRelation(page, committedRevision, arcId!, dependentId!, "arc");
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect.poll(async () => {
    const endpoint = (await screenPoints(dependent)).start;
    return Math.hypot(endpoint.x - before.start.x, endpoint.y - before.start.y);
  }).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Rehacer" }).click();
  await page.reload();
  const reloadedArc = page.locator(`.page-svg svg path[data-element-id="${arcId}"]`);
  const reloadedDependent = page.locator(`.page-svg svg g > line[data-element-id="${dependentId}"]`);
  await expect(reloadedArc).toHaveCount(1);
  await expect(reloadedDependent).toHaveCount(1);
  const reloadedArcPointAt = (fraction: number) => reloadedArc.evaluate((element, fraction) => {
    const path = element as SVGPathElement;
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error("Arc has no screen transform");
    const local = path.getPointAtLength(path.getTotalLength() * fraction);
    const point = new DOMPoint(local.x, local.y).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  }, fraction);
  await expect.poll(async () => {
    const [arcMidpoint, line] = await Promise.all([reloadedArcPointAt(0.5), screenPoints(reloadedDependent)]);
    return Math.hypot(line.start.x - arcMidpoint.x, line.start.y - arcMidpoint.y);
  }).toBeLessThanOrEqual(8);
  const beforeMove = await reloadedArcPointAt(0.3);
  await page.getByRole("button", { name: "Seleccion", exact: true }).click();
  await page.mouse.move(beforeMove.x, beforeMove.y);
  await page.mouse.down();
  await page.mouse.move(beforeMove.x + 28, beforeMove.y + 24, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const after = await reloadedArcPointAt(0.3);
    return Math.hypot(after.x - beforeMove.x, after.y - beforeMove.y);
  }).toBeGreaterThan(1);
  await expect.poll(async () => {
    const [arcMidpoint, line] = await Promise.all([reloadedArcPointAt(0.5), screenPoints(reloadedDependent)]);
    return Math.hypot(line.start.x - arcMidpoint.x, line.start.y - arcMidpoint.y);
  }).toBeLessThanOrEqual(8);
});
