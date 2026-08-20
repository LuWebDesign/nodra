import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [react(), VitePWA({ registerType: "autoUpdate", manifest: { name: "Nodra Editor", short_name: "Nodra", theme_color: "#11151d", background_color: "#11151d", display: "standalone", icons: [] }, workbox: { navigateFallback: "/index.html" } })],
  resolve: { alias: {
    "@nodra/domain": new URL("../../packages/domain/src/index.ts", import.meta.url).pathname,
    "@nodra/editor-core": new URL("../../packages/editor-core/src/index.ts", import.meta.url).pathname,
    "@nodra/geometry": new URL("../../packages/geometry/src/index.ts", import.meta.url).pathname,
    "@nodra/persistence": new URL("../../packages/persistence/src/index.ts", import.meta.url).pathname,
    "@nodra/renderer-svg": new URL("../../packages/renderer-svg/src/index.ts", import.meta.url).pathname,
  } },
});
