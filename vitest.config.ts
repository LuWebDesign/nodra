import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@nodra/domain": new URL("./packages/domain/src/index.ts", import.meta.url).pathname,
      "@nodra/geometry": new URL("./packages/geometry/src/index.ts", import.meta.url).pathname,
      "@nodra/validation": new URL("./packages/validation/src/index.ts", import.meta.url).pathname,
      "@nodra/renderer-svg": new URL("./packages/renderer-svg/src/index.ts", import.meta.url).pathname,
      "@nodra/editor-core": new URL("./packages/editor-core/src/index.ts", import.meta.url).pathname,
      "@nodra/ui": new URL("./packages/ui/src/index.ts", import.meta.url).pathname,
      "@nodra/persistence": new URL("./packages/persistence/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/src/**/*.test.tsx", "apps/*/src/**/*.test.ts", "apps/*/src/**/*.test.tsx"],
    exclude: [...configDefaults.exclude, "**/node_modules/**", "**/dist/**", ".build", "test-results"],
    passWithNoTests: true,
    pool: "forks",
  },
});
