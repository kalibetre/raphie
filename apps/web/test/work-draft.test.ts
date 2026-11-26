import { expect, test } from "bun:test";

import { changed } from "../src/domains/settings/application/work-draft";

test("a new item sends its title and notes", () => {
  expect(changed({ title: "Tax filing", notes: "" })).toEqual({
    title: "Tax filing",
    notes: "",
  });
});

test("an edit sends only what the owner changed, so the bot's notes stay", () => {
  const started = { title: "Flights", notes: "Two options" };
  expect(
    changed({
      id: "w-1",
      title: "Flights to Porto",
      notes: "Two options",
      started,
    }),
  ).toEqual({ title: "Flights to Porto" });
  expect(
    changed({ id: "w-1", title: "Flights", notes: "Three options", started }),
  ).toEqual({ notes: "Three options" });
  expect(
    changed({ id: "w-1", title: " Flights ", notes: "Two options", started }),
  ).toBeUndefined();
});
