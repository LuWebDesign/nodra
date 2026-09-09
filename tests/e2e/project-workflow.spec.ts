import { expect, test } from "@playwright/test";

test("cancelling new project creation leaves no project", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Proyectos" }).click();
  await expect(page.getByRole("heading", { name: "¿Qué querés diseñar hoy?" })).toBeVisible();
  const projects = page.locator(".project-card");
  const projectCountBefore = await projects.count();

  await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
  await expect(page.getByRole("dialog", { name: "Nuevo proyecto" })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("dialog", { name: "Nuevo proyecto" })).toHaveCount(0);
  await expect(projects).toHaveCount(projectCountBefore);
});

test("named project creation opens its project detail", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Proyectos" }).click();
  await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
  await page.getByLabel("Nombre del proyecto").fill("Proyecto de prueba");
  await page.getByLabel("Nombre de la pieza inicial").fill("Pieza inicial");
  await page.getByRole("button", { name: "Crear proyecto" }).click();

  await expect(page.locator(".project-detail")).toBeVisible();
  await expect(page.locator(".project-detail h1")).toHaveText("Proyecto de prueba");
  await expect(page.locator(".project-detail")).toContainText("Pieza inicial");
});
