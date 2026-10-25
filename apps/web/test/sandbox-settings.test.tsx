import { test } from "bun:test";
import assert from "node:assert/strict";

import type { SandboxInfo } from "@raphie/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";

import {
  sandboxQuery,
  saveSandboxSettings,
} from "../src/domains/settings/infrastructure/use-sandbox";
import { SandboxSettings } from "../src/domains/settings/presentation/sandbox-settings";
import { BackendContext } from "../src/infrastructure/http/backend-context";
import { BackendWorkspace } from "../src/infrastructure/http/backend-workspace";

const info: SandboxInfo = {
  settings: {
    provider: "just-bash",
    idleMinutes: 10,
    diskQuotaMiB: null,
    revision: 1,
  },
  providers: [
    { id: "just-bash", name: "just-bash", available: true, reason: null },
    {
      id: "container",
      name: "Container",
      available: false,
      reason:
        "Container execution is disabled: host and local network access are not blocked.",
    },
  ],
  provider: { id: "just-bash", name: "just-bash", version: "3.6.0" },
  isolation: "virtual-filesystem",
  capabilities: { network: false, hostFiles: false, nativeCode: false },
  root: "/workspace",
  revision: 0,
  executions: { admitted: 0, capacity: 16, runtimeConcurrency: 4 },
  usage: { fileBytes: 0, entries: 0, receiptBytes: 0 },
  limits: {
    timeoutMs: 5000,
    sourceBytes: 16384,
    outputBytes: 32768,
    fileBytes: 8388608,
    entries: 1024,
    receiptsBytes: 16777216,
  },
};

test("sandbox query and saves retain bot scope, parse responses and update only that bot's cached settings", async () => {
  const original = globalThis.fetch;
  const a = new BackendWorkspace("http://127.0.0.1:4317", "a");
  const b = new BackendWorkspace("http://127.0.0.1:4317", "b");
  let conflict = false;
  globalThis.fetch = (async (path: string, options?: RequestInit) => {
    if (!options?.body) {
      assert.equal(path, "/api/bots/a/workspace");
      return Response.json(info);
    }
    assert.equal(path, "/api/bots/a/workspace/settings");
    const input = JSON.parse(options.body as string);
    assert.equal(input.revision, 1);
    if (conflict)
      return Response.json(
        { error: "Sandbox settings changed elsewhere. Reload before saving." },
        { status: 409 },
      );
    return Response.json({ ...input, revision: 2 });
  }) as typeof fetch;
  try {
    const read = await a.queries.fetchQuery(sandboxQuery(a));
    assert.deepEqual(read, info);
    b.queries.setQueryData(["sandbox"], info);
    const saved = await saveSandboxSettings(a, {
      ...read.settings,
      idleMinutes: 20,
      diskQuotaMiB: 1024,
    });
    assert.equal(saved.revision, 2);
    assert.deepEqual(
      a.queries.getQueryData<SandboxInfo>(["sandbox"])?.settings,
      saved,
    );
    assert.deepEqual(b.queries.getQueryData<SandboxInfo>(["sandbox"]), info);
    assert.deepEqual(
      a.queries.getQueryData<SandboxInfo>(["sandbox"])?.limits,
      info.limits,
    );
    conflict = true;
    await assert.rejects(
      saveSandboxSettings(a, info.settings),
      /changed elsewhere/,
    );
    assert.deepEqual(
      a.queries.getQueryData<SandboxInfo>(["sandbox"])?.settings,
      saved,
    );
  } finally {
    a.dispose();
    b.dispose();
    globalThis.fetch = original;
  }
});

test("Sandbox renders persisted controls, unlimited quota and truthful provider-specific limits", async () => {
  const workspace = new BackendWorkspace("http://127.0.0.1:4317");
  workspace.queries.setQueryData(["sandbox"], info);
  const routeTree = createRootRoute({
    component: () => <SandboxSettings onBrowse={() => {}} />,
  });
  const router = createRouter({ routeTree, history: createMemoryHistory() });
  await router.load();
  try {
    const html = renderToStaticMarkup(
      <BackendContext.Provider
        value={{
          workspace,
          backend: workspace,
          connect: async () => {},
          selectBot: async () => {},
        }}
      >
        <QueryClientProvider client={workspace.queries}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </BackendContext.Provider>,
    );
    assert.match(
      html,
      /Container execution is disabled: host and local network access are not blocked./,
    );
    assert.match(html, /Applies to the container provider/);
    assert.match(html, /Has no effect on just-bash/);
    assert.match(html, /placeholder="No limit"/);
    assert.match(html, /value="10"/);
    assert.match(html, /fixed, read-only limits/);
    assert.match(html, /0 B used of 8.0 MiB/);
    assert.match(html, /Browse files/);
    assert.match(html, /data-visible="false"/);
  } finally {
    workspace.dispose();
  }
});

test("container Sandbox renders unlimited disk and open-network/live-write semantics without checkpoint limits", async () => {
  const workspace = new BackendWorkspace("http://127.0.0.1:4317");
  workspace.queries.setQueryData(["sandbox"], {
    ...info,
    provider: { id: "container", name: "Container", version: "native" },
    settings: { ...info.settings, provider: "container" },
    providers: info.providers.map((provider) => ({
      ...provider,
      available: true,
      reason: null,
    })),
    isolation: "container",
    capabilities: { network: true, hostFiles: false, nativeCode: true },
    usage: { fileBytes: 4096, entries: null, receiptBytes: null },
    limits: {
      ...info.limits,
      fileBytes: null,
      entries: null,
      receiptsBytes: null,
    },
  } satisfies SandboxInfo);
  const routeTree = createRootRoute({
    component: () => <SandboxSettings onBrowse={() => {}} />,
  });
  const router = createRouter({ routeTree, history: createMemoryHistory() });
  await router.load();
  try {
    const html = renderToStaticMarkup(
      <BackendContext.Provider
        value={{
          workspace,
          backend: workspace,
          connect: async () => {},
          selectBot: async () => {},
        }}
      >
        <QueryClientProvider client={workspace.queries}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </BackendContext.Provider>,
    );
    assert.match(html, /No disk quota/);
    assert.match(html, /Host and local network services are reachable/);
    assert.match(html, /Files survive failed and interrupted commands/);
    assert.match(html, /There is no rollback/);
    assert.doesNotMatch(
      html,
      /checkpoint entries|Failed or interrupted executions discard/,
    );
    assert.doesNotMatch(html, /NaN/);
  } finally {
    workspace.dispose();
  }
});
