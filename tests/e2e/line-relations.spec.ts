import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

const cases = [
  { label: "Paralela", kind: "parallel", glyph: "∥" },
  { label: "Igual longitud", kind: "equal", glyph: "=" },
] as const;

async function createDisposablePiece(page: Page, name: string) {
  await page.goto("/proyectos");
  await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
  await page.getByLabel("Nombre del proyecto").fill(name);
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await page.getByRole("region", { name: "Piezas" }).getByRole("button", { name: "+ Nueva pieza" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva pieza" });
  await dialog.getByLabel("Nombre de la pieza").fill(`${name} pieza`);
  await dialog.getByRole("button", { name: "Crear pieza" }).click();
  await expect(page.locator(".page")).toBeVisible();
}

async function createRelatedSketches(page: Page, relation: typeof cases[number]) {
  const bounds = await page.locator(".page").boundingBox();
  expect(bounds).not.toBeNull();
  const a = { x: bounds!.x + 110, y: bounds!.y + 120 };
  const b = { x: a.x + 90, y: a.y + 30 };
  const c = { x: bounds!.x + 300, y: bounds!.y + 260 };
  const d = relation.kind === "parallel" ? { x: c.x + 90, y: c.y + 30 } : { x: c.x + 70, y: c.y - 60 };
  const draw = async (start: { x: number; y: number }, end: { x: number; y: number }) => {
    await page.getByRole("button", { name: "Línea", exact: true }).click();
    await page.mouse.click(start.x, start.y);
    await page.mouse.click(end.x, end.y);
  };
  await draw(a, b);
  await page.getByRole("button", { name: "Seleccion" }).click();
  await draw(c, d);
  await page.getByRole("button", { name: "Forma" }).click();
  const sketches = page.locator(".page-svg svg g[data-element-id]").filter({ has: page.locator(":scope > line") });
  await expect(sketches).toHaveCount(2);
  const firstSketch = sketches.nth(0);
  const secondSketch = sketches.nth(1);
  const firstId = (await firstSketch.getAttribute("data-element-id"))!;
  const secondId = (await secondSketch.getAttribute("data-element-id"))!;
  expect(firstId).toBeTruthy();
  expect(secondId).toBeTruthy();
  expect(firstId).not.toBe(secondId);
  await expect(firstSketch.locator(":scope > line")).toHaveCount(1);
  await expect(secondSketch.locator(":scope > line")).toHaveCount(1);
  await page.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2);
  await page.keyboard.down("Shift");
  try {
    await page.mouse.click((c.x + d.x) / 2, (c.y + d.y) / 2);
  } finally {
    await page.keyboard.up("Shift");
  }
  const firstNodes = page.locator(`[data-contour-node^="${firstId}:p:"]`);
  const secondNodes = page.locator(`[data-contour-node^="${secondId}:p:"]`);
  await expect(firstNodes).toHaveCount(2);
  await expect(secondNodes).toHaveCount(2);
  await firstNodes.nth(0).click();
  await firstNodes.nth(1).click({ modifiers: ["Shift"] });
  await secondNodes.nth(0).click({ modifiers: ["Shift"] });
  await secondNodes.nth(1).click({ modifiers: ["Shift"] });
  await page.locator(".constraint-buttons").getByRole("button", { name: relation.label, exact: true }).click();
  await page.getByRole("button", { name: "Confirmar relación" }).click();
  await expect(page.getByRole("list", { name: "Relaciones globales" })).toContainText(relation.kind === "equal" ? "Igual" : relation.label);
  return { firstId, secondId, a, b, c, d };
}

async function checkGlyph(page: Page, relation: typeof cases[number], firstId: string, secondId: string, expectedConstraintId?: string) {
  const glyph = page.locator(`.page-svg svg g[data-constraint-kind="${relation.kind}"]`);
  await expect(glyph).toHaveCount(1);
  await expect(glyph).toHaveAttribute("data-constraint-owner", firstId);
  const constraintId = await glyph.getAttribute("data-constraint-id");
  expect(constraintId).toBeTruthy();
  if (expectedConstraintId !== undefined) expect(constraintId).toBe(expectedConstraintId);
  await expect(glyph.locator(":scope > text")).toHaveText(relation.glyph);
  const measured = await glyph.evaluate((element, targetId) => {
    const rect = element.getBoundingClientRect();
    const transform = element.getAttribute("transform") ?? "";
    const target = document.querySelector(`.page-svg svg g[data-element-id="${targetId}"] > line`);
    if (!(target instanceof SVGLineElement)) throw new Error("Target sketch edge missing");
    const midpoint = new DOMPoint((Number(target.getAttribute("x1")) + Number(target.getAttribute("x2"))) / 2, (Number(target.getAttribute("y1")) + Number(target.getAttribute("y2"))) / 2).matrixTransform(target.getScreenCTM()!);
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, transform, midpoint: { x: midpoint.x, y: midpoint.y } };
  }, secondId);
  expect(measured.width).toBeGreaterThan(0);
  expect(measured.height).toBeGreaterThan(0);
  expect(measured.transform).toMatch(/^translate\(/);
  expect(Math.hypot(measured.x + measured.width / 2 - measured.midpoint.x, measured.y + measured.height / 2 - measured.midpoint.y)).toBeLessThan(4);
  return glyph;
}

for (const relation of cases) {
  test(`cross-sketch ${relation.label} relation survives history and persistence`, async ({ page }, testInfo: TestInfo) => {
    const unique = `E3 ${relation.kind} ${testInfo.workerIndex}-${Date.now()}`;
    await createDisposablePiece(page, unique);
    const refs = await createRelatedSketches(page, relation);
    const glyph = await checkGlyph(page, relation, refs.firstId, refs.secondId);
    const constraintId = await glyph.getAttribute("data-constraint-id");
    expect(constraintId).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`${relation.kind}-created.png`), fullPage: true });

    await page.getByRole("button", { name: "Deshacer" }).click();
    await expect(glyph).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Relaciones globales" })).toHaveCount(0);
    await page.getByRole("button", { name: "Rehacer" }).click();
    await checkGlyph(page, relation, refs.firstId, refs.secondId, constraintId!);
    await expect(page.getByRole("list", { name: "Relaciones globales" })).toContainText(relation.kind === "equal" ? "Igual" : relation.label);

    // Observe a stable committed UI revision before reload. This proves recovery on reload, not
    // completion of the underlying official repository write (no save-status UI is exposed here).
    const pageElement = page.locator(".page");
    const committedRevision = await pageElement.getAttribute("data-document-revision");
    expect(committedRevision).toBeTruthy();
    await expect.poll(async () => {
      await page.waitForTimeout(150);
      return pageElement.getAttribute("data-document-revision");
    }).toBe(committedRevision);
    await page.reload();
    const reloadedSketches = page.locator(`.page-svg svg g[data-element-id="${refs.firstId}"], .page-svg svg g[data-element-id="${refs.secondId}"]`);
    await expect(reloadedSketches).toHaveCount(2);
    await checkGlyph(page, relation, refs.firstId, refs.secondId, constraintId!);
    await page.getByRole("button", { name: "Forma" }).click();
    const reloadedSource = page.locator(`.page-svg svg g[data-element-id="${refs.firstId}"] > line`);
    const sourceBounds = await reloadedSource.boundingBox();
    expect(sourceBounds).not.toBeNull();
    await page.mouse.click(sourceBounds!.x + sourceBounds!.width / 2, sourceBounds!.y + sourceBounds!.height / 2);
    await expect(page.getByRole("list", { name: "Relaciones globales" })).toContainText(relation.kind === "equal" ? "Igual" : relation.label);
    if (relation.kind === "parallel") {
      const sourceLine = page.locator(`.page-svg svg g[data-element-id="${refs.firstId}"] > line`);
      const before = await sourceLine.evaluate((line) => [line.getAttribute("x1"), line.getAttribute("y1"), line.getAttribute("x2"), line.getAttribute("y2")]);
      await page.getByRole("button", { name: "Forma" }).click();
      const sourceNodes = page.locator(`[data-contour-node^="${refs.firstId}:p:"]`);
      await sourceNodes.first().click();
      const node = await sourceNodes.first().boundingBox();
      expect(node).not.toBeNull();
      await page.mouse.move(node!.x + node!.width / 2, node!.y + node!.height / 2);
      await page.mouse.down();
      await page.mouse.move(node!.x + node!.width / 2 + 24, node!.y + node!.height / 2 + 13, { steps: 4 });
      await page.mouse.up();
      await expect.poll(() => sourceLine.evaluate((line) => [line.getAttribute("x1"), line.getAttribute("y1"), line.getAttribute("x2"), line.getAttribute("y2")])).not.toEqual(before);
      await expect(page.locator(`.page-svg svg g[data-constraint-kind="parallel"]`)).toHaveCount(1);
      await checkGlyph(page, relation, refs.firstId, refs.secondId, constraintId!);
      await page.screenshot({ path: testInfo.outputPath("parallel-edited.png"), fullPage: true });
    }
  });
}
