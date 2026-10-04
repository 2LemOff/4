/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Fractal",
        short_name: "Fractal",
        description: "Learn by questioning every answer.",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0f1115",
        theme_color: "#0f1115",
        start_url: ".",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
      workbox: { navigateFallback: "index.html" },
    }),
  ],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
