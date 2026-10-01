import { expect, test, type Page } from "@playwright/test";

type StoredRelation = { kind: string; source?: { elementId: string }; references: Array<{ elementId: string }> };
type StoredRevision = {
  projectId: string;
  revision: number;
  savedAt: number;
  document: {
    id: string;
    elements?: Array<{ id: string }>;
    constraints?: StoredRelation[];
    pages?: Array<{ elements: Array<{ id: string }>; constraints?: StoredRelation[] }>;
  };
};
type Snapshot = { projectId: string; revision: number; savedAt: number; elementIds: string[]; relations: Array<{ kind: string; sourceId?: string; references: string[] }> };

async function createLinkedLines(page: Page, suffix: string) {
  await page.goto("/proyectos");
  await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
  await page.getByLabel("Nombre del proyecto").fill(`Linked delete ${suffix}`);
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await page.getByRole("region", { name: "Piezas" }).getByRole("button", { name: "+ Nueva pieza" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva pieza" });
  await dialog.getByLabel("Nombre de la pieza").fill("Delete regression");
  await dialog.getByRole("button", { name: "Crear pieza" }).click();

  const canvas = page.locator(".page");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const start = { x: bounds!.x + 120, y: bounds!.y + 120 };
  const end = { x: start.x + 120, y: start.y };
  await page.getByRole("button", { name: "Línea", exact: true }).click();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.waitForTimeout(180);
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();

  const nativeSource = page.locator('.page-svg svg g > line[data-element-id]').first();
  await expect(nativeSource).toHaveCount(1);
  const sourceId = (await nativeSource.getAttribute("data-element-id"))!;
  const midpoint = await nativeSource.evaluate((line) => {
    const svg = line as SVGLineElement;
    const matrix = svg.getScreenCTM();
    if (!matrix) throw new Error("Native Line has no screen transform");
    return new DOMPoint(
      (Number(svg.getAttribute("x1")) + Number(svg.getAttribute("x2"))) / 2,
      (Number(svg.getAttribute("y1")) + Number(svg.getAttribute("y2"))) / 2,
    ).matrixTransform(matrix);
  });

  await page.getByRole("button", { name: "Seleccion", exact: true }).click();
  await page.getByRole("button", { name: "Línea", exact: true }).click();
  await page.mouse.click(midpoint.x, midpoint.y);
  await page.mouse.click(midpoint.x + 70, midpoint.y + 60);
  const dependentLine = page.locator('.page-svg svg g[data-element-id] > line').last();
  await expect(dependentLine).toHaveCount(1);
  const dependentId = await dependentLine.evaluate((line) => line.parentElement?.getAttribute("data-element-id") ?? "");
  expect(dependentId).toBeTruthy();

  await page.getByRole("button", { name: "Seleccion", exact: true }).click();
  await page.mouse.click(midpoint.x + 35, midpoint.y + 30);
  const relationText = page.getByRole("list", { name: "Relaciones globales" }).getByText(/Punto medio/);
  await expect(relationText).toBeVisible();
  await expect.poll(async () => {
    const snapshot = await latestProjectSnapshot(page);
    return snapshot.relations.some((relation) => relation.kind === "midpoint" && relation.sourceId === sourceId && relation.references.includes(dependentId));
  }, { timeout: 10000 }).toBe(true);
  return { canvas, sourceId, dependentId };
}

async function latestProjectSnapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => new Promise<Snapshot>((resolve, reject) => {
    const request = indexedDB.open("nodra-persistence");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction("revisions", "readonly").objectStore("revisions").getAll();
      read.onerror = () => reject(read.error);
      read.onsuccess = () => {
        const rows = (read.result as StoredRevision[]).filter((row) => row.projectId === row.document.id).sort((a, b) => b.revision - a.revision);
        const row = rows[0];
        if (!row) { db.close(); reject(new Error("No project revision persisted")); return; }
        const elements = [...(row.document.elements ?? []), ...(row.document.pages ?? []).flatMap((page) => page.elements)];
        const constraints = [...(row.document.constraints ?? []), ...(row.document.pages ?? []).flatMap((page) => page.constraints ?? [])];
        const snapshot = {
          projectId: row.projectId,
          revision: row.revision,
          savedAt: row.savedAt,
          elementIds: elements.map((element) => element.id).sort(),
          relations: constraints.map((relation) => ({ kind: relation.kind, ...(relation.source ? { sourceId: relation.source.elementId } : {}), references: relation.references.map((reference) => reference.elementId).sort() })),
        };
        db.close();
        resolve(snapshot);
      };
    };
  }));
}

async function selectAndDeleteElements(page: Page, sourceId: string, dependentId: string) {
  await page.getByRole("button", { name: "Seleccion", exact: true }).click();
  const dependentGroup = page.locator(`.page-svg svg g[data-element-id="${dependentId}"]`);
  const dependentBox = await dependentGroup.boundingBox();
  expect(dependentBox).not.toBeNull();
  await page.mouse.click(dependentBox!.x + dependentBox!.width / 2, dependentBox!.y + dependentBox!.height / 2);
  await page.keyboard.press("Delete");
  await expect(page.locator(`.page-svg svg g[data-element-id="${dependentId}"]`)).toHaveCount(0);
  const nativeSource = page.locator(`.page-svg svg g > line[data-element-id="${sourceId}"]`);
  if (await nativeSource.count() > 0) {
    const sourceBox = await nativeSource.boundingBox();
    expect(sourceBox).not.toBeNull();
    await page.mouse.click(sourceBox!.x + sourceBox!.width * 0.2, sourceBox!.y + sourceBox!.height / 2);
    await page.keyboard.press("Delete");
    await expect(nativeSource).toHaveCount(0);
  } else {
    await expect(page.locator(`.page-svg svg g[data-element-id="${sourceId}"]`)).toHaveCount(0);
  }
  await expect(page.locator(`.page-svg svg g[data-element-id="${dependentId}"]`)).toHaveCount(0);
  await expect(nativeSource).toHaveCount(0);
}

for (const sequence of ["delete linked elements", "remove relation then delete elements"] as const) {
  test(`native Line midpoint connection persists through ${sequence} and reload`, async ({ page }) => {
    const { canvas, sourceId, dependentId } = await createLinkedLines(page, sequence);
    let beforeDelete = await latestProjectSnapshot(page);
    console.log(`${sequence} before deletion: ${JSON.stringify(beforeDelete)}`);
    expect(beforeDelete.elementIds).toEqual(expect.arrayContaining([sourceId, dependentId]));
    expect(beforeDelete.relations).toContainEqual({ kind: "midpoint", sourceId, references: [dependentId] });

    if (sequence === "remove relation then delete elements") {
      await page.getByRole("button", { name: "Seleccion", exact: true }).click();
      const sketch = page.locator(`.page-svg svg g[data-element-id="${dependentId}"]`);
      const sketchBox = await sketch.boundingBox();
      expect(sketchBox).not.toBeNull();
      await page.mouse.click(sketchBox!.x + sketchBox!.width / 2, sketchBox!.y + sketchBox!.height / 2);
      const relations = page.getByRole("list", { name: "Relaciones globales" });
      await expect(relations.getByText(/Punto medio/)).toBeVisible();
      await relations.getByRole("button", { name: "Eliminar", exact: true }).click();
      await expect(relations.getByText(/Punto medio/)).toHaveCount(0);
      await expect(page.locator(`.page-svg svg g[data-element-id="${dependentId}"]`)).toHaveCount(1);
      await expect(page.locator(`.page-svg svg g > line[data-element-id="${sourceId}"]`)).toHaveCount(1);
      await expect.poll(async () => (await latestProjectSnapshot(page)).relations).not.toContainEqual(expect.objectContaining({ kind: "midpoint", sourceId }));
      beforeDelete = await latestProjectSnapshot(page);
      console.log(`${sequence} after relation removal: ${JSON.stringify(beforeDelete)}`);
      expect(beforeDelete.elementIds).toEqual(expect.arrayContaining([sourceId, dependentId]));
      expect(beforeDelete.relations).not.toContainEqual(expect.objectContaining({ kind: "midpoint", sourceId }));
    }

    await selectAndDeleteElements(page, sourceId, dependentId);
    console.log(`${sequence} editor state after Delete: revision=${await canvas.getAttribute("data-document-revision")} elementIds=${await canvas.getAttribute("data-document-element-ids")}`);
    await expect.poll(async () => (await latestProjectSnapshot(page)).revision, { timeout: 15000 }).toBeGreaterThan(beforeDelete.revision);
    const persisted = await latestProjectSnapshot(page);
    console.log(`${sequence} after delete autosave: ${JSON.stringify(persisted)}`);
    expect(persisted.projectId).toBe(beforeDelete.projectId);
    expect(persisted.elementIds).not.toContain(sourceId);
    expect(persisted.elementIds).not.toContain(dependentId);
    expect(persisted.relations).not.toContainEqual(expect.objectContaining({ kind: "midpoint", sourceId }));

    await page.reload();
    const reloaded = await latestProjectSnapshot(page);
    console.log(`${sequence} after reload: ${JSON.stringify(reloaded)}`);
    expect(reloaded).toEqual(persisted);
    expect(reloaded.elementIds).not.toContain(sourceId);
    expect(reloaded.elementIds).not.toContain(dependentId);
    expect(reloaded.relations).not.toContainEqual(expect.objectContaining({ kind: "midpoint", sourceId }));
    await expect(page.locator(`.page-svg svg g > line[data-element-id="${sourceId}"]`)).toHaveCount(0);
    await expect(page.locator(`.page-svg svg g[data-element-id="${dependentId}"] > line`)).toHaveCount(0);
  });
}
