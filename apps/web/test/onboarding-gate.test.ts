import { expect, test } from "bun:test";

import { showsOnboarding } from "../src/presentation/workspace/onboarding-gate";

const fresh = {
  loaded: true,
  needsSetup: true,
  conversations: 0,
  settingsOpen: false,
  skipped: false,
};

test("a bot that cannot start yet joins through the flow", () => {
  expect(showsOnboarding(fresh)).toBe(true);
});

test("anything already set up, said or chosen skips it", () => {
  for (const change of [
    { loaded: false },
    { needsSetup: false },
    { conversations: 1 },
    { settingsOpen: true },
    { skipped: true },
  ])
    expect(showsOnboarding({ ...fresh, ...change })).toBe(false);
});
