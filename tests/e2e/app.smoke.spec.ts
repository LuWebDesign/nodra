import { expect, test, type Page } from "@playwright/test";

async function drawRectangle(page: Page) {
  await page.getByRole("button", { name: "Rectángulo" }).click();
  const pageBounds = await page.locator(".page").boundingBox();
  expect(pageBounds).not.toBeNull();
  const start = { x: pageBounds!.x + 40, y: pageBounds!.y + 40 };
  const end = { x: pageBounds!.x + 180, y: pageBounds!.y + 130 };
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

test("moves an existing object with a drawing tool without creating another object", async ({ page }) => {
  await page.goto("/");
  await drawRectangle(page);

  const rectangle = page.locator(".page-svg svg rect").first();
  const originalBounds = await rectangle.boundingBox();
  expect(originalBounds).not.toBeNull();
  await page.mouse.click(originalBounds!.x + originalBounds!.width / 2, originalBounds!.y + originalBounds!.height / 2);
  await expect(page.locator(".inspector").getByLabel("Ancho en milímetros")).toBeVisible();

  await page.mouse.move(originalBounds!.x + originalBounds!.width / 2, originalBounds!.y + originalBounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(originalBounds!.x + originalBounds!.width / 2 + 30, originalBounds!.y + originalBounds!.height / 2 + 20);
  await page.mouse.up();

  await expect(page.locator(".page-svg svg rect")).toHaveCount(1);
  const movedBounds = await rectangle.boundingBox();
  expect(movedBounds).not.toBeNull();
  expect(movedBounds!.x).toBeGreaterThan(originalBounds!.x + 20);
  expect(movedBounds!.y).toBeGreaterThan(originalBounds!.y + 10);
});

test("renders created geometry as SVG", async ({ page }) => {
  await page.goto("/");
  await drawRectangle(page);

  await expect(page.locator(".page-svg svg")).toHaveAttribute("viewBox", /.+/);
  await expect(page.locator(".page-svg svg rect")).toHaveCount(1);
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
