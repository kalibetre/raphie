import { glance } from "../application/bot-glance";
import { useBotTones } from "./bot-tones";

/** "Glance": the bot's own blob shape, with eyes looking its own way. */
export function BotAvatar({ id }: { id: string }) {
  const { path, eyes } = glance(id);
  const tone = useBotTones();
  return (
    <span className={`bot-avatar tone-${tone(id)}`} aria-hidden="true">
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
