import { glance } from "../application/bot-glance";
import { useBotStyle } from "./bot-tones";

/** "Glance": the bot's own blob shape, with eyes looking its own way. */
export function BotAvatar({ id, color }: { id: string; color?: string }) {
  const { path, eyes } = glance(id);
  const botStyle = useBotStyle();
  return (
    <span className="bot-avatar" style={botStyle(id, color)} aria-hidden="true">
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
