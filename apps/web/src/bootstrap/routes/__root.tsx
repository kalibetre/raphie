import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";

import { BackendBoundary } from "../../presentation/workspace/backend-boundary";

import styles from "../../shared/styles/index.css?url";

// Set by `dev:web:fixture`, so the fake-model workspace is never mistaken for the real one.
const testWorkspace = import.meta.env.VITE_RAPHIE_TEST_WORKSPACE === "1";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      {
        title: testWorkspace
          ? "TEST · Raphie fixture workspace"
          : "Raphie · Personal workspace",
      },
    ],
    links: [{ rel: "stylesheet", href: styles }],
  }),
  component: Root,
});

function Root() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {testWorkspace && (
          <div
            role="status"
            className="pointer-events-none fixed top-2 left-1/2 z-50 -translate-x-1/2 rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-black shadow"
          >
            Test workspace · fake models, not your data
          </div>
        )}
        <BackendBoundary>
          <Outlet />
        </BackendBoundary>
        <Scripts />
      </body>
    </html>
  );
}
