import { useRef } from "react";

export function PanelResizeHandle({
  side,
  value,
  onChange,
  maxWidth,
}: {
  side: "left" | "right";
  value: number;
  onChange: (value: number) => void;
  maxWidth: number;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const min = side === "left" ? 220 : 280;
  const max = maxWidth;
  const change = (width: number) =>
    onChange(Math.min(max, Math.max(min, width)));
  return (
    <div
      className={`panel-resize-handle resize-${side}`}
      role="separator"
      aria-label={
        side === "left"
          ? "Resize navigation sidebar"
          : "Resize activity sidebar"
      }
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      title="Drag to resize · Arrow keys to adjust · Double-click to reset"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        drag.current = { x: event.clientX, width: value };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current)
          change(
            drag.current.width +
              (event.clientX - drag.current.x) * (side === "left" ? 1 : -1),
          );
      }}
      onPointerUp={(event) => {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onDoubleClick={() => change(side === "left" ? 264 : 340)}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        if (event.key === "Home") change(min);
        else if (event.key === "End") change(max);
        else
          change(
            value +
              (event.key === "ArrowRight" ? 1 : -1) *
                (side === "left" ? 1 : -1) *
                (event.shiftKey ? 50 : 10),
          );
      }}
    />
  );
}
