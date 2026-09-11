import { expect, test as base, type Page } from "@playwright/test";

export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    await page.goto("/modelo");
    await expect(page.getByRole("toolbar", { name: "Herramientas de diseño" })).toBeVisible();
    await expect(page.locator(".page")).toBeVisible();
    await use(page);
  },
});

export { expect };
