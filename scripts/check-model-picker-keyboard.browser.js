// Run in the collaborative browser's page context with the fixture picker open:
// const { checkModelPickerKeyboard } = await import('/@fs/<repo>/scripts/check-model-picker-keyboard.browser.js');
// checkModelPickerKeyboard(expectedCount);
// Use RAPHIE_FIXTURE_MODEL_CATALOG=long for 102 choices; search "acceptance"
// for two, "acceptance-alternate" for one, and a missing name for zero.
// Star five models and use the Favorites filter for five choices.
// On a fresh isolated long-catalog fixture, run checkFixtureModelPickerKeyboard()
// to exercise all five catalog sizes automatically. No model is selected or called.
export async function checkFixtureModelPickerKeyboard() {
  const settle = () =>
    new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );

  async function searchFor(value) {
    const search = document.querySelector('input[aria-label="Find a model"]');
    // Use the native setter so React receives a genuine value change.
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(search, value);
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
  }

  const results = [checkModelPickerKeyboard(102)];
  await searchFor("acceptance");
  results.push(checkModelPickerKeyboard(2));
  await searchFor("acceptance-alternate");
  results.push(checkModelPickerKeyboard(1));
  await searchFor("no-such-fixture-model");
  results.push(checkModelPickerKeyboard(0));
  await searchFor("");
  const stars = [...document.querySelectorAll(".model-picker-star")];
  if (stars.some((star) => star.getAttribute("aria-pressed") === "true"))
    throw new Error("Use a fresh isolated fixture with no saved favorites.");
  for (const star of stars.slice(0, 5)) {
    star.click();
    await settle();
  }
  document.querySelector('[aria-label="Favorite models"]').click();
  await settle();
  results.push(checkModelPickerKeyboard(5));
  // Restore fixture preferences so this probe can be repeated.
  for (const star of document.querySelectorAll(".model-picker-star")) {
    star.click();
    await settle();
  }
  document.querySelector('[aria-label="All models"]').click();
  await settle();
  return results;
}

export function checkModelPickerKeyboard(expectedCount) {
  const search = document.querySelector('input[aria-label="Find a model"]');
  const picker = search?.closest('[role="dialog"]');
  if (!search || !picker)
    throw new Error("Open the fixture model picker first.");
  const choices = [
    ...picker.querySelectorAll("[data-model-choice]:not(:disabled)"),
  ];
  if (choices.length !== expectedCount)
    throw new Error(
      `Expected ${expectedCount} choices, got ${choices.length}.`,
    );

  function press(from, key, expected, prevented = true) {
    from.focus();
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    from.dispatchEvent(event);
    if (document.activeElement !== expected)
      throw new Error(
        `${choices.length} choices: ${key} from ${from === search ? "search" : `row ${choices.indexOf(from)}`} focused row ${choices.indexOf(document.activeElement)}; expected ${choices.indexOf(expected)}.`,
      );
    if (event.defaultPrevented !== prevented)
      throw new Error(`${key}: unexpected default prevention.`);
  }

  if (!choices.length) {
    press(search, "ArrowDown", search, false);
    press(search, "ArrowUp", search, false);
  } else {
    press(search, "ArrowDown", choices[0]);
    press(search, "ArrowUp", choices.at(-1));
    for (let index = 0; index < choices.length; index++) {
      press(choices[index], "ArrowDown", choices[(index + 1) % choices.length]);
      press(
        choices[index],
        "ArrowUp",
        choices[(index + choices.length - 1) % choices.length],
      );
    }
    press(search, "ArrowLeft", search, false);
  }
  const filter = picker.querySelector('button[aria-label="All models"]');
  if (!filter) throw new Error("Missing All models filter.");
  press(filter, "ArrowDown", filter, false);
  press(filter, "ArrowUp", filter, false);
  search.focus();
  return {
    choices: choices.length,
    initialFocus: "passed",
    rowWrapping: "passed",
    unrelatedControls: "passed",
  };
}
