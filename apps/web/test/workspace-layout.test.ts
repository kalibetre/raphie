import { expect, test } from "bun:test";

import { panelFloats } from "../src/presentation/workspace/use-workspace-layout";

test("the conversations panel floats when docking would squeeze the conversation", () => {
  // 1440 leaves 836 beside the default roster (264) and panel (340).
  expect(panelFloats(1440, 264, 340)).toBe(false);
  // 960 would leave 356.
  expect(panelFloats(960, 264, 340)).toBe(true);
  // A collapsed roster makes room again.
  expect(panelFloats(960, 0, 340)).toBe(false);
  // Exactly the minimum still docks.
  expect(panelFloats(1164, 264, 340)).toBe(false);
  // Phones always use the sheet, decided elsewhere.
  expect(panelFloats(390, 0, 340)).toBe(false);
});
