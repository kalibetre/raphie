import { useCallback, useEffect, useRef } from "react";

/** The overlay's measured height is also the transcript's bottom clearance. */
export function useComposerLayout(draft: string) {
  const wrapper = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = wrapper.current;
    const stage = element?.parentElement;
    if (!element || !stage) return;
    const observer = new ResizeObserver(() =>
      stage.style.setProperty(
        "--composer-height",
        `${element.getBoundingClientRect().height}px`,
      ),
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      stage.style.removeProperty("--composer-height");
    };
  }, [wrapper]);

  const revealCaret = useCallback(() => {
    const element = input.current;
    const viewport = element?.closest<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    if (!element || !viewport || document.activeElement !== element) return;
    // Measure wrapped text up to the selection, so edits in the middle stay visible too.
    const style = getComputedStyle(element);
    const mirror = document.createElement("div");
    Object.assign(mirror.style, {
      position: "fixed",
      left: "-10000px",
      visibility: "hidden",
      width: `${element.clientWidth}px`,
      whiteSpace: "pre-wrap",
      overflowWrap: "break-word",
      font: style.font,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      padding: style.padding,
      boxSizing: style.boxSizing,
    });
    mirror.textContent = element.value.slice(0, element.selectionEnd);
    const caret = document.createElement("span");
    caret.textContent = "\u200b";
    mirror.append(caret);
    document.body.append(mirror);
    const top =
      caret.getBoundingClientRect().top - mirror.getBoundingClientRect().top;
    const bottom = top + (Number.parseFloat(style.lineHeight) || 22);
    mirror.remove();
    if (bottom > viewport.scrollTop + viewport.clientHeight)
      viewport.scrollTop = bottom - viewport.clientHeight;
    else if (top < viewport.scrollTop) viewport.scrollTop = top;
  }, [input]);

  useEffect(() => {
    if (!input.current) return;
    input.current.style.height = "auto";
    input.current.style.height = `${input.current.scrollHeight}px`;
    revealCaret();
  }, [draft, input, revealCaret]);
  return { wrapper, input, revealCaret };
}
