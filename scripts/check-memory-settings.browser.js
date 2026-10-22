// Run in a page opened on Settings → Memory in dev:web:fixture.
// Saves through the real UI and catches stale saved-state / dirty-form regressions.
export async function checkMemorySettings() {
  if (!document.title.includes("fixture"))
    throw new Error("Use the disposable fixture workspace for this check.");
  const scope = document.querySelector("#memory-scope");
  const toggle = document.querySelector(
    '[role="switch"][aria-label="Enable memory"]',
  );
  const backend = document.querySelector("#memory-backend");
  if (!scope || !toggle || !backend?.textContent.includes("built-in"))
    throw new Error(
      "Open Settings → Memory with the built-in backend selected.",
    );
  const original = scope.value;
  const enabled = toggle.getAttribute("aria-checked") === "true";
  const waitFor = async (read, label) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (read()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for ${label}`);
  };
  const button = (name) =>
    [...document.querySelectorAll("button")].find(
      (item) => item.textContent.trim() === name,
    );
  const fill = (value, selector = "#memory-scope") => {
    const input = document.querySelector(selector);
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const save = async () => {
    await waitFor(
      () => !button("Save memory settings")?.disabled,
      "saveable draft",
    );
    button("Save memory settings").click();
    await waitFor(
      () =>
        button("Save memory settings")?.disabled &&
        !document.body.textContent.includes("Save changes before testing"),
      "saved form baseline",
    );
  };
  try {
    if (!enabled) toggle.click();
    fill(`browser_probe_${Date.now()}`);
    await save();
    await waitFor(
      () => document.querySelector("#memory-query"),
      "evidence browser",
    );
    if (!document.querySelector("#memory-scope").checkValidity())
      throw new Error("A valid scope was rejected by native form validation.");
    await waitFor(
      () => document.body.textContent.includes("No memories saved yet"),
      "automatic empty-scope inventory",
    );
    fill("probe", "#memory-query");
    await waitFor(
      () => document.body.textContent.includes("0 matching memories"),
      "live search results without submitting",
    );
    button("Test saved connection").click();
    await waitFor(
      () => document.body.textContent.includes("Connection successful."),
      "connection test",
    );
    return {
      save: "passed",
      savedBaseline: "passed",
      browse: "passed",
      liveSearch: "passed",
      connection: "passed",
    };
  } finally {
    fill(original);
    const current = document.querySelector(
      '[role="switch"][aria-label="Enable memory"]',
    );
    if ((current.getAttribute("aria-checked") === "true") !== enabled)
      current.click();
    await save();
  }
}
