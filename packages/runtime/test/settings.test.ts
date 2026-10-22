import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import { redact } from "../src/domains/activity/infrastructure/pi-activity-journal.ts";
import { BackendSettings } from "../src/domains/settings/infrastructure/runtime-settings.ts";
import { switchableTelemetry } from "../src/infrastructure/observability/telemetry-switch.ts";
import { noTelemetry } from "../src/shared/application/telemetry.ts";
import { memoryCredentialKeyStore } from "./credential-store.ts";

test("backend settings persist model, credentials and telemetry without exposing secrets and reject busy or invalid changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-settings-"));
  const path = join(directory, "settings.sqlite");
  const models = createModels();
  models.setProvider(openrouterProvider());
  const ids = models
    .getModels("openrouter")
    .slice(0, 2)
    .map((m) => m.id);
  let verified = 0;
  const options = {
    credentialKeyStore: memoryCredentialKeyStore(),
    models,
    defaultModel: ids[0]!,
    verifyKey: async (key: string) => {
      verified++;
      if (key === "rejected") throw new Error("PRIVATE_REMOTE_ERROR");
    },
  };
  let settings = await BackendSettings.open(path, options);
  const app = await Gateway.open({ directory });
  const http = await startServer(app, { port: 0, settings });
  const post = (path: string, data: unknown) =>
    fetch(`${http.url}/api/settings${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-raphie-client": "web" },
      body: JSON.stringify(data),
    });
  try {
    assert.equal((await settings.read()).credentialSource, null);
    const listed = await fetch(`${http.url}/api/settings`).then((response) =>
      response.json(),
    );
    const bundled = openrouterProvider().getModels();
    assert.equal(listed.models.length, bundled.length);
    assert.deepEqual(
      new Set(listed.models.map((model: { id: string }) => model.id)),
      new Set(bundled.map((model) => model.id)),
    );
    const haiku = listed.models.find(
      (model: { id: string }) => model.id === "anthropic/claude-haiku-5.5",
    );
    const piHaiku = bundled.find((model) => model.id === haiku.id)!;
    assert.equal(haiku.contextWindow, piHaiku.contextWindow);
    assert.equal(haiku.provider, "openrouter");
    assert.equal(haiku.maxOutputTokens, piHaiku.maxTokens);
    assert.equal(haiku.reasoning, piHaiku.reasoning);
    assert.deepEqual(haiku.inputModalities, piHaiku.input);
    assert.equal(haiku.pricing.input, piHaiku.cost.input);
    assert.equal(haiku.pricing.output, piHaiku.cost.output);
    assert.equal("modelCatalog" in listed, false);
    assert.equal((await post("/models/refresh", {})).status, 404);
    const response = await post("", {
      provider: "openrouter",
      modelId: ids[1],
      apiKey: "PRIVATE_SAVED_KEY",
      telemetryEnabled: false,
    });
    assert.equal(response.status, 200);
    const wire = await response.text();
    assert.equal(wire.includes("PRIVATE"), false);
    assert.equal(verified, 1);
    assert.equal(settings.key, "PRIVATE_SAVED_KEY");
    assert.equal(settings.telemetryEnabled, false);
    assert.equal(settings.model?.modelId, ids[1]);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal(
      redact({ error: "Credential PRIVATE_SAVED_KEY failed" }).includes(
        "PRIVATE_SAVED_KEY",
      ),
      false,
    );
    assert.equal((await post("", { modelId: "missing" })).status, 400);
    assert.equal((await post("", { provider: "unsupported" })).status, 400);
    assert.equal((await post("", { apiKey: "rejected" })).status, 503);
    assert.equal(settings.key, "PRIVATE_SAVED_KEY");
    settings.isBusy = async () => true;
    assert.equal((await post("", { providerEnabled: false })).status, 409);
    assert.equal((await post("", { telemetryEnabled: true })).status, 200);
    settings.isBusy = async () => false;
    assert.equal((await post("/provider/test", {})).status, 200);
    assert.equal((await post("", { providerEnabled: false })).status, 200);
    assert.equal(settings.model, undefined);
    settings.close();
    settings = await BackendSettings.open(path, options);
    assert.equal(settings.key, "PRIVATE_SAVED_KEY");
    assert.equal(settings.model, undefined);
    assert.equal((await settings.read()).modelId, ids[1]);
    await settings.update({ apiKey: null, providerEnabled: true });
    assert.equal(settings.key, undefined);
    assert.equal((await settings.read()).credentialSource, null);
    // Clearing a saved key leaves the connection unconfigured, with no fallback.
    await settings.update({ apiKey: "PRIVATE_REPLACEMENT_KEY" });
    await settings.update({ apiKey: null, providerEnabled: false });
    assert.equal(settings.model, undefined);
    settings.close();
    settings = await BackendSettings.open(path, options);
    assert.equal(settings.key, undefined);
    assert.equal((await settings.read()).providerEnabled, false);
  } finally {
    await http.close();
    await app.close();
    settings.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("telemetry switch preserves execution while suppressing new trace collection", async () => {
  let enabled = true;
  let spans = 0;
  let calls = 0;
  const exporter = {
    ...noTelemetry,
    start: (...args: Parameters<typeof noTelemetry.start>) => {
      spans++;
      return noTelemetry.start(...args);
    },
    run: async <A>(
      _name: Parameters<typeof noTelemetry.run>[0],
      _attributes: Parameters<typeof noTelemetry.run>[1],
      operation: (annotate: () => void) => Promise<A>,
    ) => {
      spans++;
      return operation(() => {});
    },
  };
  const telemetry = switchableTelemetry(exporter, () => enabled);
  telemetry.start("agent.run", {}).end();
  await telemetry.run("tool.call", {}, async () => {
    calls++;
  });
  enabled = false;
  telemetry.start("model.generate", {}).end();
  await telemetry.run("tool.call", {}, async () => {
    calls++;
  });
  enabled = true;
  telemetry.start("agent.run", {}).end();
  assert.equal(spans, 3);
  assert.equal(calls, 2);
});
