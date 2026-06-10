import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
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
      workbox: {
        // App shell precache; runtime caching strategies arrive in Phase 2
        globPatterns: ["**/*.{js,css,html,svg}"],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
