import { expect, test } from "bun:test";

import { showsOnboarding } from "../src/presentation/workspace/onboarding-gate";

const fresh = {
  loaded: true,
  needsSetup: true,
  bots: 1,
  conversations: 0,
  settingsOpen: false,
  skipped: false,
};

test("a fresh install starts with onboarding", () => {
  expect(showsOnboarding(fresh)).toBe(true);
});

test("anything already set up, said or chosen skips it", () => {
  for (const change of [
    { loaded: false },
    { needsSetup: false },
    { bots: 2 },
    { conversations: 1 },
    { settingsOpen: true },
    { skipped: true },
  ])
    expect(showsOnboarding({ ...fresh, ...change })).toBe(false);
});
