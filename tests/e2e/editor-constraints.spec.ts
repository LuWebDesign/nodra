import { expect, test } from "@playwright/test";

test("sketch edges stay blue by default, turn orange on hover, and preserve defined black", async ({ page }) => {
  await page.goto("/proyectos");
  await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
  await page.getByLabel("Nombre del proyecto").fill("Sketch edge hover");
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await page.getByRole("region", { name: "Piezas" }).getByRole("button", { name: "+ Nueva pieza" }).click();
  const pieceDialog = page.getByRole("dialog", { name: "Nueva pieza" });
  await pieceDialog.getByLabel("Nombre de la pieza").fill("Hover test");
  await pieceDialog.getByRole("button", { name: "Crear pieza" }).click();
  await expect(page.getByRole("toolbar", { name: "Herramientas de diseño" })).toBeVisible();
  const pageBounds = await page.locator(".page").boundingBox();
  expect(pageBounds).not.toBeNull();
  const start = { x: pageBounds!.x + 120, y: pageBounds!.y + 120 };
  const end = { x: start.x + 100, y: start.y + 30 };

  await page.getByRole("button", { name: "Línea", exact: true }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  const sketch = page.locator('.page-svg svg g[data-sketch-element="true"]');
  await expect(sketch).toHaveCount(1);
  const edge = sketch.locator('line[data-sketch-edge]');
  await expect(edge).toHaveCount(1);
  await page.getByRole("button", { name: "Seleccion", exact: true }).click();
  const hoverPoint = { x: start.x + 50, y: start.y + 15 };
  await expect(edge).toHaveCSS("stroke", "rgb(37, 99, 235)");
  await page.mouse.move(hoverPoint.x, hoverPoint.y);
  await expect(edge).toHaveCSS("stroke", "rgb(245, 158, 11)");

  await page.mouse.move(pageBounds!.x + 320, pageBounds!.y + 230);
  await expect(edge).toHaveCSS("stroke", "rgb(37, 99, 235)");

  await page.getByRole("button", { name: "Desplazar", exact: true }).click();
  await page.mouse.move(hoverPoint.x, hoverPoint.y);
  await expect(edge).toHaveCSS("stroke", "rgb(245, 158, 11)");
  await page.mouse.move(pageBounds!.x + 320, pageBounds!.y + 230);
  await expect(edge).toHaveCSS("stroke", "rgb(37, 99, 235)");

  await sketch.evaluate((element) => { element.setAttribute("data-sketch-state", "fully-defined"); element.setAttribute("stroke", "#111827"); });
  await edge.evaluate((element) => element.setAttribute("data-sketch-hovered", "true"));
  await expect(edge).toHaveCSS("stroke", "rgb(17, 24, 39)");
});
