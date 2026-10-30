import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { developmentGateway } from "./src/bootstrap/dev-gateway.ts";

export default defineConfig({
  define: {
    __RAPHIE_BUILD_ID__: JSON.stringify(
      process.env.RAPHIE_BUILD_ID ?? "development",
    ),
    __RAPHIE_VERSION__: JSON.stringify(
      process.env.RAPHIE_VERSION ?? "development",
    ),
  },
  plugins: [
    developmentGateway(),
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
});
