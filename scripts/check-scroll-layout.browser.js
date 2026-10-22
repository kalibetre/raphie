// Run in the collaborative browser's page context after opening a fixture session.
// Throws on the reported double-scroll / non-floating-composer regressions.
export function checkScrollLayout() {
  const viewport = document.querySelector(
    ".conversation-scroll [data-slot='scroll-area-viewport']",
  );
  const conversation = document.querySelector(".conversation");
  const composer = document.querySelector(".composer");
  if (!viewport || !conversation || !composer)
    throw new Error("Open a session before checking its scroll layout.");
  const native = [...document.querySelectorAll("*")].filter((element) => {
    const style = getComputedStyle(element);
    return (
      ((/auto|scroll/.test(style.overflowY) &&
        element.scrollHeight > element.clientHeight + 1) ||
        (/auto|scroll/.test(style.overflowX) &&
          element.scrollWidth > element.clientWidth + 1)) &&
      !element.matches("[data-slot=scroll-area-viewport], .sidebar-viewport")
    );
  });
  if (native.length)
    throw new Error(
      `Unexpected native scroll containers: ${native.map((e) => e.className).join(", ")}`,
    );
  if (
    conversation.getBoundingClientRect().bottom <=
    composer.getBoundingClientRect().top
  )
    throw new Error("The transcript does not extend underneath the composer.");
  if (document.documentElement.scrollWidth > innerWidth)
    throw new Error("The workspace overflows horizontally.");
  return {
    customScrollAreas: document.querySelectorAll('[data-slot="scroll-area"]')
      .length,
    transcriptHeight: viewport.clientHeight,
    transcriptContentHeight: viewport.scrollHeight,
    floatingComposer: true,
    nativeScrollers: 0,
  };
}
