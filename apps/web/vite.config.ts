import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackStart({
      router: {
        routesDirectory: "./bootstrap/routes",
        generatedRouteTree: "./bootstrap/routeTree.gen.ts",
      },
    }),
    react(),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    proxy: {
      "/api": {
        target: process.env.RAPHIE_RUNTIME_URL ?? "http://127.0.0.1:4316",
        changeOrigin: true,
      },
    },
  },
});
