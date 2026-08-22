import { expect, test, type Page } from "@playwright/test";

async function drawRectangle(page: Page) {
  await page.getByRole("button", { name: "Rectángulo" }).click();
  const pageBounds = await page.locator(".page").boundingBox();
  const canvasBounds = await page.locator(".canvas").boundingBox();
  expect(pageBounds).not.toBeNull();
  expect(canvasBounds).not.toBeNull();

  const visibleLeft = Math.max(pageBounds!.x, canvasBounds!.x);
  const visibleTop = Math.max(pageBounds!.y, canvasBounds!.y);
  const visibleRight = Math.min(pageBounds!.x + pageBounds!.width, canvasBounds!.x + canvasBounds!.width);
  const visibleBottom = Math.min(pageBounds!.y + pageBounds!.height, canvasBounds!.y + canvasBounds!.height);
  const availableWidth = visibleRight - visibleLeft - 2;
  const availableHeight = visibleBottom - visibleTop - 2;
  expect(availableWidth).toBeGreaterThan(0);
  expect(availableHeight).toBeGreaterThan(0);

  const rectangleWidth = Math.min(140, availableWidth);
  const rectangleHeight = Math.min(90, availableHeight);
  const start = {
    x: visibleLeft + 1 + Math.min(40, availableWidth - rectangleWidth),
    y: visibleTop + 1 + Math.min(40, availableHeight - rectangleHeight),
  };
  const end = { x: start.x + rectangleWidth, y: start.y + rectangleHeight };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();
  await expect(page.locator(".page-svg svg")).toBeVisible();
}

test("loads the editor workspace", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Nodra Editor");
  await expect(page.getByRole("region", { name: "Barra de propiedades" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Seleccion" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pluma" })).toHaveAttribute("aria-description", /Cree un trazado abierto/);
});

test("creates an open path with Pluma and exposes its anchors", async ({ page }) => {
  await page.goto("/");
  const pageBounds = await page.locator(".page").boundingBox();
  expect(pageBounds).not.toBeNull();
  await page.getByRole("button", { name: "Pluma" }).click();
  const x = pageBounds!.x + 80;
  const y = pageBounds!.y + 80;
  await page.mouse.click(x, y);
  await page.mouse.click(x + 80, y + 30);
  await page.mouse.click(x + 160, y);
  await expect(page.locator(".page-svg svg path[data-element-id]")).toHaveCount(1);
  await expect(page.locator(".contour-node")).toHaveCount(3);
});

test("deletes a selected Pluma anchor without deleting the path", async ({ page }) => {
  await page.goto("/");
  const pageBounds = await page.locator(".page").boundingBox();
  expect(pageBounds).not.toBeNull();
  await page.getByRole("button", { name: "Pluma" }).click();
  const x = pageBounds!.x + 80;
  const y = pageBounds!.y + 80;
  await page.mouse.click(x, y);
  await page.mouse.click(x + 80, y + 30);
  await page.mouse.click(x + 160, y);
  const nodes = page.locator(".contour-node");
  await expect(nodes).toHaveCount(3);
  const middle = await nodes.nth(1).boundingBox();
  expect(middle).not.toBeNull();
  await page.mouse.click(middle!.x + middle!.width / 2, middle!.y + middle!.height / 2);
  await page.keyboard.press("Backspace");
  await expect(page.locator(".page-svg svg path[data-element-id]")).toHaveCount(1);
  await expect(nodes).toHaveCount(2);
});

test("splits a selected path segment from Forma and supports undo and redo", async ({ page }) => {
  await page.goto("/");
  const pageBounds = await page.locator(".page").boundingBox();
  expect(pageBounds).not.toBeNull();
  await page.getByRole("button", { name: "Pluma" }).click();
  const start = { x: pageBounds!.x + 100, y: pageBounds!.y + 180 };
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(start.x + 160, start.y);
  await page.mouse.click(start.x + 80, start.y);

  const split = page.getByRole("button", { name: "Dividir segmento del trazado en el punto medio" });
  await expect(split).toBeVisible();
  await split.click();
  await expect(page.locator(".contour-node")).toHaveCount(3);
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(page.locator(".contour-node")).toHaveCount(2);
  await page.getByRole("button", { name: "Rehacer" }).click();
  await expect(page.locator(".contour-node")).toHaveCount(3);
});

test("creates a cubic segment when placing an anchor with a drag", async ({ page }) => {
  await page.goto("/");
  const pageBounds = await page.locator(".page").boundingBox();
  expect(pageBounds).not.toBeNull();
  await page.getByRole("button", { name: "Pluma" }).click();
  const start = { x: pageBounds!.x + 80, y: pageBounds!.y + 120 };
  const anchor = { x: start.x + 120, y: start.y };
  await page.mouse.click(start.x, start.y);
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.down();
  await page.mouse.move(anchor.x, anchor.y + 50);
  await page.mouse.up();
  await expect(page.locator(".page-svg svg path[data-element-id]")).toHaveAttribute("d", / C/);
});

test("creates, transforms, and undoes a rectangle", async ({ page }) => {
  await page.goto("/");
  await drawRectangle(page);

  const rectangle = page.locator(".page-svg svg rect").first();
  await expect(rectangle).toBeVisible();
  const rectangleBounds = await rectangle.boundingBox();
  expect(rectangleBounds).not.toBeNull();
  await page.getByRole("button", { name: "Seleccion" }).click();
  await page.mouse.click(rectangleBounds!.x + rectangleBounds!.width / 2, rectangleBounds!.y + rectangleBounds!.height / 2);
  const width = page.locator(".inspector").getByLabel("Ancho en milímetros");
  const originalWidth = Number(await width.inputValue());
  await width.fill(String(originalWidth + 10));
  await width.press("Enter");
  await expect(width).toHaveValue(String(originalWidth + 10));
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(width).toHaveValue(String(originalWidth));
});

test("places the color palette in the status bar and duplicates directionally", async ({ page }) => {
  await page.goto("/");
  await drawRectangle(page);
  const rectangle = page.locator(".page-svg svg rect").first();
  const rectangleBounds = await rectangle.boundingBox();
  expect(rectangleBounds).not.toBeNull();
  await page.mouse.click(rectangleBounds!.x + rectangleBounds!.width / 2, rectangleBounds!.y + rectangleBounds!.height / 2);

  await expect(page.getByRole("tab", { name: "Propiedades" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".statusbar .status-palette")).toBeVisible();
  await expect(page.locator(".statusbar .palette")).toBeVisible();
  await page.getByRole("tab", { name: "Transformar" }).click();
  await page.getByRole("button", { name: "Este", exact: true }).click();
  await page.getByLabel("Distancia entre copias en milímetros").fill("5");
  await page.getByLabel("Cantidad de copias").fill("1");
  await page.getByRole("button", { name: "Reproducir copias" }).click();
  await expect(page.locator(".page-svg svg rect")).toHaveCount(2);
});

test("draws a nested object from an existing object with a drawing tool", async ({ page }) => {
  await page.goto("/");
  await drawRectangle(page);

  const rectangle = page.locator(".page-svg svg rect").first();
  const originalBounds = await rectangle.boundingBox();
  expect(originalBounds).not.toBeNull();
  await page.getByRole("button", { name: "Rectángulo" }).click();
  await page.mouse.click(originalBounds!.x + originalBounds!.width / 2, originalBounds!.y + originalBounds!.height / 2);
  await expect(page.locator(".inspector").getByLabel("Ancho en milímetros")).toBeVisible();
  await expect(page.locator(".page-svg svg rect")).toHaveCount(1);

  await page.mouse.move(originalBounds!.x + originalBounds!.width / 2, originalBounds!.y + originalBounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(originalBounds!.x + originalBounds!.width / 2 + 30, originalBounds!.y + originalBounds!.height / 2 + 20);
  await page.mouse.up();

  await expect(page.locator(".page-svg svg rect")).toHaveCount(2);
  const nestedBounds = await page.locator(".page-svg svg rect").nth(1).boundingBox();
  expect(nestedBounds).not.toBeNull();
  expect(nestedBounds!.x).toBeGreaterThan(originalBounds!.x);
  expect(nestedBounds!.y).toBeGreaterThan(originalBounds!.y);
});

test("renders created geometry as SVG", async ({ page }) => {
  await page.goto("/");
  await drawRectangle(page);

  await expect(page.locator(".page-svg svg")).toHaveAttribute("viewBox", /.+/);
  await expect(page.locator(".page-svg svg rect")).toHaveCount(1);
});

test("exposes real contour vertices in Forma and edits one vertex", async ({ page }) => {
  await page.goto("/");
  await drawRectangle(page);
  const first = await page.locator(".page-svg svg rect").first().boundingBox();
  expect(first).not.toBeNull();
  await page.getByRole("button", { name: "Rectángulo" }).click();
  await page.mouse.move(first!.x + 40, first!.y + 40);
  await page.mouse.down();
  await page.mouse.move(first!.x + first!.width + 40, first!.y + first!.height + 40);
  await page.mouse.up();

  await page.getByRole("button", { name: "Seleccion" }).click();
  await page.mouse.click(first!.x + 4, first!.y + 4);
  await page.keyboard.down("Shift");
  await page.mouse.click(first!.x + first!.width / 2 + 40, first!.y + first!.height / 2 + 40);
  await page.keyboard.up("Shift");
  await page.getByRole("button", { name: "Soldar" }).click();
  await page.getByRole("button", { name: "Forma" }).click();
  const nodes = page.locator(".contour-node");
  await expect(nodes.first()).toBeVisible();
  await expect(nodes.first()).toHaveAttribute("data-contour-node", /.+:.+:.+/);
  const node = await nodes.first().boundingBox();
  expect(node).not.toBeNull();
  await page.mouse.move(node!.x + node!.width / 2, node!.y + node!.height / 2);
  await page.mouse.down();
  await page.mouse.move(node!.x + node!.width / 2 + 12, node!.y + node!.height / 2 + 8);
  await page.mouse.up();
  await expect(nodes.first()).toBeVisible();
});

test("recovers the latest local revision after reload", async ({ page }) => {
  await page.goto("/");
  await drawRectangle(page);
  await page.waitForTimeout(1000);
  await page.reload();

  await expect(page.locator(".page-svg svg rect")).toHaveCount(1);
  await expect(page.getByText("Revisión local recuperada")).toBeVisible();
});

test("shows offline status while editing remains available", async ({ page, context }) => {
  await page.goto("/");
  await context.setOffline(true);

  await expect(page.getByText("Sin conexión — la edición permanece local")).toBeVisible();
  await expect(page.getByRole("button", { name: "Rectángulo" })).toBeEnabled();
});

test("refuses Prepare without hardware execution", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Preparar/ }).click();

  await expect(page.getByRole("heading", { name: "Preparar aún no está disponible" })).toBeVisible();
  await expect(page.getByText("No hay hardware conectado, controlado ni listo.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Volver a Diseño" })).toBeVisible();
});
