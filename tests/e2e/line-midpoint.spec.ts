import { expect, test } from "./editor.fixture.js";

test.use({ storageState: "test-results/e2e-editor-state.json" });

test("Line infers and persists a nonincident same-sketch edge midpoint with history", async ({ page }) => {
  await page.goto("/modelo");
  const pageElement = page.locator(".page");
  const bounds = await pageElement.boundingBox();
  expect(bounds).not.toBeNull();
  const points = [
    { x: bounds!.x + 110, y: bounds!.y + 110 },
    { x: bounds!.x + 190, y: bounds!.y + 110 },
    { x: bounds!.x + 270, y: bounds!.y + 160 },
    { x: bounds!.x + 350, y: bounds!.y + 110 },
  ];
  await page.getByRole("button", { name: "Línea", exact: true }).click();
  for (const point of points) await page.mouse.click(point.x, point.y);

  const sketch = page.locator('.page-svg svg g[data-element-id]').filter({ has: page.locator(":scope > line") });
  await expect(sketch).toHaveCount(1);
  const source = sketch.locator(":scope > line").first();
  await expect(sketch.locator(":scope > line")).toHaveCount(3);
  const beforeRelationIds = await pageElement.getAttribute("data-document-element-ids");
  const beforeRevision = Number(await pageElement.getAttribute("data-document-revision"));

  // The final chain endpoint is not incident to the source edge, so appending cannot close
  // the sketch or duplicate an existing edge. Transform the source edge midpoint to screen space.
  const readMidpoint = () => source.evaluate((line) => {
    const svgLine = line as SVGLineElement;
    const matrix = svgLine.getScreenCTM();
    if (!matrix) throw new Error("Source edge has no screen transform");
    const x1 = Number(svgLine.getAttribute("x1"));
    const y1 = Number(svgLine.getAttribute("y1"));
    const x2 = Number(svgLine.getAttribute("x2"));
    const y2 = Number(svgLine.getAttribute("y2"));
    const point = new DOMPoint((x1 + x2) / 2, (y1 + y2) / 2).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  });
  let midpoint = await readMidpoint();
  const nodeGuide = page.locator('[aria-label="Guía de nodo"]');
  await expect.poll(async () => {
    midpoint = await readMidpoint();
    await page.mouse.move(midpoint.x, midpoint.y);
    const currentMidpoint = await readMidpoint();
    return Math.hypot(currentMidpoint.x - midpoint.x, currentMidpoint.y - midpoint.y);
  }, { timeout: 5000, intervals: [100, 200, 300, 500] }).toBeLessThanOrEqual(1);
  midpoint = await readMidpoint();
  await page.mouse.move(midpoint.x, midpoint.y);
  await expect(nodeGuide).toBeVisible();
  expect(await pageElement.getAttribute("data-document-revision")).toBe(String(beforeRevision));
  expect(await pageElement.getAttribute("data-document-element-ids")).toBe(beforeRelationIds);

  await page.mouse.click(midpoint.x, midpoint.y);
  const relation = page.locator('g[data-constraint-kind="midpoint"]');
  await expect(relation).toBeVisible();
  await expect(sketch.locator(":scope > line")).toHaveCount(4);
  const relationCount = await relation.count();

  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(relation).toHaveCount(0);
  await expect(sketch.locator(":scope > line")).toHaveCount(3);
  await page.getByRole("button", { name: "Rehacer" }).click();
  await expect(relation).toHaveCount(relationCount);
  await expect(sketch.locator(":scope > line")).toHaveCount(4);

  const lineEnds = async () => sketch.locator(":scope > line").evaluateAll((lines) => lines.map((line) => ({ x: Number(line.getAttribute("x2")), y: Number(line.getAttribute("y2")) })));
  const originalEnds = await lineEnds();
  const originalGlyph = await relation.boundingBox();
  expect(originalGlyph).not.toBeNull();

  await page.getByRole("button", { name: "Forma" }).click();
  await page.mouse.click(midpoint.x, midpoint.y);
  const endpointScreen = await source.evaluate((line) => {
    const svgLine = line as SVGLineElement;
    const matrix = svgLine.getScreenCTM();
    if (!matrix) throw new Error("Source edge has no screen transform");
    return new DOMPoint(Number(svgLine.getAttribute("x2")), Number(svgLine.getAttribute("y2"))).matrixTransform(matrix);
  });
  const handles = page.locator("[data-contour-node]");
  await expect(handles).toHaveCount(5);
  const handlePoints = await handles.evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }));
  const targetIndex = handlePoints.reduce((best, point, index) => Math.hypot(point.x - endpointScreen.x, point.y - endpointScreen.y) < Math.hypot(handlePoints[best]!.x - endpointScreen.x, handlePoints[best]!.y - endpointScreen.y) ? index : best, 0);
  const targetHandle = handles.nth(targetIndex);
  const targetBox = await targetHandle.boundingBox();
  expect(targetBox).not.toBeNull();
  const targetCenter = { x: targetBox!.x + targetBox!.width / 2, y: targetBox!.y + targetBox!.height / 2 };
  await page.mouse.move(targetCenter.x, targetCenter.y);
  await page.mouse.down();
  await page.mouse.move(targetCenter.x + 30, targetCenter.y, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => (await lineEnds())[0]!.x).not.toBe(originalEnds[0]!.x);
  const movedEnds = await lineEnds();
  const movedGlyph = await relation.boundingBox();
  expect(movedGlyph).not.toBeNull();
  expect(Math.hypot(movedGlyph!.x - originalGlyph!.x, movedGlyph!.y - originalGlyph!.y)).toBeGreaterThan(1);
  const sourceMm = await source.evaluate((line) => ({ x1: Number(line.getAttribute("x1")), y1: Number(line.getAttribute("y1")), x2: Number(line.getAttribute("x2")), y2: Number(line.getAttribute("y2")) }));
  expect(movedEnds[0]!.x).toBeCloseTo(sourceMm.x2, 2);
  expect(movedEnds[0]!.y).toBeCloseTo(sourceMm.y2, 2);
  expect(movedEnds[3]!.x).toBeCloseTo((sourceMm.x1 + sourceMm.x2) / 2, 2);
  expect(movedEnds[3]!.y).toBeCloseTo((sourceMm.y1 + sourceMm.y2) / 2, 2);
  await expect(relation).toBeVisible();

  // Wait for autosave to settle before checking the durable project state.
  const committedIds = await pageElement.getAttribute("data-document-element-ids");
  const committedRevision = await pageElement.getAttribute("data-document-revision");
  await expect.poll(async () => {
    await page.waitForTimeout(150);
    return pageElement.getAttribute("data-document-revision");
  }).toBe(committedRevision);
  await page.reload();
  await expect(page.locator(".page")).toHaveAttribute("data-document-element-ids", committedIds!);
  await expect(page.locator('g[data-constraint-kind="midpoint"]')).toHaveCount(relationCount);
  await expect(page.locator('.page-svg svg g[data-element-id]').filter({ has: page.locator(":scope > line") }).locator(":scope > line")).toHaveCount(4);
});
