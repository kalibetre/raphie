import { test } from "bun:test";
import assert from "node:assert/strict";

import type {
  ModelSelection,
  RuntimeInfo,
  SessionObservation,
  SessionSummary,
} from "@raphie/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";

import { BackendContext } from "../src/infrastructure/http/backend-context";
import { BackendWorkspace } from "../src/infrastructure/http/backend-workspace";
import { Workspace } from "../src/presentation/workspace/workspace";

const modelA = { provider: "fixture", modelId: "fixture/model-a" };
const modelB = { provider: "fixture", modelId: "fixture/model-b" };
const session: SessionSummary = {
  id: "saved-session",
  sessionId: "saved-session",
  title: "Saved session",
  model: modelA,
  createdAt: 1,
  origin: "web",
  lastAt: 1,
  working: false,
  failed: false,
  preview: "",
  turnCount: 0,
  waiting: false,
};

// Seed the real query/projection path and render Workspace's actual Composer.
// No browser effects, network, credentials, or model calls run during SSR.
async function renderWorkspace({
  selected,
  defaultModel,
  legacy = false,
}: {
  selected?: SessionSummary;
  defaultModel: ModelSelection | null;
  legacy?: boolean;
}) {
  const workspace = new BackendWorkspace("http://127.0.0.1:4317");
  const client = workspace.queries;
  client.setQueryData<RuntimeInfo>(["runtime-info"], {
    model: defaultModel,
    mcp: { connected: false, error: false, server: null, toolCount: 0 },
    uncertainToolDeliveries: [],
  });
  client.setQueryData(["sessions"], {
    pages: [{ items: selected ? [selected] : [], next: null }],
    pageParams: [null],
  });
  if (selected) {
    client.setQueryData<SessionObservation>(["session", selected.sessionId], {
      session: selected,
      turns: [],
      toolApprovals: [],
      live: null,
      activity: [],
      nextBefore: null,
      phase: "idle",
      error: null,
    });
    if (legacy)
      client.setQueryData(["legacy-session", 42], {
        sessionId: selected.sessionId,
      });
  }
  const routeTree = createRootRoute({
    component: () => (
      <Workspace
        sessionId={legacy ? undefined : selected?.sessionId}
        legacyConversationId={legacy ? 42 : undefined}
      />
    ),
  });
  const router = createRouter({ routeTree, history: createMemoryHistory() });
  await router.load();
  try {
    return renderToStaticMarkup(
      <BackendContext.Provider value={{ workspace, connect: async () => {} }}>
        <QueryClientProvider client={client}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </BackendContext.Provider>,
    );
  } finally {
    workspace.dispose();
  }
}

function assertComposerModel(html: string, modelId: string) {
  assert.ok(
    html.includes(`aria-label="Choose model: ${modelId.split("/").at(-1)}"`),
    `Expected composer model ${modelId}`,
  );
}

test("reopening a saved session retains model A after the runtime default changes to B", async () => {
  assertComposerModel(
    await renderWorkspace({ selected: session, defaultModel: modelA }),
    modelA.modelId,
  );
  assertComposerModel(
    await renderWorkspace({ selected: session, defaultModel: modelB }),
    modelA.modelId,
  );
});

test("a new session uses the current runtime default", async () => {
  assertComposerModel(
    await renderWorkspace({ defaultModel: modelB }),
    modelB.modelId,
  );
});

test("legacy links retain the resolved session's saved model", async () => {
  assertComposerModel(
    await renderWorkspace({
      selected: session,
      defaultModel: modelB,
      legacy: true,
    }),
    modelA.modelId,
  );
});

test("sessions without a saved model retain the runtime fallback", async () => {
  assertComposerModel(
    await renderWorkspace({
      selected: { ...session, model: undefined },
      defaultModel: modelB,
    }),
    modelB.modelId,
  );
});

test("an unavailable runtime retains its warning and disabled composer", async () => {
  const html = await renderWorkspace({ selected: session, defaultModel: null });
  assertComposerModel(html, modelA.modelId);
  assert.ok(
    html.includes("Configure a model on the runtime to start chatting."),
  );
  const sendButton = html.match(
    /<button[^>]*aria-label="Send message"[^>]*>/,
  )?.[0];
  assert.ok(sendButton, "The composer renders a send button.");
  assert.match(sendButton, /\sdisabled(?:="")?(?:\s|>)/);
  const empty = await renderWorkspace({ defaultModel: null });
  assert.ok(empty.includes('aria-label="Choose model: Choose model"'));
});
