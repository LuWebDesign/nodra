import { expect, test } from "@playwright/test";

 test("keeps the requested section URL after reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Modelo", exact: true }).click();
  await expect(page).toHaveURL(/\/modelo$/);
  await page.reload();
  await expect(page).toHaveURL(/\/modelo$/);
  await expect(page.getByRole("heading", { name: "Empezá un proyecto" })).toBeVisible();

  await page.getByRole("button", { name: "Preparar" }).click();
  await expect(page).toHaveURL(/\/preparar$/);
  await page.reload();
  await expect(page).toHaveURL(/\/preparar$/);
  await expect(page.getByRole("heading", { name: "Preparar aún no está disponible" })).toBeVisible();

  await page.getByRole("button", { name: "Proyectos", exact: true }).click();
  await expect(page).toHaveURL(/\/proyectos$/);
 });

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

test("opens an empty Modelo and creates the first sketch from its CTA", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Proyectos" }).click();
  await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
  await page.getByLabel("Nombre del proyecto").fill("Proyecto modelo vacío");
  await page.getByRole("button", { name: "Crear proyecto" }).click();

  await page.getByRole("button", { name: "Crear primer croquis" }).click();
  await expect(page.getByRole("toolbar", { name: "Herramientas de diseño" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Línea" })).toBeVisible();
});

test("deleting the only project returns to the empty projects dashboard", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Proyectos" }).click();
    await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
    await page.getByLabel("Nombre del proyecto").fill("Proyecto para eliminar");
    await page.getByRole("button", { name: "Crear proyecto" }).click();
    await page.getByRole("button", { name: "Proyectos", exact: true }).click();

    while (await page.locator(".project-card").count() > 0) {
      await page.locator(".project-card").first().getByRole("button", { name: "Eliminar proyecto" }).click();
      await page.getByRole("dialog", { name: "Eliminar proyecto" }).getByRole("button", { name: "Eliminar proyecto" }).click();
      await expect(page.getByRole("dialog", { name: "Eliminar proyecto" })).toHaveCount(0);
    }
    await expect(page.getByRole("heading", { name: "Empezá un proyecto" })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Nuevo proyecto" })).toBeVisible();
    await page.getByRole("button", { name: "Proyectos", exact: true }).click();
    await expect(page.getByText("Todavía no hay proyectos")).toBeVisible();
    await expect(page.getByText("Proyecto para eliminar")).toHaveCount(0);
    await page.reload();
        await expect(page.getByText("Todavía no hay proyectos")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("opens the editor immediately after creating a piece from project detail", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Proyectos" }).click();
  await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
  await page.getByLabel("Nombre del proyecto").fill("Proyecto con pieza nueva");
  await page.getByRole("button", { name: "Crear proyecto" }).click();

  await page.getByRole("button", { name: "+ Nueva pieza" }).click();
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


test("restores the last named project after reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Proyectos" }).click();
  await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
  await page.getByLabel("Nombre del proyecto").fill("Proyecto persistente");
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await expect(page.locator(".project-detail")).toContainText("Todavía no hay piezas");
  await page.reload();
  await expect(page.locator(".project-detail")).toBeVisible();
  await expect(page.locator(".project-detail h1")).toHaveText("Proyecto persistente");
  await page.getByRole("button", { name: "Proyectos", exact: true }).click();
  await expect(page.locator(".project-card").filter({ hasText: "Proyecto persistente" })).toBeVisible();
});
test("keeps piece tabs in the footer, layers in the inspector, and typography contextual", async ({ page }) => {
  await page.goto("/");

  const footer = page.locator(".statusbar");
  await expect(footer.getByRole("tablist", { name: "Piezas" })).toBeVisible();
  await expect(footer.getByRole("tab", { name: "Pieza 1" })).toHaveAttribute("aria-selected", "true");
   await expect(page.getByRole("img", { name: "Autosave activo" })).toBeVisible();
   await expect(footer.getByText("Material por definir")).toHaveCount(0);
   await expect(footer.getByText("Espesor por definir")).toHaveCount(0);
   await expect(footer.getByText("En diseño")).toHaveCount(0);
   await expect(footer.getByText("Proyecto guardado")).toHaveCount(0);
  await expect(page.locator(".inspector").getByText("Capa de diseño")).toBeVisible();
  await expect(page.locator(".inspector").getByText("Capa de diseño")).toHaveCount(1);
  await expect(page.locator(".properties-bar").getByLabel("Tipografía del texto")).toHaveCount(0);

  const pageBounds = await page.locator(".page").boundingBox();
  expect(pageBounds).not.toBeNull();
  await page.getByRole("button", { name: "Texto" }).click();
  await page.mouse.click(pageBounds!.x + 120, pageBounds!.y + 120);
  const editor = page.getByRole("textbox", { name: "Texto editable" });
  await editor.fill("Texto UI");
  await editor.press("Control+Enter");
  const text = page.locator('.page-svg svg text[data-element-id]');
  await expect(text).toHaveCount(1);

  await page.getByRole("button", { name: "Seleccion" }).click();
  const textBounds = await text.boundingBox();
  expect(textBounds).not.toBeNull();
  await page.mouse.click(textBounds!.x + textBounds!.width / 2, textBounds!.y + textBounds!.height / 2);
  await page.getByRole("tab", { name: "Texto" }).click();
  await expect(page.locator(".inspector").getByLabel("Tipografía")).toBeVisible();
});

test("creates geometry immediately after creating a second piece from Design", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto("/");
    const secondPiece = "Pieza 2";
    const footer = page.locator(".statusbar");
    const pageCountBefore = await page.getByLabel("Página activa").locator("option").count();
    await footer.getByRole("button", { name: "+ Nueva pieza" }).click();
    const dialog = page.getByRole("dialog", { name: "Nueva pieza" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Nombre de la pieza").fill(secondPiece);
    await dialog.getByRole("button", { name: "Crear pieza" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(footer.getByRole("tab", { name: secondPiece })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("Página activa").locator("option")).toHaveCount(pageCountBefore);

    const pageBounds = await page.locator(".page").boundingBox();
    expect(pageBounds).not.toBeNull();
    await page.getByRole("button", { name: "Rectángulo" }).click();
    await page.mouse.click(pageBounds!.x + 120, pageBounds!.y + 120);
    await page.mouse.click(pageBounds!.x + 260, pageBounds!.y + 220);
    await expect(page.locator('.page-svg svg rect[data-element-id]')).toHaveCount(1);
  } finally {
    await context.close();
  }
});

test("creates and restores geometry on a tree-created page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Nueva página" })).toHaveAttribute("title", "Nueva página");
  await expect(page.locator(".properties-bar").getByRole("button", { name: "Nueva página" })).toHaveCount(0);
  const pageCount = await page.getByLabel("Página activa").locator("option").count();
  await page.getByRole("button", { name: "Nueva página" }).click();
  await expect(page.getByLabel("Página activa").locator("option")).toHaveCount(pageCount + 1);
  const page2Value = await page.getByLabel("Página activa").locator("option").nth(1).getAttribute("value");
  expect(page2Value).not.toBeNull();
  await expect(page.getByLabel("Página activa")).toHaveValue(page2Value!);
  const bounds = await page.locator(".page").boundingBox();
  expect(bounds).not.toBeNull();
  await page.getByRole("button", { name: "Rectángulo" }).click();
  await page.mouse.click(bounds!.x + 120, bounds!.y + 120);
  await page.mouse.click(bounds!.x + 240, bounds!.y + 200);
  await expect(page.locator('.page-svg svg rect[data-element-id]')).toHaveCount(1);
  await page.getByLabel("Página activa").selectOption({ index: 0 }, { force: true });
  await expect(page.locator('.page-svg svg rect[data-element-id]')).toHaveCount(0);
  await page.getByLabel("Página activa").selectOption({ index: 1 }, { force: true });
  await expect(page.locator('.page-svg svg rect[data-element-id]')).toHaveCount(1);
});

test("navigates silently away from an unchanged active sketch session", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto("/");
    const bounds = await page.locator(".page").boundingBox();
    expect(bounds).not.toBeNull();
    const start = { x: bounds!.x + 120, y: bounds!.y + 120 };
    const end = { x: start.x + 90, y: start.y };
    await page.getByRole("button", { name: "Línea" }).click();
    await page.mouse.click(start.x, start.y);
    await page.mouse.click(end.x, end.y);
    await page.locator(".project-tree ul ul ul button").first().click();
    await expect(page.getByRole("status").filter({ hasText: "Editando croquis" })).toBeVisible();

    await page.getByRole("button", { name: "Proyectos" }).click();
    await expect(page.getByRole("dialog", { name: "Cancelar croquis" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "¿Qué querés diseñar hoy?" })).toBeVisible();
  } finally {
    await context.close();
  }
});
