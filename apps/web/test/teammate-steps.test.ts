import { expect, test } from "bun:test";

import { startingPersonality } from "../src/presentation/workspace/teammate-steps";

const presets = [
  { id: "candid", name: "Candid", summary: "", personality: "Be candid." },
  { id: "analyst", name: "Analyst", summary: "", personality: "Be precise." },
];

test("a new teammate starts from the first built-in personality", () => {
  expect(startingPersonality("Be thoughtful.", presets)).toBe("Be candid.");
});

test("a built-in personality already chosen is kept", () => {
  expect(startingPersonality("Be precise.", presets)).toBe("Be precise.");
});

test("without built-in personalities the draft stays", () => {
  expect(startingPersonality("Be thoughtful.", [])).toBe("Be thoughtful.");
  expect(startingPersonality("Be thoughtful.", undefined)).toBe(
    "Be thoughtful.",
  );
});
