import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "corepack pnpm --filter @nodra/web dev --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "setup",
      testMatch: "**/editor.setup.ts",
      retries: 0,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      testMatch: "**/app.smoke.spec.ts",
      use: { ...devices["Desktop Chrome"], storageState: "test-results/e2e-editor-state.json" },
    },
    {
      name: "workflow-chromium",
      dependencies: ["setup"],
      testIgnore: ["**/editor.setup.ts", "**/app.smoke.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
