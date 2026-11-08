import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Pokeidle Manager",
        short_name: "PokeManager",
        description: "Painel em tempo real das contas do Pokeidle",
        theme_color: "#0e0a06",
        background_color: "#0e0a06",
        display: "standalone",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // O WebSocket nunca passa pelo cache; só o shell estático.
        navigateFallbackDenylist: [/^\/ws\//, /^\/api\//],
      },
    }),
  ],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    proxy: {
      // Backend de telemetria (ajuste a porta conforme o backend).
      "/ws": { target: "http://localhost:8080", ws: true, changeOrigin: true },
      "/api": { target: "http://localhost:8080", changeOrigin: true },
    },
  },
});
