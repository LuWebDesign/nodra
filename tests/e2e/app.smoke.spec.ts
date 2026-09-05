import { expect, test, type Locator, type Page } from "@playwright/test";

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
   await page.mouse.click(start.x, start.y);
   await page.mouse.move(end.x, end.y);
   await page.mouse.click(end.x, end.y);
  const rectangle = page.locator(".page-svg svg rect[data-element-id]").first();
  await expect(rectangle).toHaveCount(1);
  await expect.poll(() => rectangle.boundingBox()).not.toBeNull();
}

async function drawLine(page: Page, start: { x: number; y: number }, end: { x: number; y: number }) {
  await page.getByRole("button", { name: "Línea" }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
}

async function visibleBoundingBox(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
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
  await expect(page.locator("[data-spline-handle]")).toHaveCount(2);
  const firstNode = await nodes.first().boundingBox();
  expect(firstNode).not.toBeNull();
  await page.mouse.move(firstNode!.x + firstNode!.width / 2, firstNode!.y + firstNode!.height / 2);
  await expect(page.locator("[data-node-hover-feedback]")).toBeVisible();
  await expect(page.locator("[data-node-hover-feedback]")).toHaveCSS("background-color", "rgb(245, 158, 11)");
  await expect(page.locator(".canvas")).not.toHaveClass(/close-target-active/);
  await expect(nodes.first()).not.toHaveAttribute("data-spline-close-target");
  await expect(page.locator(".tool-cursor")).toBeVisible();
  await expect(page.locator(".tool-cursor")).not.toHaveAttribute("title", "Cerrar trazado");
  await page.mouse.click(firstNode!.x + firstNode!.width / 2, firstNode!.y + firstNode!.height / 2);
  await expect(spline).toHaveAttribute("d", / Z$/);
  await expect(page.locator("[data-spline-handle]")).toHaveCount(0);
  await page.getByRole("button", { name: "Forma" }).click();
  await page.mouse.dblclick(x + 80, y + 20);
  await expect(nodes).toHaveCount(3);
  const selectedNode = await nodes.nth(1).boundingBox();
  expect(selectedNode).not.toBeNull();
  await page.mouse.click(selectedNode!.x + selectedNode!.width / 2, selectedNode!.y + selectedNode!.height / 2);
  await expect(page.locator("[data-spline-handle]")).toHaveCount(2);
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
  await page.mouse.dblclick(pageBounds!.x + 160, pageBounds!.y + 110);
  const node = page.locator("[data-spline-node]").nth(1);
  const nodeBounds = await node.boundingBox();
  expect(nodeBounds).not.toBeNull();
  await page.mouse.click(nodeBounds!.x + nodeBounds!.width / 2, nodeBounds!.y + nodeBounds!.height / 2);
  await expect(page.locator("[data-spline-handle]")).toHaveCount(2);
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
  await page.mouse.move(firstBounds!.x + firstBounds!.width / 2, firstBounds!.y + firstBounds!.height / 2);
  await expect(page.locator("[data-node-hover-feedback]")).toBeVisible();
  await expect(page.locator("[data-node-hover-feedback]")).toHaveCSS("background-color", "rgb(245, 158, 11)");
  await expect(page.locator(".canvas")).not.toHaveClass(/close-target-active/);
  await expect(page.locator(".tool-cursor")).toBeVisible();
  await expect(page.locator(".tool-cursor")).not.toHaveAttribute("title", "Cerrar trazado");
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

test("cuts a curved Pen segment after a straight segment and supports undo and redo", async ({ page }) => {
  await page.goto("/");
  const pageBounds = await page.locator(".page").boundingBox();
  expect(pageBounds).not.toBeNull();
  const start = { x: pageBounds!.x + 80, y: pageBounds!.y + 120 };
  const straightEnd = { x: start.x + 60, y: start.y };
  const end = { x: start.x + 140, y: start.y };

  await page.getByRole("button", { name: "Pluma" }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(straightEnd.x, straightEnd.y);
  await page.mouse.move(end.x, end.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y + 50);
  await page.mouse.up();
  const curve = page.locator(".page-svg svg path[data-element-id]").first();
  await expect(curve).toHaveAttribute("d", / C/);
  const curveId = await curve.getAttribute("data-element-id");
  const beforeCut = await curve.getAttribute("d");

  await drawLine(page, { x: straightEnd.x + 40, y: start.y - 60 }, { x: straightEnd.x + 40, y: start.y + 40 });
  const sketchGroups = page.locator('.page-svg svg g[data-element-id]').filter({ has: page.locator("line") });
  await expect(sketchGroups).toHaveCount(1);
  const transversalId = await sketchGroups.getAttribute("data-element-id");
  const transversal = page.locator(`.page-svg svg g[data-element-id="${transversalId}"]`);
  await expect(transversal.locator(":scope > line")).toHaveCount(1);

  const clickedSide = await curve.evaluate((element) => {
    const path = element as SVGPathElement;
    const point = path.getPointAtLength(path.getTotalLength() * 0.8);
    const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  });
  await page.getByRole("button", { name: "Cortar segmentos" }).click();
  await page.mouse.move(clickedSide.x, clickedSide.y);
  const hoverCurve = page.locator(".cut-segment-hover-overlay path");
  await expect(hoverCurve).toHaveCount(1);
  await expect(hoverCurve).toHaveCSS("fill", "none");
  await expect(page.locator(".cut-segment-hover-overlay polyline")).toHaveCount(0);
  await page.mouse.click(clickedSide.x, clickedSide.y);

  const cutCurve = page.locator(`.page-svg svg path[data-element-id="${curveId}"]`);
  await expect(cutCurve).toHaveAttribute("d", /L.*C/);
  await expect(cutCurve).not.toHaveAttribute("d", beforeCut!);
  await expect(transversal.locator(":scope > line")).toHaveCount(2);
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(curve).toHaveAttribute("d", beforeCut!);
  await expect(transversal.locator(":scope > line")).toHaveCount(1);
  await page.getByRole("button", { name: "Rehacer" }).click();
  await expect(cutCurve).not.toHaveAttribute("d", beforeCut!);
  await expect(transversal.locator(":scope > line")).toHaveCount(2);
});

test("edits rectangle dimensions around its center with proportional lock and undo", async ({ page }) => {
  await page.goto("/");
  await drawRectangle(page);

  const rectangle = page.locator(".page-svg svg rect").first();
  await expect(rectangle).toBeVisible();
  await expect.poll(() => rectangle.boundingBox()).not.toBeNull();
  const rectangleBounds = await rectangle.boundingBox();
  expect(rectangleBounds).not.toBeNull();
  await page.getByRole("button", { name: "Seleccion" }).click();
  await page.mouse.click(rectangleBounds!.x + rectangleBounds!.width / 2, rectangleBounds!.y + rectangleBounds!.height / 2);
  const x = page.locator(".inspector").getByLabel("X en milímetros");
  const y = page.locator(".inspector").getByLabel("Y en milímetros");
  const width = page.locator(".inspector").getByLabel("Ancho en milímetros");
  const height = page.locator(".inspector").getByLabel("Alto en milímetros");
  const original = { x: Number(await x.inputValue()), y: Number(await y.inputValue()), width: Number(await width.inputValue()), height: Number(await height.inputValue()) };
  await width.fill(String(original.width + 10));
  await width.press("Enter");
  await expect(width).toHaveValue(String(original.width + 10));
  await expect.poll(async () => Number(await x.inputValue())).toBeCloseTo(original.x - 5);
  await expect(y).toHaveValue(String(original.y));
  await height.fill(String(original.height + 10));
  await height.press("Enter");
  await expect.poll(async () => Number(await y.inputValue())).toBeCloseTo(original.y - 5);
  await expect(width).toHaveValue(String(original.width + 10));
  await page.getByRole("button", { name: "Bloquear proporción" }).click();
  const lockedWidth = Number(await width.inputValue());
  const lockedHeight = Number(await height.inputValue());
  const lockedX = Number(await x.inputValue());
  const lockedY = Number(await y.inputValue());
  await width.fill(String(lockedWidth + 10));
  await width.press("Enter");
  const nextWidth = lockedWidth + 10;
  const nextHeight = nextWidth * lockedHeight / lockedWidth;
  await expect.poll(async () => Number(await height.inputValue())).toBeCloseTo(nextHeight);
  await expect.poll(async () => Number(await x.inputValue())).toBeCloseTo(lockedX - 5);
  await expect.poll(async () => Number(await y.inputValue())).toBeCloseTo(lockedY + (lockedHeight - nextHeight) / 2);
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(width).toHaveValue(String(lockedWidth));
  await expect(height).toHaveValue(String(lockedHeight));
  await expect(x).toHaveValue(String(lockedX));
  await expect(y).toHaveValue(String(lockedY));
});

test("persists a confirmed node snap and anchors inspector width to the connected side", async ({ page }) => {
  await page.goto("/");
  await drawRectangle(page);
  const original = await page.locator(".page-svg svg rect").first().boundingBox();
  expect(original).not.toBeNull();
  await page.getByRole("button", { name: "Rectángulo" }).click();
  await page.mouse.click(original!.x + original!.width, original!.y + original!.height / 2);
  await page.mouse.click(original!.x + original!.width + 60, original!.y + original!.height / 2 + 40);
  await expect(page.locator(".page-svg svg rect")).toHaveCount(2);
  const width = page.locator(".inspector").getByLabel("Ancho en milímetros");
  const x = page.locator(".inspector").getByLabel("X en milímetros");
  const originalX = Number(await x.inputValue());
  const originalWidth = Number(await width.inputValue());
  await width.fill(String(originalWidth + 10));
  await width.press("Enter");
  await expect.poll(async () => Number(await x.inputValue())).toBeCloseTo(originalX);
});

test("does not create a connection from hover alone", async ({ page }) => {
  await page.goto("/");
  await drawRectangle(page);
  const rectangle = page.locator(".page-svg svg rect").first();
  const bounds = await rectangle.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width, bounds!.y + bounds!.height / 2);
  await expect(page.locator("[data-node-hover-feedback]")).toBeVisible();
  await page.getByRole("button", { name: "Seleccion" }).click();
  await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  const x = page.locator(".inspector").getByLabel("X en milímetros");
  const width = page.locator(".inspector").getByLabel("Ancho en milímetros");
  const originalX = Number(await x.inputValue());
  const originalWidth = Number(await width.inputValue());
  await width.fill(String(originalWidth + 10));
  await width.press("Enter");
  await expect.poll(async () => Number(await x.inputValue())).toBeCloseTo(originalX - 5);
});

test("creates nested rectangle and circle objects with click gestures", async ({ page }) => {
  await page.goto("/");
  const bounds = await page.locator(".page").boundingBox();
  expect(bounds).not.toBeNull();
  await page.getByRole("button", { name: "Rectángulo" }).click();
  await page.mouse.click(bounds!.x + 100, bounds!.y + 100);
  await page.mouse.click(bounds!.x + 260, bounds!.y + 220);
  const rectangle = page.locator('.page-svg svg rect[data-element-id]');
  await expect(rectangle).toHaveCount(1);
  const rectangleBox = await rectangle.boundingBox();
  expect(rectangleBox).not.toBeNull();
  expect(rectangleBox!.x).toBeCloseTo(bounds!.x + 100, 0);
  expect(rectangleBox!.y).toBeCloseTo(bounds!.y + 100, 0);
  await page.getByRole("button", { name: "Círculo" }).click();
  await page.mouse.click(bounds!.x + 170, bounds!.y + 160);
  await page.mouse.move(bounds!.x + 205, bounds!.y + 160);
  await expect(page.locator(".creation-pending-overlay")).toBeVisible();
  await page.mouse.click(bounds!.x + 205, bounds!.y + 160);
  await expect(page.locator('.page-svg svg rect[data-element-id]')).toHaveCount(1);
  await expect(page.locator('.page-svg svg ellipse[data-element-id]')).toHaveCount(1);
});

test("continues a click line and closes a valid non-collinear path", async ({ page }) => {
  await page.goto("/");
  const bounds = await page.locator(".page").boundingBox();
  expect(bounds).not.toBeNull();
  await page.getByRole("button", { name: "Línea" }).click();
  const first = { x: bounds!.x + 120, y: bounds!.y + 120 };
  const second = { x: first.x + 90, y: first.y };
  const third = { x: second.x, y: second.y + 70 };
  await page.mouse.click(first.x, first.y);
  await page.mouse.click(second.x, second.y);
  await page.mouse.move(third.x, third.y);
  await expect(page.locator(".creation-pending-overlay")).toBeVisible();
  await page.mouse.click(third.x, third.y);
  await page.mouse.click(first.x, first.y);
  const sketch = page.locator('.page-svg svg g[data-element-id]').first();
  await expect(sketch).toHaveCount(1);
  await expect(sketch.locator('path[fill-rule="evenodd"]')).toHaveAttribute("d", /Z/);
  await expect(sketch.locator("line")).toHaveCount(3);
});

test("keeps a path selected after creating a dimension", async ({ page }) => {
  await page.goto("/");
  const bounds = await page.locator(".page").boundingBox();
  expect(bounds).not.toBeNull();
  const start = { x: bounds!.x + 120, y: bounds!.y + 180 };
  const end = { x: start.x + 160, y: start.y };
  await page.getByRole("button", { name: "Pluma" }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  await page.getByRole("button", { name: "Cota" }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  await page.mouse.click((start.x + end.x) / 2, start.y - 35);
  await expect(page.locator('[data-dimension="horizontal"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Forma" }).click();
  await page.mouse.click((start.x + end.x) / 2, start.y);
  await expect(page.getByRole("button", { name: "Dividir segmento del trazado en el punto medio" })).toBeEnabled();
  await page.getByRole("button", { name: "Dividir segmento del trazado en el punto medio" }).click();
  await expect(page.locator('[data-dimension="horizontal"]')).toHaveCount(1);
});

test("cancels a sketch relationship preview without committing it", async ({ page }) => {
  await page.goto("/");
  const bounds = await page.locator(".page").boundingBox();
  expect(bounds).not.toBeNull();
  const first = { x: bounds!.x + 120, y: bounds!.y + 120 };
  const second = { x: first.x + 90, y: first.y };
  const third = { x: second.x, y: second.y + 70 };
  await page.getByRole("button", { name: "Línea" }).click();
  for (const point of [first, second, third]) await page.mouse.click(point.x, point.y);
  await page.getByRole("button", { name: "Forma" }).click();
  await page.mouse.click((first.x + second.x) / 2, first.y);
  const nodes = page.locator(".contour-node");
  await expect(nodes).toHaveCount(3);
  await nodes.nth(0).click();
  await nodes.nth(1).click({ modifiers: ["Shift"] });
  await page.locator(".constraint-buttons").getByRole("button", { name: "Horizontal", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancelar" })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("button", { name: "Confirmar relación" })).toHaveCount(0);
});
test("edits an explicit sketch distance relationship", async ({ page }) => {
  await page.goto("/");
  const bounds = await page.locator(".page").boundingBox();
  expect(bounds).not.toBeNull();
  const first = { x: bounds!.x + 120, y: bounds!.y + 120 };
  const second = { x: first.x + 90, y: first.y };
  const third = { x: second.x, y: second.y + 70 };
  await page.getByRole("button", { name: "Línea" }).click();
  for (const point of [first, second, third]) await page.mouse.click(point.x, point.y);
  await page.getByRole("button", { name: "Forma" }).click();
  await page.mouse.click((first.x + second.x) / 2, first.y);
  const nodes = page.locator(".contour-node");
  await expect(nodes).toHaveCount(3);
  await nodes.nth(0).click();
  await nodes.nth(1).click({ modifiers: ["Shift"] });
  await page.locator(".constraint-buttons").getByRole("button", { name: "Distancia H", exact: true }).click();
  await page.getByRole("spinbutton").fill("120");
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar relación" }).click();
  const value = page.locator('input[aria-label^="Valor "]').first();
  await expect(value).toHaveValue("120");
  await value.fill("140");
  await page.locator(".inspector").getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(value).toHaveValue("140");
});

test("manages a cross-sketch distance relationship from the inspector", async ({ page }) => {
  await page.goto("/");
  const bounds = await visibleBoundingBox(page.locator(".page"));
  const firstStart = { x: bounds!.x + 110, y: bounds!.y + 120 };
  const firstEnd = { x: firstStart.x + 90, y: firstStart.y + 40 };
  const secondStart = { x: bounds!.x + 300, y: bounds!.y + 260 };
  const secondEnd = { x: secondStart.x + 90, y: secondStart.y + 40 };

  await drawLine(page, firstStart, firstEnd);
  await page.getByRole("button", { name: "Seleccion" }).click();
  await drawLine(page, secondStart, secondEnd);
  await page.getByRole("button", { name: "Forma" }).click();

  const sketches = page.locator(".page-svg svg g[data-element-id]");
  const lines = sketches.locator("line");
  await expect(lines).toHaveCount(2);
  const firstSketchId = await sketches.nth(0).getAttribute("data-element-id");
  const secondSketchId = await sketches.nth(1).getAttribute("data-element-id");
  expect(firstSketchId).not.toBeNull();
  expect(secondSketchId).not.toBeNull();
  await page.mouse.click((firstStart.x + firstEnd.x) / 2, (firstStart.y + firstEnd.y) / 2);
  await page.keyboard.down("Shift");
  try {
    await page.mouse.click((secondStart.x + secondEnd.x) / 2, (secondStart.y + secondEnd.y) / 2);
  } finally {
    await page.keyboard.up("Shift");
  }
  const firstNodes = page.locator(`[data-contour-node^="${firstSketchId}:p:"]`);
  const secondNodes = page.locator(`[data-contour-node^="${secondSketchId}:p:"]`);
  await expect(firstNodes).toHaveCount(2);
  await expect(secondNodes).toHaveCount(2);
  await firstNodes.nth(1).click();
  await secondNodes.nth(0).click({ modifiers: ["Shift"] });

  await page.locator(".constraint-buttons").getByRole("button", { name: "Distancia H", exact: true }).click();
  await page.locator(".constraint-value-editor").getByRole("spinbutton").fill("140");
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar relación" }).click();

  const globalRelations = page.getByRole("list", { name: "Relaciones globales" });
  await expect(globalRelations).toBeVisible();
  const value = globalRelations.getByRole("spinbutton");
  await expect(value).toHaveValue("140");
  await value.fill("160");
  await globalRelations.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(value).toHaveValue("160");

  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(globalRelations.getByRole("spinbutton")).toHaveValue("140");
  await page.getByRole("button", { name: "Rehacer" }).click();
  await expect(globalRelations.getByRole("spinbutton")).toHaveValue("160");
  await globalRelations.getByRole("button", { name: "Eliminar", exact: true }).click();
  await expect(globalRelations).toHaveCount(0);
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(page.getByRole("list", { name: "Relaciones globales" })).toBeVisible();
});

test("creates an angle relationship between sketches", async ({ page }) => {
  await page.goto("/");
  const bounds = await visibleBoundingBox(page.locator(".page"));
  const firstStart = { x: bounds.x + 110, y: bounds.y + 120 };
  const firstEnd = { x: firstStart.x + 90, y: firstStart.y + 30 };
  const secondStart = { x: bounds.x + 300, y: bounds.y + 260 };
  const secondEnd = { x: secondStart.x + 90, y: secondStart.y - 50 };
  await drawLine(page, firstStart, firstEnd);
  await page.getByRole("button", { name: "Seleccion" }).click();
  await drawLine(page, secondStart, secondEnd);
  await page.getByRole("button", { name: "Forma" }).click();

  const sketches = page.locator(".page-svg svg g[data-element-id]");
  const lines = sketches.locator("line");
  await expect(lines).toHaveCount(2);
  const firstSketchId = await sketches.nth(0).getAttribute("data-element-id");
  const secondSketchId = await sketches.nth(1).getAttribute("data-element-id");
  expect(firstSketchId).not.toBeNull();
  expect(secondSketchId).not.toBeNull();
  await page.mouse.click((firstStart.x + firstEnd.x) / 2, (firstStart.y + firstEnd.y) / 2);
  await page.keyboard.down("Shift");
  try {
    await page.mouse.click((secondStart.x + secondEnd.x) / 2, (secondStart.y + secondEnd.y) / 2);
  } finally {
    await page.keyboard.up("Shift");
  }
  const firstNodes = page.locator(`[data-contour-node^="${firstSketchId}:p:"]`);
  const secondNodes = page.locator(`[data-contour-node^="${secondSketchId}:p:"]`);
  await firstNodes.nth(1).click();
  await secondNodes.nth(0).click({ modifiers: ["Shift"] });

  await page.locator(".constraint-buttons").getByRole("button", { name: "Ángulo", exact: true }).click();
  const editor = page.locator(".constraint-value-editor");
  await expect(editor).toContainText("Ángulo en grados");
  await editor.getByRole("spinbutton").fill("90");
  await editor.getByRole("button", { name: "Confirmar", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar relación" }).click();
  const globalRelations = page.getByRole("list", { name: "Relaciones globales" });
  await expect(globalRelations).toContainText("Ángulo");
  await expect(globalRelations.getByRole("spinbutton")).toHaveValue("90");
});

for (const relation of [
  { button: "Paralela", label: "Paralela" },
  { button: "Perpendicular", label: "Perpendicular" },
  { button: "Igual longitud", label: "Igual" },
] as const) {
test(`creates a ${relation.label.toLowerCase()} relationship between sketches`, async ({ page }) => {
  await page.goto("/");
  const bounds = await visibleBoundingBox(page.locator(".page"));
  const firstStart = { x: bounds.x + 110, y: bounds.y + 120 };
  const firstEnd = { x: firstStart.x + 90, y: firstStart.y + 30 };
  const secondStart = { x: bounds.x + 300, y: bounds.y + 260 };
  const secondEnd = { x: secondStart.x + 90, y: secondStart.y - 50 };

  await drawLine(page, firstStart, firstEnd);
  await page.getByRole("button", { name: "Seleccion" }).click();
  await drawLine(page, secondStart, secondEnd);
  await page.getByRole("button", { name: "Forma" }).click();

  const sketches = page.locator(".page-svg svg g[data-element-id]");
  const lines = sketches.locator("line");
  await expect(lines).toHaveCount(2);
  const firstSketchId = await sketches.nth(0).getAttribute("data-element-id");
  const secondSketchId = await sketches.nth(1).getAttribute("data-element-id");
  expect(firstSketchId).not.toBeNull();
  expect(secondSketchId).not.toBeNull();
  await page.mouse.click((firstStart.x + firstEnd.x) / 2, (firstStart.y + firstEnd.y) / 2);
  await page.keyboard.down("Shift");
  try {
    await page.mouse.click((secondStart.x + secondEnd.x) / 2, (secondStart.y + secondEnd.y) / 2);
  } finally {
    await page.keyboard.up("Shift");
  }

  const firstNodes = page.locator(`[data-contour-node^="${firstSketchId}:p:"]`);
  const secondNodes = page.locator(`[data-contour-node^="${secondSketchId}:p:"]`);
  await expect(firstNodes).toHaveCount(2);
  await expect(secondNodes).toHaveCount(2);
  await firstNodes.nth(0).click();
  await firstNodes.nth(1).click({ modifiers: ["Shift"] });
  await secondNodes.nth(0).click({ modifiers: ["Shift"] });
  await secondNodes.nth(1).click({ modifiers: ["Shift"] });

  await page.locator(".constraint-buttons").getByRole("button", { name: relation.button, exact: true }).click();
  await page.getByRole("button", { name: "Confirmar relación" }).click();
  const globalRelations = page.getByRole("list", { name: "Relaciones globales" });
  await expect(globalRelations).toContainText(relation.label);
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(globalRelations).toHaveCount(0);
  await page.getByRole("button", { name: "Rehacer" }).click();
  await expect(page.getByRole("list", { name: "Relaciones globales" })).toContainText(relation.label);
});

}

test("creates and confirms an explicit sketch relationship", async ({ page }) => {
  await page.goto("/");
  const bounds = await page.locator(".page").boundingBox();
  expect(bounds).not.toBeNull();
  const first = { x: bounds!.x + 120, y: bounds!.y + 120 };
  const second = { x: first.x + 90, y: first.y };
  const third = { x: second.x, y: second.y + 70 };
  await page.getByRole("button", { name: "Línea" }).click();
  for (const point of [first, second, third]) await page.mouse.click(point.x, point.y);
  await page.getByRole("button", { name: "Forma" }).click();
  await page.mouse.click((first.x + second.x) / 2, first.y);
  const nodes = page.locator(".contour-node");
  await expect(nodes).toHaveCount(3);
  await nodes.nth(0).click();
  await nodes.nth(1).click({ modifiers: ["Shift"] });
  await page.locator(".constraint-buttons").getByRole("button", { name: "Horizontal", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirmar relación" })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar relación" }).click();
  await expect(page.getByText("Horizontal", { exact: false }).last()).toBeVisible();
});
test("reuses an existing sketch node when continuing the same line", async ({ page }) => {
  await page.goto("/");
  const bounds = await page.locator(".page").boundingBox();
  expect(bounds).not.toBeNull();
  await page.getByRole("button", { name: "Línea" }).click();
  const first = { x: bounds!.x + 120, y: bounds!.y + 120 };
  const second = { x: first.x + 90, y: first.y };
  const third = { x: second.x, y: second.y + 70 };
  await page.mouse.click(first.x, first.y);
  await page.mouse.click(second.x, second.y);
  await page.mouse.move(first.x, first.y);
  await page.mouse.click(first.x, first.y);
  await page.mouse.click(third.x, third.y);
  const sketch = page.locator('.page-svg svg g[data-element-id]').first();
  await expect(sketch).toHaveCount(1);
  const lines = sketch.locator("line");
  await expect(lines).toHaveCount(2);
  const starts = await lines.evaluateAll((elements) => elements.map((line) => [line.getAttribute("x1"), line.getAttribute("y1")]));
  expect(starts[0]).toEqual(starts[1]);
});

test("continues drawing from a closed sketch", async ({ page }) => {
  await page.goto("/");
  const bounds = await page.locator(".page").boundingBox();
  expect(bounds).not.toBeNull();
  await page.getByRole("button", { name: "Línea" }).click();
  const first = { x: bounds!.x + 120, y: bounds!.y + 120 };
  const second = { x: first.x + 80, y: first.y };
  const third = { x: second.x, y: second.y + 60 };
  const fourth = { x: first.x - 50, y: first.y + 60 };
  for (const point of [first, second, third, first, fourth]) await page.mouse.click(point.x, point.y);
  const sketch = page.locator('.page-svg svg g[data-element-id]').first();
  await expect(sketch).toHaveCount(1);
  await expect(sketch.locator("line")).toHaveCount(4);
});

test("recognizes and fills a closed sketch", async ({ page }) => {
  await page.goto("/");
  const bounds = await page.locator(".page").boundingBox();
  expect(bounds).not.toBeNull();
  await page.getByRole("button", { name: "Línea" }).click();
  const points = [{ x: bounds!.x + 140, y: bounds!.y + 140 }, { x: bounds!.x + 240, y: bounds!.y + 140 }, { x: bounds!.x + 240, y: bounds!.y + 220 }, { x: bounds!.x + 140, y: bounds!.y + 220 }];
  for (const point of [...points, points[0]!]) await page.mouse.click(point.x, point.y);
  const sketch = page.locator('.page-svg svg g[data-element-id]').first();
  await expect(sketch.locator('path[fill-rule="evenodd"]')).toHaveAttribute("fill", /.+/);
  await expect(sketch.locator('path[fill-rule="evenodd"]')).toHaveAttribute("d", /Z/);
});

test("shows node hover feedback while keeping the system cursor as an arrow", async ({ page }) => {
  await page.goto("/");
  await drawRectangle(page);
  await page.getByRole("button", { name: "Seleccion" }).click();
  const rectangle = page.locator(".page-svg svg rect").first();
  const bounds = await rectangle.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x, bounds!.y);
  const feedback = page.locator("[data-node-hover-feedback]");
  await expect(feedback).toBeVisible();
  const feedbackBounds = await feedback.boundingBox();
  expect(feedbackBounds).not.toBeNull();
  const initialFeedbackSize = await feedback.evaluate((element) => {
    const styles = getComputedStyle(element);
    return { width: Number.parseFloat(styles.width), height: Number.parseFloat(styles.height) };
  });
  const cssPixelsPerMillimeter = 96 / 25.4;
  expect(initialFeedbackSize.width).toBeCloseTo(3 * cssPixelsPerMillimeter, 1);
  expect(initialFeedbackSize.height).toBeCloseTo(3 * cssPixelsPerMillimeter, 1);
  await expect(feedback).toHaveCSS("background-color", "rgb(245, 158, 11)");
  await expect(feedback).toHaveCSS("border-top-width", "1px");
  await expect(feedback).toHaveCSS("border-top-color", "rgb(17, 24, 39)");
  await expect(feedback).toHaveCSS("box-shadow", "none");
  expect(Math.abs(feedbackBounds!.x + feedbackBounds!.width / 2 - bounds!.x)).toBeLessThan(1);
  expect(Math.abs(feedbackBounds!.y + feedbackBounds!.height / 2 - bounds!.y)).toBeLessThan(1);
  await expect(page.locator(".canvas")).toHaveCSS("cursor", "default");
  await page.getByRole("button", { name: "Acercar" }).click();
  const zoomedBounds = await rectangle.boundingBox();
  expect(zoomedBounds).not.toBeNull();
  await page.mouse.move(zoomedBounds!.x, zoomedBounds!.y);
  const zoomedFeedbackSize = await feedback.evaluate((element) => {
    const styles = getComputedStyle(element);
    return { width: Number.parseFloat(styles.width), height: Number.parseFloat(styles.height) };
  });
  expect(zoomedFeedbackSize).toEqual(initialFeedbackSize);
  await page.mouse.move(zoomedBounds!.x + zoomedBounds!.width + 80, zoomedBounds!.y + zoomedBounds!.height + 80);
  await expect(feedback).toHaveCount(0);
});

test("keeps the tool cursor beside the pointer and shows node feedback for a drawing tool", async ({ page }) => {
  await page.goto("/");
  await drawRectangle(page);
  await page.getByRole("button", { name: "Rectángulo" }).click();
  const rectangle = page.locator(".page-svg svg rect").first();
  const bounds = await rectangle.boundingBox();
  expect(bounds).not.toBeNull();
  const pointer = { x: bounds!.x, y: bounds!.y };
  await page.mouse.move(pointer.x, pointer.y);
  const feedback = page.locator("[data-node-hover-feedback]");
  await expect(feedback).toBeVisible();
  const cursor = page.locator(".tool-cursor");
  await expect(cursor).toBeVisible();
  const cursorBounds = await cursor.boundingBox();
  expect(cursorBounds).not.toBeNull();
  expect(cursorBounds!.x).toBeGreaterThan(pointer.x);
  expect(cursorBounds!.y).toBeGreaterThan(pointer.y);
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
  expect(Math.abs(inline!.width - rendered!.width)).toBeLessThan(2);
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

  const rectangle = page.locator(".page-svg svg rect[data-element-id]").first();
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

  const rectangles = page.locator(".page-svg svg rect[data-element-id]");
  await expect(rectangles).toHaveCount(2);
  const nestedBounds = await rectangles.nth(1).boundingBox();
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

test("creates a radius Cota from the integrated Cota modes", async ({ page }) => {
  await page.goto("/");
  const bounds = await page.locator(".page").boundingBox();
  expect(bounds).not.toBeNull();
  const start = { x: bounds!.x + 100, y: bounds!.y + 100 };
  const end = { x: start.x + 100, y: start.y };
  await page.getByRole("button", { name: "Círculo" }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  const ellipse = page.locator(".page-svg svg ellipse[data-element-id]");
  await expect(ellipse).toHaveCount(1);
  const ellipseBox = await visibleBoundingBox(ellipse);
  await page.getByRole("button", { name: "Cota" }).click();
  await page.getByRole("group", { name: "Modo de cota" }).getByRole("button", { name: "Radio" }).click();
  const center = { x: ellipseBox!.x + ellipseBox!.width / 2, y: ellipseBox!.y + ellipseBox!.height / 2 };
  const rim = { x: ellipseBox!.x + ellipseBox!.width, y: center.y };
  await page.mouse.click(center.x, center.y);
  await page.mouse.click(rim.x, rim.y);
  await page.mouse.click(ellipseBox!.x + ellipseBox!.width + 35, center.y);
  await expect(page.locator('[data-dimension="radius"]')).toContainText("R");
  await expect(page.locator('[data-dimension="radius"]')).toBeVisible();
      const editor = page.locator('input[type="number"]').last();
      await expect(editor).toBeVisible();
      await editor.fill("80");
      await page.getByRole("button", { name: "Confirmar", exact: true }).last().click();
      await expect.poll(async () => (await ellipse.boundingBox())?.width ?? 0).toBeGreaterThan(80);
    });
    
    test("edits a driving diameter Cota with diameter semantics", async ({ page }) => {
  await page.goto("/");
  const bounds = await page.locator(".page").boundingBox();
  expect(bounds).not.toBeNull();
  const start = { x: bounds!.x + 100, y: bounds!.y + 100 };
  const end = { x: start.x + 100, y: start.y };
  await page.getByRole("button", { name: "Círculo" }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  const ellipse = page.locator(".page-svg svg ellipse[data-element-id]");
  await expect(ellipse).toHaveCount(1);
  const ellipseBox = await visibleBoundingBox(ellipse);
  await page.getByRole("button", { name: "Cota" }).click();
  await page.getByRole("group", { name: "Modo de cota" }).getByRole("button", { name: "Diámetro" }).click();
  const center = { x: ellipseBox!.x + ellipseBox!.width / 2, y: ellipseBox!.y + ellipseBox!.height / 2 };
  await page.mouse.click(center.x, center.y);
  await page.mouse.click(ellipseBox!.x + ellipseBox!.width, center.y);
  await page.mouse.click(ellipseBox!.x + ellipseBox!.width + 35, center.y);
  await expect(page.locator('[data-dimension="diameter"]')).toContainText("Ø");
  await page.getByRole("button", { name: "Confirmar", exact: true }).last().click();
  const dimension = page.locator('[data-dimension="diameter"]');
  await page.getByRole("button", { name: "Seleccion" }).click();
  await expect.poll(async () => {
    try { await dimension.click({ force: true }); } catch { return false; }
    return await page.locator('input[type="number"]').count() > 0;
  }).toBe(true);
  await page.locator('input[type="number"]').last().fill("160");
  await page.getByRole("button", { name: "Confirmar", exact: true }).last().click();
  await expect(page.locator('[data-dimension="diameter"]')).toContainText("160");
  await expect.poll(async () => (await ellipse.boundingBox())?.width ?? 0).toBeGreaterThan(0);
});

test("creates a circular Cota from a direct contour click", async ({ page }) => {
  await page.goto("/");
  const bounds = await page.locator(".page").boundingBox();
  expect(bounds).not.toBeNull();
  const center = { x: bounds!.x + 180, y: bounds!.y + 160 };
  await page.getByRole("button", { name: "Círculo" }).click();
  await page.mouse.click(center.x, center.y);
  await page.mouse.click(center.x + 90, center.y);
  const ellipse = page.locator(".page-svg svg ellipse[data-element-id]");
  await expect(ellipse).toHaveCount(1);
  const box = await visibleBoundingBox(ellipse);
  await page.getByRole("button", { name: "Cota" }).click();
  await page.getByRole("group", { name: "Modo de cota" }).getByRole("button", { name: "Radio" }).click();
  await page.mouse.click(box!.x + box!.width / 2, box!.y);
  await page.mouse.click(box!.x + box!.width + 35, box!.y + box!.height / 2);
  await expect(page.locator('[data-dimension="radius"]')).toHaveCount(1);
  await expect(page.locator('[data-dimension="radius"]')).toContainText("R");
});

test("creates an aligned Cota for a diagonal line", async ({ page }) => {
  await page.goto("/");
  const bounds = await page.locator(".page").boundingBox();
  expect(bounds).not.toBeNull();
  const start = { x: bounds!.x + 100, y: bounds!.y + 100 };
  const end = { x: bounds!.x + 220, y: bounds!.y + 100 + 120 * Math.tan(Math.PI / 6) };
  await drawLine(page, start, end);
  await page.getByRole("button", { name: "Cota" }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  await page.mouse.click((start.x + end.x) / 2 + 35, (start.y + end.y) / 2 + 35);
  await expect(page.locator('[data-dimension="aligned"]')).toHaveCount(1);
});

test.skip("creates a 90 degree angular Cota from connected line bodies", async ({ page }) => {
  await page.goto("/");
  const bounds = await page.locator(".page").boundingBox();
  expect(bounds).not.toBeNull();
  const vertex = { x: bounds!.x + 140, y: bounds!.y + 140 };
  await drawLine(page, vertex, { x: vertex.x + 120, y: vertex.y });
  await drawLine(page, vertex, { x: vertex.x, y: vertex.y + 120 });
  await page.getByRole("button", { name: "Cota" }).click();
  await page.mouse.click(vertex.x + 60, vertex.y);
  await page.mouse.click(vertex.x, vertex.y + 60);
  await page.mouse.click(vertex.x + 50, vertex.y + 50);
  await expect(page.locator('[data-dimension="angular"]')).toContainText("90°");
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
  const firstCreatedRectangle = page.locator(".page-svg svg rect[data-element-id]").first();
  await expect.poll(() => firstCreatedRectangle.boundingBox()).not.toBeNull();
  const first = await firstCreatedRectangle.boundingBox();
  expect(first).not.toBeNull();
  await page.getByRole("button", { name: "Rectángulo" }).click();
  const secondStart = { x: first!.x + first!.width / 2, y: first!.y + first!.height / 2 };
  const secondEnd = { x: secondStart.x + 30, y: secondStart.y + 20 };
  await page.mouse.click(secondStart.x, secondStart.y);
  await page.mouse.move(secondEnd.x, secondEnd.y);
  await expect(page.locator(".creation-pending-overlay")).toBeVisible();
  await page.mouse.click(secondEnd.x, secondEnd.y);
  await expect(page.locator(".page-svg svg rect[data-element-id]")).toHaveCount(2);

  await page.getByRole("button", { name: "Seleccion" }).click();
  const rectangles = page.locator(".page-svg svg rect[data-element-id]");
  await expect(rectangles).toHaveCount(2);
  await expect.poll(() => rectangles.nth(0).boundingBox()).not.toBeNull();
  await expect.poll(() => rectangles.nth(1).boundingBox()).not.toBeNull();
  const firstRectangle = await rectangles.nth(0).boundingBox();
  const secondRectangle = await rectangles.nth(1).boundingBox();
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
  await expect(nodes).toHaveCount(0);
  await expect.poll(() => page.locator(".page-svg svg path[data-element-id]").first().boundingBox()).not.toBeNull();
  const editTarget = await page.locator(".page-svg svg path[data-element-id]").first().boundingBox();
  expect(editTarget).not.toBeNull();
  await page.mouse.dblclick(editTarget!.x + editTarget!.width / 2, editTarget!.y + editTarget!.height / 2);
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

  await expect(page.locator(".page-svg svg rect[data-element-id]")).toHaveCount(1);
  await expect(page.getByText("Revisión local recuperada")).toBeVisible();
});

test("keeps a deleted object deleted after reload", async ({ page }) => {
  await page.goto("/");
  await drawRectangle(page);
  await page.getByRole("button", { name: "Seleccion" }).click();
  const rect = await page.locator(".page-svg svg rect[data-element-id]").first().boundingBox();
  expect(rect).not.toBeNull();
  await page.mouse.click(rect!.x + rect!.width / 2, rect!.y + rect!.height / 2);
  await page.keyboard.press("Delete");
  await expect(page.locator(".page-svg svg rect[data-element-id]")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".page-svg svg rect[data-element-id]")).toHaveCount(0);
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
