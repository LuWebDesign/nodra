import { expect, test } from "@playwright/test";

test("loads the editor workspace", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Nodra Editor");
  await expect(page.getByRole("region", { name: "Barra de propiedades" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Seleccion" })).toBeVisible();
});
