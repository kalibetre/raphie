import { expect, test } from "bun:test";

import {
  dueLabel,
  initials,
} from "../src/domains/conversations/application/card-facts";

test("a due date is red once past, amber today and tomorrow, and plain later", () => {
  const today = "2026-11-23";
  expect(dueLabel("2026-11-20", today)).toEqual({
    label: "Overdue 3d",
    tone: "bad",
    soon: true,
  });
  expect(dueLabel("2026-11-23", today)).toEqual({
    label: "Due today",
    tone: "attention",
    soon: true,
  });
  expect(dueLabel("2026-11-24", today)).toEqual({
    label: "Due tomorrow",
    tone: "attention",
    soon: true,
  });
  const later = dueLabel("2026-12-02", today);
  expect(later).toMatchObject({ tone: "neutral", soon: false });
  expect(later.label).toMatch(/^Due .*2/);
  // Across a month end and a year end the count is still in days.
  expect(dueLabel("2026-12-31", "2027-01-02").label).toBe("Overdue 2d");
  expect(dueLabel("soon", today)).toEqual({
    label: "soon",
    tone: "neutral",
    soon: false,
  });
});

test("a person is drawn as their first and last initials", () => {
  expect(initials("Kalkidan Betre")).toBe("KB");
  expect(initials("  mara ")).toBe("M");
  expect(initials("Ana de la Cruz")).toBe("AC");
  expect(initials("")).toBe("");
});
