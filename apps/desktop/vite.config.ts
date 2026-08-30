import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  clearScreen: false,
  resolve: {
    alias: {
      "@nodra/domain": new URL("../../packages/domain/src/index.ts", import.meta.url).pathname,
      "@nodra/editor-core": new URL("../../packages/editor-core/src/index.ts", import.meta.url).pathname,
      "@nodra/geometry": new URL("../../packages/geometry/src/index.ts", import.meta.url).pathname,
      "@nodra/persistence": new URL("../../packages/persistence/src/index.ts", import.meta.url).pathname,
      "@nodra/renderer-svg": new URL("../../packages/renderer-svg/src/index.ts", import.meta.url).pathname,
      "@nodra/validation": new URL("../../packages/validation/src/index.ts", import.meta.url).pathname,
    },
  },
});
