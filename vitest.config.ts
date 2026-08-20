import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@nodra/domain": new URL("./packages/domain/src/index.ts", import.meta.url).pathname } },
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", "dist", ".build", "test-results"],
    passWithNoTests: true,
    pool: "forks",
  },
});
