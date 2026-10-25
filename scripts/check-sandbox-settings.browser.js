// Run on Settings → Sandbox in the disposable browser fixture. No model calls.
export async function checkSandboxSettings() {
  if (!document.title.includes("fixture"))
    throw new Error("Use the disposable fixture workspace for this check.");
  const form = document.querySelector(".sandbox-editor");
  const idle = form?.querySelector("#sandbox-idle");
  const quota = form?.querySelector("#sandbox-quota");
  if (!form || !idle || !quota) throw new Error("Open Settings → Sandbox.");
  const button = (name) =>
    [...form.querySelectorAll("button")].find(
      (item) => item.textContent.trim() === name,
    );
  const waitFor = async (read, label) => {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (read()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for ${label}`);
  };
  const fill = (input, value) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const bot = new URLSearchParams(location.search).get("bot");
  const base = bot
    ? `/api/bots/${encodeURIComponent(bot)}/workspace`
    : "/api/workspace";
  const read = () => fetch(base).then((response) => response.json());
  const original = (await read()).settings;
  const save = async () => {
    await waitFor(() => !button("Save changes").disabled, "saveable draft");
    button("Save changes").click();
    await waitFor(
      () =>
        button("Save changes").disabled &&
        form.textContent.includes("Saved revision"),
      "saved baseline",
    );
  };
  try {
    fill(idle, "0");
    await waitFor(
      () => button("Save changes").disabled,
      "invalid idle rejected",
    );
    fill(idle, original.idleMinutes === 25 ? "26" : "25");
    document.querySelectorAll("button").forEach((item) => {
      if (item.textContent.trim() === "Browse files") item.click();
    });
    await waitFor(
      () =>
        form.textContent.includes(
          "Save or discard your changes before leaving this page.",
        ),
      "navigation guard",
    );
    if (new URLSearchParams(location.search).get("section") !== "sandbox")
      throw new Error("Unsaved navigation was not blocked.");
    button("Discard").click();
    await waitFor(
      () => idle.value === String(original.idleMinutes),
      "discarded draft",
    );
    fill(idle, "27");
    fill(quota, "1024");
    await save();
    const saved = (await read()).settings;
    if (saved.idleMinutes !== 27 || saved.diskQuotaMiB !== 1024)
      throw new Error("Saved settings differ from the editor.");
    fill(idle, "28");
    const external = await fetch(base + "/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Raphie-Client": "web" },
      body: JSON.stringify({ ...saved, idleMinutes: 29 }),
    });
    if (!external.ok) throw new Error("Fixture concurrent save failed.");
    await waitFor(
      () => form.textContent.includes("Your draft is preserved"),
      "revision conflict after polling",
    );
    if (idle.value !== "28" || !button("Save changes").disabled)
      throw new Error("A stale draft was lost or allowed to save.");
    button("Discard").click();
    await waitFor(() => idle.value === "29", "latest revision after discard");
    fill(quota, "");
    await save();
    if ((await read()).settings.diskQuotaMiB !== null)
      throw new Error("An empty quota must mean no limit.");
    return {
      save: true,
      discard: true,
      navigationGuard: true,
      conflict: true,
      unlimitedQuota: true,
    };
  } finally {
    button("Discard").click();
    fill(idle, String(original.idleMinutes));
    fill(
      quota,
      original.diskQuotaMiB === null ? "" : String(original.diskQuotaMiB),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!button("Save changes").disabled) await save();
  }
}
