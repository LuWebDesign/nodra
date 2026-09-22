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
  await page.getByRole("button", { name: "Crear proyecto" }).click();

  await expect(page.locator(".project-detail")).toBeVisible();
  await expect(page.locator(".project-detail h1")).toHaveText("Proyecto de prueba");
  await expect(page.locator(".project-detail")).toContainText("Todavía no hay piezas");
});

test("deleting a newly created project remains deleted after reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Proyectos" }).click();
  await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
  await page.getByLabel("Nombre del proyecto").fill("Proyecto para eliminar");
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await expect(page.locator(".project-detail h1")).toHaveText("Proyecto para eliminar");

  await page.getByRole("button", { name: "← Volver a Proyectos" }).click();
  const card = page.locator(".project-card").filter({ hasText: "Proyecto para eliminar" });
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "Eliminar proyecto" }).click();
  await expect(page.getByRole("dialog", { name: "Eliminar proyecto" })).toBeVisible();
  await page.getByRole("dialog", { name: "Eliminar proyecto" }).getByRole("button", { name: "Eliminar proyecto" }).click();
  await expect(card).toHaveCount(0);

  await page.reload();
  await expect(page).toHaveURL("/modelo");
  await expect(page.getByRole("heading", { name: "Empezá un proyecto" })).toBeVisible();

  await page.getByRole("button", { name: "Proyectos" }).click();
  await expect(page.getByRole("heading", { name: "¿Qué querés diseñar hoy?" })).toBeVisible();
  await expect(page.locator(".project-card").filter({ hasText: "Proyecto para eliminar" })).toHaveCount(0);
});

test("opens the editor immediately after creating a piece from project detail", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Proyectos" }).click();
  await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
  await page.getByLabel("Nombre del proyecto").fill("Proyecto con pieza nueva");
  await page.getByRole("button", { name: "Crear proyecto" }).click();

  await page.getByRole("region", { name: "Piezas" }).getByRole("button", { name: "+ Nueva pieza" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva pieza" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Nombre de la pieza").fill("Pieza inmediata");
  await dialog.getByRole("button", { name: "Crear pieza" }).click();

  await expect(page.getByRole("toolbar", { name: "Herramientas de diseño" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Seleccion" })).toBeVisible();
  const pageBounds = await page.locator(".page").boundingBox();
  expect(pageBounds).not.toBeNull();
  await page.getByRole("button", { name: "Rectángulo" }).click();
  await page.mouse.click(pageBounds!.x + 120, pageBounds!.y + 120);
  await page.mouse.click(pageBounds!.x + 260, pageBounds!.y + 220);
  await expect(page.locator('.page-svg svg rect[data-element-id]')).toHaveCount(1);
});

test("does not persist a cancelled pre-commit line draft after reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Proyectos" }).click();
  await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
  await page.getByLabel("Nombre del proyecto").fill("Proyecto línea cancelada");
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await page.getByRole("region", { name: "Piezas" }).getByRole("button", { name: "+ Nueva pieza" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva pieza" });
  await dialog.getByLabel("Nombre de la pieza").fill("Pieza línea cancelada");
  await dialog.getByRole("button", { name: "Crear pieza" }).click();

  const pageBounds = await page.locator(".page").boundingBox();
  expect(pageBounds).not.toBeNull();
  const pageElement = page.locator(".page");
  await page.getByRole("button", { name: "Línea", exact: true }).click();
  await page.mouse.click(pageBounds!.x + 140, pageBounds!.y + 140);
  expect(await pageElement.getAttribute("data-document-element-ids")).toBe("");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator(".page")).toHaveAttribute("data-document-element-ids", "");
});

test("persists only committed line geometry after reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Proyectos" }).click();
  await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
  await page.getByLabel("Nombre del proyecto").fill("Proyecto línea persistente");
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await page.getByRole("region", { name: "Piezas" }).getByRole("button", { name: "+ Nueva pieza" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva pieza" });
  await dialog.getByLabel("Nombre de la pieza").fill("Pieza línea persistente");
  await dialog.getByRole("button", { name: "Crear pieza" }).click();

  const pageBounds = await page.locator(".page").boundingBox();
  expect(pageBounds).not.toBeNull();
  const pageElement = page.locator(".page");
  await page.getByRole("button", { name: "Línea", exact: true }).click();
  await page.mouse.click(pageBounds!.x + 140, pageBounds!.y + 140);
  await page.mouse.click(pageBounds!.x + 280, pageBounds!.y + 220);
  await expect.poll(async () => (await pageElement.getAttribute("data-document-element-ids"))?.length ?? 0).toBeGreaterThan(0);
  const committedIds = await pageElement.getAttribute("data-document-element-ids");
  expect(committedIds).toBeTruthy();

  // The current UI intentionally exposes no stable selector for whether click-created line geometry
  // is represented as a sketch or native line. This characterization verifies persistence only.
  await page.reload();
  await expect.poll(async () => (await page.locator(".page").getAttribute("data-document-element-ids"))?.length ?? 0).toBeGreaterThan(0);
  await expect(page.locator(".page")).toHaveAttribute("data-document-element-ids", committedIds!);
});

test("restores the last named project after reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Proyectos" }).click();
  await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
  await page.getByLabel("Nombre del proyecto").fill("Proyecto persistente");
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await expect(page.locator(".project-detail h1")).toHaveText("Proyecto persistente");
  await page.reload();
  await expect(page.locator(".project-detail h1")).toHaveText("Proyecto persistente");
});

test("keeps deleted geometry absent from the persisted document after reload", async ({ page }) => {
  await page.goto("/proyectos");
  await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
  await page.getByLabel("Nombre del proyecto").fill("Proyecto persistencia");
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await page.getByRole("region", { name: "Piezas" }).getByRole("button", { name: "+ Nueva pieza" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva pieza" });
  await dialog.getByLabel("Nombre de la pieza").fill("Pieza persistente");
  await dialog.getByRole("button", { name: "Crear pieza" }).click();

  const pageBounds = await page.locator(".page").boundingBox();
  expect(pageBounds).not.toBeNull();
  await page.getByRole("button", { name: "Rectángulo" }).click();
  await page.mouse.click(pageBounds!.x + 120, pageBounds!.y + 120);
  await page.mouse.click(pageBounds!.x + 260, pageBounds!.y + 220);
  const rectangle = page.locator('.page-svg svg rect[data-element-id]');
  await expect(rectangle).toHaveCount(1);
  const rectangleId = await rectangle.getAttribute("data-element-id");
  expect(rectangleId).not.toBeNull();
  const documentPage = page.locator(".page");
  const revisionBeforeDelete = Number(await documentPage.getAttribute("data-document-revision"));

  await page.getByRole("button", { name: "Seleccion" }).click();
  const rectangleBounds = await rectangle.boundingBox();
  expect(rectangleBounds).not.toBeNull();
  await page.mouse.click(rectangleBounds!.x + rectangleBounds!.width / 2, rectangleBounds!.y + rectangleBounds!.height / 2);
  await page.keyboard.press("Delete");
  await expect(rectangle).toHaveCount(0);
  await expect.poll(async () => Number(await documentPage.getAttribute("data-document-revision"))).toBeGreaterThan(revisionBeforeDelete);
  await expect(documentPage).not.toHaveAttribute("data-document-element-ids", new RegExp(rectangleId!));

  await page.reload();
  await expect(page.locator('.page-svg svg rect[data-element-id]')).toHaveCount(0);
  const reloadedPage = page.locator(".page");
  await expect.poll(async () => Number(await reloadedPage.getAttribute("data-document-revision"))).toBeGreaterThan(revisionBeforeDelete);
  await expect(reloadedPage).not.toHaveAttribute("data-document-element-ids", new RegExp(rectangleId!));

  await page.getByRole("button", { name: "Proyectos" }).click();
  const persistedProjectCard = page.locator(".project-card").filter({ hasText: "Proyecto persistencia" });
  await expect(persistedProjectCard).toHaveCount(1);
  await persistedProjectCard.getByRole("button", { name: "Ver proyecto" }).click();
  await expect(page.locator(".project-detail")).toBeVisible();
  await expect(page.locator(".project-metrics article").filter({ hasText: "Objetos" }).locator("strong")).toHaveText("0");
  await expect(page.locator(".project-information-card")).toContainText("Revisión");
});
