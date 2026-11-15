import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useLocation,
} from "@tanstack/react-router";

import { BackendBoundary } from "../../presentation/workspace/backend-boundary";
import { UpdateNotice } from "../../presentation/workspace/update-notice";
import favicon from "../../shared/favicon.svg?inline";

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
    links: [
      { rel: "icon", type: "image/svg+xml", href: favicon },
      { rel: "stylesheet", href: styles },
    ],
  }),
  component: Root,
});

function Root() {
  // Authentication pages do not depend on the runtime workspace.
  const authPage = useLocation({
    select: (l) => l.pathname === "/login" || l.pathname === "/device",
  });
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {testWorkspace && (
          // An amber frame round the whole window, with a small tag on its
          // top edge: unmistakable, yet over none of the app's text.
          <div
            role="status"
            className="pointer-events-none fixed inset-0 z-50 border-[3px] border-amber-500"
          >
            <span
              aria-hidden="true"
              className="absolute top-0 left-1/2 -translate-x-1/2 rounded-b-md bg-amber-500 px-2 text-[9px] leading-3 font-bold tracking-wider text-black"
            >
              TEST
            </span>
            <span className="sr-only">
              Test workspace · fake models, not your data
            </span>
          </div>
        )}
        {authPage ? (
          <Outlet />
        ) : (
          <>
            <BackendBoundary>
              <Outlet />
            </BackendBoundary>
            <UpdateNotice />
          </>
        )}
        <Scripts />
      </body>
    </html>
  );
}
