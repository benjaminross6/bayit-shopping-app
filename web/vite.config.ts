import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Bayit Shopping App",
        short_name: "Bayit",
        description: "Shopping, receipts, and settlement for the Berkeley Bayit",
        theme_color: "#2e7d32",
        background_color: "#fafaf5",
        display: "standalone",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg}"],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
