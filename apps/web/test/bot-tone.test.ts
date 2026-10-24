import { expect, test } from "bun:test";

import {
  botColors,
  botEyeColor,
  botTone,
  botToneCount,
  botTones,
} from "../src/domains/settings/application/bot-tone";

test("a newly created bot avoids colors already used by older bots", () => {
  const ids = ["default", "bot-b", "bot-f", "bot-j", "bot-n"];
  const tones = ids.map((id) => botTone(id, ids));
  expect(tones[0]).toBe(0);
  expect(new Set(tones).size).toBe(ids.length);
});

test("every palette color is used before repeats, then reuse stays balanced", () => {
  const ids = ["default", ...Array.from({ length: 23 }, (_, i) => `bot-${i}`)];
  const initial = botTones(ids.slice(0, botToneCount));
  expect(new Set(initial.values()).size).toBe(botToneCount);
  const tones = botTones(ids);
  const usage = Array<number>(botToneCount).fill(0);
  for (const tone of tones.values()) usage[tone]++;
  expect(Math.max(...usage) - Math.min(...usage)).toBeLessThanOrEqual(1);
});

test("creation and repeated fetches preserve existing bots' assigned colors", () => {
  const ids = ["default", "bot-b", "bot-f", "bot-j"];
  const before = botTones(ids);
  const after = botTones([...ids, "bot-n", "bot-r"]);
  expect(botTones([...ids])).toEqual(before);
  for (const [id, tone] of before) expect(after.get(id)).toBe(tone);
  expect(botTones([...ids, "bot-b"])).toEqual(before);
});

test("default bot always reserves sage, even when omitted or listed last", () => {
  expect(botTone("default", ["bot-b", "default"])).toBe(0);
  expect(botTone("bot-b", ["bot-b"])).not.toBe(0);
});

test("custom colors override automatic allocation and older custom colors reserve their preset", () => {
  const bots = [
    { id: "default", color: "#123456" },
    { id: "bot-b", color: "#b5c99b" },
    { id: "bot-f" },
  ];
  const colors = botColors(bots);
  expect(colors.get("default")).toBe("#123456");
  expect(colors.get("bot-b")).toBe("#b5c99b");
  expect(colors.get("bot-f")).not.toBe("#b5c99b");
  expect(botColors([{ id: "default", color: null }]).get("default")).toBe(
    "#b5c99b",
  );
});

test("avatar eyes contrast with dark and light custom colors", () => {
  expect(botEyeColor("#000000")).toBe("#ffffff");
  expect(botEyeColor("#123456")).toBe("#ffffff");
  expect(botEyeColor("#ffffff")).toBe("#273329");
  expect(botEyeColor("#b5c99b")).toBe("#273329");
});
