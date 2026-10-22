// Run in Settings → Memory → Browse memory on a fresh dev:web:fixture backed by a runtime
// started with RAPHIE_FIXTURE_MEMORY_HISTORY=true. Uses only synthetic records.
export async function checkMemoryBrowse() {
  if (!document.title.includes("fixture"))
    throw new Error("Use a disposable fixture workspace for this check.");
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
  const count = () => document.querySelectorAll(".memory-evidence").length;
  const fill = (selector, value) => {
    const input = document.querySelector(selector);
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  await waitFor(
    () =>
      count() === 25 &&
      document.body.textContent.includes("Showing 25 of 60 saved memories"),
    "initial memory inventory without search",
  );
  button("Load more").click();
  await waitFor(() => count() === 50, "second page");
  button("Load more").click();
  await waitFor(() => count() === 60 && !button("Load more"), "final page");
  if (
    new Set(
      [...document.querySelectorAll(".memory-evidence-content")].map(
        (item) => item.textContent,
      ),
    ).size !== 60
  )
    throw new Error("Browsing produced repeated or missing records.");
  fill("#memory-query", "jasmine");
  await waitFor(
    () =>
      count() === 1 && document.body.textContent.includes("1 matching memory"),
    "live filtering",
  );
  button("Clear search").click();
  await waitFor(
    () =>
      count() === 25 &&
      document.body.textContent.includes("Showing 25 of 60 saved memories"),
    "return to browsing",
  );
  document.querySelector(".memory-record-source summary").click();
  if (
    !document
      .querySelector(".memory-source")
      .textContent.includes("fixture:memory-001")
  )
    throw new Error("The record source is missing.");
  return {
    initialInventory: "passed",
    pagination: "60 unique records",
    filterAndClear: "passed",
    source: "passed",
  };
}
