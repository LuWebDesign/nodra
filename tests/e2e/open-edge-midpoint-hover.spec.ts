import { expect, test } from "@playwright/test";

test("open-edge midpoint hover is informational across editing tools", async ({ page }) => {
  await page.goto("/proyectos");
  await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
  await page.getByLabel("Nombre del proyecto").fill("Proyecto de punto medio de borde");
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

  const marker = page.locator("[data-open-edge-midpoint-hover]");
  let midpoint = { x: (start.x + end.x) / 2, y: start.y };
  let nearEndpoint = { x: start.x + 12, y: start.y };
  const assertMarker = async (): Promise<void> => {
    await expect(marker).toBeVisible();
    await expect(marker).toHaveCSS("pointer-events", "none");
    const bounds = await marker.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeCloseTo(8, 0);
    expect(bounds!.height).toBeCloseTo(8, 0);
    expect(Math.abs(bounds!.x + bounds!.width / 2 - midpoint.x)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(bounds!.y + bounds!.height / 2 - midpoint.y)).toBeLessThanOrEqual(1.5);
    const color = await marker.evaluate((element) => {
      return getComputedStyle(element).backgroundColor;
    });
    expect(color).toMatch(/orange|#f97316|#ffa500|rgb\(255,\s*165,\s*0\)|rgb\(249,\s*115,\s*22\)/i);
  };
  const assertDocumentUnchanged = async (): Promise<void> => {
    await expect(pageElement).toHaveAttribute("data-document-revision", revision!);
    await expect(pageElement).toHaveAttribute("data-document-element-ids", elementIds!);
  };

  // Hover near the endpoint, deliberately far from the edge's calculated midpoint.
  await page.mouse.move(nearEndpoint.x, nearEndpoint.y);
  await assertMarker();
  await assertDocumentUnchanged();

  // Selection and Forma clicks remain informational and do not add/edit geometry.
  for (const toolName of ["Seleccion", "Forma"]) {
    await page.getByRole("button", { name: toolName, exact: true }).click();
    await page.mouse.move(nearEndpoint.x, nearEndpoint.y);
    await assertMarker();
    await page.mouse.click(nearEndpoint.x, nearEndpoint.y);
    await assertDocumentUnchanged();
    await expect(page.locator('.page-svg svg g[data-element-id] > line')).toHaveCount(1);
  }

  await page.mouse.move(pageBounds!.x + 360, pageBounds!.y + 240);
  await expect(marker).toHaveCount(0);
  await assertDocumentUnchanged();

  // Pan is another editing tool; hover remains available without changing the document.
  await page.getByRole("button", { name: "Desplazar", exact: true }).click();
  await page.mouse.move(nearEndpoint.x, nearEndpoint.y);
  await assertMarker();
  await assertDocumentUnchanged();

  const markerBeforeZoom = await marker.boundingBox();
  expect(markerBeforeZoom).not.toBeNull();
  const initialZoom = Number((await page.locator(".zoom-label").textContent())?.replace("%", ""));
  await page.getByRole("button", { name: "Acercar" }).click();
  await expect.poll(async () => Number((await page.locator(".zoom-label").textContent())?.replace("%", ""))).toBeGreaterThan(initialZoom);
  const zoomedLineBounds = await page.locator('.page-svg svg g[data-element-id] > line').boundingBox();
  expect(zoomedLineBounds).not.toBeNull();
  midpoint = { x: zoomedLineBounds!.x + zoomedLineBounds!.width / 2, y: zoomedLineBounds!.y + zoomedLineBounds!.height / 2 };
  nearEndpoint = { x: zoomedLineBounds!.x + 12, y: zoomedLineBounds!.y + zoomedLineBounds!.height / 2 };
  await page.mouse.move(nearEndpoint.x, nearEndpoint.y);
  await assertMarker();
  const markerAfterZoom = await marker.boundingBox();
  expect(markerAfterZoom).not.toBeNull();
  expect(markerAfterZoom!.width).toBeCloseTo(8, 0);
  expect(markerAfterZoom!.height).toBeCloseTo(8, 0);
  await assertDocumentUnchanged();

  // Move away only after checking zoom: no stale marker may outlive its source hover.
  await page.mouse.move(pageBounds!.x + 360, pageBounds!.y + 240);
  await expect(marker).toHaveCount(0);
  await assertDocumentUnchanged();
});
