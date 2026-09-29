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

  const nativeSource = page.locator('.page-svg svg > g > line[data-element-id]').first();
  await expect(nativeSource).toHaveCount(1);
  const sourceId = await nativeSource.getAttribute("data-element-id");
  expect(sourceId).toBeTruthy();
  const midpoint = await nativeSource.evaluate((line) => {
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
  const revision = await canvas.getAttribute("data-document-revision");
  const sourceDocumentIds = await canvas.getAttribute("data-document-element-ids");
  await page.mouse.move(farBody.x, farBody.y);
  await expect(page.locator("[data-open-edge-midpoint-hover]")).toBeVisible();
  await page.mouse.click(farBody.x, farBody.y);
  await page.mouse.click(farBody.x + 55, farBody.y + 45);
  const globalRelations = page.getByRole("list", { name: "Relaciones globales" });
  await expect(globalRelations.getByText(/Punto medio/)).toHaveCount(0);

  // A first-click snap carries its source until the second click creates the dependent sketch.
  await page.keyboard.press("Escape");
  await page.mouse.click(midpoint.x, midpoint.y);
  await page.mouse.click(midpoint.x + 70, midpoint.y + 60);
  const createdIds = await canvas.getAttribute("data-document-element-ids");
  expect(createdIds).not.toBe(sourceDocumentIds);
  await expect(page.locator('.page-svg svg > g > line[data-element-id]')).toHaveCount(1);
  await expect(canvas).not.toHaveAttribute("data-document-revision", revision!);
  await page.getByRole("button", { name: "Seleccion" }).click();
  await page.mouse.click(midpoint.x + 35, midpoint.y + 30);
  const relation = globalRelations.getByText(/Punto medio/);
  await expect(relation).toBeVisible();

  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(relation).toHaveCount(0);
  await expect(canvas).not.toHaveAttribute("data-document-element-ids", createdIds!);
  await expect(page.locator('.page-svg svg > g > line[data-element-id]')).toHaveCount(1);
  await page.getByRole("button", { name: "Rehacer" }).click();
  await expect(canvas).toHaveAttribute("data-document-element-ids", createdIds!);
  await page.getByRole("button", { name: "Seleccion" }).click();
  await page.mouse.click(midpoint.x + 35, midpoint.y + 30);
  await expect(relation).toBeVisible();
  await expect(page.locator(`.page-svg svg > g > line[data-element-id="${sourceId}"]`)).toHaveCount(1);
});
