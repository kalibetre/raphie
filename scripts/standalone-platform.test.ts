import { expect, test } from "bun:test";

import { isOtherOwner, standaloneChildren } from "./standalone-platform.ts";

test("standalone launcher chooses native executable names", () => {
  expect(standaloneChildren("win32")).toEqual([
    "raphie-runtime.exe",
    "raphie-web.exe",
  ]);
  expect(standaloneChildren("darwin")).toEqual([
    "raphie-runtime",
    "raphie-web",
  ]);
  expect(standaloneChildren("linux")).toEqual(["raphie-runtime", "raphie-web"]);
});

test("owner check uses Unix IDs only where available", () => {
  expect(isOtherOwner(123, 123)).toBe(false);
  expect(isOtherOwner(123, 456)).toBe(true);
  expect(isOtherOwner(123, undefined)).toBe(false);
});
