import { expect, test } from "@playwright/test";

test("Line midpoint inference shows a transient glyph without changing the document", async ({ page }) => {
  await page.goto("/proyectos");
  await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
  await page.getByLabel("Nombre del proyecto").fill("Proyecto de punto medio");
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await page.getByRole("region", { name: "Piezas" }).getByRole("button", { name: "+ Nueva pieza" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva pieza" });
  await dialog.getByLabel("Nombre de la pieza").fill("Pieza de prueba");
  await dialog.getByRole("button", { name: "Crear pieza" }).click();

  const pageElement = page.locator(".page");
  const pageBounds = await pageElement.boundingBox();
  expect(pageBounds).not.toBeNull();
  const start = { x: pageBounds!.x + 120, y: pageBounds!.y + 120 };
  const end = { x: start.x + 100, y: start.y };

  await page.getByRole("button", { name: "Línea", exact: true }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  const revision = await pageElement.getAttribute("data-document-revision");
  const elementIds = await pageElement.getAttribute("data-document-element-ids");
  expect(revision).not.toBeNull();
  expect(elementIds).not.toBeNull();

  await page.mouse.move((start.x + end.x) / 2, start.y);
  const glyph = page.locator("[data-line-midpoint-glyph]");
  await expect(glyph).toBeVisible();
  await expect(glyph).toHaveCSS("pointer-events", "none");
  const initialGlyphBounds = await glyph.locator("circle").boundingBox();
  expect(initialGlyphBounds).not.toBeNull();
  const initialZoomLabel = Number((await page.locator(".zoom-label").textContent())?.replace("%", ""));
  await page.getByRole("button", { name: "Acercar" }).click();
  await expect.poll(async () => Number((await page.locator(".zoom-label").textContent())?.replace("%", ""))).toBeGreaterThan(initialZoomLabel);
  const zoomedGlyphBounds = await glyph.locator("circle").boundingBox();
  expect(zoomedGlyphBounds).not.toBeNull();
  expect(zoomedGlyphBounds!.width).toBeCloseTo(initialGlyphBounds!.width, 0);
  expect(zoomedGlyphBounds!.height).toBeCloseTo(initialGlyphBounds!.height, 0);
  await expect(pageElement).toHaveAttribute("data-document-revision", revision!);
  await expect(pageElement).toHaveAttribute("data-document-element-ids", elementIds!);
  await expect(page.locator('.page-svg svg g[data-element-id] > line')).toHaveCount(1);

  await page.mouse.move(pageBounds!.x + 360, pageBounds!.y + 240);
  await expect(glyph).toHaveCount(0);
  await expect(pageElement).toHaveAttribute("data-document-revision", revision!);
  await expect(pageElement).toHaveAttribute("data-document-element-ids", elementIds!);
});
