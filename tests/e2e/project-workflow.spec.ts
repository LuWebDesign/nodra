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

test("changes one native line role from the inspector with history and persisted reload", async ({ page }) => {
  await page.goto("/proyectos");
  await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
  await page.getByLabel("Nombre del proyecto").fill("Proyecto rol geométrico");
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await page.getByRole("region", { name: "Piezas" }).getByRole("button", { name: "+ Nueva pieza" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva pieza" });
  await dialog.getByLabel("Nombre de la pieza").fill("Pieza de prueba");
  await dialog.getByRole("button", { name: "Crear pieza" }).click();

  const bounds = await page.locator(".page").boundingBox();
  expect(bounds).not.toBeNull();
  const start = { x: bounds!.x + 160, y: bounds!.y + 150 };
  const end = { x: start.x + 110, y: start.y + 55 };
  await page.getByRole("button", { name: "Línea", exact: true }).click();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();

  const line = page.locator('.page-svg svg > g > line[data-element-id]');
  await expect(line).toHaveCount(1);
  const lineId = await line.getAttribute("data-element-id");
  expect(lineId).not.toBeNull();
  await page.getByRole("button", { name: "Seleccion" }).click();
  await page.mouse.click((start.x + end.x) / 2, (start.y + end.y) / 2);
  const roleControl = page.getByRole("group", { name: "Rol geométrico" });
  const normalRole = roleControl.getByRole("button", { name: "Normal", exact: true });
  const constructionRole = roleControl.getByRole("button", { name: "Construcción", exact: true });
  await expect(normalRole).toBeVisible();
  const revision = Number(await page.locator(".page").getAttribute("data-document-revision"));
  await normalRole.click();
  expect(Number(await page.locator(".page").getAttribute("data-document-revision"))).toBe(revision);
  await constructionRole.click();
  await expect(line).toHaveAttribute("stroke-dasharray", "6 4");
  const constructionRevision = Number(await page.locator(".page").getAttribute("data-document-revision"));
  expect(constructionRevision).toBeGreaterThan(revision);
  await expect(constructionRole).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(line).not.toHaveAttribute("stroke-dasharray", "6 4");
  await page.getByRole("button", { name: "Rehacer" }).click();
  await expect(line).toHaveAttribute("stroke-dasharray", "6 4");

  const noOpRevision = Number(await page.locator(".page").getAttribute("data-document-revision"));
  await constructionRole.click();
  expect(Number(await page.locator(".page").getAttribute("data-document-revision"))).toBe(noOpRevision);
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(line).not.toHaveAttribute("stroke-dasharray", "6 4");
  await page.getByRole("button", { name: "Rehacer" }).click();
  await expect(line).toHaveAttribute("stroke-dasharray", "6 4");
  expect(Number(await page.locator(".page").getAttribute("data-document-revision"))).toBe(noOpRevision);

  await page.reload();
  const reloadedLine = page.locator(`.page-svg svg > g > line[data-element-id="${lineId}"]`);
  await expect(reloadedLine).toHaveCount(1);
  await expect(reloadedLine).toHaveAttribute("stroke-dasharray", "6 4");
  await expect(page.locator(".page")).toHaveAttribute("data-document-element-ids", new RegExp(lineId!));
});

test("changes one sketch edge role from Forma inspector without changing its sibling", async ({ page }) => {
  await page.goto("/proyectos");
  await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
  await page.getByLabel("Nombre del proyecto").fill("Proyecto roles de croquis");
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await page.getByRole("region", { name: "Piezas" }).getByRole("button", { name: "+ Nueva pieza" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva pieza" });
  await dialog.getByLabel("Nombre de la pieza").fill("Pieza de prueba");
  await dialog.getByRole("button", { name: "Crear pieza" }).click();
  const bounds = await page.locator(".page").boundingBox();
  expect(bounds).not.toBeNull();
  const first = { x: bounds!.x + 140, y: bounds!.y + 140 };
  const second = { x: first.x + 100, y: first.y };
  const third = { x: second.x, y: second.y + 80 };
  await page.getByRole("button", { name: "Línea", exact: true }).click();
  for (const point of [first, second, third]) await page.mouse.click(point.x, point.y);
  await page.getByRole("button", { name: "Seleccion" }).click();
  await page.getByRole("button", { name: "Forma" }).click();
  await page.mouse.click((first.x + second.x) / 2, first.y);
  const sketch = page.locator('.page-svg svg g[data-element-id]').filter({ has: page.locator(":scope > line") });
  await expect(sketch).toHaveCount(1);
  const edges = sketch.locator(":scope > line");
  await expect(edges).toHaveCount(2);
  const revision = Number(await page.locator(".page").getAttribute("data-document-revision"));
  const roleControl = page.getByRole("group", { name: "Rol geométrico" });
  const constructionRole = roleControl.getByRole("button", { name: "Construcción", exact: true });
  await expect(constructionRole).toBeVisible();
  await constructionRole.click();
  await expect(edges.nth(0)).toHaveAttribute("stroke-dasharray", "6 4");
  await expect(edges.nth(1)).not.toHaveAttribute("stroke-dasharray", "6 4");
  expect(Number(await page.locator(".page").getAttribute("data-document-revision"))).toBeGreaterThan(revision);
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(edges.nth(0)).not.toHaveAttribute("stroke-dasharray", "6 4");
  await expect(edges.nth(1)).not.toHaveAttribute("stroke-dasharray", "6 4");
  await page.getByRole("button", { name: "Rehacer" }).click();
  await expect(edges.nth(0)).toHaveAttribute("stroke-dasharray", "6 4");
  await expect(edges.nth(1)).not.toHaveAttribute("stroke-dasharray", "6 4");
});

test("changes the whole selected sketch role when no Forma edge is selected", async ({ page }) => {
  await page.goto("/proyectos");
  await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
  await page.getByLabel("Nombre del proyecto").fill("Proyecto croquis completo");
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await page.getByRole("region", { name: "Piezas" }).getByRole("button", { name: "+ Nueva pieza" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva pieza" });
  await dialog.getByLabel("Nombre de la pieza").fill("Pieza de prueba");
  await dialog.getByRole("button", { name: "Crear pieza" }).click();
  const bounds = await page.locator(".page").boundingBox();
  expect(bounds).not.toBeNull();
  const first = { x: bounds!.x + 140, y: bounds!.y + 140 };
  const second = { x: first.x + 100, y: first.y };
  const third = { x: second.x, y: second.y + 80 };
  await page.getByRole("button", { name: "Línea", exact: true }).click();
  for (const point of [first, second, third]) await page.mouse.click(point.x, point.y);
  const sketch = page.locator('.page-svg svg g[data-element-id]').filter({ has: page.locator(":scope > line") });
  await expect(sketch).toHaveCount(1);
  const edges = sketch.locator(":scope > line");
  await expect(edges).toHaveCount(2);
  await page.getByRole("button", { name: "Seleccion" }).click();
  await page.mouse.click((first.x + second.x) / 2, first.y);
  const roleControl = page.getByRole("group", { name: "Rol geométrico" });
  await expect(roleControl).toBeVisible();
  const revision = Number(await page.locator(".page").getAttribute("data-document-revision"));
  const edgeStyle = (index: number) => edges.nth(index).evaluate((line) => ({
    strokeDasharray: getComputedStyle(line).strokeDasharray,
    fill: getComputedStyle(line).fill,
  }));
  await roleControl.getByRole("button", { name: "Construcción", exact: true }).click();
  await expect.poll(async () => Number(await page.locator(".page").getAttribute("data-document-revision"))).toBeGreaterThan(revision);
  await expect.poll(() => edgeStyle(0)).toEqual({ strokeDasharray: "6px, 4px", fill: "none" });
  await expect.poll(() => edgeStyle(1)).toEqual({ strokeDasharray: "6px, 4px", fill: "none" });

  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect.poll(() => edgeStyle(0)).toEqual({ strokeDasharray: "none", fill: "none" });
  await expect.poll(() => edgeStyle(1)).toEqual({ strokeDasharray: "none", fill: "none" });
  await page.getByRole("button", { name: "Rehacer" }).click();
  await expect.poll(() => edgeStyle(0)).toEqual({ strokeDasharray: "6px, 4px", fill: "none" });
  await expect.poll(() => edgeStyle(1)).toEqual({ strokeDasharray: "6px, 4px", fill: "none" });
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
