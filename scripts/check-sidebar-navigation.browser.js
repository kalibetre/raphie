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
  if (groups.join(",") !== "Setup,Workspace,Preferences")
    throw new Error("Settings destinations are not grouped correctly.");
  choose("Models");
  await waitFor(
    () =>
      section() === "models" &&
      document.querySelector("h1")?.textContent === "Models",
  );
  if (mobile) await waitFor(() => !document.querySelector('[role="dialog"]'));
  await showNavigation();
  // Memory is a collapsible group; its pages are sub-items.
  const memoryGroup = () =>
    document.querySelector(".sidebar-menu-collapsible[aria-expanded]");
  if (memoryGroup().getAttribute("aria-expanded") !== "true")
    memoryGroup().click();
  await waitFor(() => memoryGroup().getAttribute("aria-expanded") === "true");
  choose("Configuration");
  await waitFor(
    () =>
      section() === "memory" &&
      document.querySelector("h1")?.textContent === "Memory",
  );
  if (mobile) await waitFor(() => !document.querySelector('[role="dialog"]'));
  if (!mobile) {
    // Collapsed over its own page, the group stays highlighted, and going
    // back to a memory page through history reopens it.
    memoryGroup().click();
    await waitFor(() => memoryGroup().dataset.active === "true");
    choose("Models");
    await waitFor(() => section() === "models");
    history.back();
    await waitFor(
      () =>
        section() === "memory" &&
        memoryGroup().getAttribute("aria-expanded") === "true",
    );
  }
  await showNavigation();
  choose("Back to conversations");
  await waitFor(() => !location.search.includes("view=settings"));
  if (mobile) await waitFor(() => !document.querySelector('[role="dialog"]'));
  await showNavigation();
  choose("Memory");
  await waitFor(
    () =>
      section() === "memory" &&
      document.querySelector("h1")?.textContent === "Memory",
  );
  if (mobile) await waitFor(() => !document.querySelector('[role="dialog"]'));
  if (location.pathname !== path)
    throw new Error("Sidebar navigation lost the selected conversation.");
  if (document.documentElement.scrollWidth > innerWidth)
    throw new Error("Sidebar layout overflows the viewport.");
  if (document.querySelector("main").inert)
    throw new Error("The mobile sheet left the workspace inert.");
  return { width: innerWidth, mobile, groups, conversationPreserved: true };
}
