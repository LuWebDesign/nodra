import { expect, test } from "@playwright/test";

test("confirmed Line midpoint snap persists atomically and ignores body hover", async ({ page }) => {
  await page.goto("/proyectos");
  await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
  await page.getByLabel("Nombre del proyecto").fill("Proyecto midpoint confirmado");
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await page.getByRole("region", { name: "Piezas" }).getByRole("button", { name: "+ Nueva pieza" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva pieza" });
  await dialog.getByLabel("Nombre de la pieza").fill("Pieza de prueba");
  await dialog.getByRole("button", { name: "Crear pieza" }).click();

  const canvas = page.locator(".page");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const start = { x: bounds!.x + 120, y: bounds!.y + 120 };
  const end = { x: start.x + 120, y: start.y };
  await page.getByRole("button", { name: "Línea", exact: true }).click();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.waitForTimeout(180);
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();

  const nativeSource = page.locator('.page-svg svg g > line[data-element-id]').first();
  await expect(nativeSource).toHaveCount(1);
  const sourceId = await nativeSource.getAttribute("data-element-id");
  expect(sourceId).toBeTruthy();
  let midpoint = await nativeSource.evaluate((line) => {
    const svg = line as SVGLineElement;
    const matrix = svg.getScreenCTM();
    if (!matrix) throw new Error("Native Line has no screen transform");
    return new DOMPoint(
      (Number(svg.getAttribute("x1")) + Number(svg.getAttribute("x2"))) / 2,
      (Number(svg.getAttribute("y1")) + Number(svg.getAttribute("y2"))) / 2,
    ).matrixTransform(matrix);
  });
  const body = await nativeSource.boundingBox();
  expect(body).not.toBeNull();
  const farBody = { x: body!.x + body!.width * 0.2, y: midpoint.y };
  await page.mouse.move(farBody.x, farBody.y);
  await expect(page.locator("[data-open-edge-midpoint-hover]")).toBeVisible();
  await page.mouse.click(farBody.x, farBody.y);
  await page.mouse.click(farBody.x + 55, farBody.y + 45);
  const globalRelations = page.getByRole("list", { name: "Relaciones globales" });
  await expect(globalRelations.getByText(/Punto medio/)).toHaveCount(0);

  // Confirm the driving snap after zoom, using a fresh model-to-screen midpoint transform.
  const initialZoom = Number((await page.locator(".zoom-label").textContent())?.replace("%", ""));
  await page.getByRole("button", { name: "Acercar" }).click();
  await expect.poll(async () => Number((await page.locator(".zoom-label").textContent())?.replace("%", ""))).toBeGreaterThan(initialZoom);
  midpoint = await nativeSource.evaluate((line) => {
    const svg = line as SVGLineElement;
    const matrix = svg.getScreenCTM();
    if (!matrix) throw new Error("Native Line has no screen transform after zoom");
    return new DOMPoint(
      (Number(svg.getAttribute("x1")) + Number(svg.getAttribute("x2"))) / 2,
      (Number(svg.getAttribute("y1")) + Number(svg.getAttribute("y2"))) / 2,
    ).matrixTransform(matrix);
  });

  // A first-click snap carries its source until the second click creates the dependent sketch.
  await page.getByRole("button", { name: "Seleccion" }).click();
  const cancellationIds = await canvas.getAttribute("data-document-element-ids");
  const cancellationRevision = await canvas.getAttribute("data-document-revision");
  await page.getByRole("button", { name: "Línea", exact: true }).click();
  await page.mouse.click(midpoint.x, midpoint.y);
  await page.mouse.click(midpoint.x + 70, midpoint.y + 60);
  const createdIds = await canvas.getAttribute("data-document-element-ids");
  expect(createdIds).not.toBe(cancellationIds);
  const sketchLines = page.locator('.page-svg svg g[data-element-id] > line');
  await expect(sketchLines).toHaveCount(2);
  await expect(nativeSource).toHaveCount(1);
  await expect(canvas).not.toHaveAttribute("data-document-revision", cancellationRevision!);
  await page.getByRole("button", { name: "Seleccion" }).click();
  await page.mouse.click(midpoint.x + 35, midpoint.y + 30);
  const relation = globalRelations.getByText(/Punto medio/);
  await expect(relation).toBeVisible();
  await expect(sketchLines).toHaveCount(2);
  const dependentLine = sketchLines.last();
  const startNode = await dependentLine.evaluate((line) => ({ x: Number(line.getAttribute("x1")), y: Number(line.getAttribute("y1")) }));
  const sourceMm = await nativeSource.evaluate((line) => ({ x1: Number(line.getAttribute("x1")), y1: Number(line.getAttribute("y1")), x2: Number(line.getAttribute("x2")), y2: Number(line.getAttribute("y2")) }));
  expect(startNode.x).toBeCloseTo((sourceMm.x1 + sourceMm.x2) / 2, 2);
  expect(startNode.y).toBeCloseTo((sourceMm.y1 + sourceMm.y2) / 2, 2);

  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(relation).toHaveCount(0);
  await expect(canvas).not.toHaveAttribute("data-document-element-ids", createdIds!);
  await expect(sketchLines).toHaveCount(1);
  await page.getByRole("button", { name: "Rehacer" }).click();
  await expect(canvas).toHaveAttribute("data-document-element-ids", createdIds!);
  await page.getByRole("button", { name: "Seleccion" }).click();
  await page.mouse.click(midpoint.x + 35, midpoint.y + 30);
  await expect(relation).toBeVisible();
  await expect(nativeSource).toHaveCount(1);

  const sourceEndpoints = async () => nativeSource.evaluate((line) => {
    const svgLine = line as SVGLineElement;
    return { x1: Number(svgLine.getAttribute("x1")), y1: Number(svgLine.getAttribute("y1")), x2: Number(svgLine.getAttribute("x2")), y2: Number(svgLine.getAttribute("y2")) };
  });
  const beforeMove = await sourceEndpoints();
  const endpointScreen = await nativeSource.evaluate((line) => {
    const svgLine = line as SVGLineElement;
    const matrix = svgLine.getScreenCTM();
    if (!matrix) throw new Error("Native Line has no screen transform");
    return new DOMPoint(Number(svgLine.getAttribute("x2")), Number(svgLine.getAttribute("y2"))).matrixTransform(matrix);
  });
  await page.getByRole("button", { name: "Forma" }).click();
  await page.mouse.move(endpointScreen.x, endpointScreen.y);
  await page.mouse.down();
  await page.mouse.move(endpointScreen.x + 32, endpointScreen.y + 18, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await sourceEndpoints()).x2).not.toBe(beforeMove.x2);
  const movedSource = await sourceEndpoints();
  const movedStart = await dependentLine.evaluate((line) => ({ x: Number(line.getAttribute("x1")), y: Number(line.getAttribute("y1")) }));
  expect(movedStart.x).toBeCloseTo((movedSource.x1 + movedSource.x2) / 2, 2);
  expect(movedStart.y).toBeCloseTo((movedSource.y1 + movedSource.y2) / 2, 2);
  await page.getByRole("button", { name: "Seleccion" }).click();
  await page.mouse.click(midpoint.x + 35, midpoint.y + 30);
  await expect(page.getByRole("list", { name: "Relaciones globales" }).getByText(/Punto medio/)).toBeVisible();

  // Let the debounced project autosave finish before reloading the durable state.
  await page.waitForTimeout(800);
  const durableIds = await canvas.getAttribute("data-document-element-ids");
  const durableRevision = await canvas.getAttribute("data-document-revision");
  await page.reload();
  const reloadedCanvas = page.locator(".page");
  await expect(reloadedCanvas).toHaveAttribute("data-document-element-ids", durableIds!);
  await expect(reloadedCanvas).toHaveAttribute("data-document-revision", durableRevision!);
  const reloadedSource = page.locator(`.page-svg svg g > line[data-element-id="${sourceId}"]`);
  await expect(reloadedSource).toHaveCount(1);
  const reloadedDependent = page.locator('.page-svg svg g[data-element-id] > line').last();
  const reloadedSourceMm = await reloadedSource.evaluate((line) => ({ x1: Number(line.getAttribute("x1")), y1: Number(line.getAttribute("y1")), x2: Number(line.getAttribute("x2")), y2: Number(line.getAttribute("y2")) }));
  expect(reloadedSourceMm.x2).toBeCloseTo(movedSource.x2, 2);
  expect(reloadedSourceMm.y2).toBeCloseTo(movedSource.y2, 2);
  const reloadedStart = await reloadedDependent.evaluate((line) => ({ x: Number(line.getAttribute("x1")), y: Number(line.getAttribute("y1")) }));
  expect(reloadedStart.x).toBeCloseTo((reloadedSourceMm.x1 + reloadedSourceMm.x2) / 2, 2);
  expect(reloadedStart.y).toBeCloseTo((reloadedSourceMm.y1 + reloadedSourceMm.y2) / 2, 2);
  await page.getByRole("button", { name: "Seleccion" }).click();
  const reloadedSketch = page.locator('.page-svg svg g[data-element-id]').last();
  const reloadedSketchBox = await reloadedSketch.boundingBox();
  expect(reloadedSketchBox).not.toBeNull();
  await page.mouse.click(reloadedSketchBox!.x + reloadedSketchBox!.width / 2, reloadedSketchBox!.y + reloadedSketchBox!.height / 2);
  await expect(page.getByRole("list", { name: "Relaciones globales" }).getByText(/Punto medio/)).toBeVisible();
});

test("cancelling a first-click native Line midpoint draft leaves the document unchanged", async ({ page }) => {
  await page.goto("/proyectos");
  await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
  await page.getByLabel("Nombre del proyecto").fill("Proyecto midpoint cancelado");
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await page.getByRole("region", { name: "Piezas" }).getByRole("button", { name: "+ Nueva pieza" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva pieza" });
  await dialog.getByLabel("Nombre de la pieza").fill("Pieza de prueba");
  await dialog.getByRole("button", { name: "Crear pieza" }).click();

  const canvas = page.locator(".page");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const start = { x: bounds!.x + 120, y: bounds!.y + 120 };
  await page.getByRole("button", { name: "Línea", exact: true }).click();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.waitForTimeout(180);
  await page.mouse.move(start.x + 120, start.y, { steps: 5 });
  await page.mouse.up();
  const source = page.locator('.page-svg svg g > line[data-element-id]').first();
  await expect(source).toHaveCount(1);
  const midpoint = await source.evaluate((line) => {
    const svg = line as SVGLineElement;
    const matrix = svg.getScreenCTM();
    if (!matrix) throw new Error("Native Line has no screen transform");
    return new DOMPoint((Number(svg.getAttribute("x1")) + Number(svg.getAttribute("x2"))) / 2, (Number(svg.getAttribute("y1")) + Number(svg.getAttribute("y2"))) / 2).matrixTransform(matrix);
  });
  const beforeIds = await canvas.getAttribute("data-document-element-ids");
  const beforeRevision = await canvas.getAttribute("data-document-revision");
  await page.mouse.click(midpoint.x, midpoint.y);
  await page.keyboard.press("Escape");
  await expect(canvas).toHaveAttribute("data-document-element-ids", beforeIds!);
  await expect(canvas).toHaveAttribute("data-document-revision", beforeRevision!);
  await expect(page.getByRole("list", { name: "Relaciones globales" }).getByText(/Punto medio/)).toHaveCount(0);
});
