import { test } from "bun:test";
import assert from "node:assert/strict";

import {
  checkArchitecture,
  dependencyViolation,
} from "./check-architecture.mjs";

test("the codebase respects domain dependency boundaries", async () => {
  assert.deepEqual(await checkArchitecture(), []);
});
test("boundary rules reject framework and reverse-layer dependencies", () => {
  for (const [source, target] of [
    ["packages/runtime/src/domains/approvals/domain/policy.ts", "hono"],
    [
      "apps/web/src/domains/conversations/application/summary.ts",
      "apps/web/src/infrastructure/http/api.ts",
    ],
    [
      "apps/web/src/domains/conversations/domain/model.ts",
      "apps/web/src/domains/conversations/application/ports.ts",
    ],
    ["apps/web/src/presentation/chat.ts", "packages/runtime/src/domain.ts"],
    [
      "packages/runtime/src/infrastructure/discord.ts",
      "packages/runtime/src/bootstrap/main.ts",
    ],
  ])
    assert.ok(dependencyViolation(source, target), `${source} → ${target}`);
  assert.equal(
    dependencyViolation(
      "apps/web/src/domains/conversations/application/summary.ts",
      "@raphie/contracts",
    ),
    undefined,
  );
});

test("the runtime package alias cannot bypass the browser boundary", () => {
  assert.ok(
    dependencyViolation(
      "apps/web/src/infrastructure/client.ts",
      "@raphie/runtime",
    ),
  );
});

test("web components use Base UI instead of Radix primitives", () => {
  const component = "apps/web/src/shared/ui/select.tsx";
  assert.ok(dependencyViolation(component, "radix-ui"));
  assert.ok(dependencyViolation(component, "@radix-ui/react-select"));
  assert.equal(
    dependencyViolation(component, "@base-ui/react/select"),
    undefined,
  );
});
