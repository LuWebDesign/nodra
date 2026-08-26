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
  await expect(page.getByRole("button", { name: "Spline" })).toHaveAttribute("aria-description", /Cree curvas con nodos/);
});

test("creates an open spline with Spline and exposes its anchors", async ({ page }) => {
  await page.goto("/");
  const pageBounds = await page.locator(".page").boundingBox();
  expect(pageBounds).not.toBeNull();
  await page.getByRole("button", { name: "Spline" }).click();
  const x = pageBounds!.x + 80;
  const y = pageBounds!.y + 80;
  await page.mouse.click(x, y);
  await page.mouse.click(x + 80, y + 30);
  await page.mouse.click(x + 160, y);
  const spline = page.locator('.page-svg svg path[data-element-id]');
  await expect(spline).toHaveCount(1);
  await expect(spline).toHaveAttribute("d", /C/);
  const nodes = page.locator("[data-spline-node]");
  await expect(nodes).toHaveCount(3);
  await expect(page.locator("[data-spline-handle]")).toHaveCount(0);
  const secondNode = await nodes.nth(1).boundingBox();
  expect(secondNode).not.toBeNull();
  await page.mouse.click(secondNode!.x + secondNode!.width / 2, secondNode!.y + secondNode!.height / 2);
  await expect(page.locator("[data-spline-handle]")).toHaveCount(4);
  const firstNode = await nodes.first().boundingBox();
  expect(firstNode).not.toBeNull();
  await page.mouse.move(firstNode!.x + firstNode!.width / 2, firstNode!.y + firstNode!.height / 2);
  await expect(page.locator(".tool-cursor")).toBeHidden();
  await expect(page.locator(".tool-cursor")).toHaveAttribute("title", "Cerrar trazado");
  await page.mouse.click(firstNode!.x + firstNode!.width / 2, firstNode!.y + firstNode!.height / 2);
  await expect(spline).toHaveAttribute("d", / Z$/);
  await expect(page.locator("[data-spline-handle]")).toHaveCount(0);
  await page.getByRole("button", { name: "Forma" }).click();
  const selectedNode = await nodes.nth(1).boundingBox();
  expect(selectedNode).not.toBeNull();
  await page.mouse.click(selectedNode!.x + selectedNode!.width / 2, selectedNode!.y + selectedNode!.height / 2);
  await expect(page.locator("[data-spline-handle]")).toHaveCount(6);
  const beforeNodeDrag = await spline.getAttribute("d");
  await page.mouse.move(selectedNode!.x + selectedNode!.width / 2, selectedNode!.y + selectedNode!.height / 2);
  await page.mouse.down();
  await page.mouse.move(selectedNode!.x + selectedNode!.width / 2 + 20, selectedNode!.y + selectedNode!.height / 2 + 12);
  await page.mouse.up();
  await expect(spline).not.toHaveAttribute("d", beforeNodeDrag!);
  await page.keyboard.press("Control+z");
  await expect(spline).toHaveAttribute("d", beforeNodeDrag!);
  const beforeDrag = await spline.getAttribute("d");
  const handle = page.locator("[data-spline-handle]").first();
  const handleBounds = await handle.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  });
  expect(handleBounds.width).toBeGreaterThan(0);
  expect(handleBounds.height).toBeGreaterThan(0);
  await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBounds!.x + 25, handleBounds!.y - 15);
  await page.mouse.up();
  await expect(spline).not.toHaveAttribute("d", beforeDrag!);
  await page.keyboard.press("Control+z");
  await expect(spline).toHaveAttribute("d", beforeDrag!);
  await page.keyboard.press("Delete");
  await expect(spline).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(page.locator('.page-svg svg path[data-element-id]')).toHaveCount(1);
});

test("selects and moves a Spline object like Pluma", async ({ page }) => {
      await page.goto("/");
      const pageBounds = await page.locator(".page").boundingBox();
      expect(pageBounds).not.toBeNull();
      await page.getByRole("button", { name: "Spline" }).click();
      await page.mouse.click(pageBounds!.x + 100, pageBounds!.y + 100);
      await page.mouse.click(pageBounds!.x + 180, pageBounds!.y + 140);
      await page.mouse.click(pageBounds!.x + 260, pageBounds!.y + 100);
      await page.getByRole("button", { name: "Seleccion" }).click();
      const hit = page.locator("[data-spline-hit]");
      await expect(hit).toHaveCount(1);
      const hitPoint = await hit.evaluate((element) => {
        const path = element as SVGPathElement;
        const point = path.getPointAtLength(path.getTotalLength() * 0.35);
        const svg = path.ownerSVGElement!.getBoundingClientRect();
        const viewBox = path.ownerSVGElement!.viewBox.baseVal;
        return { x: svg.x + point.x / viewBox.width * svg.width, y: svg.y + point.y / viewBox.height * svg.height };
      });
      await page.mouse.click(hitPoint.x, hitPoint.y);
      await expect(page.locator('[data-resize-handle]:not([data-resize-handle="center"])')).toHaveCount(8);
      await expect(page.locator('[data-resize-handle="center"]')).toHaveCount(1);
      await expect(page.locator("[data-real-node]")).toHaveCount(0);
      const beforeResize = await page.locator(".page-svg svg path[data-element-id]").getAttribute("d");
      const resizeHandle = await page.locator('[data-resize-handle="se"]').boundingBox();
      expect(resizeHandle).not.toBeNull();
      await page.mouse.move(resizeHandle!.x + resizeHandle!.width / 2, resizeHandle!.y + resizeHandle!.height / 2);
      await page.mouse.down();
      await page.mouse.move(resizeHandle!.x + resizeHandle!.width / 2 + 20, resizeHandle!.y + resizeHandle!.height / 2 + 20);
      await page.mouse.up();
      await expect(page.locator(".page-svg svg path[data-element-id]")).not.toHaveAttribute("d", beforeResize!);
      await page.keyboard.press("Control+z");
      await expect(page.locator(".page-svg svg path[data-element-id]")).toHaveAttribute("d", beforeResize!);
      const before = await page.locator(".page-svg svg path[data-element-id]").getAttribute("d");
      await page.mouse.move(hitPoint.x, hitPoint.y);
      await page.mouse.down();
      await page.mouse.move(hitPoint.x + 35, hitPoint.y + 20);
      await page.mouse.up();
      await expect(page.locator(".page-svg svg path[data-element-id]")).not.toHaveAttribute("d", before!);
      await expect(page.locator("[data-spline-handle]")).toHaveCount(0);
    });

    test("Selection selects a closed Spline from its interior", async ({ page }) => {
      await page.goto("/");
      const pageBounds = await page.locator(".page").boundingBox();
      expect(pageBounds).not.toBeNull();
      await page.getByRole("button", { name: "Spline" }).click();
      await page.mouse.click(pageBounds!.x + 120, pageBounds!.y + 120);
      await page.mouse.click(pageBounds!.x + 240, pageBounds!.y + 120);
      await page.mouse.click(pageBounds!.x + 180, pageBounds!.y + 240);
      const firstNode = page.locator("[data-spline-node]").first();
      const firstBounds = await firstNode.boundingBox();
      expect(firstBounds).not.toBeNull();
      await page.mouse.click(firstBounds!.x + firstBounds!.width / 2, firstBounds!.y + firstBounds!.height / 2);
      await page.getByRole("button", { name: "Seleccion" }).click();
      const hit = page.locator("[data-spline-hit]");
      const bounds = await hit.boundingBox();
      expect(bounds).not.toBeNull();
      const before = await page.locator(".page-svg svg path[data-element-id]").getAttribute("d");
      await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds!.x + bounds!.width / 2 + 20, bounds!.y + bounds!.height / 2 + 15);
      await page.mouse.up();
      await expect(page.locator(".page-svg svg path[data-element-id]")).not.toHaveAttribute("d", before!);
    });

    test("double-clicking empty canvas clears native Spline node selection", async ({ page }) => {
  await page.goto("/");
  const pageBounds = await page.locator(".page").boundingBox();
  expect(pageBounds).not.toBeNull();
  await page.getByRole("button", { name: "Spline" }).click();
  await page.mouse.click(pageBounds!.x + 80, pageBounds!.y + 80);
  await page.mouse.click(pageBounds!.x + 160, pageBounds!.y + 110);
  await page.mouse.click(pageBounds!.x + 240, pageBounds!.y + 80);
  await page.getByRole("button", { name: "Forma" }).click();
  const node = page.locator("[data-spline-node]").nth(1);
  const nodeBounds = await node.boundingBox();
  expect(nodeBounds).not.toBeNull();
  await page.mouse.click(nodeBounds!.x + nodeBounds!.width / 2, nodeBounds!.y + nodeBounds!.height / 2);
  await expect(page.locator("[data-spline-handle]")).toHaveCount(4);
  await page.mouse.dblclick(pageBounds!.x + 500, pageBounds!.y + 500);
  await expect(page.locator("[data-spline-handle]")).toHaveCount(0);
  await expect(page.locator("[data-spline-node]")).toHaveCount(0);
});

test("closes a Pluma silhouette by clicking its first anchor and supports fill and undo", async ({ page }) => {
  await page.goto("/");
  const pageBounds = await page.locator(".page").boundingBox();
  expect(pageBounds).not.toBeNull();
  await page.getByRole("button", { name: "Pluma" }).click();
  const x = pageBounds!.x + 80;
  const y = pageBounds!.y + 80;
  await page.mouse.click(x, y);
  await page.mouse.click(x + 100, y + 50);
  await page.mouse.click(x + 180, y);

  const first = page.locator(".contour-node").first();
  const firstBounds = await first.boundingBox();
  expect(firstBounds).not.toBeNull();
  await page.mouse.click(firstBounds!.x + firstBounds!.width / 2, firstBounds!.y + firstBounds!.height / 2);
  await expect(page.locator(".page-svg svg path[data-element-id]")).toHaveAttribute("d", / Z$/);
  await expect(page.getByRole("button", { name: "Reabrir trazado" })).toBeVisible();
  await expect(page.getByText("Relleno: rgba(101,217,255,0.22)")).toBeVisible();

  await page.getByRole("button", { name: "Azul", exact: true }).click();
  await expect(page.locator(".page-svg svg path[data-element-id]")).toHaveAttribute("fill", "#3b82f6");
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(page.locator(".page-svg svg path[data-element-id]")).toHaveAttribute("fill", "rgba(101,217,255,0.22)");
  await page.getByRole("button", { name: "Rehacer" }).click();
  await expect(page.locator(".page-svg svg path[data-element-id]")).toHaveAttribute("fill", "#3b82f6");
});

test("closes and reopens a selected path through contextual actions", async ({ page }) => {
  await page.goto("/");
  const pageBounds = await page.locator(".page").boundingBox();
  expect(pageBounds).not.toBeNull();
  await page.getByRole("button", { name: "Pluma" }).click();
  await page.mouse.click(pageBounds!.x + 90, pageBounds!.y + 120);
  await page.mouse.click(pageBounds!.x + 170, pageBounds!.y + 120);
  await page.mouse.click(pageBounds!.x + 250, pageBounds!.y + 160);
  await page.getByRole("button", { name: "Cerrar trazado" }).click();
  await expect(page.getByRole("button", { name: "Reabrir trazado" })).toBeVisible();
  await page.getByRole("button", { name: "Reabrir trazado" }).click();
  await expect(page.getByRole("button", { name: "Cerrar trazado" })).toBeVisible();
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
  await expect.poll(() => rectangle.boundingBox()).not.toBeNull();
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

test("moves text with Selection and edits it inline on double-click", async ({ page }) => {
  await page.goto("/");
  const pageBounds = await page.locator(".page").boundingBox();
  expect(pageBounds).not.toBeNull();

  await page.getByRole("button", { name: "Texto" }).click();
  await page.mouse.click(pageBounds!.x + 120, pageBounds!.y + 120);
  const editor = page.getByRole("textbox", { name: "Texto editable" });
  await editor.fill("Texto original");
  await editor.press("Control+Enter");
  await expect(editor).toBeHidden();

  const text = page.locator('.page-svg svg text[data-element-id]');
  await expect(text).toHaveCount(1);
  await expect(text).toBeVisible();
  const before = await text.boundingBox();
  expect(before).not.toBeNull();

  await page.getByRole("button", { name: "Seleccion" }).click();
  await page.mouse.click(before!.x + before!.width / 2, before!.y + before!.height / 2);
  await page.getByRole("tab", { name: "Texto" }).click();
  await page.locator(".inspector").getByLabel("Tipografía").selectOption({ label: "Times New Roman" });
  await page.getByRole("button", { name: "Negrita" }).click();
  await page.getByRole("button", { name: "Cursiva" }).click();
  const formattingBefore = {
    family: await text.getAttribute("font-family"),
    size: await text.getAttribute("font-size"),
    weight: await text.getAttribute("font-weight"),
    style: await text.getAttribute("font-style"),
  };

  await expect(text).toBeVisible();
  await expect.poll(() => text.boundingBox()).not.toBeNull();
  const beforeDrag = await text.boundingBox();
  expect(beforeDrag).not.toBeNull();
  await page.mouse.move(beforeDrag!.x + beforeDrag!.width / 2, beforeDrag!.y + beforeDrag!.height / 2);
  await page.mouse.down();
  await page.mouse.move(beforeDrag!.x + beforeDrag!.width / 2 + 35, beforeDrag!.y + beforeDrag!.height / 2 + 20);
  await page.mouse.up();
  await expect.poll(async () => {
    const bounds = await text.boundingBox();
    return bounds !== null && bounds.x > beforeDrag!.x && bounds.y > beforeDrag!.y;
  }).toBe(true);
  await expect(text).toBeVisible();
  const moved = await text.boundingBox();
  expect(moved).not.toBeNull();
  expect(moved!.x).toBeGreaterThan(before!.x);
  expect(moved!.y).toBeGreaterThan(before!.y);

  await page.mouse.dblclick(moved!.x + moved!.width / 2, moved!.y + moved!.height / 2);
  await expect(editor).toHaveValue("Texto original");
  await editor.fill("Texto editado");
  await editor.press("Control+Enter");
  await expect(editor).toBeHidden();
  await expect(text).toContainText("Texto editado");
  await expect(text).toHaveAttribute("font-family", formattingBefore.family!);
  await expect(text).toHaveAttribute("font-size", formattingBefore.size!);
  await expect(text).toHaveAttribute("font-weight", formattingBefore.weight!);
  await expect(text).toHaveAttribute("font-style", formattingBefore.style!);
});

test("edits an existing text with Texto without replacing the element", async ({ page }) => {
  await page.goto("/");
  const pageBounds = await page.locator(".page").boundingBox();
  expect(pageBounds).not.toBeNull();

  await page.getByRole("button", { name: "Texto" }).click();
  await page.mouse.click(pageBounds!.x + 140, pageBounds!.y + 140);
  const editor = page.getByRole("textbox", { name: "Texto editable" });
  await editor.fill("Texto persistente");
  await editor.press("Enter");
  const text = page.locator('.page-svg svg text[data-element-id]');
  await expect(text).toHaveCount(1);
  const elementId = await text.getAttribute("data-element-id");
  const before = await text.boundingBox();
  expect(before).not.toBeNull();

  await page.getByRole("button", { name: "Texto" }).click();
  await page.mouse.click(before!.x + before!.width / 2, before!.y + before!.height / 2);
  await expect(editor).toHaveValue("Texto persistente");
  await expect(text).toHaveCount(1);
  await expect(text).toHaveAttribute("data-element-id", elementId!);
  await editor.fill("Texto actualizado");
  await page.mouse.click(pageBounds!.x + 400, pageBounds!.y + 300);
  await expect(editor).toBeHidden();
  await expect(text).toContainText("Texto actualizado");
  await expect(text).toHaveAttribute("data-element-id", elementId!);
});

test("opens an existing text with its rendered bounds and typography", async ({ page }) => {
  await page.goto("/");
  const pageBounds = await page.locator(".page").boundingBox();
  expect(pageBounds).not.toBeNull();

  await page.getByRole("button", { name: "Texto" }).click();
  await page.mouse.click(pageBounds!.x + 180, pageBounds!.y + 160);
  const editor = page.getByRole("textbox", { name: "Texto editable" });
  await editor.fill("Texto escalado");
  await editor.press("Control+Enter");

  const text = page.locator('.page-svg svg text[data-element-id]');
  await expect(text).toHaveCount(1);
  await expect(text).toBeVisible();
  await page.getByRole("button", { name: "Seleccion" }).click();
  const resizeHandle = page.locator('[data-resize-handle="se"]');
  await expect.poll(() => resizeHandle.boundingBox()).not.toBeNull();
  const handleBounds = await resizeHandle.boundingBox();
  expect(handleBounds).not.toBeNull();
  await page.mouse.move(handleBounds!.x + handleBounds!.width / 2, handleBounds!.y + handleBounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBounds!.x + handleBounds!.width / 2 + 30, handleBounds!.y + handleBounds!.height / 2 + 15);
  await page.mouse.up();
  await expect.poll(() => text.boundingBox()).not.toBeNull();
  const rendered = await text.boundingBox();
  expect(rendered).not.toBeNull();
  await page.mouse.dblclick(rendered!.x + rendered!.width / 2, rendered!.y + rendered!.height / 2);

  await expect(editor).toHaveValue("Texto escalado");
  const inline = await editor.boundingBox();
  expect(inline).not.toBeNull();
  expect(inline!.width).toBeGreaterThan(0);
  expect(inline!.height).toBeGreaterThan(0);
  expect(inline!.width).toBeCloseTo(rendered!.width, 0);
  const renderedFontSize = Number(await text.getAttribute("font-size"));
  const pageScale = await page.locator(".page").evaluate((element) => element.getBoundingClientRect().width / Number(element.querySelector("svg")?.getAttribute("width")));
  const inlineFontSize = await editor.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(inlineFontSize).toBeCloseTo(renderedFontSize * pageScale, 1);
});

test("commits a new text when clicking elsewhere without waiting for Enter", async ({ page }) => {
  await page.goto("/");
  const pageBounds = await page.locator(".page").boundingBox();
  expect(pageBounds).not.toBeNull();

  await page.getByRole("button", { name: "Texto" }).click();
  await page.mouse.click(pageBounds!.x + 120, pageBounds!.y + 120);
  const editor = page.getByRole("textbox", { name: "Texto editable" });
  await editor.fill("Commit inmediato");
  await page.mouse.click(pageBounds!.x + 420, pageBounds!.y + 280);

  await expect(editor).toBeHidden();
  await expect(page.locator('.page-svg svg text[data-element-id]')).toHaveCount(1);
  await expect(page.locator('.page-svg svg text[data-element-id]')).toContainText("Commit inmediato");
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(page.locator('.page-svg svg text[data-element-id]')).toHaveCount(0);
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

test("creates a Cota with two nodes and a third placement click", async ({ page }) => {
  await page.goto("/");
  await drawRectangle(page);
  const rectangles = page.locator(".page-svg svg rect");
  await expect(rectangles).toHaveCount(1);
  const first = await rectangles.first().boundingBox();
  expect(first).not.toBeNull();
  await page.getByRole("button", { name: "Cota" }).click();
  const firstNode = { x: first!.x, y: first!.y };
  const secondNode = { x: first!.x + first!.width, y: first!.y };
  await page.mouse.move(firstNode.x, firstNode.y);
  await expect(page.locator("[data-dimension-node-target]")).toBeVisible();
  await expect(page.locator(".tool-cursor")).toHaveAttribute("title", "Nodo de dimensión");
  await page.mouse.click(firstNode.x, firstNode.y);
  await page.mouse.move(secondNode.x, secondNode.y);
  await expect(page.locator("[data-dimension-node-target]")).toBeVisible();
  await page.mouse.click(secondNode.x, secondNode.y);
  await expect(page.locator(".dimension-pending-overlay")).toBeVisible();
  await expect(page.locator("[data-dimension-node-target]")).toHaveCount(0);
  await page.mouse.click((first!.x + secondNode.x) / 2, first!.y + first!.height + 45);
  await expect(page.locator('[data-dimension="horizontal"]')).toHaveCount(1);
});

test("renders created geometry as SVG", async ({ page }) => {
  await page.goto("/");
  await drawRectangle(page);

  await expect(page.locator(".page-svg svg")).toHaveAttribute("viewBox", /.+/);
  await expect(page.locator(".page-svg svg rect")).toHaveCount(1);
});

test("shows millimetre coordinate rulers around the workspace", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("[data-ruler-horizontal]")).toBeVisible();
  await expect(page.locator("[data-ruler-vertical]")).toBeVisible();
  await expect(page.locator("[data-ruler-horizontal] .ruler-tick").first()).toBeVisible();
  await expect(page.locator("[data-ruler-vertical] .ruler-tick").first()).toBeVisible();
});

test("exposes real contour vertices in Forma and edits one vertex", async ({ page }) => {
  await page.goto("/");
  await drawRectangle(page);
  const first = await page.locator(".page-svg svg rect").first().boundingBox();
  expect(first).not.toBeNull();
  await page.getByRole("button", { name: "Rectángulo" }).click();
  const secondStart = { x: first!.x + first!.width / 2, y: first!.y + first!.height / 2 };
  const secondEnd = { x: secondStart.x + 30, y: secondStart.y + 20 };
  await page.mouse.move(secondStart.x, secondStart.y);
  await page.mouse.down();
  await page.mouse.move(secondEnd.x, secondEnd.y);
  await page.mouse.up();

  await page.getByRole("button", { name: "Seleccion" }).click();
  const rectangles = page.locator(".page-svg svg rect");
  await expect(rectangles).toHaveCount(2);
  const firstRectangle = await rectangles.nth(0).boundingBox();
  const secondRectangle = await rectangles.nth(1).boundingBox();
  expect(firstRectangle).not.toBeNull();
  expect(secondRectangle).not.toBeNull();
  await page.mouse.click(firstRectangle!.x + 4, firstRectangle!.y + 4);
  await page.keyboard.down("Shift");
  await page.mouse.click(secondRectangle!.x + secondRectangle!.width / 2, secondRectangle!.y + secondRectangle!.height / 2);
  await page.keyboard.up("Shift");
  const weld = page.getByRole("button", { name: "Soldar" });
  await expect(weld).toBeVisible();
  await expect(weld).toBeEnabled();
  await weld.click();
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
