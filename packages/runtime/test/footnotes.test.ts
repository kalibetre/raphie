import { expect, test } from "bun:test";

import {
  plainFootnotes,
  superscript,
} from "../src/domains/channels/domain/footnotes.ts";

test("footnotes become superscripts in citation order, with the notes after the reply", () => {
  expect(
    plainFootnotes(
      [
        "The threshold rises to 2M ETB.[^vat] Turnover tax stays at 2%.[^tot]",
        "",
        "Again, the threshold.[^vat]",
        "",
        "[^tot]: Addis Fortune, What the new threshold means",
        "[^vat]: VAT Proclamation amendment,",
        "  mor.gov.et",
      ].join("\n"),
    ),
  ).toBe(
    [
      "The threshold rises to 2M ETB.¹ Turnover tax stays at 2%.²",
      "",
      "Again, the threshold.¹",
      "",
      "¹ VAT Proclamation amendment, mor.gov.et",
      "² Addis Fortune, What the new threshold means",
    ].join("\n"),
  );
  expect(superscript(12)).toBe("¹²");
});

test("text without notes, code, unknown references and unused notes stay plain", () => {
  expect(plainFootnotes("No sources here.")).toBe("No sources here.");
  expect(
    plainFootnotes(
      [
        "Use `[^1]` for a note.[^1] Not this one.[^2]",
        "```",
        "[^1] in code",
        "```",
        "",
        "[^1]: The guide",
        "[^3]: Never cited",
      ].join("\n"),
    ),
  ).toBe(
    [
      "Use `[^1]` for a note.¹ Not this one.[^2]",
      "```",
      "[^1] in code",
      "```",
      "",
      "¹ The guide",
    ].join("\n"),
  );
});
