// Run in the collaborative browser's page context against dev:fixture and
// dev:web:fixture. Run once in an existing session and once at / (new session).
// Exercises the real picker, router, Settings Back, and persisted composer draft.
export async function checkModelSettingsNavigation() {
  const path = location.pathname;
  if (path !== "/" && !path.startsWith("/sessions/"))
    throw new Error("Open a fixture session or the new-session page first.");
  const waitFor = async (read, label) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const value = read();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for ${label}`);
  };
  const input = () =>
    document.querySelector('textarea[aria-label="Message Raphie"]');
  const draft = `Navigation regression draft for ${path}`;
  const textarea = await waitFor(input, "composer");
  const transcript = document.querySelector(".conversation")?.textContent;
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  ).set.call(textarea, draft);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  await waitFor(
    () => Object.values(localStorage).includes(draft),
    "persisted draft",
  );
  document.querySelector('button[aria-label^="Choose model:"]').click();
  const manage = await waitFor(
    () =>
      [...document.querySelectorAll("button")].find((button) =>
        button.textContent.includes("Manage connection"),
      ),
    "Manage connection",
  );
  manage.click();
  const back = await waitFor(
    () => document.querySelector(".settings-back"),
    "Settings Back",
  );
  const settingsPath = location.pathname;
  if (new URLSearchParams(location.search).get("section") !== "models")
    throw new Error("Manage connection did not open model settings.");
  back.click();
  await waitFor(input, "composer after Back");
  await waitFor(() => !location.search, "conversation route after Back");
  if (location.pathname !== path)
    throw new Error(
      `Back lost session: expected ${path}, got ${location.pathname}`,
    );
  if (settingsPath !== path)
    throw new Error(`Settings lost session route: ${settingsPath}`);
  await waitFor(() => input()?.value === draft, "original draft after Back");
  if (document.querySelector(".conversation")?.textContent !== transcript)
    throw new Error("Back did not restore the original transcript.");
  return {
    path,
    settingsPath,
    returnedPath: location.pathname,
    draftRestored: true,
  };
}
