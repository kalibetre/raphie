// Run in the collaborative browser's page context on any Settings section.
// Checks both desktop navigation and the mobile sheet at the current viewport.
export async function checkSidebarNavigation() {
  const path = location.pathname;
  const mobile = innerWidth < 768;
  const waitFor = async (predicate) => {
    const deadline = Date.now() + 3000;
    while (!predicate()) {
      if (Date.now() > deadline)
        throw new Error("Sidebar navigation timed out.");
      await new Promise(requestAnimationFrame);
    }
  };
  const showNavigation = async () => {
    if (mobile) {
      document.querySelector('[aria-label="Open navigation"]').click();
      await waitFor(() => document.querySelector('[role="dialog"]'));
    }
  };
  const choose = (label) => {
    const button = [
      ...document.querySelectorAll('[data-slot="sidebar"] button'),
    ].find((element) => element.textContent.trim() === label);
    if (!button) throw new Error(`Missing sidebar destination: ${label}`);
    button.click();
  };
  const section = () => new URLSearchParams(location.search).get("section");
  await showNavigation();
  const groups = [
    ...document.querySelectorAll('[data-slot="sidebar-group-label"]'),
  ].map((element) => element.textContent);
  if (groups.join(",") !== "Runtime,Preferences")
    throw new Error("Settings destinations are not grouped correctly.");
  choose("Models");
  await waitFor(
    () =>
      section() === "models" &&
      document.querySelector("h1")?.textContent === "Models",
  );
  if (mobile) await waitFor(() => !document.querySelector('[role="dialog"]'));
  await showNavigation();
  choose("General");
  await waitFor(
    () =>
      section() === "general" &&
      document.querySelector("h1")?.textContent === "General",
  );
  if (mobile) await waitFor(() => !document.querySelector('[role="dialog"]'));
  await showNavigation();
  choose("Back to conversations");
  await waitFor(() => !location.search.includes("view=settings"));
  if (mobile) await waitFor(() => !document.querySelector('[role="dialog"]'));
  await showNavigation();
  document.querySelector('[aria-label="Settings"]').click();
  await waitFor(() => location.search.includes("view=settings"));
  if (mobile) await waitFor(() => !document.querySelector('[role="dialog"]'));
  if (location.pathname !== path)
    throw new Error("Sidebar navigation lost the selected conversation.");
  if (document.documentElement.scrollWidth > innerWidth)
    throw new Error("Sidebar layout overflows the viewport.");
  if (document.querySelector("main").inert)
    throw new Error("The mobile sheet left the workspace inert.");
  return { width: innerWidth, mobile, groups, conversationPreserved: true };
}
