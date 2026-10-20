import { createFileRoute } from "@tanstack/react-router";
import { proxyRuntime } from "../lib/runtime-proxy.server";
export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: ({ request }) => proxyRuntime(request),
      POST: ({ request }) => proxyRuntime(request),
      OPTIONS: ({ request }) => proxyRuntime(request),
    },
  },
});
