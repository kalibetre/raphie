import { Database } from "bun:sqlite";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { RuntimeSettings } from "@raphie/contracts";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import { BackendSettings } from "../src/domains/settings/infrastructure/runtime-settings.ts";
import { chatModel } from "./chat-model.ts";

function fixtureModels(requests: string[]) {
  const { models } = chatModel();
  const stock = models.getProvider("fixture")!;
  models.setProvider({
    ...stock,
    id: "openrouter",
    getModels: () =>
      stock.getModels().map((model) => ({ ...model, provider: "openrouter" })),
    streamSimple: (model, transcript, options) => {
      requests.push(options?.apiKey ?? "missing");
      return stock.streamSimple(model, transcript, options);
    },
  });
  return models;
}

test("two connections to OpenRouter isolate credentials, session choices, edits and removal across restarts", async () => {
  const directory = await mkdtemp("/private/tmp/raphie-connections-");
  const requests: string[] = [];
  const models = fixtureModels(requests);
  const path = `${directory}/settings.sqlite`;
  const options = {
    models,
    defaultModel: "history",
    verifyKey: async () => {},
  };
  let settings = await BackendSettings.open(path, options);
  const app = await Gateway.open({
    directory,
    models,
    modelConnectionGate: settings.connectionGate,
  });
  settings.onChange = () => {
    app.chats.model = settings.model;
  };
  settings.isBusy = async () =>
    (await app.chats.state()).turns.some((turn) => turn.status === "pending");
  const server = await startServer(app, { port: 0, settings });
  const post = (route: string, body: unknown) =>
    fetch(`${server.url}/api/settings${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-raphie-client": "web" },
      body: JSON.stringify(body),
    });
  try {
    assert.equal(
      (
        await post("/connections", {
          provider: "openrouter",
          name: "Personal",
          apiKey: "PRIVATE_PERSONAL",
        })
      ).status,
      200,
    );
    const added = await post("/connections", {
      provider: "openrouter",
      name: "Work",
      apiKey: "PRIVATE_WORK",
    });
    const wire = await added.text();
    assert.equal(wire.includes("PRIVATE"), false);
    const data = JSON.parse(wire) as RuntimeSettings;
    assert.equal(data.connections.length, 2);
    const [personal, work] = data.connections;
    assert.notEqual(personal!.id, work!.id);
    assert.equal(data.models.length, 2);
    assert.notEqual(data.models[0]!.connectionId, data.models[1]!.connectionId);
    settings.isBusy = async () => true;
    assert.equal(
      (await post(`/connections/${work!.id}/remove`, {})).status,
      409,
    );
    assert.equal(
      (await post(`/connections/${work!.id}`, { name: "Busy edit" })).status,
      409,
    );
    assert.equal(
      (
        await post("/connections", {
          provider: "openrouter",
          name: "Busy add",
          apiKey: "PRIVATE_BUSY",
        })
      ).status,
      409,
    );
    settings.isBusy = async () =>
      (await app.chats.state()).turns.some((turn) => turn.status === "pending");
    const a = await app.chats.send({
      source: "web",
      eventId: "personal",
      actor: "owner",
      text: "Personal",
      model: { provider: personal!.id, modelId: "history" },
    });
    await app.harness.waitForIdle(context);
    const b = await app.chats.send({
      source: "web",
      eventId: "work",
      actor: "owner",
      text: "Work",
      model: { provider: work!.id, modelId: "history" },
    });
    await app.harness.waitForIdle(context);
    assert.deepEqual(requests, ["PRIVATE_PERSONAL", "PRIVATE_WORK"]);
    assert.equal(
      (
        await post(`/connections/${work!.id}`, {
          provider: "other",
          name: "Other",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post(`/connections/${work!.id}`, {
          name: "Team",
          apiKey: "PRIVATE_TEAM",
        })
      ).status,
      200,
    );
    await settings.update({ connectionId: work!.id, modelId: "history" });
    assert.equal(
      (await post(`/connections/${personal!.id}/remove`, {})).status,
      200,
    );
    assert.equal(models.getModel(personal!.id, "history"), undefined);
    await assert.rejects(
      app.chats.send({
        source: "web",
        eventId: "removed",
        actor: "owner",
        sessionId: a.sessionId,
        text: "Again",
      }),
      /unavailable/,
    );
    await app.chats.send({
      source: "web",
      eventId: "team",
      actor: "owner",
      sessionId: b.sessionId,
      text: "Again",
    });
    await app.harness.waitForIdle(context);
    assert.equal(requests.at(-1), "PRIVATE_TEAM");
    assert.equal(requests.length, 3);
    settings.close();
    settings = await BackendSettings.open(path, {
      ...options,
      models: fixtureModels([]),
    });
    const restored = await settings.read();
    assert.equal(restored.connections.length, 1);
    assert.equal(restored.connections[0]!.name, "Team");
    assert.equal(restored.connections[0]!.id, work!.id);
    assert.equal(settings.model!.provider, work!.id);
  } finally {
    await server.close();
    await app.close();
    settings.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("legacy connections keep session identity and removed environment connections stay removed after restart", async () => {
  const directory = await mkdtemp("/private/tmp/raphie-legacy-connections-");
  const path = `${directory}/settings.sqlite`;
  const db = new Database(path);
  db.exec(
    "CREATE TABLE settings (id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
  );
  db.query("INSERT INTO settings VALUES (1, ?)").run(
    JSON.stringify({
      telemetryEnabled: false,
      providerEnabled: true,
      modelId: "history",
      apiKey: null,
    }),
  );
  db.close();
  const options = {
    defaultModel: "history",
    environmentKey: "PRIVATE_ENVIRONMENT",
  };
  let settings = await BackendSettings.open(path, {
    ...options,
    models: fixtureModels([]),
  });
  try {
    assert.equal(settings.model!.provider, "openrouter");
    assert.equal(
      (await settings.read()).connections[0]!.credentialSource,
      "environment",
    );
    await settings.removeConnection("openrouter");
    assert.equal(settings.model, undefined);
    settings.close();
    settings = await BackendSettings.open(path, {
      ...options,
      models: fixtureModels([]),
    });
    assert.equal((await settings.read()).connections.length, 0);
    assert.equal(settings.model, undefined);
    assert.equal(settings.telemetryEnabled, false);
  } finally {
    settings.close();
    await rm(directory, { recursive: true, force: true });
  }
});
