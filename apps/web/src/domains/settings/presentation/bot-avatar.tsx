import { glance } from "../application/bot-glance";

/** Stable colour family for a bot: its avatar and its settings pages share it. */
export function botTone(id: string) {
  return id === "default"
    ? 0
    : id.split("").reduce((sum, c) => sum + c.charCodeAt(0), 0) % 4;
}

/** "Glance": the bot's own blob shape, with eyes looking its own way. */
export function BotAvatar({ id }: { id: string }) {
  const { path, eyes } = glance(id);
  return (
    <span className={`bot-avatar tone-${botTone(id)}`} aria-hidden="true">
      {/* Inline size: host components (shadcn menus) resize nested svgs. */}
      <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%" }}>
        <path className="bot-avatar-body" d={path} />
        {eyes.map(([x, y]) => (
          <circle key={x} cx={x} cy={y} r={6.5} />
        ))}
      </svg>
    </span>
  );
}
