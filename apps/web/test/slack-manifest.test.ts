import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { slackManifest } from "../src/domains/settings/application/slack-manifest";

test("the copied manifest is the one the Slack guide shows", async () => {
  const guide = await readFile(
    new URL("../../docs/src/content/docs/guides/slack.mdx", import.meta.url),
    "utf8",
  );
  const block = /### App manifest\s+```yaml\n([\s\S]*?)```/.exec(guide)?.[1];
  expect(block).toBeDefined();
  expect(slackManifest()).toBe(block!);
});

test("the manifest names the app after the bot, within Slack's limits", () => {
  const manifest = slackManifest("Research Assistant");
  expect(manifest).toContain("  name: Research Assistant\n");
  expect(manifest).toContain("    display_name: Research Assistant\n");

  // Anything YAML could misread is quoted.
  expect(slackManifest("Ops: on-call #2")).toContain(
    '  name: "Ops: on-call #2"\n',
  );

  const long = "A".repeat(90);
  expect(slackManifest(long)).toContain(`  name: ${"A".repeat(35)}\n`);
  expect(slackManifest(long)).toContain(
    `    display_name: ${"A".repeat(80)}\n`,
  );
  expect(slackManifest("   ")).toContain("  name: Raphie\n");
});
