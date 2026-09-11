import { expect, test } from "@playwright/test";

const editorStatePath = "test-results/e2e-editor-state.json";

test("prepares an isolated editor seed", async ({ page }) => {
  await page.goto("/proyectos");
  await expect(page.getByRole("heading", { name: "¿Qué querés diseñar hoy?" })).toBeVisible();
  await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
  await page.getByLabel("Nombre del proyecto").fill("Editor E2E");
  await page.getByLabel("Nombre de la pieza inicial").fill("Pieza E2E");
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await expect(page.locator(".project-detail")).toBeVisible();
  await page.getByRole("button", { name: "+ Nueva pieza" }).click();
  const pieceDialog = page.getByRole("dialog", { name: "Nueva pieza" });
  await pieceDialog.getByLabel("Nombre de la pieza").fill("Pieza E2E secundaria");
  await pieceDialog.getByRole("button", { name: "Crear pieza" }).click();
  await expect(page.getByRole("toolbar", { name: "Herramientas de diseño" })).toBeVisible();
  await expect(page.locator(".page")).toBeVisible();
  await page.context().storageState({ path: editorStatePath, indexedDB: true });
});
