import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", "dist", ".build", "test-results"],
    passWithNoTests: true,
    pool: "forks",
  },
});
